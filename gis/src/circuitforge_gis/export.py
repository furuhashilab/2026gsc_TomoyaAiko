"""GeoJSON export (RFC 7946: WGS84, longitude/latitude order)."""

import json
from pathlib import Path

import networkx as nx
from shapely.geometry import LineString, mapping

ATTRIBUTION = "© OpenStreetMap contributors (ODbL 1.0)"
_SKIP_NODE = {"x", "y", "x_proj", "y_proj"}
_SKIP_EDGE = {"geometry", "merged_edges"}


def _jsonable(v):
    if isinstance(v, (list, tuple, set)):
        return [_jsonable(x) for x in v]
    if hasattr(v, "item"):  # numpy scalars
        return v.item()
    return v


def edge_line(g: nx.MultiDiGraph, u, v, d) -> LineString:
    if "geometry" in d:
        return d["geometry"]
    return LineString([(g.nodes[u]["x"], g.nodes[u]["y"]), (g.nodes[v]["x"], g.nodes[v]["y"])])


def write_geojson(g: nx.MultiDiGraph, out_dir: Path, metadata: dict) -> tuple[Path, Path]:
    out_dir.mkdir(parents=True, exist_ok=True)
    header = {
        "attribution": ATTRIBUTION,
        "coordinate_reference": "EPSG:4326 (lon, lat)",
        "metadata": metadata,
    }
    nodes = [
        {
            "type": "Feature",
            "id": n,
            "geometry": {"type": "Point", "coordinates": [d["x"], d["y"]]},
            "properties": {
                "osmid": n,
                **{k: _jsonable(v) for k, v in d.items() if k not in _SKIP_NODE},
            },
        }
        for n, d in g.nodes(data=True)
    ]
    edges = []
    for u, v, k, d in g.edges(keys=True, data=True):
        props = {k2: _jsonable(v2) for k2, v2 in d.items() if k2 not in _SKIP_EDGE}
        props.update(u=u, v=v, key=k, merged_segments=len(d.get("merged_edges") or [(u, v)]))
        geometry = mapping(edge_line(g, u, v, d))
        edges.append({"type": "Feature", "geometry": geometry, "properties": props})
    paths = out_dir / "nodes.geojson", out_dir / "edges.geojson"
    for path, feats in zip(paths, (nodes, edges), strict=True):
        fc = {"type": "FeatureCollection", **header, "features": feats}
        path.write_text(json.dumps(fc, ensure_ascii=False, default=_jsonable))
    return paths
