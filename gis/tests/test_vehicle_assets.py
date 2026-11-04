"""The committed vehicle model files must match the SHA-256 and licence recorded in
config/vehicle.json (Issue #9)."""

import hashlib
import json

from circuitforge_gis.aoi import REPO_ROOT

CONFIG = REPO_ROOT / "config" / "vehicle.json"
PUBLIC = REPO_ROOT / "web" / "public"


def test_model_files_match_recorded_sha256():
    cfg = json.loads(CONFIG.read_text())
    files = cfg["model"]["files"]
    assert cfg["model"]["uri"] in files
    for rel, digest in files.items():
        assert hashlib.sha256((PUBLIC / rel).read_bytes()).hexdigest() == digest, rel


def test_model_licence_is_recorded_and_shipped():
    cfg = json.loads(CONFIG.read_text())
    assert cfg["model"]["license"] == "CC0-1.0"
    licence = (PUBLIC / "models" / "kenney-car-kit" / "License.txt").read_text()
    assert "CC0" in licence and "Kenney" in licence


def test_vehicle_check_evidence_matches_config():
    cfg = json.loads(CONFIG.read_text())
    check = json.loads(
        (REPO_ROOT / "docs" / "evidence" / "issue-9" / "vehicle-check.json").read_text()
    )
    a, g = cfg["animation"], cfg["geometry"]
    s = check["settings"]
    assert s["terrain_sample_step_m"] == a["terrain_sample_step_m"]
    assert s["heading_window_m"] == a["heading_window_m"]
    assert s["base_speed_kmh"] == a["base_speed_kmh"]
    assert s["ground_offset_m"] == g["ground_offset_m"]
    stats = check["grounding"]["stats"]
    assert stats["withinThreshold"] <= stats["n"] and stats["thresholdM"] == 0.3
    assert check["heading"]["reversals"] == 0
