# Project Instructions

This repository uses the Page Studio shared AI development environment.

## Boundaries

- Work only inside this repository.
- `docs/`, `.ai/`, and Git are the source of truth.
- Never deploy, publish, push, merge, delete remote data, or modify infrastructure without explicit approval.
- Preserve user changes and avoid destructive Git commands.

## Required startup

Read in order: `docs/input/INDEX.md` when present, `.ai/INPUT_INDEX.json`, `docs/requirements/REQUIREMENTS.md`, `docs/PRD.md`, `docs/architecture/ARCHITECTURE.md`, `.ai/PROJECT_STATE.json`, `.ai/TASK_GRAPH.json`.

Use `/page-autodev` to run or resume the guarded shared workflow. Use the global Archify skill for architecture and workflow diagrams.

Source of Truth files contain only current valid decisions and evidence links. Git and `.ai/logs` preserve revision history. Synchronize compact Context only after its Gate passes. New technical ADRs remain draft until Architecture Gate approval; deployment-only unknowns belong in `.ai/RELEASE_RISKS.json` and block release only.
