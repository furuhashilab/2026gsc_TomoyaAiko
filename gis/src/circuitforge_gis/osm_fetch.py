"""Fetch OSM ways for an AOI from Overpass with a pinned (attic) date.

The query text is generated so that, for the MVP profile and the Sapporo AOI, it is
byte-identical to ``docs/evidence/issue-4/overpass_query.overpassql``. The element
hash uses the same canonicalisation as the Issue #4 evidence script, so a fetch can
be checked against the recorded ``c2eed5dd2b6d397a...`` value.
"""

import datetime
import hashlib
import json
import urllib.parse
import urllib.request
from pathlib import Path

from .aoi import Aoi
from .profile import NetworkProfile

OVERPASS_URL = "https://overpass-api.de/api/interpreter"
USER_AGENT = "CircuitForgeAI-research/0.1 (furuhashilab/2026gsc_TomoyaAiko)"


def _fmt(v: float) -> str:
    decimals = len(repr(float(v)).split(".")[1])
    return f"{v:.{max(3, decimals)}f}"


def build_query(aoi: Aoi, profile: NetworkProfile, date: str, timeout: int = 60) -> str:
    """Overpass QL for all ways of the profile intersecting the AOI, plus their nodes."""
    bbox = ",".join(_fmt(v) for v in (aoi.lat_min, aoi.lon_min, aoi.lat_max, aoi.lon_max))
    return (
        f'[out:json][timeout:{timeout}][date:"{date}"];\n'
        f"way{profile.overpass_filter()}({bbox});\n"
        "(._;>;);\n"
        "out body;\n"
    )


def element_hash(elements: list[dict]) -> str:
    """SHA-256 of the sorted, key-sorted elements (independent of response headers)."""
    canon = sorted(json.dumps(e, sort_keys=True, ensure_ascii=False) for e in elements)
    return hashlib.sha256("\n".join(canon).encode()).hexdigest()


def fetch(query: str, out_path: Path, url: str = OVERPASS_URL) -> dict:
    """POST the query, save the raw response and return it."""
    data = urllib.parse.urlencode({"data": query}).encode()
    req = urllib.request.Request(url, data=data, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=180) as resp:
        body = resp.read()
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_bytes(body)
    return json.loads(body)


def manifest(response: dict, query: str, aoi: Aoi, profile: NetworkProfile, date: str) -> dict:
    elements = response["elements"]
    counts: dict[str, int] = {}
    for e in elements:
        counts[e["type"]] = counts.get(e["type"], 0) + 1
    return {
        "source": "OpenStreetMap via Overpass API",
        "attribution": "© OpenStreetMap contributors (ODbL 1.0)",
        "endpoint": OVERPASS_URL,
        "attic_date": date,
        "aoi": {"id": aoi.id, "bbox_lon_lat": [aoi.lon_min, aoi.lat_min, aoi.lon_max, aoi.lat_max]},
        "profile": {"name": profile.name, "highways": list(profile.highways)},
        "query": query,
        "element_counts": counts,
        "element_sha256": element_hash(elements),
        "overpass_timestamp_osm_base": response.get("osm3s", {}).get("timestamp_osm_base"),
        "processed_utc": datetime.datetime.now(datetime.UTC).replace(microsecond=0).isoformat(),
    }
