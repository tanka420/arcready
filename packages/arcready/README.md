# ArcReady

ArcReady is an Arc-specific CI quality gate and integration validator for wallets, bridges, App Kit integrations, and dApps.

> ArcReady is an independent open-source project. It is not an official Circle or Arc product.

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
