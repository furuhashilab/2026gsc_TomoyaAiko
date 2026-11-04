"""Offline tests for the 3D scene config and the height-check evidence (Issue #8)."""

import hashlib
import json
import random
import re
import struct

from circuitforge_gis.aoi import REPO_ROOT, load_aoi
from circuitforge_gis.plateau import (
    TERRAIN_ATTRIBUTION,
    batch_table,
    choose_tilesets,
    region_intersects,
    sample_one_per_cell,
)

SCENE = REPO_ROOT / "config" / "scene.sapporo.json"
EVIDENCE = REPO_ROOT / "docs" / "evidence" / "issue-8"
SHA256 = re.compile(r"^[0-9a-f]{64}$")


def test_choose_tilesets_prefers_lod2_without_texture():
    datasets = [
        {"id": "01101_bldg_lod1", "city_code": "01100"},
        {"id": "01101_bldg_lod2", "city_code": "01100"},
        {"id": "01101_bldg_lod2_no_texture", "city_code": "01100"},
        {"id": "01105_bldg_lod1", "city_code": "01100"},
        {"id": "13104_bldg_lod2_no_texture", "city_code": "13104"},
    ]
    chosen = choose_tilesets(datasets, "01100", {"01101", "01105"})
    assert [d["id"] for d in chosen] == ["01101_bldg_lod2_no_texture", "01105_bldg_lod1"]


def test_region_intersects():
    aoi = load_aoi()
    rad = [v * 3.141592653589793 / 180 for v in (141.30, 43.00, 141.34, 43.06)]
    assert region_intersects(rad, aoi)
    far = [v * 3.141592653589793 / 180 for v in (139.70, 35.60, 139.80, 35.70)]
    assert not region_intersects(far, aoi)


def test_grid_sample_is_deterministic_and_inside_aoi():
    aoi = load_aoi()
    rng = random.Random(0)
    buildings = [
        {
            "gml_id": f"b{i:04d}",
            "lon": rng.uniform(141.33, 141.37),
            "lat": rng.uniform(43.045, 43.075),
        }
        for i in range(2000)
    ]
    a = sample_one_per_cell(buildings, aoi, 300)
    rng.shuffle(buildings)
    b = sample_one_per_cell(buildings, aoi, 300)
    assert a == b
    assert all(
        aoi.lon_min <= x["lon"] <= aoi.lon_max and aoi.lat_min <= x["lat"] <= aoi.lat_max for x in a
    )
    assert len({x["gml_id"] for x in a}) == len(a)


def test_batch_table_reads_json_and_binary_columns():
    n = 3
    feature = json.dumps({"BATCH_LENGTH": n}).encode()
    binary = struct.pack("<3d", 10.5, 11.5, 12.5)
    table = json.dumps(
        {"gml_id": ["a", "b", "c"], "_zmin": {"byteOffset": 0, "componentType": "DOUBLE"}}
    ).encode()
    header = struct.pack("<4s6I", b"b3dm", 1, 0, len(feature), 0, len(table), len(binary))
    count, cols = batch_table(header + feature + table + binary)
    assert count == n
    assert cols["gml_id"] == ["a", "b", "c"]
    assert cols["_zmin"] == [10.5, 11.5, 12.5]


def test_committed_scene_config_records_sources_and_snapshot():
    cfg = json.loads(SCENE.read_text())
    t, b = cfg["terrain"], cfg["buildings"]
    assert t["url"].startswith("https://") and t["attribution"] == TERRAIN_ATTRIBUTION
    assert t["licence"]["status"] == "unconfirmed"  # not assumed to be PDL1.0
    assert SHA256.match(t["snapshot"]["layer_json_sha256"]) and t["snapshot"]["version"]
    assert b["licence"]["name"].startswith("公共データ利用規約") and b["attribution"]
    assert b["tilesets"] and all(
        ts["url"].startswith("https://") and SHA256.match(ts["tileset_json_sha256"])
        for ts in b["tilesets"]
    )
    assert cfg["retrieved_utc"]


def test_height_check_evidence_is_consistent():
    sample_bytes = (EVIDENCE / "buildings-base.json").read_bytes()
    check = json.loads((EVIDENCE / "height-check.json").read_text())
    assert check["buildings_sample"]["sha256"] == hashlib.sha256(sample_bytes).hexdigest()
    rows = [dict(zip(check["row_fields"], r, strict=True)) for r in check["rows"]]
    assert len(rows) == check["stats"]["n"] == len(json.loads(sample_bytes)["buildings"])
    for r in rows:
        assert abs(r["base_ellipsoidal_m"] - r["terrain_m"] - r["diff_m"]) < 0.002
    within = sum(abs(r["diff_m"]) <= check["stats"]["thresholdM"] for r in rows)
    assert within == check["stats"]["withinThreshold"]
    assert (
        check["terrain"]["live_version"]
        == json.loads(SCENE.read_text())["terrain"]["snapshot"]["version"]
    )
