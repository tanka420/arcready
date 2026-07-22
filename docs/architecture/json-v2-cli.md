# Opt-in json-v2 CLI projection

## Purpose

`arcready scan --json-v2` exposes the private canonical scan runtime as an
experimental, observational JSON document. The opt-in does not replace or
refactor the legacy CLI path.

The canonical runtime currently executes exactly:

- `bridge/CCTP_DOMAIN_26`
- `bridge/NO_WRAPPED_USDC_ON_ARC`
- `bridge/RELAYER_USES_USDC_FOR_GAS`

Its analysis state and applicability remain `unknown` because rule-specific
analysis acknowledgements are not available.

## Interface and exclusivity

The only canonical CLI syntax is:

```text
arcready scan --json-v2
```

The flag cannot be combined with explicit `--format`, `--out`, or `--fail-on`
options. Such a conflict exits `1`, writes no stdout, and writes this fixed
stderr message:

```text
--json-v2 cannot be combined with --format, --out, or --fail-on
```

Configured reporters and `failOn` values are not conflicts. They remain in the
normalized configuration but do not select canonical output or enforcement.

## Routing boundary

```text
scan options
  |
  +-- legacy
  |     -> runScan
  |     -> ScanReport
  |     -> legacy reporter
  |     -> stdout or file
  |     -> failOn
  |
  +-- --json-v2
        -> loadConfig(cwd)
        -> runInternalScanV2({ projectRoot: cwd, config })
        -> exact ScanResultV2
        -> one stdout write
        -> exit 0
```

The canonical branch returns before `runScan`, report construction, reporter
lookup, output-file handling, scoring, status, and `failOn` evaluation.

## Document and serialization

stdout is the exact `ScanResultV2` returned by the canonical runtime. Its
top-level keys are, in order:

1. `contractVersion`
2. `coverage`
3. `findings`
4. `diagnostics`

There is no report, result, project, or metadata wrapper. The CLI adds no
project root, timestamp, duration, package version, score, status, summary,
legacy findings, or instrumentation.

Serialization is equivalent to:

```text
JSON.stringify(scanResult, null, 2) + "\n"
```

The output uses two-space indentation, UTF-8, no BOM or ANSI, and exactly one
trailing LF on every platform. The CLI does not transform, sort, or incrementally
stream the validated result. Existing canonical construction and ordering own
determinism.

## Configuration

The CLI loads the existing normalized config with `loadConfig(cwd)` and passes
it directly to the runtime. Existing `paths`, `exclude`, and supported-rule
`off` overrides are respected. Non-`off` overrides retain existing detector
normalization behavior without changing canonical classification or
fingerprints.

Unsupported rule overrides remain inert. Configured and detected presets are
context only. Configured reporters produce no json-v2 output, and configured
`failOn` does not affect the canonical exit code. No json-v2 config property or
CLI override exists.

## stdout, stderr, and exit codes

A valid result writes one JSON document to stdout, leaves stderr empty, and
exits `0`, including when findings or recoverable diagnostics are present.
Canonical output is observational rather than enforcement.

Parse errors, unknown options, and explicit option conflicts exit `1`.

Fatal failures exit `2` with empty stdout and one sanitized message:

```text
ArcReady json-v2 error: invalid configuration.
ArcReady json-v2 error: unable to produce canonical scan output.
ArcReady json-v2 error: unable to write canonical scan output.
```

Raw errors, stacks, operational absolute paths, source content, and fallback
text are not reported. Recoverable repository and tool conditions remain in a
valid result's `diagnostics` array.

## One-write boundary

Scanning and in-memory serialization complete before one stdout write is
attempted. No heading or JSON fragment is deliberately emitted first. A stream
cannot retract bytes already accepted by the operating system, so this is a
one-write boundary rather than a claim of transactional output after a
mid-write pipe failure.

## Compatibility and API boundary

Without `--json-v2`, all legacy commands, output formats, files, scores,
statuses, summaries, exit codes, errors, and GitHub Action behavior remain
unchanged. `ScanResultV2` is never sent to a legacy reporter.

`runInternalScanV2`, Contract v2 types, CoverageV2, builders, adapters, and
instrumentation remain private. The CLI uses package-internal imports; there is
no public v2 library export or package subpath.

## Verification strategy

Direct CLI-handler tests use temporary repositories for rule, configuration,
conflict, serialization, determinism, and error behavior. Package smoke tests
exercise both the built `dist/bin.js` and a locally packed installation. Tests
do not invoke the published package or require repository fixture changes.

## Deferred work

This projection does not add ReportV2, GitHub Action integration, canonical
enforcement, SARIF, baselines, suppressions, or further rule adapters. Those
features require evidence from real canonical output and separate contracts.
