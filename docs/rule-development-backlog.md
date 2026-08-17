# ArcReady Rule Development Backlog

**Status:** Active decision record
**Last reviewed:** 2026-08-06
**Applies to:** Active and proposed ArcReady static-analysis rules

## Purpose

This document owns sequencing and development decisions.

It records which rules should be built, researched, kept as advice, replaced, or
retired.

It is not a commitment to canonicalize every legacy rule.

Policy metadata, official documentation, impact, confidence, maturity, detector
limitations, and deprecation remain sourced from:

```text
docs/rule-catalog.md
packages/arcready/core/rules/catalog.ts
```

## Decision values

- `Complete`: the approved detector scope is implemented and reviewed.
- `Build`: the rule has enough evidence and user value for a bounded milestone.
- `Research`: the problem matters, but reliable static evidence is not defined.
- `Advice-only`: keep as optional guidance, not a compatibility blocker.
- `Replace`: preserve the product problem but stop hardening the current rule.
- `Retire`: do not invest further in the current premise.

## Priority values

- `P0`: current core compatibility work.
- `P1`: high-value work after the current P0 sequence.
- `P2`: useful but narrower, framework-specific, or capability-dependent work.
- `P3`: optional advice, replacement research, or low-urgency work.

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

- `bridge/CCTP_DOMAIN_26`
  - Decision: Complete.
  - Priority: P0.
  - Detects Arc CCTP domain values other than `26`.
- `bridge/NO_WRAPPED_USDC_ON_ARC`
  - Decision: Complete.
  - Priority: P0.
  - Detects Arc-side wrapped-USDC mappings with source-chain isolation.
- `bridge/RELAYER_USES_USDC_FOR_GAS`
  - Decision: Complete.
  - Priority: P0.
  - Detects literal ETH relayer gas-token configuration owned by Arc.
- `wallet/ARC_CHAIN_METADATA`
  - Decision: Complete.
  - Priority: P0.
  - Uses bounded Arc-owned metadata analysis.

The private canonical runtime remains exactly four rules.

## Wallet rules

### `wallet/WALLET_NATIVE_USDC_DISPLAY`

- Decision: Complete.
- Priority: P0.
- Impact: Required change.
- Canonical status: Non-canonical.
- Revisit amount and UI binding separately.

### `wallet/ARC_USDC_AMOUNT_CONVERSION`

- Decision: Complete for C06B1 reads and the C06B2 exact write MVP.
- Priority: P0.
- Impact: Blocker.
- Canonical status: Non-canonical.
- C06B2 is complete under `docs/exec-plans/completed/C06B2.md`; PR #45 merged
  E1, E2, and E3 on 2026-08-04.
- Native write analysis is Research and blocked by contradictory first-party raw
  `value` decimal premises.
- The completed write surface is an exact viem local-account
  transfer to canonical Arc USDC using one exact client, request, and direct
  nonzero `parseEther` literal.
- The thin existing-rule integration defines one private write-candidate kind
  and a deterministic at-most-one read/write selection policy while preserving
  C06B1 behavior when no write candidate exists. Candidate offsets are private
  ordering metadata, emitted findings remain file-level, and expression-level
  output is deferred to a separate R3 prerequisite.
- E1, E2, and E3 each received an independent `APPROVE` with zero blocker,
  major, and minor findings. The final `corepack pnpm verify:full` gate passed
  before merge.
- The rule remains non-canonical. No live RPC request, signing, funding, or
  transaction success was proven.
- `parseUnits`, conversions, wider bindings, multiple candidates,
  mutation-aware expansion, ethers, and generalized write analysis remain
  deferred to separately reviewed follow-ups.
- Current official Arc documentation uses
  `https://rpc.testnet.arc.network`, so the existing `.network` analyzer literal
  remains current and no RPC migration is planned.

### `wallet/NO_BLOB_TX_ON_ARC`

- Decision: Complete for C07B ethers and C07C viem explicit-pattern MVP.
- Priority: P0.
- Impact: Blocker.
- Canonical status: Non-canonical.
- Completed capability: bounded ethers and conservative viem explicit-pattern
  ownership and submission detection.
- Expand viem only from concrete user patterns or separately approved work.

### `wallet/PREVRANDAO_NOT_SUPPORTED`

- Decision: C09A compatibility-shell migration implemented; closeout pending.
- Priority: P1.
- Impact: Required change.
- Retain as a temporary compatibility shell over one shared private analyzer.
- Emit only exact owned non-bridge records when this shell is selected.
- Remove the current keyword detector and all blanket `mixHash` equivalence.
- Preserve non-canonical status and inventory during the compatibility period.

### `wallet/NO_ETH_GAS_LABEL`

- Decision: Advice-only.
- Priority: P2.
- Impact: Required change.
- Revisit when rendered UI labels can be separated from internal terminology.

### `wallet/ONE_CONFIRMATION_FINAL`

- Decision: Advice-only.
- Priority: P3.
- Impact: Recommendation.
- Consolidate with bridge confirmation guidance.

## Completed C07C viem scope

C07C completed a bounded conservative explicit-pattern contract.

Implemented bounded surface:

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
- per-call chain or account overrides;
- alias depth 2+, branching aliases, and mutation graphs;
- imported, cross-function, and cross-file resolution;
- custom transport, formatter, serializer, and client extensions;
- `writeContract`, raw, sync, deploy, and account-abstraction paths;
- shared static-analysis infrastructure.

The rejected candidate `61ce4f6...` is audit evidence only.

It must not be used as an implementation base.

## Bridge rules

### `bridge/ATTESTATION_404_NOT_FATAL`

- Decision: Complete as Advice-only migration.
- Priority: P3 during the compatibility/deprecation period.
- Impact: Recommendation.
- C08-R1 through R3, C08-D, and C08A are complete.
- PR #53 removed the rule from default bridge execution while preserving the
  public ID and added a narrow explicit opt-in path for known non-off levels.
- PR #54 changed direct/default severity to `info`, removed the unconditional
  retry claim, and aligned runtime/docs catalog policy as deprecated advice.
- Inventory is 19 known / 16 default / 7 wallet / 4 canonical.
- The detector remains a low-confidence proximity heuristic and is not eligible
  for canonical FindingV2 or default CI failure.
- Revisit Retire after one compatibility period or earlier if usage evidence
  shows no material value.

### `bridge/NO_PREVRANDAO_RELAY_SELECTION`

- Decision: C09A compatibility-shell migration implemented; closeout pending.
- Priority: P1.
- Impact: Required change.
- Retain as a temporary relay/validator/sequencer compatibility shell over the
  shared private analyzer.
- Emit only exact owned bridge-relay records when this shell is selected.
- Remove the current keyword detector and prevent cross-shell duplication.
- Preserve non-canonical status and inventory during the compatibility period.

### `bridge/BRIDGE_CONFIRMATIONS_ONE`

- Decision: Advice-only.
- Priority: P3.
- Impact: Recommendation.
- Consolidate with wallet confirmation guidance.

## App Kit rules

### `app-kit/APPKIT_CHAIN_IDENTIFIER_VALID`

- Decision: Build.
- Priority: P2.
- Impact: Blocker.
- Requires version-aware App Kit argument or configuration ownership.

### `app-kit/UB_DELEGATE_REQUIRED`

- Decision: Research.
- Priority: P2.
- Impact: Required change.
- Requires account-role and delegate-controlled spend modeling.

### `app-kit/APPKIT_CAPABILITY_SUPPORTED`

- Decision: Replace.
- Priority: P2.
- Design a versioned compatibility rule from official support tables.

### `app-kit/APPKIT_CUSTOM_RPC_RECOMMENDED`

- Decision: Advice-only.
- Priority: P3.
- Keep in an optional advice pack.

### `app-kit/UB_FEE_EXPLANATION_PRESENT`

- Decision: Advice-only.
- Priority: P3.
- Revisit only with rendered confirmation-screen ownership.

### `app-kit/APPKIT_BRIDGE_MIN_AMOUNT_NOTE`

- Decision: Retire.
- Priority: P3.
- Research future fee or disclosure guidance separately.

## High-value opportunities beyond current inventory

- Native USDC versus ERC-20 USDC amount modeling.
- Duplicate native and ERC-20 USDC presentation.
- Evidence-driven expansion of unsupported transaction-submission patterns.
- Indexer ordering by block number.
- Ethereum-style reorg assumptions.
- Native-value and USDC event reconciliation.

## Recommended sequence

```text
C05A   Complete: harden wallet/ARC_CHAIN_METADATA
C05B   Complete: canonical FindingV2 support for ARC_CHAIN_METADATA
C06A   Complete: harden wallet/WALLET_NATIVE_USDC_DISPLAY
C06B1  Complete: bounded read-side amount interpretation
C07A   Complete: private ethers transaction ownership
C07B   Complete: ethers-only NO_BLOB_TX_ON_ARC hardening
C07C-A Complete: conservative viem explicit-pattern MVP
C07C-B Complete: thin integration of already-valid records
DX01   Complete: broken/fixed demo, onboarding, and report clarity
C06B2  Complete: exact direct viem parseEther write MVP; native remains blocked
C08-D  Complete: Advice-only disposition selected
C08A   Complete: default-excluded deprecated attestation advice
C09-D  Complete: bounded Build disposition selected
C09A   Next: implement private analyzer and compatibility shells
C10    Then: add versioned App Kit compatibility analysis
```

C09-R1, C09-R2, C09-R3-A, and C09-R3-B are complete. C09-D selects Build, and
C09A is the next approved sequencing target. Production remains blocked until
the decision and implementation plan merge. The compatibility inventory target
remains `19 known / 16 default / 7 wallet / 4 canonical`. Other analyzer
expansion should not interrupt this sequence without real user evidence.

## Expansion triggers

A deferred analyzer family may be promoted only when at least one condition is
true:

- a user reports a concrete false negative or unsupported integration;
- multiple real repositories use the same unsupported pattern;
- at least two high-value rules need the same stable capability;
- expansion clearly reduces total code or regression risk;
- official versioned documentation changes the premise.

A theoretical language pattern is insufficient.

## Governance rules

1. Do not canonicalize a rule merely because it exists in a legacy preset.
2. Do not promote advice into a blocker to increase rule count.
3. Do not keep hardening a detector whose premise is unsupported.
4. Prefer exact common patterns before wider semantic infrastructure.
5. Share infrastructure only after multiple stable consumers justify it.
6. Record decision changes here and policy changes in the catalog.
7. Revalidate versioned Arc, Circle, viem, and App Kit sources before deferred
   work.
8. User-reported failures may change priority but do not bypass canonical
   eligibility.
9. Continue correction until no known blocker remains in the declared scope.
10. Reduce scope, redesign, or split work when defects reveal an architecture
    problem.
11. Do not impose a fixed numerical cap on correction or review rounds.
