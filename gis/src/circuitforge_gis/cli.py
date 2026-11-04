"""Command line entry point: ``uv run cf-osm``.

Fetches (or reuses) raw Overpass data for the AOI, builds the directed graph,
clips it to the AOI, simplifies and verifies it, and writes GeoJSON plus an audit.
Raw and processed data go under ``data/`` (gitignored).
"""

import argparse
import json
from pathlib import Path

import osmnx as ox

from . import audit, graph
from .aoi import DEFAULT_AOI_PATH, REPO_ROOT, load_aoi
from .export import write_geojson
from .osm_fetch import build_query, fetch, manifest
from .profile import MVP_DRIVE, PROFILES

DEFAULT_DATE = "2026-11-03T16:25:05Z"  # same attic date as the Issue #4 evidence


def run(elements: list[dict], aoi, out_dir: Path, meta: dict) -> dict:
    full = graph.build_directed_graph(elements)
    clipped, clip_report = graph.clip_to_aoi(full, aoi)
    graph.add_projected_lengths(clipped)
    comp_report = graph.add_components(clipped)
    simplified = graph.simplify(clipped)
    verify_report = graph.verify_simplification(clipped, simplified)

    out_dir.mkdir(parents=True, exist_ok=True)
    ox.save_graphml(clipped, out_dir / "graph_unsimplified.graphml")
    ox.save_graphml(simplified, out_dir / "graph_simplified.graphml")
    write_geojson(simplified, out_dir, meta)
    report = {
        "provenance": {k: meta.get(k) for k in ("attic_date", "element_sha256", "element_counts")},
        "ways": audit.audit_ways(elements),
        "aoi_clipping": clip_report,
        "components": comp_report,
        "graph_unsimplified": audit.audit_graph(clipped),
        "graph_simplified": audit.audit_graph(simplified),
        "simplification_check": verify_report,
    }
    report_json = json.dumps(report, ensure_ascii=False, indent=1, default=str)
    (out_dir / "audit.json").write_text(report_json)
    (out_dir / "audit.md").write_text(audit.to_markdown(report))
    return report


def main(argv: list[str] | None = None) -> None:
    p = argparse.ArgumentParser(prog="cf-osm", description=__doc__)
    p.add_argument("--aoi", type=Path, default=DEFAULT_AOI_PATH)
    p.add_argument("--profile", choices=sorted(PROFILES), default=MVP_DRIVE.name)
    p.add_argument("--date", default=DEFAULT_DATE, help="Overpass attic date (UTC, ISO 8601)")
    p.add_argument("--data-dir", type=Path, default=REPO_ROOT / "data")
    p.add_argument("--refetch", action="store_true", help="download even if the raw file exists")
    args = p.parse_args(argv)

    aoi = load_aoi(args.aoi)
    profile = PROFILES[args.profile]
    query = build_query(aoi, profile, args.date)
    tag = f"{aoi.id}_{profile.name}_{args.date.replace(':', '')}"
    raw_path = args.data_dir / "raw" / f"osm_{tag}.json"
    if args.refetch or not raw_path.exists():
        response = fetch(query, raw_path)
    else:
        response = json.loads(raw_path.read_text())
    meta = manifest(response, query, aoi, profile, args.date)
    out_dir = args.data_dir / "processed" / tag
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "manifest.json").write_text(json.dumps(meta, ensure_ascii=False, indent=1))
    report = run(response["elements"], aoi, out_dir, meta)

    print(f"elements {meta['element_counts']} sha256 {meta['element_sha256'][:16]}")
    print(f"output   {out_dir}")
    v = report["simplification_check"]
    print(f"graph    {v['raw_nodes']} nodes / {v['raw_edges']} edges (unsimplified)")
    print(f"         {v['simplified_nodes']} nodes / {v['simplified_edges']} edges (simplified)")
    print(f"check    {len(v['problems'])} simplification problems")


if __name__ == "__main__":
    main()
