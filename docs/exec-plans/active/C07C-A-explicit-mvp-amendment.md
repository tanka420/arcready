# C07C-A amendment — conservative viem explicit-pattern MVP

## Status

- Status: replacement decision record; implementation remains blocked until the
  planning alignment PR is independently reviewed and merged.
- Risk class: R3.
- Parent plan: `docs/exec-plans/active/C07C.md`.
- Planning base: `main` at `1e595050373009994636bf9afef70500109f573b`.
- Planning branch: `agent/c07c-a-explicit-mvp-plan`.
- Rule: `wallet/NO_BLOB_TX_ON_ARC`.
- Date: 2026-07-28.

The parent C07C plan now contains the authoritative replacement implementation
contract. This file preserves the decision history, rejected candidate evidence,
and reasons for the reset.

## Rejected candidate

The first local C07C-A candidate was implemented on
`agent/c07c-a-viem-analyzer`:

- candidate commit: `61ce4f68a28f0c0f589cd52a7c47cd7ef78ac344`;
- base: `1e595050373009994636bf9afef70500109f573b`;
- scope: one private analyzer and one test file;
- targeted suite: 134/134 passed;
- analyzer: 989 physical lines;
- tests: 1,403 physical lines;
- package boundary: unchanged at 7 files and 68,925 pnpm smoke bytes.

Independent adversarial review rejected the candidate with:

- 1 blocker;
- 9 major findings;
- 0 minor findings;
- root-cause classes A = 8, B = 1, C = 1.

The review confirmed false positives, false negatives, status-contract
violations, incomplete semantic families, and inadequate readable budget. The
analyzer used 34 `prettier-ignore` directives and had only 11 lines remaining
under the original hard stop.

Disposition:

- do not push the candidate;
- do not open a PR from it;
- do not merge or amend it;
- do not cherry-pick it into the replacement;
- do not treat its passing test count as acceptance evidence;
- retain it only as local audit evidence.

## Strategic decision

The broad semantic-analyzer design is withdrawn.

C07C-A will be rebuilt as a **conservative explicit-pattern MVP**. ArcReady will
report only a small, common, source-proven viem shape. Unsupported or ambiguous
code produces no viem finding and is not described as safe.

The decision intentionally prefers bounded false negatives over critical false
positives.

Rejected alternatives:

1. Patch the 989-line monolith — rejected because reviewability and budget had
   already failed.
2. Build a 1,300–1,700-line full semantic analyzer — deferred because its product
   value does not justify the current complexity.
3. Extract a shared ethers/viem framework — rejected as speculative R3
   infrastructure and an unnecessary C07B regression surface.

## Replacement shape

The authoritative parent plan now locks two private viem-specific modules:

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

- local inference from `maxFeePerBlobGas` and `authorizationList`;
- blobs, KZG, versioned hashes, and sidecars;
- per-call chain/account overrides;
- alias depth 2+, branching aliases, and general mutation graphs;
- imported, cross-function, and cross-file resolution;
- `.extend(...)`, custom actions, transports, formatters, and serializers;
- `writeContract`, raw, sync, deploy, and account-abstraction paths;
- direct chain objects and `defineChain`;
- shared lexical/static-analysis infrastructure.

Future expansion requires at least one concrete user pattern, issue, fixture, or
separately approved milestone. Theoretical expressibility alone is not enough.

## Budgets and process

Production target across the two private modules is 700–1,000 physical lines,
with a hard stop above 1,100. Tests target 1,000–1,400 physical lines across at
most two files, with a hard stop above 1,500.

No semantic code may use `prettier-ignore`, minification, generated fixtures,
snapshots, helper-file fragmentation, or formatting compression to satisfy the
budget.

Delivery process:

1. merge the planning alignment;
2. start from fresh `main` on `agent/c07c-a-viem-explicit-mvp`;
3. implement compiler/status and lexical contracts first;
4. implement the exact positive grammar;
5. add fail-closed, source-order, and sibling-isolation tests;
6. run targeted checks and package-boundary proof;
7. perform one comprehensive independent review;
8. apply at most one correction batch;
9. perform one focused re-review.

A systemic issue after review cycle two stops the milestone for another scope
decision.

## Unchanged boundaries

The replacement must preserve:

- exactly 7 published files;
- exactly 68,925 bytes in the C07C-A pnpm smoke artifact;
- no public viem analyzer exports or declarations;
- no `viem` dependency;
- TypeScript `5.9.3` external and lazy;
- all C07B ethers behavior and tests;
- 19 known / 17 default / 7 wallet / 4 canonical rules;
- non-canonical status of `NO_BLOB_TX_ON_ARC`;
- rule ID, severity, message, fix, docs URL, presets, reporters, schema, scoring,
  file order, exits, and one-finding-per-file behavior.

Any drift is a stop condition.

## Progress

- [x] Original C07C planning contract merged.
- [x] First C07C-A candidate implemented locally.
- [x] Independent adversarial review completed.
- [x] Candidate rejected: 1 blocker / 9 major / 0 minor.
- [x] Conservative explicit-pattern MVP selected.
- [x] Parent C07C plan aligned with the replacement direction.
- [ ] Planning alignment independently reviewed and merged.
- [ ] Replacement C07C-A implemented from fresh main.
- [ ] Replacement C07C-A independently approved.
- [ ] C07C-B thin integration started.

C07C-B remains blocked until replacement C07C-A is independently approved.

## Exit criteria for this planning alignment

- Exact scope is documentation only:
  - `docs/exec-plans/active/C07C.md`;
  - `docs/exec-plans/active/C07C-A-explicit-mvp-amendment.md`;
  - `docs/roadmap.md`;
  - `docs/rule-development-backlog.md`.
- One independent planning review reports 0 blocker, 0 major, and 0 minor.
- Formatting and diff checks pass.
- No production, test, package, dependency, export, inventory, canonical, schema,
  scoring, reporter, or exit behavior changes.
- The planning alignment is merged before replacement implementation begins.
