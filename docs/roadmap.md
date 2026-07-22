# ArcReady Roadmap

**Status:** Active roadmap after C05B
**Last reviewed:** 2026-07-22

ArcReady is an Arc-specific, repository-level static compatibility analyzer for projects being ported from Ethereum or other EVM environments to Arc.

The project has moved beyond the original v0.3 rule-hardening release scope. The current engineering focus is to improve evidence quality, expand the canonical FindingV2 slice beyond bridge configuration, and introduce bounded semantic analysis only where it creates clear user value.

## Guiding Principles

ArcReady should remain:

- Arc-specific;
- local-first;
- CI-friendly;
- open-source-first;
- low-infrastructure;
- conservative and fail-closed when evidence is ambiguous;
- useful without a hosted backend;
- driven by official Arc and Circle documentation;
- explicit about confidence, limitations, and advice versus compatibility impact.

ArcReady should not become a generic multi-chain linter, Solidity security auditor, hosted monitoring service, or SaaS dashboard in the near term.

## Completed Product Foundation

The existing product foundation includes:

- TypeScript and Node.js CLI scanning;
- wallet, bridge, and App Kit rule packs;
- terminal, JSON, Markdown, and HTML legacy reports;
- installable npm package shape;
- external composite GitHub Action usage;
- validation fixtures and package smoke tests;
- automated GitHub Actions CI and repository verification;
- 18 active legacy static rules after placeholder cleanup;
- rule taxonomy, maturity, confidence, documentation support, and detector-limitation metadata;
- cross-preset regression coverage;
- deterministic private FindingV2, CoverageV2, ScanResultV2, and `json-v2` contracts.

## Completed Four-Rule Canonical Slice

C04 completed the first bounded bridge slice, and C05 added the first wallet rule.

The private `json-v2` runtime now selects exactly these four rules in stable order:

1. `bridge/CCTP_DOMAIN_26`
2. `bridge/NO_WRAPPED_USDC_ON_ARC`
3. `bridge/RELAYER_USES_USDC_FOR_GAS`
4. `wallet/ARC_CHAIN_METADATA`

Four of 18 known inventory rules execute, leaving 14 outside the canonical
slice. Coverage exposes `selectedOccurrences: 4`; IDs remain a private tuple.

For this slice, ArcReady now has:

- hardened detectors with bounded Arc ownership;
- approved FindingV2 adapter specifications;
- truthful per-rule capabilities for new adapters;
- deterministic fingerprints and output ordering;
- lifecycle and coverage instrumentation;
- schema-validated machine-readable output;
- package and built-CLI validation;
- preserved legacy scan behavior.

`json-v2` remains observational. It does not yet change process exit behavior or legacy scoring, reporters, presets, and `failOn` behavior.

## Current Product Limits

The current implementation is still primarily text-pattern and structured-literal analysis.

Known limits include:

- no general TypeScript or Solidity AST pipeline;
- no import, symbol, or cross-file value resolution;
- no general control-flow or data-flow analysis;
- file-level canonical locations rather than precise line and column regions;
- no SARIF, baseline, or suppression workflow;
- limited framework-aware ownership for wallet, provider, transaction, and UI configuration;
- no runtime RPC, Circle API, on-chain, or simulation checks.

These limits are intentional. New infrastructure should be added only when a prioritized rule cannot be made reliable with a smaller bounded design.

## Rule Development Governance

The active sequencing and disposition for completed and deferred rules is maintained in:

```text
docs/rule-development-backlog.md
```

The backlog distinguishes:

- `Complete`;
- `Build`;
- `Research`;
- `Advice-only`;
- `Replace`;
- `Retire`.

Legacy presence does not imply canonical eligibility. A rule should not enter the canonical FindingV2 slice until its official-document premise, Arc applicability, static evidence, confidence, capabilities, and fail-closed behavior are all defensible.

The policy source of truth remains:

```text
docs/rule-catalog.md
packages/arcready/core/rules/catalog.ts
```

## Near-Term Engineering Roadmap

### C05A — Complete: Harden `wallet/ARC_CHAIN_METADATA`

Goal:

Reliably identify an Arc-owned chain configuration and detect incorrect applicable Arc metadata without borrowing evidence from Ethereum or sibling networks.

Priority evidence:

- Arc Testnet chain ID `5042002`;
- Arc-owned RPC configuration;
- Arc-owned explorer configuration;
- bounded chain-object ownership;
- common JavaScript and TypeScript chain-definition shapes.

Non-goals:

- no generic chain registry framework;
- no live RPC validation;
- no broad repository-wide keyword association;
- no FindingV2 expansion in the same detector-hardening milestone.

C05A completed with bounded plain `.js` and `.ts` object-local scanning,
multichain isolation, four stable messages, and fail-closed syntax handling.

### C05B — Complete: Add canonical FindingV2 support for `wallet/ARC_CHAIN_METADATA`

Goal:

Expand the canonical slice beyond bridge rules while preserving deterministic selection, private API boundaries, and observational `json-v2` behavior.

C05B completed with one private file-level adapter specification,
message-independent fingerprints, and observational json-v2 coverage. It added
no enforcement or public export.

### C06A — Harden `wallet/WALLET_NATIVE_USDC_DISPLAY`

Goal:

Attach native-currency evidence to a trusted Arc-owned wallet or chain configuration and detect ETH-native assumptions without flagging valid Ethereum sibling configuration or internal EVM terminology.

This milestone should reuse or align with the ownership model proven in C05A rather than create an independent Arc-context heuristic.

### C06B — Research the native-versus-ERC-20 USDC amount model

Goal:

Design a high-value semantic slice for Arc's native USDC and ERC-20 USDC interfaces, including amount conversion, balance interpretation, and duplicate presentation risks.

This work may justify bounded AST or value-flow analysis. It should not be forced into the current regex architecture.

### C07 — Arc transaction-submission ownership

Goal:

Associate a submitted transaction with an Arc provider or chain context.

This capability is a prerequisite for reliable blob-transaction and transaction-specific gas or fee checks.

### C08 — CCTP attestation control-flow analysis

Goal:

Distinguish expected pending `404` polling from terminal failures and invalid request parameters.

Do not canonicalize the current low-confidence keyword detector before control-flow evidence exists.

### C09 — Shared Solidity `PREVRANDAO` value-dependency analysis

Goal:

Replace duplicate wallet and bridge keyword detectors with one semantic rule that proves `PREVRANDAO` influences randomness, selection, or another behavior that fails when the value is always zero on Arc.

Unsupported blanket `mixHash` equivalence should not be carried forward.

### C10 — Versioned App Kit integration analysis

Goal:

Model App Kit chain identifiers and operation, token, adapter, and supported-chain compatibility using official versioned APIs and support tables.

Do not continue hardening the deprecated generic capability-guard detector.

## Distribution and Release Track

The v0.3 package and GitHub Action remain release-ready from the rule-quality-hardening phase.

Creating or updating a tag and GitHub Release is a maintainer distribution decision and may proceed independently of the C05 engineering sequence after verifying:

- package metadata and package contents;
- installable CLI behavior;
- external GitHub Action references;
- release notes that accurately distinguish legacy output from private observational `json-v2` work;
- current CI on the chosen release commit.

Release work should not block core compatibility development, and core milestones should not silently change an already selected release commit.

## Later Product Capabilities

Potential later work includes:

- precise line and column locations;
- source excerpts with privacy and stability safeguards;
- SARIF output;
- baseline and suppression workflows;
- indexer ordering analysis;
- deterministic-finality and unnecessary reorg-handling analysis;
- native-value and USDC event reconciliation;
- richer HTML reporting;
- example repositories and adoption walkthroughs.

These items should be prioritized only when they support proven user workflows or unlock a high-value compatibility rule.

## Explicit Non-Goals

The following remain out of scope for the near-term roadmap:

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
- on-chain verification as a substitute for static evidence;
- broad analyzer infrastructure without a prioritized rule use case.

## Current Recommended Next Step

The next recommended engineering milestone is:

```text
C06A — Harden wallet/WALLET_NATIVE_USDC_DISPLAY
```

C06 has not started, and `wallet/WALLET_NATIVE_USDC_DISPLAY` is not canonical.
