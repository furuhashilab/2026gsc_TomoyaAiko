"""Command line entry point: ``uv run cf-course build|validate``.

The road graph is rebuilt from the pinned raw OSM file in ``data/raw/`` (written by
``cf-osm``), and its element hash must match the course's ``osm_snapshot``.
"""

import argparse
import json
import sys
from pathlib import Path

from . import graph
from .aoi import DEFAULT_AOI_PATH, REPO_ROOT, Aoi, load_aoi
from .cli import DEFAULT_DATE, snapshot_tag
from .course import CourseError, build_course, validate
from .osm_fetch import element_hash
from .profile import MVP_DRIVE


def load_snapshot_graph(aoi: Aoi, profile: str, date: str, data_dir: Path):
    raw = data_dir / "raw" / f"osm_{snapshot_tag(aoi.id, profile, date)}.json"
    if not raw.exists():
        raise CourseError(f"{raw} not found; run `uv run cf-osm` for this AOI and date first")
    elements = json.loads(raw.read_text())["elements"]
    g, _ = graph.clip_to_aoi(graph.build_directed_graph(elements), aoi)
    graph.add_projected_lengths(g, graph.check_length_crs(aoi))
    snapshot = {"attic_date": date, "element_sha256": element_hash(elements), "profile": profile}
    return g, snapshot


def _print_validation(v: dict) -> None:
    print(f"status   {v['status']}  ({len(v['errors'])} errors, {len(v['warnings'])} warnings)")
    for kind in ("errors", "warnings"):
        for item in v[kind]:
            print(f"  {item['code']}: {item['message']}")


def cmd_build(args) -> int:
    recipe = json.loads(args.recipe.read_text()) if args.recipe else {}
    aoi = load_aoi(REPO_ROOT / recipe["aoi_config"] if "aoi_config" in recipe else args.aoi)
    date = recipe.get("attic_date", args.date)
    profile = recipe.get("profile", MVP_DRIVE.name)
    g, snapshot = load_snapshot_graph(aoi, profile, date, args.data_dir)
    via = recipe.get("via")
    if args.via:
        via = [[float(x) for x in v.split(",")] for v in args.via]
    if args.via_nodes:
        via = [int(n) for n in args.via_nodes]
    course = build_course(
        g, aoi, snapshot,
        course_id=args.id or recipe["id"],
        name=args.name or recipe["name"],
        mode=args.mode or recipe.get("mode", "circuit"),
        via=via if not args.segments else None,
        segments=args.segments or None,
        preferences=recipe.get("preferences"),
    )  # fmt: skip
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(course, ensure_ascii=False, indent=1) + "\n")
    p = course["properties"]
    print(f"wrote    {args.output}")
    print(f"length   {p['length_m']:.1f} m, {len(p['segments'])} segments")
    _print_validation(p["validation"])
    return 0 if p["validation"]["status"] == "valid" else 1


def cmd_validate(args) -> int:
    course = json.loads(args.course.read_text())
    p = course.get("properties", {})
    try:
        a, snap = p["aoi"], p["osm_snapshot"]
        aoi = Aoi(a["id"], a["id"], *a["bbox"], length_crs=a["length_crs"])
        g, snapshot = load_snapshot_graph(aoi, snap["profile"], snap["attic_date"], args.data_dir)
    except KeyError as exc:
        print(f"invalid course file: missing {exc}", file=sys.stderr)
        return 1
    v = validate(course, g, snapshot["element_sha256"])
    _print_validation(v)
    return 0 if v["status"] == "valid" else 1


def main(argv: list[str] | None = None) -> None:
    p = argparse.ArgumentParser(prog="cf-course", description=__doc__)
    p.add_argument("--data-dir", type=Path, default=REPO_ROOT / "data")
    sub = p.add_subparsers(dest="command", required=True)
    b = sub.add_parser("build", help="build a course from via points or segments")
    b.add_argument("--recipe", type=Path, help="JSON with id, name, mode, via, preferences")
    b.add_argument("--aoi", type=Path, default=DEFAULT_AOI_PATH)
    b.add_argument("--date", default=DEFAULT_DATE)
    b.add_argument("--id")
    b.add_argument("--name")
    b.add_argument("--mode", choices=["circuit", "rally"])
    b.add_argument("--via", nargs="+", metavar="LON,LAT")
    b.add_argument("--via-nodes", nargs="+", metavar="NODE_ID")
    b.add_argument("--segments", nargs="+", metavar="EDGE_UID")
    b.add_argument("-o", "--output", type=Path, required=True)
    b.set_defaults(func=cmd_build)
    v = sub.add_parser("validate", help="validate a course file")
    v.add_argument("course", type=Path)
    v.set_defaults(func=cmd_validate)
    args = p.parse_args(argv)
    try:
        sys.exit(args.func(args))
    except CourseError as exc:
        print(f"error: {exc}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
