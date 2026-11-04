"""Road network profiles: which OSM highway classes are fetched.

The MVP profile matches the Issue #4 evidence query exactly. Service roads are
excluded for now; ``DRIVE_WITH_SERVICE`` shows how a future profile adds them
without touching the rest of the pipeline.
"""

from dataclasses import dataclass


@dataclass(frozen=True)
class NetworkProfile:
    name: str
    highways: tuple[str, ...]

    def overpass_filter(self) -> str:
        return f'["highway"~"^({"|".join(self.highways)})$"]'


MVP_DRIVE = NetworkProfile(
    name="mvp-drive",
    highways=(
        "motorway",
        "trunk",
        "primary",
        "secondary",
        "tertiary",
        "unclassified",
        "residential",
        "living_street",
        "motorway_link",
        "trunk_link",
        "primary_link",
        "secondary_link",
        "tertiary_link",
    ),
)

# Not used in the MVP. Service roads (parking aisles, driveways, ...) need their own
# access review before they can be routable.
DRIVE_WITH_SERVICE = NetworkProfile(
    name="drive-with-service", highways=(*MVP_DRIVE.highways, "service")
)

PROFILES = {p.name: p for p in (MVP_DRIVE, DRIVE_WITH_SERVICE)}
