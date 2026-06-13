# ArcReady Roadmap

ArcReady is currently release-ready for the `v0.3.0` rule quality hardening release.

The MVP proves the core foundation:

* CLI scanner
* Arc-specific rule packs
* terminal, JSON, Markdown, and HTML reports
* local composite GitHub Action
* validation fixtures
* fixture validation script
* passing test suite

The next phase is focused on improving quality, usability, and distribution readiness without adding unnecessary infrastructure.

## Guiding Principles

ArcReady should remain:

* Arc-specific
* local-first
* CI-friendly
* open-source-first
* low-infrastructure
* conservative in rule detection
* useful without a hosted backend

ArcReady should not become a SaaS dashboard, telemetry tool, generic multi-chain linter, or hosted monitoring service in the near term.

## v0.3 Rule Quality Hardening

The v0.3 phase is release-ready as a quality-focused npm and GitHub Action release.

Completed release-ready scope:

* removed placeholder/internal no-op rules from public API and default presets
* improved wallet rule precision and false-positive handling
* improved bridge rule precision and false-positive handling
* improved App Kit static integration-pattern rule precision
* added cross-preset regression coverage
* improved finding messages and suggestions across all 18 active rules
* prepared GitHub Action usage for `tanka420/arcready@v0.3.0`

Still out of scope for this release:

* live Arc RPC checks
* Circle API checks
* on-chain simulation
* bridge runtime simulation
* real App Kit runtime testing
* SaaS, dashboards, databases, authentication, or telemetry
* GitHub Marketplace publication

## v0.2 Goals

The v0.2 phase should focus on making ArcReady more useful for real users and easier to adopt.

### 1. Improve Rule Precision

Goal:

Reduce false positives and make rule findings more reliable.

Scope:

* Review wallet rules v1
* Review bridge rules v1
* Review App Kit rules v1
* Add more good/bad fixture coverage
* Improve finding messages and suggested fixes
* Keep rules conservative and explainable

Non-goals:

* No runtime RPC checks
* No live bridge simulation
* No generic multi-chain abstraction

Related issue:

* Improve rule precision for wallet checks

### 2. Add More Arc App Kit Examples

Goal:

Make App Kit validation easier to understand through practical examples.

Scope:

* Add more App Kit fixture examples
* Document correct and incorrect chain identifier usage
* Document capability guard examples
* Improve Unified Balance UX examples
* Keep examples small and easy to scan

Non-goals:

* No full sample dApp
* No hosted frontend
* No backend service

Related issue:

* Add more Arc App Kit integration examples

### 3. Prepare npm Package Publishing

Goal:

Prepare ArcReady for installable CLI usage through npm.

Scope:

* Review package metadata
* Confirm `bin` entry works after package install
* Review package `files` output
* Add npm publish checklist
* Run npm dry-run validation
* Confirm generated `dist/` package shape

Non-goals:

* Do not publish until package shape is reviewed
* No monetization
* No SaaS
* No telemetry

Related issue:

* Prepare npm package publishing

### 4. External GitHub Action Usage

Goal:

Prepare the composite GitHub Action for external repository usage.

Status:

Completed for `v0.2.0`. External GitHub Action usage validated with `uses: tanka420/arcready@v0.2.0` against known-good and known-bad fixtures. This does not include deeper Arc integration, live RPC checks, runtime simulation, rule hardening, or GitHub Marketplace publication.

Scope:

* Review action metadata
* Decide final public action usage format
* Confirm report artifact behavior
* Document required permissions
* Add usage examples for external repositories
* Make sure the external action uses the published npm CLI instead of local workspace behavior

Non-goals:

* No PR comment bot in v0.2
* No hosted service
* No telemetry
* No marketplace launch until packaging is stable

Related issue:

* Prepare external GitHub Action usage

## Later Ideas

These are possible future directions, but not part of the immediate v0.2 focus.

### More Rule Packs

Potential future presets:

* indexer
* stablecoin payments
* onboarding flow
* contract deployment checks

### Better Reports

Possible improvements:

* richer HTML report
* report screenshots for README
* optional SARIF output
* machine-readable rule metadata

### External Adoption

Possible future steps:

* npm publish
* GitHub Marketplace publish
* example integration in a sample repo
* short validation walkthrough video
* Arc ecosystem announcement

## Explicit Non-goals

The following are intentionally out of scope for the near-term roadmap:

* hosted dashboard
* database
* auth
* telemetry
* SaaS workspace
* plugin marketplace
* runtime bridge simulation
* generic multi-chain abstraction
* paid plans
* user accounts

## Current Recommended Next Step

The next practical work item should be:

```text
Create the v0.3.0 git tag and GitHub Release after maintainer approval.
```

This keeps ArcReady useful as a static CI quality gate without expanding into runtime checks or hosted infrastructure.
