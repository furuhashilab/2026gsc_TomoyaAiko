import json
from pathlib import Path

import pytest

from circuitforge_gis import graph
from circuitforge_gis.aoi import REPO_ROOT, load_aoi
from circuitforge_gis.cli import DEFAULT_DATE
from circuitforge_gis.export import ATTRIBUTION, write_geojson
from circuitforge_gis.osm_fetch import build_query, element_hash, fetch
from circuitforge_gis.profile import DRIVE_WITH_SERVICE, MVP_DRIVE

FIXTURES = Path(__file__).parent / "fixtures"
ISSUE4_QUERY = REPO_ROOT / "docs" / "evidence" / "issue-4" / "overpass_query.overpassql"
ISSUE4_ELEMENT_SHA256 = "c2eed5dd2b6d397a"


def test_query_is_identical_to_issue4_evidence():
    assert build_query(load_aoi(), MVP_DRIVE, DEFAULT_DATE) == ISSUE4_QUERY.read_text()


def test_service_profile_only_adds_service():
    q = build_query(load_aoi(), DRIVE_WITH_SERVICE, DEFAULT_DATE)
    assert "|service)$" in q
    assert "service" not in build_query(load_aoi(), MVP_DRIVE, DEFAULT_DATE)


def test_element_hash_ignores_order():
    a = [
        {"type": "node", "id": 1, "lat": 0.0, "lon": 0.0},
        {"type": "node", "id": 2, "lat": 1.0, "lon": 1.0},
    ]
    assert element_hash(a) == element_hash(list(reversed(a)))


def test_geojson_is_lon_lat_with_attribution(tmp_path):
    elements = json.loads((FIXTURES / "mini_overpass.json").read_text())["elements"]
    aoi = load_aoi(FIXTURES / "aoi_fixture.json")
    g, _ = graph.clip_to_aoi(graph.build_directed_graph(elements), aoi)
    graph.add_projected_lengths(g, graph.check_length_crs(aoi))
    graph.add_components(g)
    nodes_path, edges_path = write_geojson(graph.simplify(g), tmp_path, {"test": True})
    for path in (nodes_path, edges_path):
        fc = json.loads(path.read_text())
        assert fc["attribution"] == ATTRIBUTION
        for f in fc["features"]:
            coords = f["geometry"]["coordinates"]
            points = [coords] if f["geometry"]["type"] == "Point" else coords
            for lon, lat in points:
                assert 141 < lon < 142 and 43 < lat < 44


@pytest.mark.network
def test_real_fetch_matches_issue4_data(tmp_path):
    response = fetch(build_query(load_aoi(), MVP_DRIVE, DEFAULT_DATE), tmp_path / "raw.json")
    assert element_hash(response["elements"]).startswith(ISSUE4_ELEMENT_SHA256)
