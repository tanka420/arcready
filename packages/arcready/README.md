# ArcReady

ArcReady is an Arc-specific CI quality gate and integration validator for wallets, bridges, App Kit integrations, and dApps.

> ArcReady is an independent open-source project. It is not an official Circle or Arc product.

## Install

ArcReady is being prepared for npm publishing. After publishing, install it as a development dependency:

```bash
npm install -D arcready
```

or:

```bash
pnpm add -D arcready
```

## Usage

```bash
npx arcready scan --format terminal
```

```bash
pnpm arcready scan --format json
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
  "failOn": "critical"
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
