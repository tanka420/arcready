# ArcReady Demo Script

## Goal

This demo shows how ArcReady works as an Arc-specific CI quality gate and integration validator.

ArcReady helps developers catch integration mistakes in wallets, bridge flows, App Kit integrations, and dApps before release.

## Demo Length

Target: 2–3 minutes.

## Demo Flow

### 1. Introduce the problem

Arc is EVM-compatible, but Arc projects should not blindly assume Ethereum-default behavior.

Common integration mistakes can happen around:

* USDC gas display
* one-confirmation finality
* CCTP domain configuration
* canonical USDC assumptions
* relayer gas funding
* App Kit chain identifiers
* capability guards
* Unified Balance UX messaging

ArcReady turns these assumptions into local and CI checks.

### 2. Show the repository

Open the ArcReady repository.

Highlight:

* CLI scanner
* rule packs
* reports
* GitHub Action
* fixtures
* demo script

### 3. Run the fixture demo

Run:

```bash
corepack pnpm demo:fixtures
```

Expected output:

```text
Result: PASS
```

Explain:

* good fixtures pass with zero findings
* bad fixtures produce expected findings
* this proves the validator detects Arc-specific mistakes

### 4. Run a normal CLI scan

Run:

```bash
corepack pnpm --filter arcready exec arcready scan --format terminal
```

Explain the output:

* project name
* score
* status
* summary
* findings

### 5. Show report formats

Run:

```bash
corepack pnpm --filter arcready exec arcready scan --format json
corepack pnpm --filter arcready exec arcready scan --format markdown
corepack pnpm --filter arcready exec arcready scan --format html
```

Explain:

* terminal is for quick local/CI feedback
* JSON is for automation
* Markdown is for summaries
* HTML is for readable reports and demos

### 6. Show GitHub Action

Open the GitHub Actions tab.

Show:

* ArcReady workflow passed
* job summary contains the ArcReady report
* action can upload report artifacts
* workflow fails based on ArcReady exit code

### 7. Explain what is intentionally not included

ArcReady v1 intentionally does not include:

* hosted dashboard
* database
* auth
* telemetry
* SaaS workspace
* plugin marketplace
* runtime bridge simulation
* multi-chain abstraction

This keeps the project local-first, open-source-first, and low-infrastructure.

### 8. Close

ArcReady is an early MVP for Arc ecosystem developers who want a lightweight CI quality gate before releasing wallet, bridge, App Kit, or dApp integrations.

## Short Closing Line

ArcReady helps Arc builders catch integration mistakes before they ship.
