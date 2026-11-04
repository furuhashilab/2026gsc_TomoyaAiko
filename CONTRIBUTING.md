# Contributing to CircuitForge AI

This repository is an **early-stage university GIS research prototype**. Development lead: [@mapbytomoya](https://github.com/mapbytomoya).

**New contributors and AI agents:** start with [実作業ガイド / WORKFLOW.md](docs/WORKFLOW.md), which describes the practical order of Issues, local clone/branch/Claude Code steps, verification, PR handoff and research recordkeeping. This file covers contributor rules; WORKFLOW.md is the hands-on tutorial.

## Workflow
1. Check [Issues](https://github.com/furuhashilab/2026gsc_TomoyaAiko/issues) for scope, assignee and acceptance criteria. Discuss scope changes before implementing.
2. Make one issue-sized branch off `main` (e.g. `feat/issue-6-camera`, `docs/issue-1-study-design`).
3. Keep PRs focused; link their issue using `Refs #N` (or `Closes #N` when fully complete).
4. Describe purpose, key changes, how to reproduce or test, licenses / data provenance, screenshots (when useful), and limitations in the PR body.
5. Do not merge without human review or permission. If an implementation assistant is involved, record what was independently verified.

## Quality & research integrity
- Test graph connectivity, CRS/coordinate order, route validation and data parsing with small reproducible fixtures.
- Write explicit docs for input data, provenance, version, data access date, model/prompt, experiment seed, metrics and exclusions.
- Do not claim results based on screenshots only; include machine-checkable tests or repeatable instructions.
- No copyrighted game assets, unauthorized 3D vehicle models, credentials, massive map exports, unlicensed teacher datasets, or sensitive participant data.

## Current status
Only a development-environment skeleton exists ([Issue #5](https://github.com/furuhashilab/2026gsc_TomoyaAiko/issues/5)): `web/` (Vite + TypeScript + CesiumJS) and `gis/` (Python 3.12 via uv). Setup, run and test commands are in the [README](README.md#セットアップ); CI runs the same checks on every PR.
