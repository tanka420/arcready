# GitHub Action

ArcReady provides a GitHub Action for running Arc-specific static CI checks in external repositories. The action runs the published npm CLI package and generates JSON, Markdown, and HTML reports.

> ArcReady is an independent open-source project. It is not an official Circle or Arc product.

The GitHub Action is intended for static integration validation of common Arc wallet, bridge, App Kit, and dApp mistakes. It does not perform live Arc RPC checks, Circle API checks, on-chain simulation, contract deployment checks, bridge runtime simulation, or real App Kit runtime validation.

## Basic Usage

```yaml
name: ArcReady

on:
  pull_request:
  push:
    branches: [main]

jobs:
  arcready:
    runs-on: ubuntu-latest
    permissions:
      contents: read

    steps:
      - uses: actions/checkout@v4

      - uses: tanka420/arcready@v0.3.0
        with:
          fail-on: critical
```

`v0.3.0` is the current GitHub Action-ready release and includes rule quality hardening. The action runs the published npm CLI package, and the default CLI version is `0.3.0`. You can override the CLI package version with `arcready-version`.

## Inputs

| Input | Default | Description |
| --- | --- | --- |
| `arcready-version` | `0.3.0` | ArcReady npm package version to run |
| `working-directory` | `.` | Directory to scan |
| `fail-on` | `critical` | Fail when findings reach `critical`, `warning`, `info`, or `none` |
| `output-dir` | `.arcready/reports` | Directory for ArcReady report files |
| `upload-artifact` | `true` | Upload ArcReady reports as a workflow artifact |
| `artifact-name` | `arcready-report` | Artifact name for uploaded ArcReady reports |

## Working Directory

Scan a subdirectory:

```yaml
- uses: tanka420/arcready@v0.3.0
  with:
    working-directory: apps/wallet
    fail-on: critical
```

## Report Artifacts

The action writes:

```text
.arcready/reports/arcready.json
.arcready/reports/arcready.md
.arcready/reports/arcready.html
```

Upload artifacts with the default settings:

```yaml
- uses: tanka420/arcready@v0.3.0
  with:
    upload-artifact: true
```

Customize the report directory and artifact name:

```yaml
- uses: tanka420/arcready@v0.3.0
  with:
    output-dir: reports/arcready
    artifact-name: arc-static-validation
```

## Fail Threshold

Fail only on critical findings:

```yaml
with:
  fail-on: critical
```

Fail on warnings or critical findings:

```yaml
with:
  fail-on: warning
```

Generate reports without failing on findings:

```yaml
with:
  fail-on: none
```

## External Smoke Coverage

The repository includes an external action smoke workflow that validates the released action syntax:

```yaml
uses: tanka420/arcready@v0.3.0
```

It checks a known-good fixture that should pass and a known-bad fixture that should fail as expected.

External action smoke validation is configured to use `uses: tanka420/arcready@v0.3.0` after the `v0.3.0` tag is created and pushed.
