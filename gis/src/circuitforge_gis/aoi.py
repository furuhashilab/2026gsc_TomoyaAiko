"""Shared area of interest (AOI) configuration.

The AOI lives in ``config/aoi.<name>.json`` at the repository root so that the web
viewer and the GIS pipeline read the same bounds. Coordinates are WGS84
(EPSG:4326) in longitude, latitude order.
"""

import json
from dataclasses import dataclass
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
DEFAULT_AOI_PATH = REPO_ROOT / "config" / "aoi.sapporo.json"


@dataclass(frozen=True)
class Aoi:
    id: str
    name: str
    lon_min: float
    lat_min: float
    lon_max: float
    lat_max: float


def parse_aoi(data: dict) -> Aoi:
    """Validate an AOI config dict and return it as an ``Aoi``."""
    if data.get("crs") != "EPSG:4326":
        raise ValueError(f"AOI crs must be EPSG:4326, got {data.get('crs')!r}")
    bbox = data.get("bbox")
    if not isinstance(bbox, list) or len(bbox) != 4:
        raise ValueError("AOI bbox must be [lon_min, lat_min, lon_max, lat_max]")
    lon_min, lat_min, lon_max, lat_max = (float(v) for v in bbox)
    if not (-180 <= lon_min < lon_max <= 180):
        raise ValueError(f"AOI longitudes out of range or not increasing: {lon_min}, {lon_max}")
    if not (-90 <= lat_min < lat_max <= 90):
        raise ValueError(f"AOI latitudes out of range or not increasing: {lat_min}, {lat_max}")
    return Aoi(str(data["id"]), str(data["name"]), lon_min, lat_min, lon_max, lat_max)


def load_aoi(path: Path = DEFAULT_AOI_PATH) -> Aoi:
    with open(path, encoding="utf-8") as f:
        return parse_aoi(json.load(f))
