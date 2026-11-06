"""Automatic circuit candidates, plan A "outbound + disjoint return" (Issue #10).

A *formally valid circuit* here is a simple directed cycle on the road graph: it starts
and ends at S, passes no other node twice, uses no road edge twice and no road segment
in both directions, makes no U-turn (also where it closes), keeps every road rule,
stays inside the AOI, meets the target length range, is continuous, and its drawn shape
does not cross itself. It says nothing about racing safety, road width or whether a
road could be closed: the courses are fictional.

Plan A, per attempt (all choices come from ``random.Random(seed)`` over sorted ids):

1. pick a start node S;
2. pick a turn node T whose shortest distance from S is within ``turn_band`` x target;
3. outbound S -> T: shortest path with seeded per-edge weight jitter;
4. return T -> S on the graph without the outbound edges, their reverse twins and the
   outbound's intermediate nodes (S and T are the only shared nodes);
5. join both halves and accept only if ``check_candidate`` passes: the existing
   ``validate`` with 0 errors, none of ``FORBIDDEN_WARNINGS``, no planar self-crossing,
   and not the same directed cycle as an earlier candidate (start node ignored).

Two outputs are kept apart: the *record* (inputs, candidates, failure counts; identical
for the same snapshot, parameters and seed) and the *log* (timestamps, durations).
"""

import dataclasses
import hashlib
import json
import math
import platform
import random
import sys
import time
from collections import Counter
from pathlib import Path

import networkx as nx
from shapely.geometry import LineString

from .aoi import Aoi
from .course import (
    RULE_SET,
    TOOL,
    CourseError,
    build_course,
    edge_index,
    length_mm,
    search_graph,
    shortest_path,
)

METHOD = "generated-outbound-return"
# validate() only warns about these; for generated circuits they are hard constraints.
FORBIDDEN_WARNINGS = ("W_LENGTH_OUT_OF_RANGE", "W_NODE_REVISITED", "W_OPPOSITE_DIRECTION_REUSE")
MAJOR_HIGHWAYS = {"motorway", "trunk", "primary", "secondary"}


@dataclasses.dataclass(frozen=True)
class GenerateParams:
    target_m: float = 3000.0
    tolerance: float = 0.10
    count: int = 10
    seed: int = 0
    max_attempts: int = 300
    time_limit_s: float = 120.0
    turn_band: tuple[float, float] = (0.35, 0.50)  # distance S->T as a fraction of target
    jitter: float = 0.3  # outbound/return edge weights are length x U(1, 1 + jitter)
    allow_default_two_way_major: bool = False

    def __post_init__(self):
        def finite(name):
            v = getattr(self, name)
            if isinstance(v, bool) or not isinstance(v, int | float) or not math.isfinite(v):
                raise ValueError(f"{name} must be a finite number, got {v!r}")
            return v

        def whole(name, minimum):
            v = getattr(self, name)
            if isinstance(v, bool) or not isinstance(v, int) or v < minimum:
                raise ValueError(f"{name} must be an integer >= {minimum}, got {v!r}")

        if finite("target_m") <= 0:
            raise ValueError(f"target_m must be > 0 m, got {self.target_m}")
        if not 0 < finite("tolerance") < 1:
            raise ValueError(f"tolerance must be between 0 and 1 (exclusive), got {self.tolerance}")
        whole("count", 1)
        whole("max_attempts", 1)
        whole("seed", 0)
        if self.count > self.max_attempts:
            raise ValueError(
                f"count ({self.count}) cannot exceed max_attempts ({self.max_attempts})"
            )
        if finite("time_limit_s") <= 0:
            raise ValueError(f"time_limit_s must be > 0 s, got {self.time_limit_s}")
        if finite("jitter") < 0:
            raise ValueError(f"jitter must be >= 0, got {self.jitter}")
        lo, hi = self.turn_band
        if not 0 < lo <= hi < 1:
            raise ValueError(f"turn_band must satisfy 0 < low <= high < 1, got {self.turn_band}")

    @property
    def length_range_m(self) -> list[float]:
        return [
            round(self.target_m * (1 - self.tolerance), 3),
            round(self.target_m * (1 + self.tolerance), 3),
        ]


def twin(uid: str) -> str:
    """edge_uid of the same road segment driven the other way."""
    way, seq, d = uid.rsplit(":", 2)
    return f"{way}:{seq}:{'r' if d == 'f' else 'f'}"


def road_segment(uid: str) -> str:
    return uid.rsplit(":", 1)[0]


def canonical_cycle(uids: list[str]) -> tuple[str, ...]:
    """The directed cycle independent of its start: rotated to begin at the smallest uid."""
    i = uids.index(min(uids))
    return tuple(uids[i:] + uids[:i])


def shape_key(uids: list[str]) -> tuple[str, ...]:
    """Road segments regardless of direction: equal for a cycle and its reverse."""
    return tuple(sorted({road_segment(u) for u in uids}))


def digest(items) -> str:
    return hashlib.sha256("\n".join(items).encode()).hexdigest()


def jaccard_distance(a: set, b: set) -> float:
    return 1 - len(a & b) / len(a | b) if a | b else 0.0


def is_default_two_way_major(d: dict) -> bool:
    return d.get("highway") in MAJOR_HIGHWAYS and d["direction_source"].startswith("no oneway tag")


def generation_graph(g: nx.MultiDiGraph, params: GenerateParams) -> nx.MultiDiGraph:
    """Routable edges inside the AOI (search_graph), optionally without major roads that
    are two-way only by OSM default, restricted to the largest strongly connected
    component (ties: the one with the smallest node id)."""
    s = search_graph(g)
    if not params.allow_default_two_way_major:
        drop = [
            (u, v, k) for u, v, k, d in s.edges(keys=True, data=True) if is_default_two_way_major(d)
        ]
        s.remove_edges_from(drop)
    comps = list(nx.strongly_connected_components(s))
    if not comps:
        return nx.MultiDiGraph()
    best = max(comps, key=lambda c: (len(c), -min(c)))
    return s.subgraph(best).copy()


def planar_crossings(g: nx.MultiDiGraph, uids: list[str]) -> list[tuple[int, int]]:
    """Pairs of non-adjacent segments whose drawn lines cross or touch in the projected
    CRS. A crossing without a shared node is either a grade separation (bridge/tunnel)
    or a mapping problem; the graph cannot tell which, so both are reported."""
    idx = edge_index(g)
    lines, ends = [], []
    for uid in uids:
        u, v, _ = idx[uid]
        a, b = g.nodes[u], g.nodes[v]
        lines.append(LineString([(a["x_proj"], a["y_proj"]), (b["x_proj"], b["y_proj"])]))
        ends.append({u, v})
    n = len(lines)
    out = []
    for i in range(n):
        for j in range(i + 1, n):
            # segments meeting at a shared node are consecutive or a node revisit, which
            # validate() already reports (W_NODE_REVISITED)
            if ends[i] & ends[j]:
                continue
            if lines[i].intersects(lines[j]):
                out.append((i, j))
    return out


def check_candidate(
    g: nx.MultiDiGraph,
    aoi: Aoi,
    snapshot: dict,
    uids: list[str],
    params: GenerateParams,
    *,
    course_id: str,
    name: str,
    authoring: dict,
    seen: set | None = None,
    attribution: str | None = None,
    synthetic: bool = False,
) -> tuple[dict | None, list[str]]:
    """(course, []) if the segment list is a formally valid circuit, else (None, reasons)."""
    idx = edge_index(g)
    bad = [
        "E_DIRECTION_NOT_ALLOWED" if twin(u) in idx else "E_UNKNOWN_SEGMENT"
        for u in uids
        if u not in idx
    ]
    if bad or not uids:
        return None, sorted(set(bad)) or ["E_EMPTY"]
    extra = {"attribution": attribution} if attribution else {}
    course = build_course(
        g, aoi, snapshot,
        course_id=course_id, name=name, mode="circuit", segments=uids,
        preferences={"length_range_m": params.length_range_m},
        authoring=authoring, synthetic=synthetic, **extra,
    )  # fmt: skip
    v = course["properties"]["validation"]
    reasons = sorted({e["code"] for e in v["errors"]})
    reasons += sorted({w["code"] for w in v["warnings"] if w["code"] in FORBIDDEN_WARNINGS})
    if not v["errors"] and planar_crossings(g, uids):
        reasons.append("PLANAR_SELF_INTERSECTION")
    if not reasons and seen is not None and canonical_cycle(uids) in seen:
        reasons.append("DUPLICATE_CYCLE")
    return (None, reasons) if reasons else (course, [])


def generate(
    g: nx.MultiDiGraph,
    aoi: Aoi,
    snapshot: dict,
    params: GenerateParams,
    *,
    attribution: str | None = None,
    synthetic: bool = False,
) -> tuple[list[dict], dict, dict]:
    """Run plan A. Returns (courses, record, log)."""
    started = time.perf_counter()
    started_utc = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    rng = random.Random(params.seed)
    gen = generation_graph(g, params)
    nodes = sorted(gen.nodes)
    edges = sorted(gen.edges(keys=True, data=True), key=lambda e: e[3]["edge_uid"])
    lo, hi = params.length_range_m
    failures: Counter = Counter()
    seen: set = set()
    shapes: dict[tuple, str] = {}
    courses, accepted = [], []
    attempts, stop = 0, "count reached"
    attempt_times = []

    while len(courses) < params.count:
        if attempts >= params.max_attempts:
            stop = "max_attempts reached"
            break
        if time.perf_counter() - started > params.time_limit_s:
            stop = "time_limit reached"
            break
        attempts += 1
        t0 = time.perf_counter()
        reason = None
        if not nodes:
            stop = "empty generation graph"
            break
        start = rng.choice(nodes)
        # seeded weight jitter, drawn in edge_uid order so it does not depend on insertion
        weight = {d["edge_uid"]: 1 + params.jitter * rng.random() for *_, d in edges}

        def cost(d, weight=weight):
            return round(length_mm(d) * weight[d["edge_uid"]])

        dist = nx.single_source_dijkstra_path_length(gen, start, weight="length_m")
        band = sorted(
            n
            for n, x in dist.items()
            if params.turn_band[0] * params.target_m <= x <= params.turn_band[1] * params.target_m
        )
        if not band:
            reason = "NO_TARGET_IN_RANGE"
        else:
            turn = rng.choice(band)
            outbound = shortest_path(gen, start, turn, cost)
            ret = None
            out_nodes = {start}
            idx = edge_index(gen)
            for u in outbound:
                out_nodes.add(idx[u][1])
            blocked_uids = set(outbound) | {twin(u) for u in outbound}
            blocked_edges = [
                (a, b, k) for a, b, k, d in gen.edges(keys=True, data=True)
                if d["edge_uid"] in blocked_uids
            ]  # fmt: skip
            view = nx.restricted_view(gen, out_nodes - {start, turn}, blocked_edges)
            try:
                ret = shortest_path(view, turn, start, cost)
            except CourseError:
                reason = "NO_RETURN_PATH"
            if ret is not None:
                uids = outbound + ret
                length = sum(idx[u][2]["length_m"] for u in uids)
                if not lo <= length <= hi:
                    reason = "LENGTH_OUT_OF_RANGE"
                else:
                    n = len(courses) + 1
                    course, reasons = check_candidate(
                        g, aoi, snapshot, uids, params,
                        course_id=f"gen-a-seed{params.seed}-{n:02d}",
                        name=f"自動生成候補 {n}（案A・seed {params.seed}）",
                        authoring={
                            "method": METHOD,
                            "tool": TOOL,
                            "seed": params.seed,
                            "attempt": attempts,
                            "start_node": start,
                            "turn_node": turn,
                            "params": _params_record(params),
                        },
                        seen=seen, attribution=attribution, synthetic=synthetic,
                    )  # fmt: skip
                    if course is None:
                        reason = reasons[0] if len(reasons) == 1 else "+".join(reasons)
                    else:
                        key = canonical_cycle(uids)
                        seen.add(key)
                        sk = shape_key(uids)
                        courses.append(course)
                        accepted.append(
                            {
                                "id": course["properties"]["id"],
                                "attempt": attempts,
                                "segments": len(uids),
                                "length_m": round(length, 3),
                                "length_error": round(
                                    abs(length - params.target_m) / params.target_m, 5
                                ),
                                "cycle_sha256": digest(key),
                                "shape_sha256": digest(sk),
                                "reverse_of": shapes.get(sk),
                                "_edges": set(uids),
                                "_shape": set(sk),
                            }
                        )
                        shapes.setdefault(sk, course["properties"]["id"])
        if reason:
            failures[reason] += 1
        attempt_times.append(time.perf_counter() - t0)

    elapsed = time.perf_counter() - started
    record = {
        "schema": "circuitforge-generation-record",
        "schema_version": "0.1.0",
        "method": METHOD,
        "tool": TOOL,
        "rule_set": RULE_SET,
        "aoi": {"id": aoi.id, "bbox": [aoi.lon_min, aoi.lat_min, aoi.lon_max, aoi.lat_max]},
        "osm_snapshot": snapshot,
        "params": _params_record(params),
        "forbidden_warnings": list(FORBIDDEN_WARNINGS),
        "generation_graph": {"nodes": gen.number_of_nodes(), "edges": gen.number_of_edges()},
        "attempts": attempts,
        "accepted": len(courses),
        "valid_rate": round(len(courses) / attempts, 4) if attempts else None,
        "stop_reason": stop,
        "failures": dict(sorted(failures.items())),
        "candidates": [{k: v for k, v in a.items() if not k.startswith("_")} for a in accepted],
        "distinct_shapes": len({a["shape_sha256"] for a in accepted}),
        "diversity": _diversity(accepted),
    }
    log = {
        "started_utc": started_utc,
        "elapsed_s": round(elapsed, 3),
        "seconds_per_attempt": round(elapsed / attempts, 4) if attempts else None,
        "seconds_per_accepted": round(elapsed / len(courses), 4) if courses else None,
        "slowest_attempt_s": round(max(attempt_times), 4) if attempt_times else None,
        "python": sys.version.split()[0],
        "platform": platform.platform(),
        "note": "Timing varies between runs; the record (not this log) is the reproducible part.",
    }
    return courses, record, log


def _params_record(p: GenerateParams) -> dict:
    d = dataclasses.asdict(p)
    d["turn_band"] = list(p.turn_band)
    d["length_range_m"] = p.length_range_m
    return d


def _diversity(accepted: list[dict]) -> dict:
    pairs = [
        (a, b) for i, a in enumerate(accepted) for b in accepted[i + 1 :]
    ]  # fmt: skip
    if not pairs:
        return {"pairs": 0}
    edge = [jaccard_distance(a["_edges"], b["_edges"]) for a, b in pairs]
    shape = [jaccard_distance(a["_shape"], b["_shape"]) for a, b in pairs]
    return {
        "pairs": len(pairs),
        "edge_jaccard_min": round(min(edge), 4),
        "edge_jaccard_mean": round(sum(edge) / len(edge), 4),
        "shape_jaccard_min": round(min(shape), 4),
        "shape_jaccard_mean": round(sum(shape) / len(shape), 4),
        "note": "edge = directed edge_uids; shape = road segments regardless of direction",
    }


def record_json(record: dict) -> str:
    return json.dumps(record, ensure_ascii=False, indent=1) + "\n"


RECORD_FILE = "generation-record.json"
LOG_FILE = "generation-log.json"


def course_file(course_id: str) -> str:
    return f"{course_id}.course.geojson"


def write_outputs(out: Path, courses: list[dict], record: dict, log: dict) -> dict:
    """Write a run to ``out`` without mixing it with an earlier run.

    Only files that the previous run in ``out`` listed in its own record (its course
    files, record and log) are removed or overwritten; any other file is left alone and
    reported, so a user's own files are never deleted. If a file this run would write
    already exists and is not one of those, nothing is changed and ValueError is raised.
    Returns {"removed": [...], "left": [...]}.
    """
    out.mkdir(parents=True, exist_ok=True)
    managed: set[str] = set()
    prev = out / RECORD_FILE
    if prev.exists():
        try:
            old = json.loads(prev.read_text())
        except json.JSONDecodeError as exc:
            raise ValueError(f"{prev} is not a readable generation record; move it away") from exc
        if old.get("schema") != "circuitforge-generation-record":
            raise ValueError(f"{prev} is not a generation record; choose another --output")
        managed = {RECORD_FILE, LOG_FILE}
        for c in old.get("candidates", []):
            name = course_file(c["id"])
            if "/" not in name and not name.startswith("."):
                managed.add(name)
    targets = {course_file(c["properties"]["id"]) for c in courses} | {RECORD_FILE, LOG_FILE}
    clash = sorted(n for n in targets - managed if (out / n).exists())
    if clash:  # checked before anything is removed or written
        raise ValueError(
            f"{out} already has files this run would overwrite that no earlier run here "
            f"wrote: {', '.join(clash[:5])}; move them away or choose another --output"
        )
    removed = []
    for name in sorted(managed - {RECORD_FILE, LOG_FILE}):
        path = out / name
        if path.is_file():
            path.unlink()
            removed.append(name)
    for c in courses:
        (out / course_file(c["properties"]["id"])).write_text(
            json.dumps(c, ensure_ascii=False, indent=1) + "\n"
        )
    (out / RECORD_FILE).write_text(record_json(record))
    (out / LOG_FILE).write_text(record_json(log))
    keep = {course_file(c["properties"]["id"]) for c in courses} | {RECORD_FILE, LOG_FILE}
    left = sorted(p.name for p in out.iterdir() if p.name not in keep)
    return {"removed": sorted(removed), "left": left}
