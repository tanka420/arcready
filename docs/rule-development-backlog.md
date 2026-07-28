# ArcReady Rule Development Backlog

**Status:** Active decision record
**Last reviewed:** 2026-07-28
**Applies to:** Active and proposed ArcReady static-analysis rules

## Purpose

This document owns sequencing and development decisions. It records which rules
should be built, researched, kept as advice, replaced, or retired.

It is not a commitment to canonicalize every legacy rule.

Policy metadata, official documentation, impact, confidence, maturity, detector
limitations, and deprecation remain sourced from:

```text
docs/rule-catalog.md
packages/arcready/core/rules/catalog.ts
```

## Decision values

| Decision | Meaning |
| --- | --- |
| `Complete` | The approved detector scope is implemented and reviewed. |
| `Build` | The rule has enough evidence and user value for a bounded implementation milestone. |
| `Research` | The problem matters, but reliable static evidence is not yet defined. |
| `Advice-only` | Keep as optional guidance, not a core compatibility blocker. |
| `Replace` | Preserve the product problem, but stop hardening the current detector. |
| `Retire` | Do not invest further in the current premise. |

## Priority values

| Priority | Meaning |
| --- | --- |
| `P0` | Current core compatibility work. |
| `P1` | High-value work after the current P0 sequence. |
| `P2` | Useful but narrower, framework-specific, or dependent on new capability. |
| `P3` | Optional advice, replacement research, or low urgency. |

## Canonical eligibility

A rule enters the private canonical FindingV2 slice only when:

1. official Arc or Circle documentation supports the premise;
2. evidence is bound to an Arc-owned object, call, transaction, UI surface, or
   control-flow branch;
3. ambiguous, imported, computed, multichain, documentation-only, and malformed
   cases fail closed;
4. capabilities, evidence, confidence, remediation, and ownership are truthful;
5. fingerprints are deterministic without source-content leakage;
6. the rule represents compatibility impact rather than generic advice.

Legacy presence does not imply canonical eligibility.

## Completed canonical rules

| Rule | Decision | Priority | Canonical status | Notes |
| --- | --- | --- | --- | --- |
| `bridge/CCTP_DOMAIN_26` | Complete | P0 | Canonical | Detects Arc CCTP domain values other than `26`. |
| `bridge/NO_WRAPPED_USDC_ON_ARC` | Complete | P0 | Canonical | Detects Arc-side wrapped-USDC mappings with source-chain isolation. |
| `bridge/RELAYER_USES_USDC_FOR_GAS` | Complete | P0 | Canonical | Detects literal ETH relayer gas-token configuration owned by Arc. |
| `wallet/ARC_CHAIN_METADATA` | Complete | P0 | Canonical | Bounded Arc-owned metadata analysis with one adapter specification. |

The private canonical runtime remains exactly four rules.

## Wallet rules

| Rule | Decision | Priority | Impact | Required analyzer or prerequisite | Canonical eligibility | Revisit trigger |
| --- | --- | --- | --- | --- | --- | --- |
| `wallet/WALLET_NATIVE_USDC_DISPLAY` | Complete | P0 | Required change | Bounded Arc chain-object scanner shared with `ARC_CHAIN_METADATA` | Non-canonical | Revisit amount and UI binding separately. |
| `wallet/ARC_USDC_AMOUNT_CONVERSION` | Complete for C06B1 reads | P0 | Blocker | Private bounded same-file amount interpretation | Non-canonical | C06B2 follows approved transaction-ownership work. |
| `wallet/NO_BLOB_TX_ON_ARC` | Complete for C07B ethers; Build for C07C viem MVP | P0 | Blocker | Completed ethers analyzer plus conservative viem explicit-pattern analyzer | Non-canonical | Expand viem only from concrete user patterns or independently approved milestones. |
| `wallet/PREVRANDAO_NOT_SUPPORTED` | Replace | P1 | Required change | Solidity AST and value-dependency analysis | Current legacy rule never | Replace with one shared dependency rule; remove blanket `mixHash` equivalence. |
| `wallet/NO_ETH_GAS_LABEL` | Advice-only | P2 | Required change | Rendered UI-label ownership | Advice output only | Revisit when UI copy can be separated from internal EVM terminology. |
| `wallet/ONE_CONFIRMATION_FINAL` | Advice-only | P3 | Recommendation | Shared Arc finality-policy model | Advice output only | Consolidate with bridge confirmation guidance. |

### C07C viem scope decision

C07C is no longer deferred in the abstract. It is an active bounded build with a
conservative explicit-pattern contract.

Supported initial value:

- exact first-party viem imports;
- exact `arcTestnet`;
- exact built-in HTTP transport;
- approved JSON-RPC or `privateKeyToAccount` account routes;
- direct or one immutable same-file binding;
- exact `.sendTransaction(...)`;
- exact own `type: "eip4844"` evidence.

Deferred until real usage evidence or separate approval:

- `maxFeePerBlobGas` and `authorizationList` inference;
- blobs, KZG, versioned hashes, and sidecars;
- per-call chain/account overrides;
- alias depth 2+, branching aliases, and general mutation graphs;
- imported, cross-function, and cross-file resolution;
- custom transport, formatter, serializer, and client extensions;
- `writeContract`, raw, sync, deploy, and account-abstraction paths;
- shared static-analysis infrastructure.

The rejected local candidate `61ce4f6...` is audit evidence only and must not be
used as an implementation base.

## Bridge rules

| Rule | Decision | Priority | Impact | Required analyzer or prerequisite | Canonical eligibility | Revisit trigger |
| --- | --- | --- | --- | --- | --- | --- |
| `bridge/ATTESTATION_404_NOT_FATAL` | Research | P1 | Required change | Retry-loop and typed HTTP control-flow analysis | After analyzer | Revisit when pending polling can be distinguished from terminal failure and invalid parameters. |
| `bridge/NO_PREVRANDAO_RELAY_SELECTION` | Replace | P1 | Required change | Shared Solidity value-dependency analysis | Current legacy rule never | Merge into the replacement PREVRANDAO dependency rule. |
| `bridge/BRIDGE_CONFIRMATIONS_ONE` | Advice-only | P3 | Recommendation | Shared finality-policy model | Advice output only | Consolidate with wallet confirmation guidance. |

## App Kit rules

| Rule | Decision | Priority | Impact | Required analyzer or prerequisite | Canonical eligibility | Revisit trigger |
| --- | --- | --- | --- | --- | --- | --- |
| `app-kit/APPKIT_CHAIN_IDENTIFIER_VALID` | Build | P2 | Blocker | Version-aware App Kit argument/configuration ownership | After hardening | Revisit after current wallet core work. |
| `app-kit/UB_DELEGATE_REQUIRED` | Research | P2 | Required change | Account-role and delegate-controlled spend modeling | After SDK model | Revisit when owner and delegate flows can be distinguished. |
| `app-kit/APPKIT_CAPABILITY_SUPPORTED` | Replace | P2 | Undetermined | Official versioned operation/token/adapter/support matrix | Current rule never | Design a new versioned compatibility rule. |
| `app-kit/APPKIT_CUSTOM_RPC_RECOMMENDED` | Advice-only | P3 | Recommendation | Project-wide provider/import resolution | Never in core slice | Keep as optional advice. |
| `app-kit/UB_FEE_EXPLANATION_PRESENT` | Advice-only | P3 | Recommendation | Confirmation-screen or UI-flow ownership | Never in core slice | Revisit only with rendered UI ownership. |
| `app-kit/APPKIT_BRIDGE_MIN_AMOUNT_NOTE` | Retire | P3 | Undetermined | None for current premise | Never | Research any future fee or disclosure rule separately. |

## High-value opportunities beyond current inventory

| Opportunity | Priority | Why it matters | Required capability |
| --- | --- | --- | --- |
| Native USDC versus ERC-20 USDC amount model | P0/P1 | Incorrect conversion can create real value errors. | Bounded amount-flow analysis. |
| Duplicate native and ERC-20 USDC presentation | P1 | One underlying Arc balance should not appear as two unrelated assets. | Wallet state and UI binding analysis. |
| Arc transaction-submission ownership | P0 | Enables reliable blob and future transaction checks. | Bounded provider/client/request association. |
| Indexer ordering by block number | P2 | Sub-second blocks can share timestamps. | Query-shape and cursor analysis. |
| Ethereum-style reorg assumptions | P2 | Arc finality differs from probabilistic Ethereum workflows. | Control-flow and infrastructure analysis. |
| Native-value and USDC event reconciliation | P2 | Indexers need Arc-specific accounting semantics. | Event and balance reconciliation. |

## Recommended sequence

```text
C05A   Complete: harden wallet/ARC_CHAIN_METADATA
C05B   Complete: canonical FindingV2 support for ARC_CHAIN_METADATA
C06A   Complete: harden wallet/WALLET_NATIVE_USDC_DISPLAY
C06B1  Complete: bounded read-side amount interpretation
C07A   Complete: private ethers transaction ownership
C07B   Complete: ethers-only NO_BLOB_TX_ON_ARC hardening
C07C-A Build: conservative viem explicit-pattern MVP
C07C-B Blocked: thin integration after C07C-A approval
Demo/DX Improve broken/fixed example, onboarding, and report clarity
C06B2  Add write-side amount analysis after C07C
C08    Research CCTP attestation control flow
C09    Replace duplicate PREVRANDAO keyword rules
C10    Add versioned App Kit compatibility analysis
```

Advice-only work should not interrupt this sequence without real user evidence.

## Expansion triggers

A deferred analyzer family may be promoted only when at least one of these is
true:

- a user reports a concrete false negative or unsupported real integration;
- multiple real repositories use the same unsupported pattern;
- at least two high-value rules need the same stable capability;
- the expansion clearly reduces total code or regression risk;
- official versioned documentation changes the product premise.

A theoretical language pattern is not sufficient.

## Governance rules

1. Do not canonicalize a rule merely because it exists in a legacy preset.
2. Do not promote advice into a blocker to increase rule count.
3. Do not keep hardening a detector whose premise is unsupported.
4. Prefer exact common patterns before wider semantic infrastructure.
5. Share analysis infrastructure only after multiple stable consumers justify it.
6. Record decision changes here and update policy metadata separately when
   official support or detector claims change.
7. Revalidate versioned Arc, Circle, viem, and App Kit sources before implementing
   deferred work.
8. User-reported failures may change priority but do not bypass canonical
   eligibility.
9. After two unsuccessful review cycles, stop and reduce scope or redesign.
