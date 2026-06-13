# ArcReady Launch Post Draft

I just released the first MVP of ArcReady.

ArcReady is an open-source Arc-specific CI quality gate and integration validator for wallets, bridge flows, App Kit integrations, and dApps.

It helps catch Arc-specific integration mistakes before release, including issues around:

* USDC gas display
* one-confirmation finality
* CCTP domain configuration
* canonical USDC usage
* relayer gas assumptions
* App Kit chain identifiers
* capability guards
* Unified Balance UX messaging

The MVP includes:

* TypeScript CLI
* wallet rule pack v1
* bridge rule pack v1
* App Kit rule pack v1
* terminal, JSON, Markdown, and HTML reports
* GitHub Action
* good/bad demo fixtures
* fixture demo script
* 114 passing tests

ArcReady is intentionally local-first and open-source-first.

No hosted dashboard.
No database.
No auth.
No telemetry.
No SaaS workspace.

The goal is simple: help Arc builders catch integration issues earlier, directly in local development and CI.

Repository: https://github.com/tanka420/arcready
