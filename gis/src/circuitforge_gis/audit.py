"""Attribute audit of the OSM ways and the resulting road graph.

Reports missing and malformed tags, direction/access classes, tags that need manual
review, dead ends and components. "Missing" is reported as missing, never as valid.
"""

import re
from collections import Counter

import networkx as nx

from .graph import routable_subgraph
from .rules import classify_way

TAG_KEYS = [
    "oneway", "maxspeed", "lanes", "width", "surface", "name",
    "access", "motor_vehicle", "motorcar", "vehicle",
]  # fmt: skip
DIRECTIONS = ("forward", "reverse", "both", "uncertain")
ACCESS_CLASSES = ("allowed", "restricted", "untagged", "needs_review")
_NUMERIC = re.compile(r"^\d+(\.\d+)?$")
_MAXSPEED = re.compile(r"^\d+( mph)?$")


def audit_ways(elements: list[dict]) -> dict:
    ways = [e for e in elements if e["type"] == "way"]
    n = len(ways)
    missing = {k: sum(1 for w in ways if k not in w.get("tags", {})) for k in TAG_KEYS}
    malformed: Counter = Counter()
    multivalued: Counter = Counter()
    rules = Counter()
    review = Counter()
    by_highway = Counter()
    default_two_way = Counter()
    for w in ways:
        t = w.get("tags", {})
        by_highway[t.get("highway")] += 1
        if "lanes" in t and not _NUMERIC.match(t["lanes"]):
            malformed["lanes"] += 1
        if "maxspeed" in t and not _MAXSPEED.match(t["maxspeed"]):
            malformed["maxspeed"] += 1
        for k, v in t.items():
            if ";" in v and k in TAG_KEYS:
                multivalued[k] += 1
        r = classify_way(t)
        rules[(r.direction, r.direction_source)] += 1
        rules[(r.access, r.access_source)] += 1
        if r.direction == "both" and "oneway" not in t:
            default_two_way[t.get("highway")] += 1
        for reason in r.review:
            review[reason.split("=")[0]] += 1
    return {
        "ways": n,
        "by_highway": dict(by_highway.most_common()),
        "missing_share": {k: round(v / n, 4) for k, v in missing.items()} if n else {},
        "malformed": dict(malformed),
        "multivalued": dict(multivalued),
        "direction": {f"{d} ({src})": c for (d, src), c in rules.items() if d in DIRECTIONS},
        # Two-way only because no oneway tag exists; dual carriageways on major roads
        # with a missing tag would show up here and need checking.
        "two_way_by_osm_default_by_highway": dict(default_two_way.most_common()),
        "access": {f"{a} ({src})": c for (a, src), c in rules.items() if a in ACCESS_CLASSES},
        "review_keys": dict(review.most_common()),
        "routable_ways": sum(1 for w in ways if classify_way(w.get("tags", {})).routable),
    }


def audit_graph(g: nx.MultiDiGraph) -> dict:
    r = routable_subgraph(g)
    inside = [n for n, d in g.nodes(data=True) if d.get("in_aoi")]
    dead_out = [n for n in inside if r.out_degree(n) == 0 and r.in_degree(n) > 0]
    dead_in = [n for n in inside if r.in_degree(n) == 0 and r.out_degree(n) > 0]
    # Cul-de-sacs: inside nodes whose routable edges reach a single neighbour.
    culdesac = [n for n in inside if len(set(r.successors(n)) | set(r.predecessors(n))) == 1]
    edges = list(g.edges(data=True))
    total = sum(d["length_m"] for *_, d in edges)
    routable_len = sum(d["length_m"] for *_, d in edges if d["routable"])
    largest_scc_len = sum(d["length_m"] for *_, d in edges if d["scc_id"] == 0)

    def max_rel_diff(ref):  # segments >= 1 m, to avoid rounding noise on tiny segments
        diffs = [abs(d["length_m"] - d[ref]) / d[ref] for *_, d in edges if d[ref] >= 1]
        return round(max(diffs), 6) if diffs else None

    return {
        "nodes": g.number_of_nodes(),
        "edges": g.number_of_edges(),
        "edges_by_direction": dict(Counter(d["direction"] for *_, d in edges)),
        "edges_by_access": dict(Counter(d["access"] for *_, d in edges)),
        "edges_routable": sum(1 for *_, d in edges if d["routable"]),
        "self_loops": nx.number_of_selfloops(g),
        "dead_end_no_exit_inside_aoi": len(dead_out),
        "dead_end_no_entry_inside_aoi": len(dead_in),
        "cul_de_sac_nodes_inside_aoi": len(culdesac),
        "length_m_total": round(total, 1),
        "length_m_routable": round(routable_len, 1),
        "length_m_largest_routable_scc": round(largest_scc_len, 1),
        "largest_scc_share_of_routable_length": (
            round(largest_scc_len / routable_len, 4) if routable_len else None
        ),
        "length_epsg6680_vs_grs80_geodesic_max_rel_diff": max_rel_diff("length_geod_m"),
        "length_epsg6680_vs_spherical_great_circle_max_rel_diff": max_rel_diff("length_gc_m"),
    }


def to_markdown(report: dict) -> str:
    lines = ["# OSM road graph audit", ""]
    for section, body in report.items():
        lines.append(f"## {section}")
        if isinstance(body, dict):
            for k, v in body.items():
                lines.append(f"- **{k}**: {v}")
        else:
            lines.append(str(body))
        lines.append("")
    return "\n".join(lines)
