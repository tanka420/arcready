# ArcReady Roadmap

**Status:** Active roadmap after C07B, with C07C-A explicit-MVP redesign in progress  
**Last reviewed:** 2026-07-28

ArcReady is an Arc-specific, repository-level static compatibility analyzer for
projects being ported from Ethereum or other EVM environments to Arc.

The current engineering focus is to improve evidence quality, keep critical
findings conservative, and add bounded semantic analysis only where it creates
clear user value. ArcReady should remain a small, trustworthy developer tool,
not grow into a general TypeScript analysis platform.

## Guiding principles

ArcReady should remain:

- Arc-specific;
- local-first;
- CI-friendly;
- open-source-first;
- low-infrastructure;
- conservative and fail-closed when evidence is ambiguous;
- useful without a hosted backend;
- driven by official Arc and Circle documentation;
- explicit about confidence, limitations, and advice versus compatibility
  impact;
- focused on real developer workflows and common source patterns.

ArcReady should not become a generic multi-chain linter, Solidity security
auditor, hosted monitoring service, SaaS dashboard, or speculative static-analysis
framework.

## Product development rule

New analysis capability should be introduced in this order:

```text
exact common pattern
→ one safe same-file binding
→ nearby real-world variants
→ wider semantic analysis only after usage evidence
```

Do not begin with alias graphs, mutation graphs, cross-file resolution, prototype
analysis, or general control-flow unless a prioritized Arc rule cannot be made
reliable with a smaller design.

For critical findings, a bounded false negative outside the declared surface is
preferable to a false positive inside CI.

## Completed product foundation

ArcReady currently includes:

- TypeScript and Node.js CLI scanning;
- wallet, bridge, and App Kit rule packs;
- terminal, JSON, Markdown, and HTML legacy reports;
- installable npm package `arcready@0.3.0`;
- external composite GitHub Action `tanka420/arcready@v0.3.0`;
- validation fixtures and package smoke tests;
- automated CI and repository verification;
- rule taxonomy, maturity, confidence, documentation, and detector-limitation
  metadata;
- deterministic private FindingV2, CoverageV2, ScanResultV2, and `json-v2`
  contracts.

The private canonical runtime remains exactly four rules in stable order:

1. `bridge/CCTP_DOMAIN_26`
2. `bridge/NO_WRAPPED_USDC_ON_ARC`
3. `bridge/RELAYER_USES_USDC_FOR_GAS`
4. `wallet/ARC_CHAIN_METADATA`

Inventory remains 19 known / 17 default / 7 wallet / 4 canonical.

`json-v2` remains observational. It does not change legacy scoring, reporters,
presets, `failOn`, or process exit behavior.

## Intentional product limits

ArcReady still has no general:

- TypeScript or Solidity AST platform;
- package/module resolution;
- cross-file value resolution;
- control-flow or data-flow engine;
- runtime RPC, Circle API, on-chain, or simulation validation;
- SARIF, baseline, or suppression workflow;
- precise line-and-column FindingV2 regions.

These limits are intentional. Infrastructure is justified only when it unlocks
a prioritized rule with clear product value.

## Rule development governance

Sequencing and disposition are maintained in:

```text
docs/rule-development-backlog.md
```

Policy metadata and official-document support remain in:

```text
docs/rule-catalog.md
packages/arcready/core/rules/catalog.ts
```

A legacy rule is not automatically eligible for the canonical FindingV2 slice.
Canonical entry still requires official premise, Arc ownership, fail-closed
evidence, truthful capabilities, deterministic fingerprints, and meaningful
compatibility impact.

## Engineering milestones

### C05A — Complete: `wallet/ARC_CHAIN_METADATA`

Bounded Arc-owned chain-object analysis for chain ID, RPC, explorer, and native
metadata. No generic chain registry or live RPC validation.

### C05B — Complete: canonical FindingV2 adapter

Added the fourth canonical rule while preserving private APIs and observational
`json-v2` behavior.

### C06A — Complete: `wallet/WALLET_NATIVE_USDC_DISPLAY`

Bounded Arc chain ownership and direct native-currency name/symbol analysis.
Decimals, amount flow, balances, and UI prose remain separate problems.

### C06B1 — Complete: read-side Arc USDC amount conversion

Private lazy same-file analysis for direct native balance reads and exact Arc
USDC ERC-20 `balanceOf` reads. Supports only bounded direct or one-binding
amount interpretation.

### C07A — Complete: private ethers transaction ownership

Private same-file ethers v6 analysis for exact `JsonRpcProvider`, `Wallet`,
awaited `getSigner`, and dot-call `sendTransaction` paths.

### C07B — Complete: ethers-only `NO_BLOB_TX_ON_ARC`

Reports only structurally safe own decimal `type: 3` transactions with effective
`proven-arc` ownership. Broad Arc/blob keyword matching was removed. The rule
remains non-canonical.

### C07C-A — Build: conservative viem explicit-pattern MVP

The first broad local implementation candidate was rejected after independent
adversarial review despite 134 passing targeted tests. It remains audit evidence
and is not a merge candidate.

The replacement supports only exact first-party viem imports, exact
`arcTestnet`, direct built-in HTTP transport, approved account routes, direct or
one immutable same-file binding, exact `.sendTransaction(...)`, and exact own
`type: "eip4844"` evidence.

The replacement uses two private viem-specific modules and does not create a
shared AST framework. Wider blob inference, alias/mutation graphs, per-call
overrides, custom hooks, alternate actions, and cross-file analysis are deferred.

### C07C-B — Blocked: thin viem integration

Starts only after replacement C07C-A is independently approved.

The integration may combine already-valid ethers and viem records and choose the
earliest `callOffset`. It must not add new viem inference or change public output,
inventory, canonical status, scoring, schema, reporters, or exits.

### C06B2 — Planned after C07C

Write-side amount analysis remains behind transaction-ownership work. It must not
inherit unnecessary semantic complexity from the rejected C07C-A design.

### C08 — Research: CCTP attestation control flow

Distinguish pending `404` polling from terminal failure and invalid parameters.
Do not canonicalize the current keyword detector without control-flow evidence.

### C09 — Replace: shared Solidity `PREVRANDAO` value dependency

Replace duplicate wallet and bridge keyword rules with one evidence-backed rule.
Do not preserve unsupported blanket `mixHash` equivalence.

### C10 — Research/build: versioned App Kit compatibility

Model official versioned chain identifiers, operations, tokens, adapters, and
support tables. Do not keep hardening the deprecated generic capability guard.

## Adoption and developer-experience track

After C07C integration, prioritize product usefulness before expanding deep
semantic infrastructure:

1. maintain a small public broken/fixed demo project;
2. improve onboarding and GitHub Action usage;
3. make reports easier to understand and act on;
4. gather real false-positive, false-negative, and unsupported-pattern reports;
5. expand analyzers only from that evidence.

Example repositories and adoption walkthroughs are higher priority than broad
analysis infrastructure without users.

## Distribution and release track

The v0.3 package and GitHub Action are already released. Distribution work may
proceed independently of engineering milestones after verifying package contents,
CLI installation, Action references, release notes, and CI on the selected
release commit.

Core milestones must not silently change an already selected release commit.

## Later product capabilities

Potential later work includes:

- precise line and column locations;
- source excerpts with privacy safeguards;
- SARIF output;
- baseline and suppression workflows;
- indexer ordering analysis;
- deterministic-finality and unnecessary reorg-handling analysis;
- native-value and USDC event reconciliation;
- richer HTML reporting;
- expanded example repositories.

Prioritize these only when they support proven workflows or unlock a high-value
compatibility rule.

## Explicit non-goals

The following remain outside the near-term roadmap:

- hosted dashboard;
- database;
- authentication;
- telemetry;
- SaaS workspace;
- plugin marketplace;
- paid plans;
- user accounts;
- generic multi-chain abstraction;
- runtime bridge simulation;
- on-chain verification as a replacement for static evidence;
- broad analyzer infrastructure without a prioritized rule use case.

## Current recommended next step

1. Complete independent planning review and merge the C07C-A explicit-MVP
   alignment.
2. Implement replacement C07C-A from fresh `main` on
   `agent/c07c-a-viem-explicit-mvp`.
3. Complete one comprehensive review, at most one correction batch, and one
   focused re-review.
4. Implement only the thin C07C-B integration.
5. Return focus to broken/fixed demo quality, developer experience, and adoption
   evidence before opening deferred semantic families.

The private canonical runtime remains exactly four rules throughout C07C.
