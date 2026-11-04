"""Build a directed road graph from Overpass elements.

Pipeline: Overpass JSON -> OSM XML -> ``osmnx.graph_from_xml`` (unsimplified, with
``all_oneway`` so OSMnx adds each way once) -> edges rebuilt from ``rules.classify_way``
-> AOI clipping -> projected lengths -> weak/strong components -> ``simplify_graph``
with ``track_merged`` -> ``verify_simplification``.

Coordinates stay in EPSG:4326 (node ``x`` = lon, ``y`` = lat). Lengths used by the
project (``length_m``) are planar distances in the AOI's ``length_crs`` (EPSG:6680,
JGD2011 / Japan Plane Rectangular CS XII, for Sapporo); ``check_length_crs`` refuses a
CRS whose area of use does not contain the AOI. Two references are kept for checking:
``length_geod_m`` (GRS80 ellipsoidal geodesic) and OSMnx's spherical great-circle
``length`` as ``length_gc_m`` (spherical, so it can differ by ~0.3% depending on bearing).
"""

import math
import tempfile
import xml.etree.ElementTree as ET
from collections import Counter
from contextlib import contextmanager
from itertools import chain
from pathlib import Path

import networkx as nx
import osmnx as ox
from pyproj import CRS, Geod, Transformer
from shapely.geometry import LineString, box

from .aoi import Aoi
from .rules import classify_way

# Edge tags copied from OSM; direction/access are decided from all raw tags in rules.py.
EDGE_TAGS = [
    "highway", "name", "ref", "oneway", "junction", "lanes", "maxspeed", "width", "surface",
    "access", "vehicle", "motor_vehicle", "motorcar", "bridge", "tunnel", "layer", "area",
]  # fmt: skip
# OSMnx treats these oneway values as "travel against node order" and reverses them.
OSMNX_REVERSED_VALUES = {"-1", "reverse", "T"}
# Edges are never merged across a change of these attributes during simplification.
SIMPLIFY_KEEP_SEPARATE = [
    "highway", "name", "direction", "access", "routable", "aoi_status", "scc_id",
]  # fmt: skip


def overpass_to_osm_xml(elements: list[dict], path: Path) -> None:
    root = ET.Element("osm", version="0.6", generator="circuitforge-gis")
    for e in elements:
        if e["type"] == "node":
            coords = {"lat": repr(e["lat"]), "lon": repr(e["lon"])}
            el = ET.SubElement(root, "node", id=str(e["id"]), **coords)
        elif e["type"] == "way":
            el = ET.SubElement(root, "way", id=str(e["id"]))
            for n in e["nodes"]:
                ET.SubElement(el, "nd", ref=str(n))
        else:
            continue
        for k, v in e.get("tags", {}).items():
            ET.SubElement(el, "tag", k=k, v=v)
    ET.ElementTree(root).write(path, encoding="utf-8", xml_declaration=True)


@contextmanager
def _osmnx_settings(**overrides):
    old = {k: getattr(ox.settings, k) for k in overrides}
    try:
        for k, v in overrides.items():
            setattr(ox.settings, k, v)
        yield
    finally:
        for k, v in old.items():
            setattr(ox.settings, k, v)


def build_directed_graph(elements: list[dict]) -> nx.MultiDiGraph:
    """Full (unclipped, unsimplified) graph with edges following rules.classify_way."""
    rules = {e["id"]: classify_way(e.get("tags", {})) for e in elements if e["type"] == "way"}
    with tempfile.TemporaryDirectory() as tmp:
        xml_path = Path(tmp) / "aoi.osm"
        overpass_to_osm_xml(elements, xml_path)
        with _osmnx_settings(all_oneway=True, useful_tags_way=EDGE_TAGS, log_console=False):
            g0 = ox.graph_from_xml(xml_path, simplify=False, retain_all=True, bidirectional=False)

    g = nx.MultiDiGraph(crs="EPSG:4326")
    g.add_nodes_from(g0.nodes(data=True))
    for u, v, d in g0.edges(data=True):
        r = rules[d["osmid"]]
        # (a, b) is the segment in OSM way order; OSMnx stored oneway=-1/reverse/T reversed.
        a, b = (v, u) if d.get("oneway") in OSMNX_REVERSED_VALUES else (u, v)
        attrs = {k: d[k] for k in EDGE_TAGS if k in d}
        # OSMnx's GraphML loader expects a boolean "oneway"; keep the raw tag apart.
        if "oneway" in attrs:
            attrs["oneway_tag"] = attrs.pop("oneway")
        attrs.update(
            osmid=d["osmid"],
            length_gc_m=d["length"],
            direction=r.direction,
            direction_source=r.direction_source,
            access=r.access,
            access_source=r.access_source,
            review="; ".join(r.review),
            routable=r.routable,
        )
        if r.direction == "reverse":
            pairs = [(b, a, False)]
        elif r.direction == "both":
            pairs = [(a, b, True), (b, a, False)]
        else:  # forward, or uncertain: keep the drawn order only, never add the reverse
            pairs = [(a, b, True)]
        for x, y, way_order in pairs:
            # edge_uid identifies one directed raw segment; it lets verify_simplification
            # match raw and simplified edges one-to-one even when parallel edges exist.
            uid = f"{d['osmid']}:{x}:{y}:{g.number_of_edges(x, y)}"
            g.add_edge(x, y, **{**attrs, "edge_uid": uid, "way_order": way_order})
    return g


def clip_to_aoi(g: nx.MultiDiGraph, aoi: Aoi) -> tuple[nx.MultiDiGraph, dict]:
    """Keep nodes inside the AOI plus the first node beyond it on each crossing segment.

    Boundary-crossing segments keep their real OSM end node (no synthetic node is
    created at the boundary). Segments whose both ends lie outside are dropped even if
    they cut a corner of the AOI; those are counted in the returned report.
    """

    def inside(n):
        d = g.nodes[n]
        return aoi.lon_min <= d["x"] <= aoi.lon_max and aoi.lat_min <= d["y"] <= aoi.lat_max

    inner = {n for n in g.nodes if inside(n)}
    keep = inner | {m for n in inner for m in chain(g.successors(n), g.predecessors(n))}
    clipped = g.subgraph(keep).copy()
    clipped.remove_edges_from(
        [(u, v, k) for u, v, k in clipped.edges(keys=True) if u not in inner and v not in inner]
    )
    for n in clipped.nodes:
        clipped.nodes[n]["in_aoi"] = n in inner
    for u, v, d in clipped.edges(data=True):
        d["aoi_status"] = "inside" if (u in inner and v in inner) else "crossing"

    aoi_box = box(aoi.lon_min, aoi.lat_min, aoi.lon_max, aoi.lat_max)
    corner_cuts = set()
    for u, v, d in g.edges(data=True):
        if u in inner or v in inner:
            continue
        seg = LineString([(g.nodes[u]["x"], g.nodes[u]["y"]), (g.nodes[v]["x"], g.nodes[v]["y"])])
        if seg.intersects(aoi_box):
            corner_cuts.add((min(u, v), max(u, v), d["osmid"]))
    report = {
        "nodes_inside": len(inner),
        "nodes_outside_kept": len(keep) - len(inner),
        "edges_crossing": sum(
            1 for *_, d in clipped.edges(data=True) if d["aoi_status"] == "crossing"
        ),
        "dropped_segments_cutting_aoi": len(corner_cuts),
        "dropped_segments_cutting_aoi_way_ids": sorted({w for *_, w in corner_cuts}),
    }
    return clipped, report


def check_length_crs(aoi: Aoi) -> CRS:
    """Return the AOI's length CRS, or raise if it is missing or unsuitable for the AOI.

    The check uses the CRS's published area of use as a bounding box, so it rejects
    clearly wrong zones (e.g. EPSG:6680 for Tokyo) but cannot detect every boundary
    case of a zone defined by municipalities.
    """
    if not aoi.length_crs:
        raise ValueError(f"AOI {aoi.id!r} has no length_crs; set a projected CRS in metres")
    crs = CRS.from_user_input(aoi.length_crs)
    if not crs.is_projected or any(a.unit_name != "metre" for a in crs.axis_info):
        raise ValueError(f"length_crs {aoi.length_crs} must be a projected CRS in metres")
    area = crs.area_of_use
    if area is None or not (
        area.west <= aoi.lon_min and aoi.lon_max <= area.east
        and area.south <= aoi.lat_min and aoi.lat_max <= area.north
    ):  # fmt: skip
        bounds = None if area is None else (area.west, area.south, area.east, area.north)
        raise ValueError(
            f"AOI {aoi.id!r} lies outside the area of use of {aoi.length_crs} {bounds}"
        )
    return crs


def add_projected_lengths(g: nx.MultiDiGraph, length_crs: CRS) -> None:
    tr = Transformer.from_crs("EPSG:4326", length_crs, always_xy=True)
    geod = Geod(ellps="GRS80")  # reference only (JGD2011 / WGS84 ellipsoids agree here)
    g.graph["length_crs"] = length_crs.to_string()
    for _, d in g.nodes(data=True):
        d["x_proj"], d["y_proj"] = tr.transform(d["x"], d["y"])
    for u, v, d in g.edges(data=True):
        a, b = g.nodes[u], g.nodes[v]
        d["length_m"] = math.hypot(b["x_proj"] - a["x_proj"], b["y_proj"] - a["y_proj"])
        d["length_geod_m"] = geod.inv(a["x"], a["y"], b["x"], b["y"])[2]


def routable_subgraph(g: nx.MultiDiGraph) -> nx.MultiDiGraph:
    r = nx.MultiDiGraph()
    r.add_nodes_from(g.nodes)
    r.add_edges_from((u, v, k) for u, v, k, d in g.edges(keys=True, data=True) if d["routable"])
    return r


def add_components(g: nx.MultiDiGraph) -> dict:
    """wcc_id over the whole graph; scc_id over routable edges only (largest = 0)."""
    wccs = sorted(nx.weakly_connected_components(g), key=len, reverse=True)
    for i, comp in enumerate(wccs):
        for n in comp:
            g.nodes[n]["wcc_id"] = i
    sccs = sorted(nx.strongly_connected_components(routable_subgraph(g)), key=len, reverse=True)
    for i, comp in enumerate(sccs):
        for n in comp:
            g.nodes[n]["scc_id"] = i
    for u, v, d in g.edges(data=True):
        su, sv = g.nodes[u]["scc_id"], g.nodes[v]["scc_id"]
        d["wcc_id"] = g.nodes[u]["wcc_id"]
        d["scc_id"] = su if (d["routable"] and su == sv) else -1
    return {
        "wcc_count": len(wccs),
        "wcc_largest_nodes": len(wccs[0]) if wccs else 0,
        "scc_routable_count_nontrivial": sum(1 for c in sccs if len(c) > 1),
        "scc_largest_nodes": len(sccs[0]) if sccs else 0,
    }


def mark_parallel_edge_nodes(g: nx.MultiDiGraph) -> int:
    """Flag both ends of parallel edges so simplification never passes through them.

    OSMnx's simplify_graph keeps only the first of several edges between two
    interstitial nodes and drops the rest; making those nodes endpoints keeps them all.
    """
    nodes = {n for u, v, k in g.edges(keys=True) if k > 0 for n in (u, v)}
    for n in nodes:
        g.nodes[n]["parallel_edge_endpoint"] = True
    return len(nodes)


def simplify(g: nx.MultiDiGraph) -> nx.MultiDiGraph:
    mark_parallel_edge_nodes(g)
    return ox.simplify_graph(
        g,
        node_attrs_include=["parallel_edge_endpoint"],
        edge_attrs_differ=SIMPLIFY_KEEP_SEPARATE,
        remove_rings=False,  # keep isolated loops (e.g. roundabouts) in the graph
        track_merged=True,
        edge_attr_aggs={
            "length_m": sum,
            "length_geod_m": sum,
            "length_gc_m": sum,
            "edge_uid": list,
        },
    )


def verify_simplification(g: nx.MultiDiGraph, s: nx.MultiDiGraph) -> dict:
    """Check that simplification kept every raw edge exactly once, with its vertices,
    attributes and length.

    Raw and simplified edges are matched one-to-one by ``edge_uid`` (not by counts or by
    node pairs), so parallel edges cannot hide a dropped or duplicated edge. For each
    simplified edge the raw uids must form a chain from u to v in ``merged_edges`` order.
    """
    raw = {d["edge_uid"]: (u, v, d) for u, v, d in g.edges(data=True)}
    problems: list[str] = []
    if len(raw) != g.number_of_edges():
        problems.append("edge_uid is not unique in the raw graph")
    seen: Counter = Counter()
    for u, v, d in s.edges(data=True):
        uids = d["edge_uid"] if isinstance(d["edge_uid"], list) else [d["edge_uid"]]
        merged = d.get("merged_edges") or [(u, v)]
        seen.update(uids)
        if len(uids) != len(merged):
            problems.append(f"edge {u}->{v}: {len(uids)} uids for {len(merged)} merged segments")
            continue
        originals = [raw.get(uid) for uid in uids]
        if None in originals:
            problems.append(f"edge {u}->{v}: unknown edge_uid")
            continue
        if [(a, b) for a, b, _ in originals] != list(merged):
            problems.append(f"edge {u}->{v}: uids do not match merged segments")
            continue
        seq = [merged[0][0]] + [b for _, b in merged]
        if (
            seq[0] != u
            or seq[-1] != v
            or any(a != b for (_, a), (b, _) in zip(merged, merged[1:], strict=False))
        ):
            problems.append(f"edge {u}->{v}: merged path is not a chain from u to v")
            continue
        for attr in SIMPLIFY_KEEP_SEPARATE:
            if any(o.get(attr) != d.get(attr) for *_, o in originals):
                problems.append(f"edge {u}->{v}: attribute {attr} differs from raw edges")
        expected = [(g.nodes[n]["x"], g.nodes[n]["y"]) for n in seq]
        got = list(d["geometry"].coords) if "geometry" in d else expected
        if got != expected:
            problems.append(f"edge {u}->{v}: geometry vertices differ from raw nodes")
        raw_len = sum(o["length_m"] for *_, o in originals)
        if not math.isclose(raw_len, d["length_m"], rel_tol=1e-9, abs_tol=1e-6):
            problems.append(f"edge {u}->{v}: length_m {d['length_m']} != raw {raw_len}")
    duplicated = sorted(uid for uid, c in seen.items() if c > 1)
    missing = sorted(set(raw) - set(seen))
    if duplicated:
        problems.append(f"{len(duplicated)} raw edges appear in more than one simplified edge")
    if missing:
        problems.append(f"{len(missing)} raw edges missing after simplification: {missing[:5]}")
    raw_routable = routable_subgraph(g)
    simp_routable = routable_subgraph(s)
    report = {
        "raw_nodes": g.number_of_nodes(),
        "raw_edges": g.number_of_edges(),
        "simplified_nodes": s.number_of_nodes(),
        "simplified_edges": s.number_of_edges(),
        "parallel_edge_endpoints": sum(
            1 for *_, d in g.nodes(data=True) if d.get("parallel_edge_endpoint")
        ),
        "raw_edges_matched_once_by_uid": sum(1 for uid in raw if seen[uid] == 1),
        "raw_edges_duplicated": len(duplicated),
        "raw_edges_missing": len(missing),
        "total_length_m_raw": sum(d["length_m"] for *_, d in g.edges(data=True)),
        "total_length_m_simplified": sum(d["length_m"] for *_, d in s.edges(data=True)),
        "wcc_count_raw": nx.number_weakly_connected_components(g),
        "wcc_count_simplified": nx.number_weakly_connected_components(s),
        "scc_nontrivial_raw": sum(
            1 for c in nx.strongly_connected_components(raw_routable) if len(c) > 1
        ),
        "scc_nontrivial_simplified": sum(
            1 for c in nx.strongly_connected_components(simp_routable) if len(c) > 1
        ),
    }
    pairs = [
        ("wcc_count_raw", "wcc_count_simplified"),
        ("scc_nontrivial_raw", "scc_nontrivial_simplified"),
    ]
    for a, b in pairs:
        if report[a] != report[b]:
            problems.append(f"{a}={report[a]} != {b}={report[b]}")
    report["problems"] = problems
    return report
