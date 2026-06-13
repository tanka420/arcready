# ArcReady Spec

## Purpose

ArcReady validates Arc-specific integration quality before release. The project
is designed for CI usage by wallets, dApps, bridge flows, App Kit integrations,
and indexers.

## Current Scope

The initial repository foundation provides:

- A pnpm workspace.
- A TypeScript CLI package at `packages/arcready`.
- Minimal `arcready init` and `arcready scan` commands.
- A typed config loader for `arcready.config.json`.
- A typed finding model, scan summary, scan report, and scoring model.
- A sequential internal rule runner and preset registry.
- A stub scan report backed by the scoring model.
- Placeholder directories for future rules, presets, reporters, config,
  findings, and scoring.

## Current Non-Goals

- No hosted dashboard.
- No database.
- No auth.
- No telemetry.
- No runtime RPC calls.
- No real Arc rule execution.

## Config Shape

ArcReady supports one config file: `arcready.config.json`.

Supported fields:

- `presets`: array of `wallet`, `app-kit`, or `bridge`.
- `paths`: string array.
- `exclude`: string array.
- `reporters`: array of `terminal`, `markdown`, `json`, or `html`.
- `failOn`: `info`, `warning`, `critical`, or `none`.
- `rpc.arcTestnetHttp`: optional string.
- `rpc.arcTestnetWs`: optional string.
- `rules`: object mapping rule IDs to `off`, `info`, `warning`, or `critical`.

## Scan Report Shape

`arcready scan` returns JSON with:

- `project`: scanned project root.
- `score`: score from 0 to 100.
- `status`: `pass`, `warn`, or `fail`.
- `summary`: counts for `critical`, `warning`, and `info` findings.
- `findings`: an empty array until real rules exist.

Scoring starts at 100, subtracts 25 per critical finding, 10 per warning, and 2
per info, with a floor of 0.

## Rule Framework

Rules implement a stable internal contract with an ID, preset, default severity,
docs, and a `run` function. The scan pipeline loads configured files, detects the
project type, resolves preset rules, runs rules sequentially, and converts rule
findings into the final scan report.

The current wallet, App Kit, and bridge preset rules are placeholders only and
return no findings.
