# ArcReady

ArcReady is an Arc-specific CI quality gate and integration validator for wallets, bridges, App Kit integrations, and dApps.

> ArcReady is an independent open-source project. It is not an official Circle or Arc product.

## v0.4.0 package boundary

The `arcready@0.4.0` npm package publishes the precision and compatibility work
already reviewed on the selected release base. It contains 19 known rules, 15
rules in the default scan, six default wallet rules, and four rules in the
opt-in canonical JSON runtime. Four deprecated rules remain public and
default-excluded: the attestation and gas-label advice rules support explicit
non-off configuration, while the two legacy App Kit rule objects remain
available only for direct API compatibility.

This package also includes the additive `arcUsdcAmountConversionRule` library
export, the experimental opt-in `scan --json-v2` command, and the pinned
`@solidity-parser/parser@0.20.2` and `typescript@5.9.3` runtime dependencies.
Legacy reports, configuration, scoring, and normal CLI exit behavior remain
available. ArcReady still performs local static analysis only; it does not make
live RPC, API, simulation, deployment, or compatibility-certification claims.

The coordinated GitHub Action `v0.4.0` is a later release checkpoint. Until
that checkpoint is completed, `tanka420/arcready@v0.3.0` continues to select
the published v0.3 Action and CLI by default.

## Install

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

With pnpm:

```bash
pnpm add -D arcready
pnpm arcready scan
```

## Usage

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

Run Markdown and HTML reports:

```bash
npx arcready scan --format markdown
npx arcready scan --format html
```

Override the fail threshold:

```bash
npx arcready scan --fail-on warning
```

ArcReady supports terminal, JSON, Markdown, and HTML reports, plus configurable fail thresholds with `--fail-on`.

## Experimental canonical JSON output

Use the explicit opt-in canonical projection:

```bash
arcready scan --json-v2
```

This leaves the default legacy output unchanged and emits the exact
`ScanResultV2` document, versioned by `contractVersion`:

```text
{
  "contractVersion": "2.0",
  "coverage": { ... },
  "findings": [ ... ],
  "diagnostics": [ ... ]
}
```

The experimental runtime currently executes exactly four rules in stable order:
`bridge/CCTP_DOMAIN_26`, `bridge/NO_WRAPPED_USDC_ON_ARC`,
`bridge/RELAYER_USES_USDC_FOR_GAS`, and `wallet/ARC_CHAIN_METADATA`. The JSON
exposes `selectedOccurrences: 4`, while the selected rule IDs remain a private
runtime tuple. Analysis and applicability remain unknown.
Exit code `0` means a valid document was produced, not that the repository is
compatible: findings and recoverable diagnostics are observational, and
canonical enforcement is deferred.

## Configuration

Create an `arcready.config.json` file in the project you want to scan:

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
  }
}
```

## Reports

Use `--format terminal`, `--format json`, `--format markdown`, or `--format html`.

Write a report to disk with `--out`:

```bash
npx arcready scan --format json --out .arcready/reports/arcready.json
```

Full documentation, GitHub Action usage, rule catalog, roadmap, and local development instructions live in the repository:

https://github.com/tanka420/arcready

## License

MIT
