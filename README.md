# ArcReady

Open-source Arc-specific CI quality gate and integration validator.

[![ArcReady Example](https://github.com/tanka420/arcready/actions/workflows/arcready-example.yml/badge.svg)](https://github.com/tanka420/arcready/actions/workflows/arcready-example.yml)
[![Release](https://img.shields.io/github/v/release/tanka420/arcready?include_prereleases\&label=release)](https://github.com/tanka420/arcready/releases)
![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue)
![Node.js](https://img.shields.io/badge/Node.js-22%2B-green)
![Status](https://img.shields.io/badge/status-MVP-orange)
![Backend](https://img.shields.io/badge/backend-not_required-lightgrey)

ArcReady helps developers catch Arc-specific integration mistakes before release. It is designed for wallets, bridge flows, App Kit integrations, and dApps that want a lightweight local and CI validation step.

> ArcReady is an independent open-source project. It is not an official Circle or Arc product.

ArcReady is local-first and CI-friendly. It does not require a hosted backend, database, authentication system, telemetry, SaaS workspace, or dashboard.

## Links

* GitHub Action: [ArcReady Example](https://github.com/tanka420/arcready/actions/workflows/arcready-example.yml)
* MVP Release: [v0.1.0-mvp](https://github.com/tanka420/arcready/releases/tag/v0.1.0-mvp)
* Roadmap: [GitHub Issues](https://github.com/tanka420/arcready/issues)

## Why ArcReady Exists

Arc is EVM-compatible, but Arc integrations should not blindly assume Ethereum-default behavior.

Projects can accidentally ship incorrect assumptions around:

* USDC gas display
* one-confirmation finality
* CCTP domain configuration
* canonical USDC handling
* relayer gas funding
* App Kit chain identifiers
* App Kit capability guards
* Unified Balance UX messaging

ArcReady turns these assumptions into local and CI checks.

Docs explain what should be done. ArcReady helps verify that a project is actually following those expectations.

## Current Status

ArcReady is currently an MVP / early open-source tool.

Implemented:

* CLI scanner
* Wallet rules v1
* Bridge rules v1
* App Kit rules v1
* Terminal report
* JSON report
* Markdown report
* HTML report
* Composite GitHub Action
* Validation fixtures
* Fixture validation script

Not included in v1:

* hosted dashboard
* database
* auth
* telemetry
* SaaS workspace
* plugin marketplace
* runtime bridge simulation
* multi-chain abstraction

## Features

* Arc-specific static validation
* preset-based scanning
* configurable fail threshold
* terminal, JSON, Markdown, and HTML reports
* local composite GitHub Action
* validation fixtures for wallet, bridge, and App Kit integrations
* no hosted infrastructure required

## Rule Packs

| Preset    | Focus                                                            | Example rules                                                                                |
| --------- | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `wallet`  | Wallet UX, chain metadata, fee display, finality                 | `ARC_CHAIN_METADATA`, `NO_ETH_GAS_LABEL`, `ONE_CONFIRMATION_FINAL`                           |
| `bridge`  | CCTP, finality, relayer gas, canonical USDC                      | `BRIDGE_CONFIRMATIONS_ONE`, `CCTP_DOMAIN_26`, `RELAYER_USES_USDC_FOR_GAS`                    |
| `app-kit` | App Kit chain identifiers, capability guards, Unified Balance UX | `APPKIT_CHAIN_IDENTIFIER_VALID`, `APPKIT_CAPABILITY_SUPPORTED`, `UB_FEE_EXPLANATION_PRESENT` |

## Quick Start

Run without installing:

```bash
npx arcready scan
```

Or install globally:

```bash
npm install -g arcready
arcready scan
```

Or install as a development dependency:

```bash
npm install -D arcready
npx arcready scan
```

## Configuration

Create an `arcready.config.json` file in the project you want to scan.

```json
{
  "presets": ["wallet", "bridge", "app-kit"],
  "paths": ["src", "app", "components", "lib", "package.json"],
  "exclude": ["dist/**", "coverage/**", ".next/**", "node_modules/**"],
  "reporters": ["terminal", "json", "markdown", "html"],
  "failOn": "critical",
  "rpc": {
    "arcTestnetHttp": "https://your-arc-testnet-rpc.example",
    "arcTestnetWs": "wss://your-arc-testnet-ws.example"
  },
  "rules": {
    "wallet/ONE_CONFIRMATION_FINAL": "critical",
    "bridge/BRIDGE_CONFIRMATIONS_ONE": "critical",
    "app-kit/APPKIT_CHAIN_IDENTIFIER_VALID": "critical"
  }
}
```

### `failOn`

| Value      | Behavior                                     |
| ---------- | -------------------------------------------- |
| `critical` | Fail only when critical findings exist       |
| `warning`  | Fail when warning or critical findings exist |
| `info`     | Fail when any finding exists                 |
| `none`     | Never fail due to findings                   |

The CLI `--fail-on` option overrides the config value.

## CLI Usage

Create a config file:

```bash
npx arcready init
```

Run a terminal report:

```bash
npx arcready scan --format terminal
```

Run a JSON report:

```bash
npx arcready scan --format json
```

Run a Markdown report:

```bash
npx arcready scan --format markdown
```

Run an HTML report:

```bash
npx arcready scan --format html
```

Override the fail threshold:

```bash
npx arcready scan --fail-on warning
```

Write report files:

```bash
npx arcready scan --format json --out .arcready/reports/arcready.json
npx arcready scan --format markdown --out .arcready/reports/arcready.md
npx arcready scan --format html --out .arcready/reports/arcready.html
```

If installed globally, use `arcready` directly:

```bash
arcready scan --format terminal
```

Generated report folders such as `.arcready/` and `reports/` are ignored by git.

## Validation Fixtures

ArcReady includes validation fixtures:

```text
fixtures/
  wallet-good/
  wallet-bad/
  bridge-good/
  bridge-bad/
  app-kit-good/
  app-kit-bad/
```

Run fixture validation:

```bash
corepack pnpm validate:fixtures
```

Expected behavior:

* good fixtures pass with zero findings
* bad fixtures produce findings
* the fixture validation script exits `0` when all expectations match

Example output:

```text
ArcReady Fixture Validation

Fixture        Status   Score   Critical   Warning   Info   Findings   Expected   Result
wallet-good    pass     100     0          0         0      0          pass       OK
wallet-bad     fail     75      1          0         0      1          findings   OK
bridge-good    pass     100     0          0         0      0          pass       OK
bridge-bad     fail     75      1          0         0      1          findings   OK
app-kit-good   pass     100     0          0         0      0          pass       OK
app-kit-bad    fail     75      1          0         0      1          findings   OK

Result: PASS
```

## GitHub Action

ArcReady can be used as a GitHub Action after the next action-ready release.

See [docs/github-action.md](docs/github-action.md).

## Development Commands

```bash
corepack pnpm build
corepack pnpm test
corepack pnpm lint
corepack pnpm validate:fixtures
```

## Architecture Snapshot

```text
packages/arcready/
  core/
  presets/
  reporters/
  rules/
  src/
  test/

actions/github/
fixtures/
scripts/
.codex-tasks/
```

## Contributing

Guidelines:

* Keep rules Arc-specific.
* Prefer conservative detection over noisy findings.
* Add or update tests for every rule change.
* Do not add SaaS, dashboard, auth, database, telemetry, or backend features to v1.
* Run build, test, lint, and fixture validation before submitting changes.

```bash
corepack pnpm build
corepack pnpm test
corepack pnpm lint
corepack pnpm validate:fixtures
```

## License

MIT
