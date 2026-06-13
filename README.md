# ArcReady

Arc-specific static CI quality gate and integration-pattern validator for wallets, bridges, App Kit integrations, and dApps.

[![ArcReady Example](https://github.com/tanka420/arcready/actions/workflows/arcready-example.yml/badge.svg)](https://github.com/tanka420/arcready/actions/workflows/arcready-example.yml)
[![Release](https://img.shields.io/github/v/release/tanka420/arcready?include_prereleases\&label=release)](https://github.com/tanka420/arcready/releases)
![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue)
![Node.js](https://img.shields.io/badge/Node.js-22%2B-green)
![npm](https://img.shields.io/badge/npm-arcready%400.3.0-blue)
![Backend](https://img.shields.io/badge/backend-not_required-lightgrey)

ArcReady helps developers catch common Arc integration mistakes before release. It is a developer-side early warning layer for static checks in local workflows and CI.

> ArcReady is an independent open-source project. It is not an official Circle or Arc product.

## What It Is

ArcReady scans source files for common Arc-specific integration assumptions across three presets:

- `wallet`
- `bridge`
- `app-kit`

It reports findings in terminal, JSON, Markdown, or HTML formats and can fail CI based on `critical`, `warning`, `info`, or `none` thresholds.

## Quick Demo

```powershell
npx --yes arcready@0.3.0 init
npx --yes arcready@0.3.0 scan
```

CI-oriented Markdown report:

```powershell
npx --yes arcready@0.3.0 scan --format markdown --out arcready-report.md
```

Shortened example output:

```text
ArcReady v0.3.0
Project: my-arc-app
Score: 75
Status: fail
Summary: 1 critical, 0 warning, 0 info
```

## Quick Start

Run without installing:

```powershell
npx --yes arcready@0.3.0 scan
```

Create a config file:

```powershell
npx --yes arcready@0.3.0 init
```

Install locally:

```powershell
npm install -D arcready
npx arcready scan
```

## GitHub Action

Minimal workflow:

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

The action runs the published npm CLI and defaults to `arcready@0.3.0`. You can pin or override the CLI package version:

```yaml
with:
  arcready-version: "0.3.0"
```

See [docs/github-action.md](docs/github-action.md) for inputs, artifact behavior, and external usage notes.

## What ArcReady Checks

### Wallet

- Arc chain metadata
- native USDC display
- avoiding ETH gas labeling assumptions
- one-confirmation finality assumptions
- unsupported PREVRANDAO assumptions
- blob transaction assumptions

### Bridge

- one-confirmation bridge assumptions
- CCTP domain `26`
- canonical USDC vs wrapped USDC assumptions
- relayer gas token assumptions
- retryable CCTP attestation `404` handling
- avoiding PREVRANDAO relay selection assumptions

### App Kit

- `Arc_Testnet` / Arc chain identifier usage
- capability guardrails
- explicit RPC configuration
- user-controlled wallet delegate handling
- user-facing fee explanation
- bridge minimum amount copy

ArcReady checks static integration patterns. It does not validate the Circle SDK or App Kit at runtime.

## Example Output

```text
CRITICAL (1)

- wallet/ONE_CONFIRMATION_FINAL
  Message: Arc wallet transaction flow appears to wait for more than one confirmation.
  Files: src/wallet.ts
  Suggested fix: Set Arc confirmation waits and release logic to 1 confirmation.
```

## Reports

Supported formats:

- terminal
- JSON
- Markdown
- HTML

```powershell
npx --yes arcready@0.3.0 scan --format terminal
npx --yes arcready@0.3.0 scan --format json --out arcready-report.json
npx --yes arcready@0.3.0 scan --format markdown --out arcready-report.md
npx --yes arcready@0.3.0 scan --format html --out arcready-report.html
```

Generated report folders such as `.arcready/` and `reports/` are ignored by git.

## What ArcReady Does Not Do

ArcReady does not perform:

- live Arc RPC checks
- Circle API checks
- on-chain transaction simulation
- contract deployment validation
- bridge runtime simulation
- real App Kit runtime validation
- SaaS/dashboard monitoring

It is a static CI quality gate, not a runtime verifier or compatibility guarantee.

## Why This Exists

Arc is EVM-compatible, but Arc integrations should not blindly inherit Ethereum-default assumptions. Teams can accidentally ship incorrect gas labels, finality waits, CCTP domain values, wrapped asset assumptions, or App Kit configuration mistakes.

ArcReady turns those common integration risks into local and CI checks.

## Configuration Basics

Create `arcready.config.json` in the project you want to scan:

```json
{
  "presets": ["wallet", "bridge", "app-kit"],
  "paths": ["src", "app", "components", "lib", "package.json"],
  "exclude": ["dist/**", "coverage/**", ".next/**", "node_modules/**"],
  "reporters": ["terminal", "json", "markdown", "html"],
  "failOn": "critical",
  "rules": {
    "wallet/ONE_CONFIRMATION_FINAL": "critical",
    "bridge/BRIDGE_CONFIRMATIONS_ONE": "critical",
    "app-kit/APPKIT_CHAIN_IDENTIFIER_VALID": "critical"
  }
}
```

### CI Behavior

`failOn` controls when the CLI exits non-zero:

| Value | Behavior |
| --- | --- |
| `critical` | Fail only when critical findings exist |
| `warning` | Fail when warning or critical findings exist |
| `info` | Fail when any finding exists |
| `none` | Never fail due to findings |

The CLI `--fail-on` option overrides the config value.

## Presets

| Preset | Focus | Example rules |
| --- | --- | --- |
| `wallet` | Wallet UX, chain metadata, fee display, finality | `ARC_CHAIN_METADATA`, `NO_ETH_GAS_LABEL`, `ONE_CONFIRMATION_FINAL` |
| `bridge` | CCTP, finality, relayer gas, canonical USDC | `BRIDGE_CONFIRMATIONS_ONE`, `CCTP_DOMAIN_26`, `RELAYER_USES_USDC_FOR_GAS` |
| `app-kit` | App Kit chain identifiers, capability guards, Unified Balance UX | `APPKIT_CHAIN_IDENTIFIER_VALID`, `APPKIT_CAPABILITY_SUPPORTED`, `UB_FEE_EXPLANATION_PRESENT` |

Full rule list: [docs/rule-catalog.md](docs/rule-catalog.md)

## Validation Fixtures

ArcReady includes good and bad fixtures for wallet, bridge, and App Kit integrations:

```powershell
corepack pnpm validate:fixtures
```

Good fixtures should pass with zero findings. Bad fixtures should produce findings and fail according to their expected result.

## Contributing

Contributions should keep ArcReady focused and conservative:

- keep rules Arc-specific
- prefer precise findings over noisy checks
- add or update tests for rule or message changes
- keep reporter schemas and CLI behavior stable unless a task explicitly changes them
- do not add SaaS, dashboard, auth, database, telemetry, or runtime validation features

Development commands:

```powershell
corepack pnpm build
corepack pnpm test
corepack pnpm lint
corepack pnpm validate:fixtures
```

## Independent Disclaimer

ArcReady is an independent open-source project. It is not an official Circle or Arc product, and its static findings should be treated as developer-side release checks rather than official validation.

## License

MIT
