"""PLATEAU Sapporo: how much of the AOI has real LOD2 buildings? (Issue #4 evidence)

The "lod2" 3D Tiles published by PLATEAU also contain LOD1 geometry for buildings
that have no LOD2 model, so tileset coverage is not LOD2 coverage. This script
reads each building's `_lod`, `_x`, `_y` (centroid, WGS84) from the b3dm batch
tables instead of decoding geometry. Stdlib only.

usage:
  python3 -I lod_batch.py CACHE_DIR OUT_DIR                     # discover tiles via the live catalog
  python3 -I lod_batch.py CACHE_DIR OUT_DIR plateau_manifest.json  # re-download exactly the pinned tiles
                                                                   # and verify their SHA-256
  - downloads only the b3dm tiles whose content bounding region intersects the AOI
    (71 tiles, 203 MB in 10^6 bytes on 2026-11-04) into CACHE_DIR
  - writes plateau_manifest.json (catalog entries, tile URLs, sizes, SHA-256) and
    aoi_lod_grid_100m.geojson / .txt to OUT_DIR

The 100 m grid is an approximation: cells are laid out with a local metres-per-degree
factor, the last row/column is clipped by the AOI, and a cell is classified only from
the building centroids that fall inside it. It is not an exact area coverage.
"""
import collections, datetime, hashlib, json, math, os, struct, sys, urllib.request

AOI = (141.335, 43.050, 141.365, 43.072)  # lon_min, lat_min, lon_max, lat_max (WGS84)
CATALOG = "https://api.plateauview.mlit.go.jp/datacatalog/plateau-datasets"
WARDS = ("01101", "01102", "01103", "01105")  # Sapporo wards whose tileset bbox intersects the AOI
CATALOG_FIELDS = ("id", "ward", "ward_code", "year", "registration_year", "spec", "lod", "texture", "crs", "url")
CT = {5120: "b", 5121: "B", 5122: "h", 5123: "H", 5124: "i", 5125: "I", 5126: "f", 5130: "d",
      "BYTE": "b", "UNSIGNED_BYTE": "B", "SHORT": "h", "UNSIGNED_SHORT": "H", "INT": "i",
      "UNSIGNED_INT": "I", "FLOAT": "f", "DOUBLE": "d"}


def intersects(region_rad):
    w, s, e, n = (math.degrees(v) for v in region_rad[:4])
    return not (e < AOI[0] or w > AOI[2] or n < AOI[1] or s > AOI[3])


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def cache_name(dataset_id, uri):
    return f"{dataset_id}__{uri.replace('/', '_')}"


def discover():
    """Build a manifest from the live PLATEAU catalog."""
    datasets = json.load(urllib.request.urlopen(CATALOG))["datasets"]
    manifest = {"catalog": CATALOG, "retrieved_utc": datetime.datetime.utcnow().replace(microsecond=0).isoformat() + "Z",
                "aoi": AOI, "tile_selection": "leaf tiles whose content boundingVolume.region intersects the AOI",
                "datasets": []}
    for d in datasets:
        if d.get("city_code") != "01100" or d.get("ward_code") not in WARDS:
            continue
        if d["id"] not in (f"{d['ward_code']}_bldg_lod1", f"{d['ward_code']}_bldg_lod2_no_texture"):
            continue
        entry = {k: d.get(k) for k in CATALOG_FIELDS}
        base = d["url"].rsplit("/", 1)[0]
        t = json.load(urllib.request.urlopen(d["url"]))
        stack, tiles = [t["root"]], []
        while stack:
            n = stack.pop()
            stack.extend(n.get("children", []))
            if n.get("children") or "content" not in n:
                continue
            if intersects(n["content"].get("boundingVolume", n["boundingVolume"])["region"]):
                tiles.append({"uri": n["content"]["uri"], "url": f"{base}/{n['content']['uri']}"})
        entry["tiles"] = sorted(tiles, key=lambda x: x["uri"])
        manifest["datasets"].append(entry)
    manifest["datasets"].sort(key=lambda x: x["id"])
    return manifest


def download(manifest, cache, verify):
    os.makedirs(cache, exist_ok=True)
    for d in manifest["datasets"]:
        for tile in d["tiles"]:
            fn = os.path.join(cache, cache_name(d["id"], tile["uri"]))
            if not os.path.exists(fn):
                urllib.request.urlretrieve(tile["url"], fn)
            digest = sha256(fn)
            if verify and digest != tile["sha256"]:
                raise SystemExit(f"SHA-256 mismatch for {tile['url']}: {digest} != {tile['sha256']}")
            tile["bytes"] = os.path.getsize(fn); tile["sha256"] = digest


def batch_table(path):
    d = open(path, "rb").read()
    _, _, _, ftj, ftb, btj, btb = struct.unpack_from("<4s6I", d, 0)
    n = json.loads(d[28:28 + ftj])["BATCH_LENGTH"]
    o = 28 + ftj + ftb
    bt = json.loads(d[o:o + btj]); binb = d[o + btj:o + btj + btb]

    def col(k):
        v = bt.get(k)
        if isinstance(v, dict):  # reference into the batch table binary body
            return list(struct.unpack_from("<%d%s" % (n, CT[v["componentType"]]), binb, v["byteOffset"]))
        return v if v is not None else [None] * n
    return n, col


def buildings(manifest, cache, suffix):
    seen = {}
    for d in manifest["datasets"]:
        if not d["id"].endswith(suffix):
            continue
        for tile in d["tiles"]:
            n, col = batch_table(os.path.join(cache, cache_name(d["id"], tile["uri"])))
            gid, x, y, lod = col("gml_id"), col("_x"), col("_y"), col("_lod")
            for i in range(n):
                if gid[i] not in seen and AOI[0] <= x[i] <= AOI[2] and AOI[1] <= y[i] <= AOI[3]:
                    seen[gid[i]] = (x[i], y[i], lod[i])
    return seen


def grid_report(seen, cell_m, outdir):
    mx = 111320.0 * math.cos(math.radians((AOI[1] + AOI[3]) / 2)); my = 110574.0  # local approx, binning only
    ncol = math.ceil((AOI[2] - AOI[0]) * mx / cell_m); nrow = math.ceil((AOI[3] - AOI[1]) * my / cell_m)
    aoi_m2 = (AOI[2] - AOI[0]) * mx * (AOI[3] - AOI[1]) * my
    cells = collections.defaultdict(lambda: [0, 0])  # [lod1-only buildings, lod2 buildings]
    for x, y, lod in seen.values():
        cells[(min(int((x - AOI[0]) * mx // cell_m), ncol - 1), min(int((y - AOI[1]) * my // cell_m), nrow - 1))][lod == 2] += 1

    def half_or_more(v):  # LOD2 buildings >= LOD1-only buildings in the cell ("half or more", not "majority")
        return v[1] > 0 and v[1] >= v[0]

    def clipped_m2(i, j):  # cell area inside the AOI; only the last column/row is partial
        w = min(cell_m, (AOI[2] - AOI[0]) * mx - i * cell_m)
        h = min(cell_m, (AOI[3] - AOI[1]) * my - j * cell_m)
        return w * h

    built = len(cells)
    any2 = sum(1 for v in cells.values() if v[1])
    half = [k for k, v in cells.items() if half_or_more(v)]
    half_m2 = sum(clipped_m2(*k) for k in half)
    lod2 = [(x, y) for x, y, l in seen.values() if l == 2]
    print(f"grid {ncol}x{nrow} cells of {cell_m:.0f} m (last column/row clipped by AOI); built cells {built}; "
          f"cells with any LOD2 {any2} ({any2/built:.1%} of built)")
    print(f"cells with LOD2 >= half of buildings: {len(half)} ({len(half)/built:.1%} of built cells, "
          f"{len(half)/(ncol*nrow):.1%} of grid cells); clipped area {half_m2/1e6:.2f} km2 = {half_m2/aoi_m2:.1%} of AOI "
          f"({aoi_m2/1e6:.2f} km2, same local approximation)")
    print("LOD2 buildings %d / %d (%.1f%%); LOD2 centroid bbox lon %.4f-%.4f lat %.4f-%.4f" % (
        len(lod2), len(seen), 100 * len(lod2) / len(seen), min(p[0] for p in lod2), max(p[0] for p in lod2),
        min(p[1] for p in lod2), max(p[1] for p in lod2)))
    rows = ["".join(" " if (i, j) not in cells else "#" if half_or_more(cells[(i, j)])
                    else "+" if cells[(i, j)][1] else "." for i in range(ncol)) for j in reversed(range(nrow))]
    print("\n".join(rows))
    os.makedirs(outdir, exist_ok=True)
    feats = []
    for (i, j), (a, b) in sorted(cells.items()):
        x0 = AOI[0] + i * cell_m / mx; y0 = AOI[1] + j * cell_m / my
        x1 = min(x0 + cell_m / mx, AOI[2]); y1 = min(y0 + cell_m / my, AOI[3])
        ring = [[round(x0, 6), round(y0, 6)], [round(x1, 6), round(y0, 6)], [round(x1, 6), round(y1, 6)],
                [round(x0, 6), round(y1, 6)], [round(x0, 6), round(y0, 6)]]
        feats.append({"type": "Feature",
                      "properties": {"lod1_only_buildings": a, "lod2_buildings": b,
                                     "lod2_half_or_more": half_or_more((a, b)), "area_in_aoi_m2": round(clipped_m2(i, j))},
                      "geometry": {"type": "Polygon", "coordinates": [ring]}})
    json.dump({"type": "FeatureCollection", "features": feats,
               "attribution": "Derived from Project PLATEAU (MLIT) Sapporo FY2020 3D Tiles"},
              open(os.path.join(outdir, "aoi_lod_grid_100m.geojson"), "w"))
    open(os.path.join(outdir, "aoi_lod_grid_100m.txt"), "w").write("\n".join(rows) + "\n")


def main(cache, outdir, manifest_in=None):
    if manifest_in:
        manifest = json.load(open(manifest_in))
    else:
        manifest = discover()
    download(manifest, cache, verify=bool(manifest_in))
    n_tiles = sum(len(d["tiles"]) for d in manifest["datasets"])
    n_bytes = sum(t["bytes"] for d in manifest["datasets"] for t in d["tiles"])
    print(f"tiles {n_tiles}, {n_bytes/1e6:.0f} MB, catalog retrieved {manifest['retrieved_utc']}"
          + (" (pinned manifest, SHA-256 verified)" if manifest_in else ""))
    if not manifest_in:
        os.makedirs(outdir, exist_ok=True)
        json.dump(manifest, open(os.path.join(outdir, "plateau_manifest.json"), "w"), ensure_ascii=False, indent=1)
    l1 = buildings(manifest, cache, "_bldg_lod1")
    l2 = buildings(manifest, cache, "_bldg_lod2_no_texture")
    for name, s in (("lod1 tileset", l1), ("lod2 tileset", l2)):
        print(name, "buildings in AOI:", len(s), "by _lod:", dict(sorted(collections.Counter(v[2] for v in s.values()).items())))
    print("in both", len(set(l1) & set(l2)), "| only in lod1 tileset", len(set(l1) - set(l2)))
    merged = {g: (x, y, 2 if g in l2 and l2[g][2] == 2 else 1) for g, (x, y, _) in l1.items()}
    grid_report(merged, 100.0, outdir)


if __name__ == "__main__":
    main(*sys.argv[1:4])
