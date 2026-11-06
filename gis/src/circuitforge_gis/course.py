"""CircuitForge course files: build from manual input, validate against the road graph.

A course is one GeoJSON Feature (``contracts/course.schema.json``). Its ordered
``segments`` (``edge_uid`` = way_id:segment_index:f|r) are the source of truth;
geometry and ``length_m`` are derived from them and re-checked on validation.

Building is a manual-authoring aid only: the user chooses via points (or the full
segment list) and gaps between via points are filled with the shortest path on
routable edges inside the AOI. It does not try to make an interesting circuit;
preference-aware generation belongs to Issue #10 and later.
"""

import heapq
import importlib.metadata
import json
from collections import Counter
from collections.abc import Callable

import networkx as nx
from jsonschema import Draft202012Validator
from pyproj import CRS, Transformer

from .aoi import REPO_ROOT, Aoi
from .graph import check_length_crs

SCHEMA_PATH = REPO_ROOT / "contracts" / "course.schema.json"
SCHEMA_ID = "circuitforge-course"
SCHEMA_VERSION = "0.1.1"  # 0.1.1: authoring.method "generated-outbound-return" (Issue #10)
RULE_SET = "circuitforge-gis/D-0010"
TOOL = f"circuitforge-gis {importlib.metadata.version('circuitforge-gis')}"
MAX_SNAP_M = 30.0
LENGTH_REL_TOLERANCE = 1e-3  # stored length_m may differ from the recomputed one by 0.1%
COORD_TOLERANCE_DEG = 1e-9
MAJOR_HIGHWAYS = {"motorway", "trunk", "primary", "secondary"}
PATH_COMPLETION = (
    "shortest path by length_m (integer millimetres) on routable edges inside the AOI; "
    "ties broken by the lexicographically smallest edge_uid sequence"
)
ATTRIBUTION_OSM = "© OpenStreetMap contributors (ODbL 1.0)"
DISCLAIMER = (
    "Fictional course for visualisation and research only. Not a proposal to drive, race "
    "or close public roads. 架空の可視化用コースであり、公道走行の提案ではありません。"
)


class CourseError(ValueError):
    pass


def edge_index(g: nx.MultiDiGraph) -> dict[str, tuple[int, int, dict]]:
    return {d["edge_uid"]: (u, v, d) for u, v, d in g.edges(data=True)}


def search_graph(g: nx.MultiDiGraph) -> nx.MultiDiGraph:
    """Edges a course may use: routable (Issue #6 rules) and fully inside the AOI."""
    s = nx.MultiDiGraph()
    s.add_edges_from(
        (u, v, k, d)
        for u, v, k, d in g.edges(keys=True, data=True)
        if d["routable"] and d["aoi_status"] == "inside"
    )
    return s


def length_mm(d: dict) -> int:
    return round(d["length_m"] * 1000)


def shortest_path(
    s: nx.MultiDiGraph, source: int, target: int, cost: Callable[[dict], int] = length_mm
) -> list[str]:
    """Deterministic shortest path as a list of edge_uids.

    Labels are (cost, tuple of edge_uids) and compared lexicographically, so among
    equal-cost paths the one with the smallest edge_uid sequence wins, independent of
    graph insertion order. ``cost`` maps edge data to an integer (default: length in mm).
    """
    if source == target:
        return []
    best: dict[int, tuple[int, tuple[str, ...]]] = {source: (0, ())}
    heap: list[tuple[int, tuple[str, ...], int]] = [(0, (), source)]
    done: set[int] = set()
    while heap:
        cost_so_far, path, n = heapq.heappop(heap)
        if n in done:
            continue
        done.add(n)
        if n == target:
            return list(path)
        for _, m, d in s.out_edges(n, data=True):
            if m in done:
                continue
            label = (cost_so_far + cost(d), (*path, d["edge_uid"]))
            if m not in best or label < best[m]:
                best[m] = label
                heapq.heappush(heap, (label[0], label[1], m))
    raise CourseError(
        f"no route from node {source} to node {target} on routable edges inside the AOI"
    )


def snap(s: nx.MultiDiGraph, g: nx.MultiDiGraph, lon: float, lat: float, crs) -> tuple[int, float]:
    """Nearest node of the search graph to (lon, lat), with its distance in metres."""
    tr = Transformer.from_crs("EPSG:4326", crs, always_xy=True)
    x, y = tr.transform(lon, lat)
    best = min(
        s.nodes,
        key=lambda n: ((g.nodes[n]["x_proj"] - x) ** 2 + (g.nodes[n]["y_proj"] - y) ** 2, n),
    )
    dist = ((g.nodes[best]["x_proj"] - x) ** 2 + (g.nodes[best]["y_proj"] - y) ** 2) ** 0.5
    if dist > MAX_SNAP_M:
        raise CourseError(f"via point ({lon}, {lat}) is {dist:.1f} m from the nearest usable node")
    return best, dist


def expand_simplified_path(s: nx.MultiDiGraph, edges: list[tuple[int, int, int]]) -> list[str]:
    """Raw edge_uids, in travel order, of a path given as simplified-graph edges (u, v, key)."""
    uids: list[str] = []
    for u, v, k in edges:
        uid = s.edges[u, v, k]["edge_uid"]
        uids.extend(uid if isinstance(uid, list) else [uid])
    return uids


def _feature(g, aoi: Aoi, snapshot: dict, uids: list[str], meta: dict) -> dict:
    idx = edge_index(g)
    missing = [u for u in uids if u not in idx]
    if missing:
        raise CourseError(f"unknown edge_uid(s): {missing[:5]}")
    segs = [
        {
            "edge_uid": uid,
            "way_id": idx[uid][2]["osmid"],
            "from_node": idx[uid][0],
            "to_node": idx[uid][1],
        }
        for uid in uids
    ]
    nodes = [segs[0]["from_node"]] + [s["to_node"] for s in segs]
    return {
        "type": "Feature",
        "geometry": {
            "type": "LineString",
            "coordinates": [[g.nodes[n]["x"], g.nodes[n]["y"]] for n in nodes],
        },
        "properties": {
            "schema": SCHEMA_ID,
            "schema_version": SCHEMA_VERSION,
            **meta,
            "fictional": True,
            "aoi": {
                "id": aoi.id,
                "bbox": [aoi.lon_min, aoi.lat_min, aoi.lon_max, aoi.lat_max],
                "length_crs": aoi.length_crs,
            },
            "osm_snapshot": snapshot,
            "rule_set": RULE_SET,
            "segments": segs,
            "length_m": round(sum(idx[u][2]["length_m"] for u in uids), 3),
        },
    }


def build_course(
    g: nx.MultiDiGraph,
    aoi: Aoi,
    snapshot: dict,
    *,
    course_id: str,
    name: str,
    mode: str,
    via: list | None = None,
    segments: list[str] | None = None,
    preferences: dict | None = None,
    attribution: str = ATTRIBUTION_OSM,
    synthetic: bool = False,
    authoring: dict | None = None,
) -> dict:
    """Build a course from via points (node ids or [lon, lat]) or an explicit segment list.

    ``authoring`` replaces the default record for a segment list (used by generators)."""
    if (via is None) == (segments is None):
        raise CourseError("give either via points or segments")
    crs = check_length_crs(aoi)
    if via is not None:
        s = search_graph(g)
        nodes, snapped = [], []
        for item in via:
            if isinstance(item, int):
                if item not in s:
                    raise CourseError(f"via node {item} has no routable edge inside the AOI")
                nodes.append(item)
                snapped.append({"node": item})
            else:
                node, dist = snap(s, g, float(item[0]), float(item[1]), crs)
                nodes.append(node)
                snapped.append(
                    {"lon_lat": list(item), "node": node, "snap_distance_m": round(dist, 2)}
                )
        stops = nodes + [nodes[0]] if mode == "circuit" else nodes
        uids = [
            uid for a, b in zip(stops, stops[1:], strict=False) for uid in shortest_path(s, a, b)
        ]
        authoring = {
            "method": "manual-via-points",
            "via": snapped,
            "path_completion": PATH_COMPLETION,
            "tool": TOOL,
        }
    else:
        uids = list(segments)
        authoring = authoring or {"method": "manual-segments", "tool": TOOL}
    if not uids:
        raise CourseError("the course has no segments")
    meta = {"id": course_id, "name": name, "mode": mode, "authoring": authoring}
    if preferences:
        meta["preferences"] = preferences
    course = _feature(g, aoi, snapshot, uids, meta)
    props = course["properties"]
    if synthetic:
        props["synthetic"] = True
    props["attribution"] = attribution
    props["disclaimer"] = DISCLAIMER
    props["validation"] = validate(course, g, snapshot["element_sha256"], expected_aoi=aoi)
    return course


def _issue(code: str, message: str, index: int | None = None) -> dict:
    out = {"code": code, "message": message}
    if index is not None:
        out["segment_index"] = index
    return out


def _same_crs(a: str, b: str) -> bool:
    return CRS.from_user_input(a) == CRS.from_user_input(b)


def validate(
    course: dict, g: nx.MultiDiGraph, snapshot_sha256: str, expected_aoi: Aoi | None = None
) -> dict:
    """Validate a course against the road graph built from the given OSM snapshot.

    The course's own metadata is not trusted: ``aoi.length_crs`` must be the CRS the
    graph's lengths were computed in (``g.graph["length_crs"]``), and when
    ``expected_aoi`` (the AOI the graph was built from) is given, the course's AOI must
    match it.
    """
    errors: list[dict] = []
    warnings: list[dict] = []

    def result(metrics=None):
        return {
            "status": "invalid" if errors else "valid",
            "errors": errors,
            "warnings": warnings,
            "validator": TOOL,
            **({"metrics": metrics} if metrics else {}),
        }

    schema = json.loads(SCHEMA_PATH.read_text())
    for e in sorted(Draft202012Validator(schema).iter_errors(course), key=lambda e: list(e.path)):
        errors.append(_issue("E_SCHEMA", f"{'/'.join(map(str, e.path))}: {e.message}"))
    if errors:
        return result()

    p = course["properties"]
    a = p["aoi"]
    aoi = Aoi(a["id"], a["id"], *a["bbox"], length_crs=a["length_crs"])
    try:
        check_length_crs(aoi)
    except ValueError as exc:
        errors.append(_issue("E_LENGTH_CRS", str(exc)))
    graph_crs = g.graph.get("length_crs")
    if graph_crs is None:
        errors.append(_issue("E_LENGTH_CRS_MISMATCH", "the road graph has no recorded length CRS"))
    elif not _same_crs(a["length_crs"], graph_crs):
        errors.append(
            _issue(
                "E_LENGTH_CRS_MISMATCH",
                f"course length_crs {a['length_crs']} differs from the graph's {graph_crs}",
            )
        )
    if expected_aoi is not None:
        exp = [
            expected_aoi.lon_min,
            expected_aoi.lat_min,
            expected_aoi.lon_max,
            expected_aoi.lat_max,
        ]
        same_bbox = all(
            abs(x - y) <= COORD_TOLERANCE_DEG for x, y in zip(a["bbox"], exp, strict=True)
        )
        if a["id"] != expected_aoi.id or not same_bbox:
            errors.append(
                _issue(
                    "E_AOI_MISMATCH",
                    f"course AOI {a['id']} {a['bbox']} differs from {expected_aoi.id} {exp}",
                )
            )
    if p["osm_snapshot"]["element_sha256"] != snapshot_sha256:
        errors.append(
            _issue(
                "E_SNAPSHOT_MISMATCH",
                "course was made from a different OSM snapshot than the graph",
            )
        )
        return result()

    idx = edge_index(g)
    segs = p["segments"]
    known = []
    for i, seg in enumerate(segs):
        uid = seg["edge_uid"]
        if uid not in idx:
            way, seq, direction = uid.rsplit(":", 2)
            flipped = f"{way}:{seq}:{'r' if direction == 'f' else 'f'}"
            if flipped in idx:
                errors.append(
                    _issue(
                        "E_DIRECTION_NOT_ALLOWED",
                        f"{uid}: travel in this direction is not allowed (one-way or uncertain)",
                        i,
                    )
                )
            else:
                errors.append(_issue("E_UNKNOWN_SEGMENT", f"{uid}: not in the road graph", i))
            continue
        u, v, d = idx[uid]
        known.append(uid)
        if (seg["way_id"], seg["from_node"], seg["to_node"]) != (d["osmid"], u, v):
            errors.append(
                _issue(
                    "E_SEGMENT_MISMATCH",
                    f"{uid}: way_id/from_node/to_node disagree with the graph",
                    i,
                )
            )
        if not d["routable"]:
            reason = d["review"] or f"direction={d['direction']}, access={d['access']}"
            errors.append(_issue("E_NOT_ROUTABLE", f"{uid}: not routable ({reason})", i))
        if d["aoi_status"] != "inside":
            errors.append(_issue("E_OUTSIDE_AOI", f"{uid}: segment leaves the AOI", i))

    # Adjacent pairs; for a circuit also the closing pair (last segment -> first segment).
    pairs = [(i - 1, i) for i in range(1, len(segs))]
    if p["mode"] == "circuit" and len(segs) > 1:
        pairs.append((len(segs) - 1, 0))
    for j, i in pairs:
        prev, cur = segs[j], segs[i]
        if cur["from_node"] != prev["to_node"]:
            if i != 0:  # an open circuit is reported as E_NOT_CLOSED below
                errors.append(_issue("E_DISCONTINUOUS", f"gap between segment {j} and {i}", i))
        elif cur["to_node"] == prev["from_node"]:
            where = " (where the circuit closes)" if i == 0 else ""
            errors.append(_issue("E_UTURN", f"U-turn at node {cur['from_node']}{where}", i))
    for uid, n in Counter(s["edge_uid"] for s in segs).items():
        if n > 1:
            errors.append(_issue("E_REPEATED_SEGMENT", f"{uid} is used {n} times"))
    first, last = segs[0]["from_node"], segs[-1]["to_node"]
    if p["mode"] == "circuit" and first != last:
        errors.append(
            _issue("E_NOT_CLOSED", f"circuit ends at node {last}, not at start node {first}")
        )
    if p["mode"] == "rally" and first == last:
        errors.append(_issue("E_RALLY_SAME_ENDS", "rally start and finish are the same node"))

    computed_length = None
    if len(known) == len(segs) and not any(e["code"] == "E_DISCONTINUOUS" for e in errors):
        nodes = [first] + [s["to_node"] for s in segs]
        expected = [(g.nodes[n]["x"], g.nodes[n]["y"]) for n in nodes]
        got = [tuple(c[:2]) for c in course["geometry"]["coordinates"]]
        if len(got) != len(expected) or any(
            abs(a - b) > COORD_TOLERANCE_DEG
            for pe, pg in zip(expected, got, strict=False)
            for a, b in zip(pe, pg, strict=True)
        ):
            errors.append(
                _issue(
                    "E_GEOMETRY_MISMATCH",
                    "geometry differs from the segments' OSM node coordinates",
                )
            )
        computed_length = sum(idx[u][2]["length_m"] for u in known)
        if abs(computed_length - p["length_m"]) > LENGTH_REL_TOLERANCE * computed_length:
            errors.append(
                _issue(
                    "E_LENGTH_MISMATCH",
                    f"length_m {p['length_m']} != recomputed {computed_length:.3f}",
                )
            )

    # warnings
    pairs = Counter(uid.rsplit(":", 1)[0] for uid in known)
    reused = sorted(
        k
        for k, n in pairs.items()
        if n > 1 and len({u for u in known if u.startswith(k + ":")}) > 1
    )
    if reused:
        warnings.append(
            _issue(
                "W_OPPOSITE_DIRECTION_REUSE",
                f"{len(reused)} road segments are driven in both directions",
            )
        )
    visits = Counter(s["from_node"] for s in segs)
    revisited = sorted(n for n, c in visits.items() if c > 1)
    if revisited:
        warnings.append(
            _issue(
                "W_NODE_REVISITED",
                f"{len(revisited)} junctions are passed more than once: {revisited[:5]}",
            )
        )
    default_two_way = sorted(
        {
            idx[u][2]["osmid"]
            for u in known
            if idx[u][2].get("highway") in MAJOR_HIGHWAYS
            and idx[u][2]["direction_source"].startswith("no oneway tag")
        }
    )
    if default_two_way:
        warnings.append(
            _issue(
                "W_DEFAULT_TWO_WAY_MAJOR",
                f"{len(default_two_way)} major-road ways are two-way only by OSM default: "
                f"{default_two_way[:5]}",
            )
        )
    rng = p.get("preferences", {}).get("length_range_m")
    if rng and computed_length is not None and not (rng[0] <= computed_length <= rng[1]):
        warnings.append(
            _issue("W_LENGTH_OUT_OF_RANGE", f"length {computed_length:.0f} m outside {rng}")
        )
    if all(len(c) < 3 for c in course["geometry"]["coordinates"]):
        warnings.append(_issue("W_NO_ELEVATION", "no elevation in coordinates"))
    warnings.append(
        _issue("W_TURN_RESTRICTIONS_NOT_EVALUATED", "OSM turn restrictions are not modelled")
    )

    metrics = {
        "segments": len(segs),
        "computed_length_m": round(computed_length, 3) if computed_length else None,
    }
    return result(metrics)
