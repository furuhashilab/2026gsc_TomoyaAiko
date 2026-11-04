"""Sensitivity of straight/corner proxies to OSM vertex density (Issue #4).

Input: Overpass JSON of drivable highway ways in the AOI, fetched with
overpass_query.overpassql (attic date pinned). Stdlib only.
Projection: local equirectangular tangent plane at the AOI centre (scale error
< 0.1 % over ~2.4 km; adequate for angle/length statistics, not for final metrics).

Corner counts are computed inside each OSM way only. Turns at junctions between
ways are not measured here, so this is a preliminary check, not route-level evidence.

usage: python3 -I osm_angle_sensitivity.py OSM_JSON
"""
import collections, hashlib, json, math, statistics, sys

AOI = (141.335, 43.050, 141.365, 43.072)
LAT0 = math.radians((AOI[1] + AOI[3]) / 2)
R = 6371008.8


def xy(lon, lat):
    return (math.radians(lon - AOI[0]) * R * math.cos(LAT0), math.radians(lat - AOI[1]) * R)


def heading(a, b):
    return math.atan2(b[1] - a[1], b[0] - a[0])


def dturn(h1, h2):
    d = math.degrees(h2 - h1)
    return (d + 180) % 360 - 180


def resample(pts, step):
    out = [pts[0]]; carry = 0.0
    for a, b in zip(pts, pts[1:]):
        L = math.dist(a, b); t = step - carry
        while t <= L:
            out.append((a[0] + (b[0] - a[0]) * t / L, a[1] + (b[1] - a[1]) * t / L)); t += step
        carry = L - (t - step)
    if math.dist(out[-1], pts[-1]) > 1e-6:
        out.append(pts[-1])
    return out


def turns(pts):
    """(cumulative distance at vertex, signed turn deg) for interior vertices."""
    res = []; s = 0.0
    for i in range(1, len(pts) - 1):
        s += math.dist(pts[i - 1], pts[i])
        if math.dist(pts[i - 1], pts[i]) < 1e-6 or math.dist(pts[i], pts[i + 1]) < 1e-6:
            continue
        res.append((s, dturn(heading(pts[i - 1], pts[i]), heading(pts[i], pts[i + 1]))))
    return res


def corners_per_vertex(pts, th):
    return sum(1 for _, t in turns(pts) if abs(t) >= th)


def corners_windowed(pts, th, win):
    """Count corners where |net heading change| within a sliding window of `win` m reaches th.
    After a detection, skip ahead by one window so one curve is counted once."""
    tv = turns(pts); n = 0; i = 0
    while i < len(tv):
        acc = 0.0; j = i
        while j < len(tv) and tv[j][0] - tv[i][0] <= win:
            acc += tv[j][1]
            if abs(acc) >= th:
                break
            j += 1
        if j < len(tv) and abs(acc) >= th:
            n += 1
            end = tv[j][0] + win
            while i < len(tv) and tv[i][0] <= end:
                i += 1
        else:
            i += 1
    return n


def longest_straight(pts, th):
    best = cur = 0.0
    for i in range(1, len(pts)):
        seg = math.dist(pts[i - 1], pts[i])
        if i >= 2 and abs(dturn(heading(pts[i - 2], pts[i - 1]), heading(pts[i - 1], pts[i]))) >= th:
            cur = 0.0
        cur += seg; best = max(best, cur)
    return best


def main(path):
    d = json.load(open(path))
    # Overpass returns whole ways that touch the bbox; keep only vertices inside the AOI
    # and split ways where they leave it, so lengths/straights are AOI-bounded.
    nodes = {e["id"]: xy(e["lon"], e["lat"]) for e in d["elements"] if e["type"] == "node"
             and AOI[0] <= e["lon"] <= AOI[2] and AOI[1] <= e["lat"] <= AOI[3]}
    ways = [e for e in d["elements"] if e["type"] == "way"]
    # The raw response carries a fetch-time header, so compare element content instead of file bytes.
    canon = sorted(json.dumps(e, sort_keys=True, ensure_ascii=False) for e in d["elements"])
    digest = hashlib.sha256("\n".join(canon).encode()).hexdigest()
    counts = collections.Counter(e["type"] for e in d["elements"])
    print("OSM base timestamp:", d.get("osm3s", {}).get("timestamp_osm_base"), "| elements", dict(counts),
          "| sha256(sorted elements)", digest[:16])

    tags = collections.Counter()
    for w in ways:
        for k in ("oneway", "maxspeed", "lanes", "width", "surface", "access"):
            if k in w.get("tags", {}):
                tags[k] += 1
    print("tag presence (share of ways):", {k: f"{tags[k]/len(ways):.0%}" for k in ("oneway", "maxspeed", "lanes", "width", "surface", "access")})

    polylines = []
    for w in ways:
        cur = []
        for n in w["nodes"]:
            if n in nodes:
                cur.append(nodes[n])
            else:
                if len(cur) >= 2:
                    polylines.append(cur)
                cur = []
        if len(cur) >= 2:
            polylines.append(cur)
    total_km = sum(math.dist(a, b) for p in polylines for a, b in zip(p, p[1:])) / 1000
    segs = [math.dist(a, b) for p in polylines for a, b in zip(p, p[1:])]
    q = statistics.quantiles(segs, n=10)
    print(f"total way length {total_km:.1f} km | vertex spacing median {statistics.median(segs):.1f} m, p10 {q[0]:.1f} m, p90 {q[-1]:.1f} m")

    allturns = [abs(t) for p in polylines for _, t in turns(p)]
    bins = [(0, 5), (5, 10), (10, 30), (30, 45), (45, 90), (90, 181)]
    print("interior-vertex |turn| distribution:",
          {f"{a}-{b}°": f"{sum(1 for t in allturns if a <= t < b)/len(allturns):.1%}" for a, b in bins}, f"(n={len(allturns)})")

    variants = {"raw": polylines, "resample 5 m": [resample(p, 5) for p in polylines],
                "resample 20 m": [resample(p, 20) for p in polylines]}
    print("\ncorners per km (within ways; intersections between ways not included)")
    print(f"{'geometry':<15}" + "".join(f"{'vtx θc='+str(t):>12}" for t in (30, 45, 60)) + "".join(f"{'win30m θc='+str(t):>15}" for t in (30, 45, 60)))
    for name, pls in variants.items():
        row = f"{name:<15}"
        for t in (30, 45, 60):
            row += f"{sum(corners_per_vertex(p, t) for p in pls)/total_km:>12.2f}"
        for t in (30, 45, 60):
            row += f"{sum(corners_windowed(p, t, 30) for p in pls)/total_km:>15.2f}"
        print(row)

    print("\nlongest straight within a way (median over ways ≥ 200 m / max), by θ")
    long_ways = [p for p in polylines if sum(math.dist(a, b) for a, b in zip(p, p[1:])) >= 200]
    for name, pls in (("raw", long_ways), ("resample 5 m", [resample(p, 5) for p in long_ways])):
        row = f"{name:<15}"
        for t in (5, 10, 15):
            v = [longest_straight(p, t) for p in pls]
            row += f"  θ={t}°: {statistics.median(v):6.0f} / {max(v):6.0f} m"
        print(row, f"(n={len(pls)})")


if __name__ == "__main__":
    main(sys.argv[1])
