# ArcReady Rule Development Backlog

**Status:** Active decision record  
**Last reviewed:** 2026-07-22  
**Applies to:** Active and proposed ArcReady static-analysis rules

## Purpose

This document records which rules should be built, researched, kept as advice, replaced, or retired after the C05 four-rule canonical slice.

It is not a commitment to canonicalize every legacy rule.

The source of truth for rule policy metadata, official documentation, impact, confidence, maturity, detector limitations, and deprecation remains:

```text
docs/rule-catalog.md
packages/arcready/core/rules/catalog.ts
```

This backlog owns sequencing and development decisions only.

## Decision Values

| Decision | Meaning |
| --- | --- |
| `Complete` | Detector hardening and canonical FindingV2 integration are complete for the current scope. |
| `Build` | The rule concept is important and supported well enough to justify a bounded implementation milestone. |
| `Research` | The rule concept matters, but the current detector cannot produce sufficiently reliable static evidence. |
| `Advice-only` | Keep as optional guidance; do not treat it as a core compatibility blocker or CI-failure candidate. |
| `Replace` | Do not keep hardening the current detector. Preserve the product problem and design a new rule or analyzer. |
| `Retire` | The current rule premise is not sufficiently supported and should not receive further implementation investment. |

## Priority Values

| Priority | Meaning |
| --- | --- |
| `P0` | Next core compatibility work. |
| `P1` | High-value work after the current P0 sequence. |
| `P2` | Useful, but narrower, framework-specific, or dependent on new analysis capability. |
| `P3` | Optional advice, replacement research, or low urgency. |

## Canonical Eligibility

A rule should enter the private canonical FindingV2 slice only when all of the following are true:

1. The product premise is supported by official Arc or Circle documentation.
2. The detector binds evidence to an applicable Arc-owned object, call, transaction, UI surface, or control-flow branch.
3. Ambiguous, imported, computed, multichain, documentation-only, and malformed cases fail closed.
4. The adapter can state truthful capabilities, evidence, confidence, remediation, and file ownership.
5. The result can use a stable deterministic fingerprint without source-content leakage.
6. The rule is useful as compatibility analysis, not merely general UX or operational advice.

Active legacy status does not imply canonical eligibility.

## Completed Canonical Rules

| Rule | Decision | Priority | Static detectability | Canonical status | Notes |
| --- | --- | --- | --- | --- | --- |
| `bridge/CCTP_DOMAIN_26` | Complete | P0 | High for bounded supported configuration shapes | Canonical | Detects Arc CCTP domain values that are not `26`. |
| `bridge/NO_WRAPPED_USDC_ON_ARC` | Complete | P0 | High for bounded Arc-owned route objects | Canonical | Detects Arc-side wrapped-USDC mappings while preserving source-chain separation. |
| `bridge/RELAYER_USES_USDC_FOR_GAS` | Complete | P0 | High for bounded JS/TS relayer configuration | Canonical | Detects literal ETH relayer gas-token configuration owned by Arc. |
| `wallet/ARC_CHAIN_METADATA` | Complete | P0 | High for bounded Arc-owned JS/TS chain objects | Canonical | Uses one file-level adapter specification for four metadata outcomes. |

## Wallet Rules

| Rule | Decision | Priority | Impact | Static detectability | Required analyzer or prerequisite | Canonical eligibility | Revisit trigger |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `wallet/WALLET_NATIVE_USDC_DISPLAY` | Complete | P0 | Required change | Medium | Private bounded Arc chain-object scanner shared with `ARC_CHAIN_METADATA` | Non-canonical | C06A detects direct ETH/Ethereum names and non-USDC symbols; decimals and amounts remain C06B. |
| `wallet/NO_BLOB_TX_ON_ARC` | Research | P1 | Blocker | Low to medium | Arc transaction-submission ownership, structured transaction config, or AST-backed call analysis | After analyzer | Revisit when Arc provider or chain ownership can be connected to the actual submitted transaction. |
| `wallet/PREVRANDAO_NOT_SUPPORTED` | Replace | P1 | Required change | Low | Solidity AST and value-dependency analysis | Legacy rule never; replacement after analyzer | Replace with one shared `PREVRANDAO` dependency rule and remove unsupported blanket `mixHash` equivalence. |
| `wallet/NO_ETH_GAS_LABEL` | Advice-only | P2 | Required change | Low | User-facing UI or rendered-label ownership | Advice output only after UI analysis | Revisit when the analyzer can distinguish UI copy from internal EVM units, tests, docs, and multichain labels. |
| `wallet/ONE_CONFIRMATION_FINAL` | Advice-only | P3 | Recommendation | Medium | Shared Arc finality-policy model | Advice output only | Consolidate with bridge confirmation guidance when a shared finality analyzer exists. |

## Bridge Rules

| Rule | Decision | Priority | Impact | Static detectability | Required analyzer or prerequisite | Canonical eligibility | Revisit trigger |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `bridge/ATTESTATION_404_NOT_FATAL` | Research | P1 | Required change | Low | Control-flow, retry-loop, and typed HTTP error analysis | After analyzer | Revisit when a detector can distinguish pending polling, terminal failure, and invalid request parameters. |
| `bridge/NO_PREVRANDAO_RELAY_SELECTION` | Replace | P1 | Required change | Low | Shared Solidity AST and value-dependency analysis | Legacy rule never; replacement after analyzer | Merge the problem into the shared `PREVRANDAO` dependency rule, with relayer selection as context rather than a duplicate detector. |
| `bridge/BRIDGE_CONFIRMATIONS_ONE` | Advice-only | P3 | Recommendation | Medium | Shared Arc finality-policy model | Advice output only | Consolidate with wallet confirmation guidance; extra confirmations generally add latency rather than break compatibility. |

## App Kit Rules

| Rule | Decision | Priority | Impact | Static detectability | Required analyzer or prerequisite | Canonical eligibility | Revisit trigger |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `app-kit/APPKIT_CHAIN_IDENTIFIER_VALID` | Build | P2 | Blocker | Medium after ownership hardening | App Kit argument or configuration-slot ownership and version-aware identifier semantics | After hardening | Revisit after wallet core work; prove that a candidate string is used as an App Kit chain identifier. |
| `app-kit/UB_DELEGATE_REQUIRED` | Research | P2 | Required change | Low | Account-role modeling, delegate-controlled spend detection, and chain-specific authorization context | After SDK model | Revisit when owner-initiated and delegate-initiated spends can be distinguished statically. |
| `app-kit/APPKIT_CAPABILITY_SUPPORTED` | Replace | P2 | Not applicable until researched | Low | Versioned App Kit operation, token, adapter, and supported-chain matrix | Current rule never | Design a new versioned compatibility rule based on official App Kit APIs and support tables. |
| `app-kit/APPKIT_CUSTOM_RPC_RECOMMENDED` | Advice-only | P3 | Recommendation | Low | Project-wide provider/import resolution | Never in core compatibility slice | Keep in an optional advice pack; absence of local RPC text does not prove public RPC usage. |
| `app-kit/UB_FEE_EXPLANATION_PRESENT` | Advice-only | P3 | Recommendation | Low | Confirmation-screen or UI-flow ownership | Never in core compatibility slice | Revisit only when ArcReady can identify rendered checkout or confirmation UI. |
| `app-kit/APPKIT_BRIDGE_MIN_AMOUNT_NOTE` | Retire | P3 | Not applicable until researched | Low | None for the current premise | Never | Do not harden. A separately named fee-estimation or confirmation-disclosure advice rule may be researched later. |

## New High-Value Work Outside the Legacy Inventory

The 18 legacy rules do not define the complete product roadmap. New rules may deliver more value than low-confidence advice rules.

| Opportunity | Priority | Why it matters | Required capability |
| --- | --- | --- | --- |
| Native USDC versus ERC-20 USDC decimal and amount model | P0/P1 | Arc exposes one underlying USDC balance through native and ERC-20 interfaces with different amount conventions. Incorrect conversions can cause real value errors. | Structured TS/JS and Solidity amount-flow analysis. |
| Duplicate native and ERC-20 USDC balance presentation | P1 | Wallets and dApps should not present one underlying Arc USDC balance as two unrelated assets. | Wallet state and UI binding analysis. |
| Arc transaction submission ownership | P1 | Enables reliable blob-transaction, gas-token, chain-metadata, and fee checks. | Provider, chain, and transaction-object association. |
| Indexer ordering by block number rather than timestamp alone | P2 | Sub-second blocks can share timestamps, so timestamp-only cursors may be ambiguous. | Indexer configuration and query-shape analysis. |
| Ethereum-style reorg assumptions on deterministic-finality flows | P2 | Arc does not use probabilistic confirmation or reorg handling in the Ethereum model. | Control-flow and infrastructure configuration analysis. |
| Unified native-value and USDC transfer-event handling | P2 | Indexers and wallets need an Arc-specific accounting model for value and token events. | Event-subscription and balance-reconciliation analysis. |

## Recommended Sequence

```text
C05A  Complete: harden wallet/ARC_CHAIN_METADATA
C05B  Complete: add canonical FindingV2 support for ARC_CHAIN_METADATA

C06A  Complete: harden wallet/WALLET_NATIVE_USDC_DISPLAY
C06B  Research and implement the native-versus-ERC20 USDC amount model

C07   Build Arc transaction-submission ownership, then revisit blob transactions
C08   Add CCTP attestation control-flow analysis
C09   Add one Solidity PREVRANDAO value-dependency analyzer
C10   Add versioned App Kit chain and capability analysis
```

Advice-only rules should not interrupt this core sequence unless real user evidence demonstrates higher value.

The private runtime still executes four of 18 known inventory rules and leaves
14 outside the canonical slice. C06A is complete, but
`wallet/WALLET_NATIVE_USDC_DISPLAY` remains non-canonical. The next recommended
milestone is C06B: research and implement the native-versus-ERC20 USDC amount
model.

## Governance Rules

1. Do not canonicalize a rule merely because it already exists in the legacy preset.
2. Do not promote an advice rule into a compatibility blocker to increase rule count.
3. Do not keep hardening a detector whose premise is contradicted or unsupported by official documentation.
4. Prefer one shared semantic analyzer over duplicate wallet and bridge keyword detectors.
5. Record any decision change in this backlog and update the policy catalog separately when metadata or official-document support changes.
6. Revalidate versioned Arc, Circle, and App Kit documentation before implementing a deferred rule.
7. User-reported false positives, false negatives, and real integration failures may change priority, but must not bypass the canonical eligibility requirements.
