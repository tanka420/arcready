# ArcReady Demo Recording Checklist

## Goal

Record a short 2–3 minute demo showing ArcReady as an Arc-specific CI quality gate and integration validator.

The demo should prove that ArcReady can:

* run locally
* scan Arc-related fixtures
* detect good and bad integration examples
* generate reports
* run in GitHub Actions

## Target Audience

* Arc ecosystem builders
* wallet developers
* bridge developers
* App Kit integrators
* dApp developers
* open-source reviewers
* potential collaborators

## Recording Length

Target length: 2–3 minutes.

Maximum length: 5 minutes.

## Screen Setup

Before recording:

* Open VS Code in the ArcReady repository.
* Open terminal at the repository root.
* Open GitHub repository in browser.
* Open GitHub Actions page in browser.
* Increase terminal font size.
* Close unrelated tabs.
* Hide private files, tokens, and local-only settings.

## Pre-recording Commands

Run once before recording to make sure everything is clean:

```bash
git status
corepack pnpm build
corepack pnpm test
corepack pnpm lint
corepack pnpm demo:fixtures
```

Expected:

```text
working tree clean
build passes
114 tests pass
lint passes
Result: PASS
```

## Demo Flow

### 1. Intro

Say:

```text
This is ArcReady, an open-source Arc-specific CI quality gate and integration validator.
It helps wallets, bridge flows, App Kit integrations, and dApps catch Arc-specific mistakes before release.
```

Show the README briefly.

Highlight:

* local-first
* open-source-first
* no backend
* no dashboard
* no telemetry

### 2. Show the problem

Say:

```text
Arc is EVM-compatible, but projects should not blindly assume Ethereum-default behavior.
Arc integrations can make mistakes around USDC gas, finality, CCTP, App Kit capabilities, and Unified Balance UX.
```

Show the rule pack section in README.

### 3. Run fixture demo

Run:

```bash
corepack pnpm demo:fixtures
```

Explain:

```text
ArcReady scans good and bad examples for wallet, bridge, and App Kit integrations.
Good fixtures pass. Bad fixtures produce expected findings.
```

Show:

```text
Result: PASS
```

### 4. Run normal CLI scan

Run:

```bash
corepack pnpm --filter arcready exec arcready scan --format terminal
```

Explain:

```text
The CLI returns project score, status, severity summary, and findings.
This output is useful for local development and CI logs.
```

### 5. Show report formats

Run one or two examples only:

```bash
corepack pnpm --filter arcready exec arcready scan --format markdown
corepack pnpm --filter arcready exec arcready scan --format html
```

Explain:

```text
ArcReady supports terminal, JSON, Markdown, and HTML reports.
JSON is useful for automation. Markdown and HTML are useful for readable summaries.
```

Do not spend too much time showing all formats.

### 6. Show GitHub Actions

Open the GitHub Actions tab.

Show:

* latest workflow passed
* ArcReady job summary
* score 100
* status pass
* no findings

Say:

```text
The GitHub Action wraps the CLI and uses the CLI exit code as the quality gate.
```

### 7. Close

Say:

```text
ArcReady is still an early MVP, but the foundation is ready:
CLI, rule packs, reports, GitHub Action, fixtures, and tests.
The next steps are improving rule precision, preparing npm publishing, and preparing GitHub Marketplace usage.
```

## What Not To Show

Do not show:

* private tokens
* local `.claude` files
* local `.codex-tasks`
* generated report folders
* unrelated GitHub repositories
* unrelated terminal history

## Good Demo Signs

The demo is successful if viewers understand:

* what ArcReady is
* why Arc-specific validation matters
* how to run it locally
* how it behaves in CI
* what is included in the MVP
* what is intentionally not included yet

## Final One-line Summary

```text
ArcReady helps Arc builders catch integration mistakes before they ship.
```
