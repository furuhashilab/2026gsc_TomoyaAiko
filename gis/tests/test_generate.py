"""Plan A circuit generation (Issue #10) on a small synthetic grid (no OSM data).

Grid: 5 x 5 junctions about 65 m apart, every row and column a two-way residential way,
except row 4 which is one-way eastbound. Extra pieces: a dead-end spur, a detour through
a node outside the AOI, and a separate "bow-tie" whose two diagonals cross without a
shared node (like a bridge).
"""

import json
from pathlib import Path

import pytest

from circuitforge_gis import graph
from circuitforge_gis.aoi import load_aoi
from circuitforge_gis.course import edge_index, validate
from circuitforge_gis.generate import (
    GenerateParams,
    canonical_cycle,
    check_candidate,
    generate,
    shape_key,
    twin,
)
from circuitforge_gis.osm_fetch import element_hash

FIXTURES = Path(__file__).parent / "fixtures"
LON0, LAT0, DLON, DLAT = 141.3505, 43.0605, 0.0008, 0.0006


def nid(r: int, c: int) -> int:
    return 1000 + r * 10 + c


def grid_elements() -> list[dict]:
    els = [
        {"type": "node", "id": nid(r, c), "lat": LAT0 + r * DLAT, "lon": LON0 + c * DLON}
        for r in range(5)
        for c in range(5)
    ]
    for r in range(5):
        tags = {"highway": "residential"}
        if r == 4:
            tags["oneway"] = "yes"
        els.append(
            {"type": "way", "id": 200 + r, "nodes": [nid(r, c) for c in range(5)], "tags": tags}
        )
    for c in range(5):
        els.append(
            {
                "type": "way",
                "id": 300 + c,
                "nodes": [nid(r, c) for r in range(5)],
                "tags": {"highway": "residential"},
            }
        )
    # dead-end spur north of (1, 1)'s block, attached at junction (2, 2)
    els += [
        {
            "type": "node",
            "id": 2001,
            "lat": LAT0 + 2 * DLAT + 0.0002,
            "lon": LON0 + 2 * DLON + 0.0002,
        },
        {"type": "way", "id": 400, "nodes": [nid(2, 2), 2001], "tags": {"highway": "service"}},
    ]
    # detour through a node east of the AOI (bbox ends at 141.354)
    els += [
        {"type": "node", "id": 2002, "lat": LAT0 + 0.5 * DLAT, "lon": 141.3545},
        {
            "type": "way",
            "id": 401,
            "nodes": [nid(0, 4), 2002, nid(1, 4)],
            "tags": {"highway": "residential"},
        },
    ]
    # bow-tie: P1-P2 and P3-P4 cross without a shared node (one is a bridge)
    bx, by = 141.3514, 43.0612  # inside the block between rows 1-2 and columns 1-2
    els += [
        {"type": "node", "id": 3001, "lat": by, "lon": bx},
        {"type": "node", "id": 3002, "lat": by + 0.0004, "lon": bx + 0.0006},
        {"type": "node", "id": 3003, "lat": by + 0.0004, "lon": bx},
        {"type": "node", "id": 3004, "lat": by, "lon": bx + 0.0006},
        {
            "type": "way",
            "id": 500,
            "nodes": [3001, 3002],
            "tags": {"highway": "residential", "oneway": "yes"},
        },
        {
            "type": "way",
            "id": 501,
            "nodes": [3002, 3003],
            "tags": {"highway": "residential", "oneway": "yes"},
        },
        {
            "type": "way",
            "id": 502,
            "nodes": [3003, 3004],
            "tags": {"highway": "residential", "oneway": "yes", "bridge": "yes", "layer": "1"},
        },
        {
            "type": "way",
            "id": 503,
            "nodes": [3004, 3001],
            "tags": {"highway": "residential", "oneway": "yes"},
        },
    ]
    return els


@pytest.fixture(scope="module")
def grid():
    elements = grid_elements()
    aoi = load_aoi(FIXTURES / "aoi_fixture.json")
    g, _ = graph.clip_to_aoi(graph.build_directed_graph(elements), aoi)
    graph.add_projected_lengths(g, graph.check_length_crs(aoi))
    snapshot = {
        "attic_date": "fixture",
        "element_sha256": element_hash(elements),
        "profile": "mvp-drive",
    }
    return g, aoi, snapshot


def path_uids(g, nodes: list[int]) -> list[str]:
    """edge_uids along consecutive nodes (the drawn way may not allow every step)."""
    out = []
    for a, b in zip(nodes, nodes[1:], strict=False):
        data = g.get_edge_data(a, b)
        if data:
            out.append(sorted(d["edge_uid"] for d in data.values())[0])
        else:  # direction not allowed: name the forbidden uid so the checker can report it
            rev = sorted(d["edge_uid"] for d in g.get_edge_data(b, a).values())[0]
            out.append(twin(rev))
    return out


def check(grid, nodes=None, uids=None, target=520.0, tol=0.5, seen=None):
    g, aoi, snapshot = grid
    params = GenerateParams(target_m=target, tolerance=tol)
    uids = uids if uids is not None else path_uids(g, nodes)
    return check_candidate(
        g, aoi, snapshot, uids, params,
        course_id="t", name="t", authoring={"method": "generated-outbound-return", "tool": "test"},
        seen=seen, attribution="Synthetic test data (no OSM content)", synthetic=True,
    )  # fmt: skip


# --- what counts as a formally valid circuit --------------------------------------------


def test_rectangle_and_polygon_are_accepted(grid):
    block = [nid(1, 1), nid(1, 2), nid(2, 2), nid(2, 1), nid(1, 1)]
    course, reasons = check(grid, block, target=260)
    assert reasons == [] and course is not None
    # an L-shaped hexagon around three blocks
    hexagon = [
        nid(1, 1),
        nid(1, 2),
        nid(1, 3),
        nid(2, 3),
        nid(2, 2),
        nid(3, 2),
        nid(3, 1),
        nid(2, 1),
        nid(1, 1),
    ]
    course, reasons = check(grid, hexagon, target=520)
    assert reasons == [] and course is not None


def test_out_and_back_on_the_same_road_is_rejected(grid):
    out_back = [nid(1, 1), nid(1, 2), nid(1, 3), nid(1, 2), nid(1, 1)]
    course, reasons = check(grid, out_back, target=260)
    assert course is None
    assert "E_UTURN" in reasons and "W_OPPOSITE_DIRECTION_REUSE" in reasons


def test_reusing_a_road_in_reverse_is_rejected(grid):
    # lollipop: (1,1)->(1,2), loop around a block, then back (1,2)->(1,1)
    lollipop = [nid(1, 1), nid(1, 2), nid(1, 3), nid(2, 3), nid(2, 2), nid(1, 2), nid(1, 1)]
    course, reasons = check(grid, lollipop, target=390)
    assert course is None
    assert "W_OPPOSITE_DIRECTION_REUSE" in reasons and "W_NODE_REVISITED" in reasons


def test_figure_eight_through_one_junction_is_rejected(grid):
    eight = [
        nid(1, 1), nid(1, 2), nid(2, 2), nid(2, 3), nid(3, 3), nid(3, 2),
        nid(2, 2), nid(2, 1), nid(1, 1),
    ]  # fmt: skip
    course, reasons = check(grid, eight, target=520)
    assert course is None and reasons == ["W_NODE_REVISITED"]


def test_dead_end_turnaround_is_rejected(grid):
    spur = [nid(2, 1), nid(2, 2), 2001, nid(2, 2), nid(3, 2), nid(3, 1), nid(2, 1)]
    course, reasons = check(grid, spur, target=260)
    assert course is None and "E_UTURN" in reasons


def test_u_turn_where_the_circuit_closes_is_rejected(grid):
    # start (1,1) -> (1,2), around a block, return (1,2) -> (1,1); closes with a U-turn at S
    closing = [nid(1, 2), nid(1, 3), nid(2, 3), nid(2, 2), nid(1, 2), nid(1, 1), nid(1, 2)]
    course, reasons = check(grid, closing, target=390)
    assert course is None and "E_UTURN" in reasons


def test_one_way_violation_is_rejected(grid):
    # row 4 is one-way eastbound; this loop drives it westbound
    wrong_way = [nid(3, 1), nid(3, 2), nid(4, 2), nid(4, 1), nid(3, 1)]
    course, reasons = check(grid, wrong_way, target=260)
    assert course is None and reasons == ["E_DIRECTION_NOT_ALLOWED"]
    ok = [nid(3, 2), nid(3, 1), nid(4, 1), nid(4, 2), nid(3, 2)]  # same block, legal direction
    assert check(grid, ok, target=260)[1] == []


def test_leaving_the_aoi_is_rejected(grid):
    outside = [nid(1, 4), nid(0, 4), 2002, nid(1, 4)]
    course, reasons = check(grid, outside, target=260)
    assert course is None and "E_OUTSIDE_AOI" in reasons


def test_length_out_of_range_is_rejected(grid):
    block = [nid(1, 1), nid(1, 2), nid(2, 2), nid(2, 1), nid(1, 1)]
    course, reasons = check(grid, block, target=1000, tol=0.1)
    assert course is None and reasons == ["W_LENGTH_OUT_OF_RANGE"]


def test_same_cycle_from_another_start_is_a_duplicate(grid):
    g = grid[0]
    block = path_uids(g, [nid(1, 1), nid(1, 2), nid(2, 2), nid(2, 1), nid(1, 1)])
    rotated = block[2:] + block[:2]
    assert canonical_cycle(block) == canonical_cycle(rotated)
    course, reasons = check(grid, uids=rotated, target=260, seen={canonical_cycle(block)})
    assert course is None and reasons == ["DUPLICATE_CYCLE"]
    # the reverse direction is a different directed cycle with the same road shape
    reverse = path_uids(g, [nid(1, 1), nid(2, 1), nid(2, 2), nid(1, 2), nid(1, 1)])
    assert canonical_cycle(reverse) != canonical_cycle(block)
    assert shape_key(reverse) == shape_key(block)


def test_planar_self_intersection_without_shared_node_is_rejected(grid):
    bowtie = [3001, 3002, 3003, 3004, 3001]
    course, reasons = check(grid, bowtie, target=230)
    assert course is None and reasons == ["PLANAR_SELF_INTERSECTION"]


# --- generation ------------------------------------------------------------------------


@pytest.fixture(scope="module")
def run(grid):
    g, aoi, snapshot = grid
    params = GenerateParams(target_m=520, tolerance=0.15, count=5, seed=7, max_attempts=200)
    return generate(g, aoi, snapshot, params, attribution="Synthetic test data", synthetic=True)


def test_generated_candidates_are_valid_simple_and_distinct(grid, run):
    g, aoi, snapshot = grid
    courses, record, _ = run
    assert record["accepted"] == len(courses) == 5, record
    keys = set()
    for c in courses:
        p = c["properties"]
        v = validate(c, g, snapshot["element_sha256"], expected_aoi=aoi)
        assert v["status"] == "valid"
        assert not {w["code"] for w in v["warnings"]} & set(record["forbidden_warnings"])
        uids = [s["edge_uid"] for s in p["segments"]]
        nodes = [s["from_node"] for s in p["segments"]]
        assert len(nodes) == len(set(nodes))  # simple cycle: no junction twice
        assert p["segments"][-1]["to_node"] == nodes[0]
        assert 520 * 0.85 <= p["length_m"] <= 520 * 1.15
        assert p["authoring"]["method"] == "generated-outbound-return"
        keys.add(canonical_cycle(uids))
    assert len(keys) == 5
    # the bow-tie and the outside detour are never used
    idx = edge_index(g)
    used = {s["edge_uid"] for c in courses for s in c["properties"]["segments"]}
    assert not any(idx[u][2]["osmid"] in (401, 500, 501, 502, 503) for u in used)


def test_same_seed_gives_the_same_record_and_courses(grid, run):
    g, aoi, snapshot = grid
    courses, record, _ = run
    params = GenerateParams(target_m=520, tolerance=0.15, count=5, seed=7, max_attempts=200)
    courses2, record2, _ = generate(
        g, aoi, snapshot, params, attribution="Synthetic test data", synthetic=True
    )
    assert json.dumps(record2, sort_keys=True) == json.dumps(record, sort_keys=True)
    assert json.dumps(courses2, sort_keys=True) == json.dumps(courses, sort_keys=True)
    other = generate(
        g,
        aoi,
        snapshot,
        GenerateParams(target_m=520, tolerance=0.15, count=5, seed=8, max_attempts=200),
    )
    assert other[1]["candidates"] != record["candidates"]


def test_record_counts_failures_and_respects_the_attempt_limit(grid):
    g, aoi, snapshot = grid
    # impossible target: nothing fits, the run stops at the attempt limit and says why
    params = GenerateParams(target_m=5000, tolerance=0.05, count=3, seed=1, max_attempts=20)
    courses, record, log = generate(g, aoi, snapshot, params)
    assert courses == [] and record["accepted"] == 0
    assert record["attempts"] == 20 and record["stop_reason"] == "max_attempts reached"
    assert sum(record["failures"].values()) == 20
    assert "elapsed_s" in log and "elapsed_s" not in record
