"""Offline tests on a hand-made Overpass fixture (tests/fixtures/mini_overpass.json).

Way ids in the fixture are named after what they exercise; see the fixture file.
"""

import json
import math
from pathlib import Path

import pytest

from circuitforge_gis import graph
from circuitforge_gis.aoi import load_aoi

FIXTURES = Path(__file__).parent / "fixtures"


@pytest.fixture(scope="module")
def elements():
    return json.loads((FIXTURES / "mini_overpass.json").read_text())["elements"]


@pytest.fixture(scope="module")
def aoi():
    return load_aoi(FIXTURES / "aoi_fixture.json")


@pytest.fixture(scope="module")
def built(elements, aoi):
    full = graph.build_directed_graph(elements)
    clipped, clip_report = graph.clip_to_aoi(full, aoi)
    graph.add_projected_lengths(clipped)
    graph.add_components(clipped)
    simplified = graph.simplify(clipped)
    return {"full": full, "clipped": clipped, "clip": clip_report, "simplified": simplified}


def edges_of(g, way_id):
    return {(u, v) for u, v, d in g.edges(data=True) if d["osmid"] == way_id}


def attrs_of(g, way_id):
    return [d for *_, d in g.edges(data=True) if d["osmid"] == way_id]


# --- direction -----------------------------------------------------------------------


def test_untagged_way_is_two_way(built):
    assert edges_of(built["full"], 101) == {(1, 2), (2, 3), (2, 1), (3, 2)}


def test_oneway_minus_one_runs_against_way_order(built):
    assert edges_of(built["full"], 103) == {(4, 1)}
    assert all(
        d["direction"] == "reverse" and not d["way_order"] for d in attrs_of(built["full"], 103)
    )


@pytest.mark.parametrize("way_id", [104, 105, 111])  # reversible, "yes;no", motorway_link
def test_uncertain_direction_is_not_made_two_way(built, way_id):
    edges = edges_of(built["full"], way_id)
    assert len(edges) == 1  # drawn order only, no reverse edge
    assert all(
        d["direction"] == "uncertain" and not d["routable"] for d in attrs_of(built["full"], way_id)
    )


def test_roundabout_is_one_way_in_drawn_order(built):
    assert edges_of(built["full"], 107) == {(20, 21), (21, 22), (22, 23), (23, 20)}


def test_untagged_motorway_is_one_way(built):
    assert edges_of(built["full"], 109) == {(6, 40)}


# --- access --------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("way_id", "access", "routable"),
    [
        (112, "restricted", False),  # access=private
        (113, "allowed", True),  # access=no + motorcar=yes
        (114, "restricted", False),  # access=yes + motor_vehicle=no
        (115, "untagged", False),  # access:conditional -> review
        (116, "untagged", False),  # oneway:conditional -> review
        (117, "untagged", True),  # oneway:bicycle only
    ],
)
def test_access_and_review(built, way_id, access, routable):
    for d in attrs_of(built["full"], way_id):
        assert d["access"] == access
        assert d["routable"] is routable


# --- AOI clipping --------------------------------------------------------------------


def test_boundary_segment_keeps_first_outside_node_only(built):
    g = built["clipped"]
    assert 8 in g and not g.nodes[8]["in_aoi"]
    assert 9 not in g
    (d,) = g.get_edge_data(7, 8).values()
    assert d["aoi_status"] == "crossing"


def test_corner_cutting_segment_is_reported(built):
    assert 30 not in built["clipped"] and 31 not in built["clipped"]
    assert built["clip"]["dropped_segments_cutting_aoi_way_ids"] == [110]


# --- lengths and components ----------------------------------------------------------


def test_epsg6680_length_matches_geodesic(built):
    for *_, d in built["clipped"].edges(data=True):
        assert math.isclose(d["length_m"], d["length_geod_m"], rel_tol=1e-4)


def test_scc_ignores_non_routable_edges(built):
    g = built["clipped"]
    # 2->5 exists only as an uncertain (non-routable) edge
    assert all(d["scc_id"] == -1 for d in g.get_edge_data(2, 5).values())


# --- simplification ------------------------------------------------------------------


def test_simplification_keeps_vertices_lengths_and_attributes(built):
    report = graph.verify_simplification(built["clipped"], built["simplified"])
    assert report["problems"] == []
    assert report["raw_edges_covered"] == built["clipped"].number_of_edges()


def test_curve_corner_shape_survives_simplification(built, elements):
    s = built["simplified"]
    curve = [d for d in s.get_edge_data(4, 5).values() if d["osmid"] == 106]
    assert len(curve) == 1
    coords = {e["id"]: (e["lon"], e["lat"]) for e in elements if e["type"] == "node"}
    assert list(curve[0]["geometry"].coords) == [coords[n] for n in (4, 10, 11, 12, 13, 5)]
    raw = built["clipped"]
    expected = sum(
        next(iter(raw.get_edge_data(a, b).values()))["length_m"]
        for a, b in [(4, 10), (10, 11), (11, 12), (12, 13), (13, 5)]
    )
    assert math.isclose(curve[0]["length_m"], expected)


def test_boundary_node_stays_an_endpoint(built):
    # 7 is mid-way along way 102, but the inside/crossing change keeps it as a node
    assert 7 in built["simplified"]
    assert (7, 8) in edges_of(built["simplified"], 102)
