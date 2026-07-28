# C07C-A amendment — conservative viem explicit-pattern MVP

## Status

- Status: replacement decision record.
- Risk class: R3.
- Parent plan: `docs/exec-plans/active/C07C.md`.
- Planning base: `1e595050373009994636bf9afef70500109f573b`.
- Planning branch: `agent/c07c-a-explicit-mvp-plan`.
- Rule: `wallet/NO_BLOB_TX_ON_ARC`.
- Date: 2026-07-28.

The parent C07C plan is the authoritative implementation contract.

This file preserves the reset decision and failed-candidate evidence.

## Rejected candidate

The first local C07C-A candidate was implemented on
`agent/c07c-a-viem-analyzer`.

Evidence:

- candidate commit: `61ce4f68a28f0c0f589cd52a7c47cd7ef78ac344`;
- base: `1e595050373009994636bf9afef70500109f573b`;
- scope: one private analyzer and one test file;
- targeted suite: 134/134 passed;
- analyzer: 989 physical lines;
- tests: 1,403 physical lines;
- package boundary: unchanged at 7 files and 68,925 bytes;
- `prettier-ignore` directives: 40.

Independent adversarial review rejected the candidate with:

- 1 blocker;
- 9 major findings;
- 0 minor findings;
- root-cause classes A = 8, B = 1, C = 1.

The review found false positives, false negatives, status-contract violations,
incomplete semantic families, and inadequate readable budget.

Disposition:

- do not push the candidate;
- do not open a PR from it;
- do not merge or amend it;
- do not cherry-pick it;
- do not reuse it as the replacement implementation base;
- do not treat its passing tests as acceptance evidence;
- retain it only as local audit evidence.

## Strategic decision

Withdraw the broad semantic-analyzer design.

Rebuild C07C-A as a conservative explicit-pattern MVP.

ArcReady reports only a small source-proven viem shape.

Unsupported or ambiguous code produces no viem finding and is not described as
safe.

This intentionally prefers bounded false negatives over critical false
positives.

Rejected alternatives:

1. Patch the monolith. Reviewability and budget already failed.
2. Build a larger full semantic analyzer. Product value does not justify the
   complexity.
3. Extract a shared ethers/viem framework. The common semantics are not proven.

## Replacement shape

Use two private viem-specific modules:

```text
packages/arcready/rules/wallet/viem-transaction-submission-lexical.ts
packages/arcready/rules/wallet/viem-transaction-submission-analyzer.ts
```

The MVP supports only:

- exact named imports from `viem`, `viem/chains`, and `viem/accounts`;
- exact imported `arcTestnet`;
- direct `http()` or the exact primary Arc Testnet RPC;
- a lowercase JSON-RPC address literal or exact `privateKeyToAccount(...)`;
- direct or one immutable same-file `const` binding;
- exact non-optional `.sendTransaction(...)`;
- exact own direct `type: "eip4844"` evidence.

The MVP defers:

- `maxFeePerBlobGas` and `authorizationList` inference;
- blobs, KZG, versioned hashes, and sidecars;
- per-call chain or account overrides;
- alias depth 2+, branching aliases, and mutation graphs;
- imported, cross-function, and cross-file resolution;
- `.extend(...)` and custom actions;
- custom transports, formatters, serializers, and hooks;
- `writeContract`, raw, sync, deploy, and account-abstraction paths;
- direct chain objects and `defineChain(...)`;
- shared static-analysis infrastructure.

Future expansion requires concrete usage evidence or separate approval.

Theoretical expressibility alone is insufficient.

## Budgets

Production target:

- 700–1,000 physical lines across two private modules;
- hard stop above 1,100 lines.

Test target:

- 1,000–1,400 physical lines across at most two files;
- hard stop above 1,500 lines.

Do not use `prettier-ignore`, minification, generated fixtures, snapshots, or
helper-file fragmentation to hide scope.

## Delivery process

1. Merge the planning alignment.
2. Start from fresh `main` on `agent/c07c-a-viem-explicit-mvp`.
3. Implement compiler and lexical contracts first.
4. Implement the exact positive grammar.
5. Add fail-closed, source-order, and sibling-isolation tests.
6. Run targeted checks and package-boundary proof.
7. Obtain independent adversarial review.
8. Correct until no known blocker remains in the declared scope.

There is no fixed numerical cap on correction or review rounds.

Repeated local defects with one cause require a regression family.

A missing contract class requires specification and matrix updates.

A systemic architecture defect requires scope reduction, redesign, or a split.

## Unchanged boundaries

The replacement must preserve:

- exactly 7 published files;
- exactly 68,925 bytes in the C07C-A package smoke artifact;
- no public viem analyzer exports or declarations;
- no `viem` dependency;
- lazy external TypeScript `5.9.3` handling;
- all C07B ethers behavior and tests;
- 19 known, 17 default, 7 wallet, and 4 canonical rules;
- non-canonical status of `NO_BLOB_TX_ON_ARC`;
- rule ID, severity, message, fix, and docs URL;
- presets, reporters, schema, scoring, file order, exits, and
  one-finding-per-file behavior.

Any drift is a stop condition.

## Progress

- [x] Original C07C planning contract merged.
- [x] First C07C-A candidate implemented locally.
- [x] Independent adversarial review completed.
- [x] Candidate rejected: 1 blocker, 9 major, 0 minor.
- [x] Conservative explicit-pattern MVP selected.
- [x] Parent C07C plan aligned with the replacement direction.
- [ ] Planning alignment independently approved and merged.
- [ ] Replacement C07C-A implemented from fresh `main`.
- [ ] Replacement C07C-A independently approved.
- [ ] C07C-B thin integration started.

C07C-B remains blocked until replacement C07C-A is independently approved.

## Exit criteria for this planning alignment

The scope is documentation only:

- `docs/exec-plans/active/C07C.md`;
- `docs/exec-plans/active/C07C-A-explicit-mvp-amendment.md`;
- `docs/roadmap.md`;
- `docs/rule-development-backlog.md`.

The alignment may merge only when:

- independent review reports no known blocker in scope;
- formatting and diff checks pass;
- no production, test, package, dependency, export, inventory, canonical,
  schema, scoring, reporter, or exit behavior changes;
- implementation has not started from the planning branch.
