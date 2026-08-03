# ArcReady Roadmap

**Status:** Active roadmap after completed C07C explicit-pattern integration
**Last reviewed:** 2026-08-01

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
auditor, hosted monitoring service, SaaS dashboard, or speculative
static-analysis framework.

## Product development rule

New analysis capability should be introduced in this order:

```text
exact common pattern
→ one safe same-file binding
→ nearby real-world variants
→ wider semantic analysis only after usage evidence
```

Do not begin with alias graphs, mutation graphs, cross-file resolution,
prototype analysis, or general control-flow unless a prioritized Arc rule cannot
be made reliable with a smaller design.

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
USDC ERC-20 `balanceOf` reads. Supports only bounded direct or one-binding amount
interpretation.

### C07A — Complete: private ethers transaction ownership

Private same-file ethers v6 analysis for exact `JsonRpcProvider`, `Wallet`,
awaited `getSigner`, and dot-call `sendTransaction` paths.

### C07B — Complete: ethers-only `NO_BLOB_TX_ON_ARC`

Reports only structurally safe own decimal `type: 3` transactions with effective
`proven-arc` ownership. Broad Arc/blob keyword matching was removed. The rule
remains non-canonical.

### C07C-A — Complete: conservative viem explicit-pattern MVP

The first broad local implementation candidate was rejected after independent
adversarial review despite 134 passing targeted tests. It remains audit evidence
and is not a merge candidate.

The completed implementation supports only exact first-party viem imports, exact
`arcTestnet`, direct built-in HTTP transport, approved account routes, direct or
one immutable same-file binding, exact `.sendTransaction(...)`, and exact own
`type: "eip4844"` evidence.

It uses two private viem-specific modules and does not create a
shared AST framework. Wider blob inference, alias/mutation graphs, per-call
overrides, custom hooks, alternate actions, and cross-file analysis are
deferred.

### C07C-B — Complete: thin viem integration

PR #40 integrated already-valid ethers and viem records, selected the earliest
`callOffset`, and added no new semantic inference. Public output, scoring,
schema, reporters, and exits remained unchanged. The rule remains non-canonical,
and inventory remains 19 known / 17 default / 7 wallet / 4 canonical.

### DX01 — Complete: broken/fixed demo and onboarding

DX01 completed the post-C07C broken/fixed demo, onboarding, and report-clarity
work. C06B2 planning may now proceed without broadening the completed Demo/DX
scope.

### C06B2 — Approved plan: direct `parseEther` write MVP

The active plan is `docs/exec-plans/active/C06B2.md`. Native write analysis is
Research and blocked because current first-party Arc sources conflict on raw
native `value` decimals. The only candidate implementation surface is a bounded
viem local-account transfer to canonical Arc USDC using one exact client,
request, and direct nonzero `parseEther` literal. The approved
architecture-reset plan defines seven unordered provenance identities and nine non-positional semantic
source relations. Its 70 deterministic complete-source fixtures separate static
analyzer stages from expression-evaluation classes and make no live submission,
signing, funding, or RPC-success claim. No controlled-RPC harness is planned. A
ten-dimension syntax signature now derives each fixture's exact REL set and
rejects both under-mapping and over-mapping: 3 fixtures have empty sets, 38 have
all nine relations, and 29 have partial sets. Usage counts in relation-inventory
order are 64, 62, 61, 64, 46, 46, 46, 64, and 61. The semantic validator has 33
negative mutations and 3 invariance cases, 36 mandatory cases total, plus one
explicit mapping-correction acceptance case. Seven independent provenance
booleans also derive exact P sets: 3 fixtures are empty, 41 retain all seven,
and 26 are partial; P01–P07 usage counts are 64, 63, 61, 56, 64, 65, and 58.
The provenance validator has 16 negative mutations, 3 invariance cases, and 2
N45/N46 acceptance cases, 21 cases total. The thin final slice adds one
private write-candidate kind to the existing rule and
deterministically selects at most one read/write issue without changing legacy
read-only behavior. Candidate offsets are private ordering metadata; emitted
findings retain the existing file-level location. Expression-level emitted
ranges require a separate R3 prerequisite. Parsers other than `parseEther`,
conversions, bindings, multi-write analysis, mutation, and ethers remain
separate follow-ups. Independent re-review passed on 2026-08-01 with blocker
0, major 0, and minor 0. Implementation remains unauthorized until a separate
explicit decision.

Current Arc documentation uses `https://rpc.testnet.arc.io`, while existing
exact-literal ownership analyzers recognize the previously documented
`.network` endpoint. RPC endpoint migration is a separate R2 maintenance
follow-up and is not part of C06B2.

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

With C07C integration complete, prioritize product usefulness before expanding
deep semantic infrastructure:

1. maintain a small public broken/fixed demo project;
2. improve onboarding and GitHub Action usage;
3. make reports easier to understand and act on;
4. gather real false-positive, false-negative, and unsupported-pattern reports;
5. expand analyzers only from that evidence.

Example repositories and adoption walkthroughs are higher priority than broad
analysis infrastructure without users.

## Distribution and release track

The v0.3 package and GitHub Action are already released. Distribution work may
proceed independently of engineering milestones after verifying package
contents, CLI installation, Action references, release notes, and CI on the
selected release commit.

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

1. Keep C06B2 implementation unauthorized until a separate explicit decision.
2. Keep native write analysis blocked pending first-party premise clarification.
3. Implement only the approved reduced local-account canonical ERC-20 transfer
   MVP if separately authorized.
4. Plan Arc RPC endpoint migration as separate R2 maintenance.
5. Continue gathering real unsupported-pattern and false-positive/negative
   evidence.
6. Continue C08/C09/C10 in the existing sequence.
7. Reopen deferred C07C families only from concrete usage evidence or a
   separately approved milestone.

The private canonical runtime remained exactly four rules throughout C07C.
