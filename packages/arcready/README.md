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

Full documentation, GitHub Action usage, rule catalog, roadmap, and local development instructions live in the repository:

https://github.com/tanka420/arcready

## License

MIT
