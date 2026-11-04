"""Direction and access rules for motor-car travel on OSM ways.

OSMnx 2.1.1 treats any ``oneway`` value outside {yes, true, 1, -1, reverse, T, F}
(e.g. ``reversible``, ``alternating``, typos) as two-way, and its ``custom_filter``
does not apply the access exclusions of its built-in "drive" network type. So each
way is classified here from its raw tags, and graph edges are built from this
classification rather than from OSMnx's oneway logic (see graph.py).

Nothing here assumes travel is allowed without a stated basis: every result carries
the tag (or OSM default) it was derived from, and anything not understood is marked
for review and made non-routable.
"""

import re
from dataclasses import dataclass

FORWARD_VALUES = {"yes", "true", "1"}
REVERSE_VALUES = {"-1", "reverse"}
TWO_WAY_VALUES = {"no", "false", "0"}
# OSM documents these as implying oneway=yes when no oneway tag is present.
IMPLIED_ONEWAY_JUNCTIONS = {"roundabout", "circular"}
IMPLIED_ONEWAY_HIGHWAYS = {"motorway"}
# Usually one-way, but not an agreed implication: do not guess a direction.
UNCERTAIN_WHEN_UNTAGGED_HIGHWAYS = {"motorway_link"}

# Motor-car access, most specific key first (OSM access hierarchy).
ACCESS_KEYS = ("motorcar", "motor_vehicle", "vehicle", "access")
ALLOWED_VALUES = {"yes", "permissive", "designated"}
RESTRICTED_VALUES = {"no", "private"}

_FAMILY = re.compile(r"^(access|vehicle|motor_vehicle|motorcar|oneway)(?::(.+))?$")
# Sub-keys about other transport modes; they do not change motor-car travel.
OTHER_MODES = {
    "agricultural", "bicycle", "bus", "caravan", "coach", "disabled", "emergency",
    "foot", "forestry", "goods", "hgv", "horse", "hov", "inline_skates", "moped",
    "mofa", "motorcycle", "psv", "ski", "snowmobile", "taxi", "tourist_bus", "trailer",
}  # fmt: skip


@dataclass(frozen=True)
class WayRules:
    direction: str  # forward | reverse | both | uncertain
    direction_source: str
    access: str  # allowed | restricted | untagged | needs_review
    access_source: str
    review: tuple[str, ...]  # reasons this way needs manual review

    @property
    def routable(self) -> bool:
        return (
            self.direction != "uncertain"
            and self.access in ("allowed", "untagged")
            and not self.review
        )


def classify_direction(tags: dict[str, str]) -> tuple[str, str]:
    raw = tags.get("oneway")
    if raw is not None:
        if raw in FORWARD_VALUES:
            return "forward", f"oneway={raw}"
        if raw in REVERSE_VALUES:
            return "reverse", f"oneway={raw}"
        if raw in TWO_WAY_VALUES:
            return "both", f"oneway={raw}"
        return "uncertain", f"oneway={raw} is not a fixed direction"
    if tags.get("junction") in IMPLIED_ONEWAY_JUNCTIONS:
        return "forward", f"implied by junction={tags['junction']}"
    if tags.get("highway") in IMPLIED_ONEWAY_HIGHWAYS:
        return "forward", f"implied by highway={tags['highway']}"
    if tags.get("highway") in UNCERTAIN_WHEN_UNTAGGED_HIGHWAYS:
        return "uncertain", f"highway={tags['highway']} without oneway tag"
    return "both", "no oneway tag (OSM default: two-way)"


def classify_access(tags: dict[str, str]) -> tuple[str, str]:
    for key in ACCESS_KEYS:
        if key in tags:
            value = tags[key]
            if value in ALLOWED_VALUES:
                return "allowed", f"{key}={value}"
            if value in RESTRICTED_VALUES:
                return "restricted", f"{key}={value}"
            return "needs_review", f"{key}={value} is limited or not recognised"
    return "untagged", "no access tags (OSM default for the highway class)"


def review_reasons(tags: dict[str, str]) -> tuple[str, ...]:
    """Tags that may change motor-car direction/access but are not interpreted here."""
    reasons = []
    for key in tags:
        m = _FAMILY.match(key)
        if not m or m.group(2) is None:
            continue
        suffix_parts = m.group(2).split(":")
        if suffix_parts[0] in OTHER_MODES:
            continue
        reasons.append(f"unhandled {key}={tags[key]}")
    if tags.get("area") == "yes":
        reasons.append("area=yes")
    return tuple(sorted(reasons))


def classify_way(tags: dict[str, str]) -> WayRules:
    direction, direction_source = classify_direction(tags)
    access, access_source = classify_access(tags)
    return WayRules(direction, direction_source, access, access_source, review_reasons(tags))
