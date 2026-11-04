"""3D scene sources for the viewer: PLATEAU building 3D Tiles and PLATEAU-Terrain (Issue #8).

``build_scene_config`` writes ``config/scene.<aoi>.json`` with the delivery URLs, dataset
identifiers, attribution, licence status and a snapshot (SHA-256 / version / retrieval
time) of what the services returned. URLs alone do not pin the data: the PLATEAU
services are trial services and may change content, so ``check_scene_config`` re-fetches
and reports differences, and the height check must be re-run after any change.

``sample_buildings`` reproduces the building-base height sample used to check that
buildings sit on the terrain (needs the optional ``verify`` group for DracoPy).
"""

import datetime
import hashlib
import json
import math
import struct
import urllib.request
from pathlib import Path

from pyproj import Transformer

from .aoi import Aoi

CATALOG_URL = "https://api.plateauview.mlit.go.jp/datacatalog/plateau-datasets"
TERRAIN_URL = "https://tile.plateauview.mlit.go.jp/terrain"
TERRAIN_DOCS = "https://docs.plateauview.mlit.go.jp/datasets/terrain/"
TERRAIN_ATTRIBUTION = "PLATEAU | Mapterhorn | 国土地理院"
PLATEAU_SITE_POLICY = "https://www.mlit.go.jp/plateau/site-policy/"
USER_AGENT = "CircuitForgeAI-research/0.1 (furuhashilab/2026gsc_TomoyaAiko)"
# Per ward: LOD2 without texture where it exists (it falls back to LOD1 per building),
# otherwise LOD1.
PREFERRED_SUFFIXES = ("bldg_lod2_no_texture", "bldg_lod1")
CATALOG_FIELDS = (
    "id",
    "name",
    "ward",
    "ward_code",
    "year",
    "registration_year",
    "spec",
    "lod",
    "texture",
    "crs",
)


def fetch(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=60) as resp:
        return resp.read()


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def now_utc() -> str:
    return datetime.datetime.now(datetime.UTC).replace(microsecond=0).isoformat()


def region_intersects(region_rad: list[float], aoi: Aoi) -> bool:
    w, s, e, n = (math.degrees(v) for v in region_rad[:4])
    return not (e < aoi.lon_min or w > aoi.lon_max or n < aoi.lat_min or s > aoi.lat_max)


def choose_tilesets(datasets: list[dict], city_code: str, wards: set[str]) -> list[dict]:
    """One building tileset per ward in ``wards``, preferring LOD2 without texture."""
    by_id = {d["id"]: d for d in datasets if d.get("city_code") == city_code}
    chosen = []
    for ward in sorted(wards):
        for suffix in PREFERRED_SUFFIXES:
            d = by_id.get(f"{ward}_{suffix}")
            if d:
                chosen.append(d)
                break
    return chosen


def build_scene_config(aoi: Aoi, city_code: str, terrain_url: str = TERRAIN_URL) -> dict:
    datasets = json.loads(fetch(CATALOG_URL))["datasets"]
    candidates = {
        d["ward_code"]: d
        for d in datasets
        if d.get("city_code") == city_code
        and d.get("type_en") == "bldg"
        and d["id"].endswith("_bldg_lod1")
    }
    wards = set()
    for ward, d in candidates.items():
        root = json.loads(fetch(d["url"]))["root"]
        if region_intersects(root["boundingVolume"]["region"], aoi):
            wards.add(ward)
    tilesets = []
    for d in choose_tilesets(datasets, city_code, wards):
        body = fetch(d["url"])
        tilesets.append(
            {
                **{k: d.get(k) for k in CATALOG_FIELDS},
                "url": d["url"],
                "tileset_json_sha256": sha256(body),
                "tileset_version": json.loads(body).get("asset", {}).get("tilesetVersion"),
            }
        )
    layer_body = fetch(f"{terrain_url}/layer.json")
    layer = json.loads(layer_body)
    city = tilesets[0] if tilesets else {}
    retrieved = now_utc()
    return {
        "schema": "circuitforge-scene",
        "schema_version": "0.1.0",
        "aoi_id": aoi.id,
        "retrieved_utc": retrieved,
        "terrain": {
            "provider": "PLATEAU-Terrain",
            "format": layer.get("format"),
            "url": terrain_url,
            "request_vertex_normals": True,
            "height_reference": "ellipsoidal (orthometric + geoid height, per provider docs)",
            "docs": TERRAIN_DOCS,
            "attribution": TERRAIN_ATTRIBUTION,
            "service_status": "trial service; no guarantee of availability or content",
            "licence": {
                "status": "unconfirmed",
                "note": "Provider docs require the attribution above but state no data licence; "
                "do not assume PDL1.0. Tracked in Issue #12.",
            },
            "snapshot": {
                "layer_json_sha256": sha256(layer_body),
                "version": layer.get("version"),
                "maxzoom": layer.get("maxzoom"),
                "projection": layer.get("projection"),
                "extensions": layer.get("extensions"),
                "retrieved_utc": retrieved,
            },
        },
        "buildings": {
            "provider": "PLATEAU",
            "catalog": CATALOG_URL,
            "city_code": city_code,
            "dataset_year": city.get("year"),
            "spec": city.get("spec"),
            "attribution": _building_attribution(_city_name(datasets, city_code), city.get("year")),
            "service_status": "trial service; asset URLs may change",
            "licence": {
                "name": "公共データ利用規約 第1.0版 (PDL1.0)",
                "cc_by_4_0_compatible": True,
                "source": PLATEAU_SITE_POLICY,
                "use": "display only (no modification or redistribution of the data)",
            },
            "tilesets": tilesets,
        },
    }


def _building_attribution(city: str, year) -> str:
    return f"「3D都市モデル（Project PLATEAU）{city}（{year}年度）」（国土交通省）"


def _city_name(datasets: list[dict], city_code: str) -> str:
    return next((d["city"] for d in datasets if d.get("city_code") == city_code), city_code)


def check_scene_config(cfg: dict) -> list[str]:
    """Re-fetch the pinned resources and list what changed since the config was written."""
    changes = []
    layer_body = fetch(f"{cfg['terrain']['url']}/layer.json")
    snap = cfg["terrain"]["snapshot"]
    if sha256(layer_body) != snap["layer_json_sha256"]:
        version = json.loads(layer_body).get("version")
        changes.append(f"terrain layer.json changed (version {snap['version']} -> {version})")
    for t in cfg["buildings"]["tilesets"]:
        try:
            body = fetch(t["url"])
        except OSError as exc:
            changes.append(f"{t['id']}: {exc}")
            continue
        if sha256(body) != t["tileset_json_sha256"]:
            changes.append(f"{t['id']}: tileset.json changed")
    return changes


# --- building base heights (verification) ---------------------------------------------

_CT = {5120: "b", 5121: "B", 5122: "h", 5123: "H", 5124: "i", 5125: "I", 5126: "f", 5130: "d"}
_CT.update({"BYTE": "b", "UNSIGNED_BYTE": "B", "SHORT": "h", "UNSIGNED_SHORT": "H"})
_CT.update({"INT": "i", "UNSIGNED_INT": "I", "FLOAT": "f", "DOUBLE": "d"})


def batch_table(data: bytes) -> tuple[int, dict]:
    """(BATCH_LENGTH, {column: values}) of a b3dm tile."""
    _, _, _, ftj, ftb, btj, btb = struct.unpack_from("<4s6I", data, 0)
    n = json.loads(data[28 : 28 + ftj])["BATCH_LENGTH"]
    o = 28 + ftj + ftb
    bt = json.loads(data[o : o + btj])
    binary = data[o + btj : o + btj + btb]
    cols = {}
    for k, v in bt.items():
        if isinstance(v, dict) and "byteOffset" in v:
            cols[k] = list(
                struct.unpack_from(f"<{n}{_CT[v['componentType']]}", binary, v["byteOffset"])
            )
        elif isinstance(v, list) and len(v) == n:
            cols[k] = v
    return n, cols


def sample_one_per_cell(buildings: list[dict], aoi: Aoi, cell_m: float) -> list[dict]:
    """Deterministic spatial sample: per cell_m grid cell (in the AOI's length CRS), the
    building with the smallest gml_id whose centroid lies in the AOI."""
    tr = Transformer.from_crs("EPSG:4326", aoi.length_crs, always_xy=True)
    x0, y0 = tr.transform(aoi.lon_min, aoi.lat_min)
    cells: dict[tuple[int, int], dict] = {}
    for b in buildings:
        if not (aoi.lon_min <= b["lon"] <= aoi.lon_max and aoi.lat_min <= b["lat"] <= aoi.lat_max):
            continue
        x, y = tr.transform(b["lon"], b["lat"])
        key = (int((x - x0) // cell_m), int((y - y0) // cell_m))
        if key not in cells or b["gml_id"] < cells[key]["gml_id"]:
            cells[key] = b
    return [cells[k] for k in sorted(cells)]


def _node_matrix(n: dict) -> list[float]:
    if "matrix" in n:
        return n["matrix"]
    t, s = n.get("translation", [0, 0, 0]), n.get("scale", [1, 1, 1])
    qx, qy, qz, qw = n.get("rotation", [0, 0, 0, 1])
    r = [
        1 - 2 * (qy * qy + qz * qz), 2 * (qx * qy + qz * qw), 2 * (qx * qz - qy * qw), 0,
        2 * (qx * qy - qz * qw), 1 - 2 * (qx * qx + qz * qz), 2 * (qy * qz + qx * qw), 0,
        2 * (qx * qz + qy * qw), 2 * (qy * qz - qx * qw), 1 - 2 * (qx * qx + qy * qy), 0,
        t[0], t[1], t[2], 1,
    ]  # fmt: skip
    for c in range(3):
        for row in range(3):
            r[c * 4 + row] *= s[c]
    return r


def _matmul(a: list[float], b: list[float]) -> list[float]:  # 4x4, column-major
    return [sum(a[k * 4 + r] * b[c * 4 + k] for k in range(4)) for c in range(4) for r in range(4)]


_Y_UP_TO_Z_UP = [1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1]


def building_base_heights(data: bytes) -> dict[int, float]:
    """Lowest ellipsoidal height (m) of each building (batch id) in a Draco b3dm tile."""
    import DracoPy  # optional "verify" dependency group

    _, _, _, ftj, ftb, btj, btb = struct.unpack_from("<4s6I", data, 0)
    ft = json.loads(data[28 : 28 + ftj]) if ftj else {}
    glb = data[28 + ftj + ftb + btj + btb :]
    jlen = struct.unpack_from("<I", glb, 12)[0]
    gl = json.loads(glb[20 : 20 + jlen])
    binc = glb[20 + jlen + 8 :]
    rtc = (
        gl.get("extensions", {})
        .get("CESIUM_RTC", {})
        .get("center", ft.get("RTC_CENTER", [0, 0, 0]))
    )
    to_geodetic = Transformer.from_crs("EPSG:4978", "EPSG:4979", always_xy=True)
    lowest: dict[int, float] = {}
    nodes = gl.get("nodes", [])

    def visit(index: int, parent: list[float]) -> None:
        node = nodes[index]
        m = _matmul(parent, _node_matrix(node))
        for prim in gl["meshes"][node["mesh"]]["primitives"] if "mesh" in node else []:
            draco = prim["extensions"]["KHR_draco_mesh_compression"]
            view = gl["bufferViews"][draco["bufferView"]]
            start = view.get("byteOffset", 0)
            mesh = DracoPy.decode(bytes(binc[start : start + view["byteLength"]]))
            uid = draco["attributes"]["_BATCHID"]
            ids = next(a["data"] for a in mesh.attributes if a.get("unique_id") == uid)
            for (x, y, z), b in zip(mesh.points, ids, strict=True):
                b = int(b[0]) if hasattr(b, "__len__") else int(b)
                ex = m[0] * x + m[4] * y + m[8] * z + m[12] + rtc[0]
                ey = m[1] * x + m[5] * y + m[9] * z + m[13] + rtc[1]
                ez = m[2] * x + m[6] * y + m[10] * z + m[14] + rtc[2]
                h = to_geodetic.transform(ex, ey, ez)[2]
                lowest[b] = min(h, lowest.get(b, math.inf))
        for child in node.get("children", []):
            visit(child, m)

    for index in gl["scenes"][gl.get("scene", 0)]["nodes"]:
        visit(index, _Y_UP_TO_Z_UP)
    return lowest


def _leaf_tiles(tileset: dict, aoi: Aoi) -> list[str]:
    uris, stack = [], [tileset["root"]]
    while stack:
        node = stack.pop()
        stack.extend(node.get("children", []))
        if node.get("children") or "content" not in node:
            continue
        if region_intersects(
            node["content"].get("boundingVolume", node["boundingVolume"])["region"], aoi
        ):
            uris.append(node["content"]["uri"])
    return sorted(uris)


def tile_key(tileset_id: str, uri: str) -> str:
    """Key used in ``tiles_sha256``: '<tileset id>/<tile uri>'."""
    return f"{tileset_id}/{uri}"


def tile_url(cfg: dict, key: str) -> str:
    tileset_id, uri = key.split("/", 1)
    t = next(t for t in cfg["buildings"]["tilesets"] if t["id"] == tileset_id)
    return f"{t['url'].rsplit('/', 1)[0]}/{uri}"


def compare_tile_hashes(recorded: dict[str, str], current: dict[str, str]) -> dict[str, list[str]]:
    """Which tiles changed, appeared or disappeared relative to a recorded tiles_sha256."""
    return {
        "changed": sorted(k for k in recorded.keys() & current.keys() if recorded[k] != current[k]),
        "added": sorted(current.keys() - recorded.keys()),
        "removed": sorted(recorded.keys() - current.keys()),
    }


def check_tiles(cfg: dict, recorded: dict[str, str]) -> dict[str, list[str]]:
    """Re-download every recorded building tile (no cache) and compare its SHA-256."""
    current = {}
    for key in recorded:
        try:
            current[key] = sha256(fetch(tile_url(cfg, key)))
        except OSError:
            pass  # reported as removed
    return compare_tile_hashes(recorded, current)


def sample_buildings(
    cfg: dict, aoi: Aoi, cache_dir: Path, cell_m: float = 300.0, refresh: bool = False
) -> dict:
    """Building-base heights for a deterministic grid sample of the configured tilesets.

    Tiles are cached in ``cache_dir``; ``refresh=True`` downloads them again so that a
    provider update is not hidden by the cache. The SHA-256 of every tile used is
    returned in ``tiles_sha256`` for comparison with an earlier run.
    """
    cache_dir.mkdir(parents=True, exist_ok=True)
    found, tiles_used = [], {}
    for t in cfg["buildings"]["tilesets"]:
        base = t["url"].rsplit("/", 1)[0]
        for uri in _leaf_tiles(json.loads(fetch(t["url"])), aoi):
            path = cache_dir / f"{t['id']}__{uri.replace('/', '_')}"
            if refresh or not path.exists():
                path.write_bytes(fetch(f"{base}/{uri}"))
            data = path.read_bytes()
            tiles_used[tile_key(t["id"], uri)] = sha256(data)
            n, cols = batch_table(data)
            for i in range(n):
                found.append(
                    {
                        "gml_id": cols["gml_id"][i], "lon": cols["_x"][i], "lat": cols["_y"][i],
                        "zmin_attr": cols["_zmin"][i], "lod": cols["_lod"][i],
                        "tileset": t["id"], "tile": uri, "_path": path, "_batch": i,
                    }
                )  # fmt: skip
    unique = {b["gml_id"]: b for b in found}  # tiles of one tileset do not overlap buildings
    chosen = sample_one_per_cell(list(unique.values()), aoi, cell_m)
    heights: dict[Path, dict[int, float]] = {}
    for b in chosen:
        if b["_path"] not in heights:
            heights[b["_path"]] = building_base_heights(b["_path"].read_bytes())
        b["base_ellipsoidal_m"] = round(heights[b["_path"]][b["_batch"]], 3)
    return {
        "method": {
            "selection": (
                f"one building per {cell_m:.0f} m grid cell ({aoi.length_crs}, origin at the AOI "
                "south-west corner); per cell the smallest gml_id with centroid (_x, _y) in the AOI"
            ),
            "base_height": "lowest vertex of the building's 3D Tiles geometry, ECEF -> ellipsoidal "
            "height (EPSG:4978 -> EPSG:4979)",
            "zmin_attr": "batch table _zmin (orthometric, from CityGML) for reference",
        },
        "aoi": {"id": aoi.id, "bbox": [aoi.lon_min, aoi.lat_min, aoi.lon_max, aoi.lat_max]},
        "tilesets": [
            {"id": t["id"], "tileset_json_sha256": t["tileset_json_sha256"]}
            for t in cfg["buildings"]["tilesets"]
        ],
        "tiles_sha256": dict(sorted(tiles_used.items())),
        "sampled_utc": now_utc(),
        "tiles_downloaded_fresh": refresh,
        "attribution": cfg["buildings"]["attribution"],
        "buildings": [{k: v for k, v in b.items() if not k.startswith("_")} for b in chosen],
    }
