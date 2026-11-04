"""Course build/validate tests on the hand-made fixture graph (no OSM data)."""

import copy
import json
from pathlib import Path

import networkx as nx
import pytest

from circuitforge_gis import graph
from circuitforge_gis.aoi import REPO_ROOT, load_aoi
from circuitforge_gis.course import (
    CourseError,
    build_course,
    expand_simplified_path,
    search_graph,
    shortest_path,
    validate,
)
from circuitforge_gis.osm_fetch import element_hash

FIXTURES = Path(__file__).parent / "fixtures"
SAMPLE = REPO_ROOT / "contracts" / "examples" / "synthetic-loop.course.geojson"


@pytest.fixture(scope="module")
def setup():
    elements = json.loads((FIXTURES / "mini_overpass.json").read_text())["elements"]
    aoi = load_aoi(FIXTURES / "aoi_fixture.json")
    g, _ = graph.clip_to_aoi(graph.build_directed_graph(elements), aoi)
    graph.add_projected_lengths(g, graph.check_length_crs(aoi))
    graph.add_components(g)
    snapshot = {
        "attic_date": "fixture",
        "element_sha256": element_hash(elements),
        "profile": "mvp-drive",
    }
    return g, aoi, snapshot


def make_loop(g, aoi, snapshot):
    # 4 -> 5 along one-way way 102, back 5 -> 4 along the curved two-way way 106
    return build_course(
        g, aoi, snapshot,
        course_id="synthetic-loop", name="Synthetic test loop (hand-made roads, not OSM)",
        mode="circuit", via=[4, 5], preferences={"length_range_m": [100, 1000]},
        attribution="Synthetic test data (no OSM content)", synthetic=True,
    )  # fmt: skip


@pytest.fixture(scope="module")
def loop(setup):
    return make_loop(*setup)


def codes(v, kind="errors"):
    return {e["code"] for e in v[kind]}


def revalidate(course, setup):
    g, _, snapshot = setup
    return validate(course, g, snapshot["element_sha256"])


# --- segment identity --------------------------------------------------------------------


def test_edge_uid_is_unique_and_osm_based(setup):
    g, _, _ = setup
    uids = [d["edge_uid"] for *_, d in g.edges(data=True)]
    assert len(uids) == len(set(uids))
    # way 103 is oneway=-1: only its segment 0 against drawn order exists
    assert {u for u in uids if u.startswith("103:")} == {"103:0:r"}


def test_parallel_duplicate_ways_get_distinct_uids(setup):
    g, _, _ = setup
    assert {d["edge_uid"] for d in g.get_edge_data(60, 61).values()} == {"118:0:f", "119:0:f"}


def test_simplified_edges_expand_back_to_the_ordered_raw_segments(setup, loop):
    g, _, _ = setup
    s = graph.simplify(g.copy())
    curve = [(5, 4, k) for k, d in s.get_edge_data(5, 4).items() if d["osmid"] == 106]
    straight = [(4, 5, k) for k, d in s.get_edge_data(4, 5).items() if d["osmid"] == 102]
    expanded = expand_simplified_path(s, straight + curve)
    assert expanded == [seg["edge_uid"] for seg in loop["properties"]["segments"]]


# --- building ------------------------------------------------------------------------------


def test_loop_is_valid_and_follows_the_rules(loop):
    p = loop["properties"]
    assert p["validation"]["status"] == "valid", p["validation"]["errors"]
    assert [s["edge_uid"] for s in p["segments"]] == [
        "102:0:f", "106:4:r", "106:3:r", "106:2:r", "106:1:r", "106:0:r",
    ]  # fmt: skip
    assert p["authoring"]["method"] == "manual-via-points"
    assert "W_TURN_RESTRICTIONS_NOT_EVALUATED" in codes(p["validation"], "warnings")


def test_committed_synthetic_sample_is_reproducible(setup, loop):
    assert json.loads(SAMPLE.read_text()) == json.loads(json.dumps(loop))


def test_search_graph_excludes_non_routable_and_boundary_edges(setup):
    g, _, _ = setup
    s = search_graph(g)
    assert all(d["routable"] and d["aoi_status"] == "inside" for *_, d in s.edges(data=True))
    assert 8 not in s  # beyond the AOI boundary
    assert not s.has_edge(2, 5)  # reversible way 104


def test_via_lon_lat_snaps_to_nearest_usable_node(setup):
    g, aoi, snapshot = setup
    c = build_course(
        g, aoi, snapshot, course_id="x", name="x", mode="circuit",
        via=[[141.35051, 43.06151], [141.35149, 43.06149]],
    )  # fmt: skip
    via = c["properties"]["authoring"]["via"]
    assert [v["node"] for v in via] == [4, 5]
    assert all(v["snap_distance_m"] < 2 for v in via)


def test_via_point_too_far_is_rejected(setup):
    g, aoi, snapshot = setup
    with pytest.raises(CourseError, match="from the nearest usable node"):
        build_course(
            g, aoi, snapshot, course_id="x", name="x", mode="circuit",
            via=[[141.3505, 43.0605], [141.3539, 43.0629]],
        )  # fmt: skip


def test_explicit_segments(setup, loop):
    g, aoi, snapshot = setup
    uids = [s["edge_uid"] for s in loop["properties"]["segments"]]
    c = build_course(g, aoi, snapshot, course_id="x", name="x", mode="circuit", segments=uids)
    assert c["properties"]["authoring"]["method"] == "manual-segments"
    assert c["properties"]["validation"]["status"] == "valid"


def test_shortest_path_ties_are_broken_by_edge_uid_regardless_of_insertion_order():
    def diamond(order):
        g = nx.MultiDiGraph()
        edges = {
            ("a", "b"): ("1:0:f", 100.0), ("b", "d"): ("1:1:f", 100.0),
            ("a", "c"): ("2:0:f", 100.0), ("c", "d"): ("2:1:f", 100.0),
        }  # fmt: skip
        for key in order:
            uid, length = edges[key]
            g.add_edge(*key, edge_uid=uid, length_m=length)
        return g

    first = shortest_path(diamond([("a", "b"), ("b", "d"), ("a", "c"), ("c", "d")]), "a", "d")
    second = shortest_path(diamond([("c", "d"), ("a", "c"), ("b", "d"), ("a", "b")]), "a", "d")
    assert first == second == ["1:0:f", "1:1:f"]


# --- validation: each rule ---------------------------------------------------------------


def mutate(loop, fn):
    c = copy.deepcopy(loop)
    c["properties"].pop("validation")
    fn(c, c["properties"])
    return c


def seg(g, uid):
    u, v, d = next((u, v, d) for u, v, d in g.edges(data=True) if d["edge_uid"] == uid)
    return {"edge_uid": uid, "way_id": d["osmid"], "from_node": u, "to_node": v}


def test_against_oneway_is_rejected(setup, loop):
    def fn(c, p):
        p["segments"][0] = {"edge_uid": "102:0:r", "way_id": 102, "from_node": 5, "to_node": 4}

    assert "E_DIRECTION_NOT_ALLOWED" in codes(revalidate(mutate(loop, fn), setup))


def test_discontinuity_is_rejected(setup, loop):
    assert "E_DISCONTINUOUS" in codes(
        revalidate(mutate(loop, lambda c, p: p["segments"].pop(2)), setup)
    )


def test_not_closed_is_rejected(setup, loop):
    def fn(c, p):
        p["segments"].pop()
        c["geometry"]["coordinates"].pop()

    assert "E_NOT_CLOSED" in codes(revalidate(mutate(loop, fn), setup))


def test_uturn_and_repeat_are_rejected(setup, loop):
    g, _, _ = setup

    def fn(c, p):
        p["segments"][1:1] = [seg(g, "106:4:f"), seg(g, "106:4:r")]  # 5 -> 4 -> back

    v = revalidate(mutate(loop, fn), setup)
    assert {"E_UTURN", "E_REPEATED_SEGMENT"} <= codes(v)


@pytest.mark.parametrize(
    ("uid", "code"),
    [("104:0:f", "E_NOT_ROUTABLE"), ("102:3:f", "E_OUTSIDE_AOI"), ("999:0:f", "E_UNKNOWN_SEGMENT")],
)
def test_forbidden_segments_are_rejected(setup, loop, uid, code):
    g, _, _ = setup

    def fn(c, p):
        p["segments"].append(
            seg(g, uid) if uid != "999:0:f" else {**p["segments"][0], "edge_uid": uid}
        )

    assert code in codes(revalidate(mutate(loop, fn), setup))


def test_tampered_geometry_and_length_are_rejected(setup, loop):
    def fn(c, p):
        c["geometry"]["coordinates"][2][0] += 0.0001
        p["length_m"] *= 1.01

    assert {"E_GEOMETRY_MISMATCH", "E_LENGTH_MISMATCH"} <= codes(
        revalidate(mutate(loop, fn), setup)
    )


def test_segment_fields_must_match_uid(setup, loop):
    def fn(c, p):
        p["segments"][0]["way_id"] = 106

    assert "E_SEGMENT_MISMATCH" in codes(revalidate(mutate(loop, fn), setup))


def test_snapshot_mismatch_is_rejected(setup, loop):
    def fn(c, p):
        p["osm_snapshot"]["element_sha256"] = "0" * 64

    assert codes(revalidate(mutate(loop, fn), setup)) == {"E_SNAPSHOT_MISMATCH"}


def test_unsuitable_length_crs_is_rejected(setup, loop):
    def fn(c, p):
        p["aoi"]["length_crs"] = "EPSG:4326"

    assert "E_LENGTH_CRS" in codes(revalidate(mutate(loop, fn), setup))


def test_schema_violations_are_reported(setup, loop):
    def fn(c, p):
        c["geometry"]["coordinates"][0] = [43.06, 141.35]  # lat/lon swapped
        p["mode"] = "drift"

    v = revalidate(mutate(loop, fn), setup)
    assert codes(v) == {"E_SCHEMA"} and len(v["errors"]) >= 2


def test_rally_with_same_ends_is_rejected(setup, loop):
    assert "E_RALLY_SAME_ENDS" in codes(
        revalidate(mutate(loop, lambda c, p: p.update(mode="rally")), setup)
    )


def test_length_range_warning(setup, loop):
    def fn(c, p):
        p["preferences"]["length_range_m"] = [3000, 5000]

    assert "W_LENGTH_OUT_OF_RANGE" in codes(revalidate(mutate(loop, fn), setup), "warnings")


SAPPORO_RECIPE = REPO_ROOT / "contracts" / "examples" / "sapporo-demo.recipe.json"
SAPPORO_SUMMARY = REPO_ROOT / "docs" / "evidence" / "issue-7" / "sapporo-demo-summary.json"
SAPPORO_RAW = REPO_ROOT / "data" / "raw" / "osm_sapporo-center_mvp-drive_2026-11-03T162505Z.json"


@pytest.mark.skipif(not SAPPORO_RAW.exists(), reason="needs local OSM data (uv run cf-osm)")
def test_sapporo_demo_recipe_reproduces_recorded_course():
    import hashlib

    from circuitforge_gis.course_cli import load_snapshot_graph

    recipe = json.loads(SAPPORO_RECIPE.read_text())
    summary = json.loads(SAPPORO_SUMMARY.read_text())
    aoi = load_aoi(REPO_ROOT / recipe["aoi_config"])
    g, snapshot = load_snapshot_graph(
        aoi, recipe["profile"], recipe["attic_date"], REPO_ROOT / "data"
    )
    c = build_course(
        g, aoi, snapshot, course_id=recipe["id"], name=recipe["name"], mode=recipe["mode"],
        via=recipe["via"], preferences=recipe["preferences"],
    )  # fmt: skip
    uids = [s["edge_uid"] for s in c["properties"]["segments"]]
    assert hashlib.sha256("\n".join(uids).encode()).hexdigest() == summary["segments_sha256"]
    assert c["properties"]["validation"]["status"] == "valid"
