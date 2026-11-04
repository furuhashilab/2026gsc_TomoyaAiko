import copy

import pytest

from circuitforge_gis.aoi import DEFAULT_AOI_PATH, load_aoi, parse_aoi

VALID = {
    "id": "test",
    "name": "test",
    "bbox": [141.335, 43.05, 141.365, 43.072],
    "crs": "EPSG:4326",
}


def test_shared_config_loads():
    aoi = load_aoi(DEFAULT_AOI_PATH)
    assert aoi.id == "sapporo-center"
    assert (aoi.lon_min, aoi.lat_min, aoi.lon_max, aoi.lat_max) == (141.335, 43.05, 141.365, 43.072)


def test_rejects_lat_lon_swapped_bbox():
    data = copy.deepcopy(VALID)
    data["bbox"] = [43.05, 141.335, 43.072, 141.365]  # lat/lon order by mistake
    with pytest.raises(ValueError, match="latitudes"):
        parse_aoi(data)


def test_rejects_non_increasing_bbox():
    data = copy.deepcopy(VALID)
    data["bbox"] = [141.365, 43.05, 141.335, 43.072]
    with pytest.raises(ValueError, match="longitudes"):
        parse_aoi(data)


def test_rejects_other_crs():
    data = copy.deepcopy(VALID)
    data["crs"] = "EPSG:6668"
    with pytest.raises(ValueError, match="crs"):
        parse_aoi(data)
