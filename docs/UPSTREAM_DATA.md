# Upstream Football Data Integrations

## Decision

The project does **not** mirror full upstream repositories. The selected projects already publish maintained packages or release artifacts, and copying them would create stale code, repository bloat, license drift, and an unnecessary maintenance fork.

The project instead pins dependencies, consumes release/API data, caches immutable raw artifacts, records provenance, and keeps all transformation and scoring logic inside this repository.

## Selected upstream projects

### nflverse/nflreadpy — integrated dependency

Primary Python entry point for NFL players, rosters, weekly/seasonal statistics, draft history, combine results, and ID mappings. It replaces the deprecated `nfl_data_py` package.

Implementation: `scripts/collectors/nflverse.py` and `requirements-data.txt`.

### nflverse/nflverse-data — release source

The authoritative distribution point for most nflverse data. Release assets are consumed through nflreadpy rather than mirrored. Most datasets are broadly CC-BY-4.0, but every published artifact must retain attribution and dataset-specific license notes.

### dynastyprocess/data — referenced fantasy dataset

Useful for market values, draft-pick values, and identifier mappings. It should be consumed through maintained access functions where possible. Dataset licenses must be checked before republishing derived files.

### sportsdataverse/cfbfastR — methodology reference

A mature college-football analytics project. Because this dashboard is Python-first, the R package is not vendored. Its documented data definitions and EPA/context methodology are a reference for future deterministic college-production features.

### CFBD/cfb.js and CollegeFootballData API — direct API integration

The API provides rosters, recruiting records, player statistics, and historical draft data. The repository uses a small Python adapter rather than copying the generated JavaScript client. `CFBD_API_KEY` is required and must be stored as a GitHub Actions secret or local environment variable.

### sportsdataverse/sportsdataverse-py — evaluation only

MIT-licensed and potentially useful, but not required for the initial pipeline. Direct CFBD and nflreadpy adapters reduce dependency count and make provenance clearer.

## Data contract

Every collected dataset must record:

- upstream repository or API;
- retrieval timestamp;
- endpoint or release identity;
- request parameters or seasons;
- local artifact path;
- collection failures;
- applicable license/attribution requirement.

Raw data is not a prospect grade. It must pass identity resolution, normalization, evidence validation, and deterministic scoring before entering `data/prospect_board.json`.

## Commands

```bash
python -m pip install -r requirements-data.txt
python scripts/collectors/nflverse.py --seasons 2024 2025 2026
CFBD_API_KEY=... python scripts/collectors/cfbd.py --year 2026 --teams "Ohio State" "Alabama"
```

## Mirroring policy

Mirroring is reserved for abandoned projects or small immutable files needed for reproducibility, and only when the license clearly allows redistribution. A mirrored file must include upstream repository, commit SHA, retrieval date, original license, and a statement describing local modifications.
