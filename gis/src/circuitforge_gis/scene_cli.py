"""Command line entry point: ``uv run cf-scene build|check|sample-buildings``.

- build: write config/scene.<aoi>.json from the live PLATEAU catalog and terrain service
- check: re-fetch the pinned resources and report changes (exit 1 if anything changed)
- sample-buildings: building-base heights for the height check (``uv sync --group verify``)
"""

import argparse
import json
import sys
from pathlib import Path

from .aoi import DEFAULT_AOI_PATH, REPO_ROOT, load_aoi
from .plateau import build_scene_config, check_scene_config, sample_buildings

DEFAULT_SCENE = REPO_ROOT / "config" / "scene.sapporo.json"
DEFAULT_SAMPLE = REPO_ROOT / "docs" / "evidence" / "issue-8" / "buildings-base.json"


def main(argv: list[str] | None = None) -> None:
    p = argparse.ArgumentParser(prog="cf-scene", description=__doc__)
    p.add_argument("--aoi", type=Path, default=DEFAULT_AOI_PATH)
    p.add_argument("--scene", type=Path, default=DEFAULT_SCENE)
    sub = p.add_subparsers(dest="command", required=True)
    b = sub.add_parser("build")
    b.add_argument("--city-code", default="01100", help="PLATEAU city code (01100 = Sapporo)")
    sub.add_parser("check")
    s = sub.add_parser("sample-buildings")
    s.add_argument("--cell-m", type=float, default=300.0)
    s.add_argument("--cache", type=Path, default=REPO_ROOT / "data" / "raw" / "plateau-tiles")
    s.add_argument("-o", "--output", type=Path, default=DEFAULT_SAMPLE)
    args = p.parse_args(argv)
    aoi = load_aoi(args.aoi)

    if args.command == "build":
        cfg = build_scene_config(aoi, args.city_code)
        args.scene.write_text(json.dumps(cfg, ensure_ascii=False, indent=2) + "\n")
        print(f"wrote {args.scene}: {len(cfg['buildings']['tilesets'])} building tilesets, "
              f"terrain version {cfg['terrain']['snapshot']['version']}")  # fmt: skip
        return
    cfg = json.loads(args.scene.read_text())
    if args.command == "check":
        changes = check_scene_config(cfg)
        for c in changes:
            print(f"changed: {c}")
        print("no changes" if not changes else "re-run `cf-scene build` and the height check")
        sys.exit(1 if changes else 0)
    sample = sample_buildings(cfg, aoi, args.cache, args.cell_m)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(sample, ensure_ascii=False, indent=1) + "\n")
    hs = [b["base_ellipsoidal_m"] for b in sample["buildings"]]
    print(f"wrote {args.output}: {len(hs)} buildings, base height {min(hs):.2f}-{max(hs):.2f} m")


if __name__ == "__main__":
    main()
