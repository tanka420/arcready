# C07C-A amendment — conservative viem explicit-pattern MVP

## Status

- Status: proposed replacement contract; implementation blocked until this amendment is reviewed and merged.
- Risk class: R3.
- Parent plan: `docs/exec-plans/active/C07C.md`.
- Planning base: `main` at `1e595050373009994636bf9afef70500109f573b`.
- Planning branch: `agent/c07c-a-explicit-mvp-plan`.
- Rule: `wallet/NO_BLOB_TX_ON_ARC`.
- Date: 2026-07-28.

This amendment supersedes the original C07C-A implementation contract where the
contracts conflict. The pinned viem source premise and all unchanged C07B,
package, inventory, canonical, schema, scoring, reporter, and exit-behavior
boundaries remain authoritative.

## Why this amendment exists

The first local C07C-A candidate was implemented on
`agent/c07c-a-viem-analyzer`:

- candidate commit: `61ce4f68a28f0c0f589cd52a7c47cd7ef78ac344`;
- base: `1e595050373009994636bf9afef70500109f573b`;
- exact scope: two new private analyzer/test files;
- dedicated suite: 134/134 passed;
- analyzer: 989 physical lines;
- tests: 1,403 physical lines;
- package boundary remained unchanged at 7 files and 68,925 pnpm smoke bytes.

Independent adversarial review rejected that candidate with:

- 1 blocker;
- 9 major findings;
- 0 minor findings;
- root-cause classes A = 8, B = 1, C = 1.

The review confirmed false positives, false negatives, status-contract
violations, incomplete semantic families, and insufficient readable budget. The
candidate used 34 `prettier-ignore` directives and sat only 11 lines below the
1,000-line analyzer hard stop. The candidate must not be pushed, merged, amended,
or used as the base for the replacement implementation. It remains audit
evidence only.

## Decision

Replace the broad semantic C07C-A design with a **conservative explicit-pattern
MVP**.

The objective is not to classify every viem transaction-submission shape. The
objective is to emit a critical finding only for a small, common, source-proven
shape with a low false-positive risk. Unsupported or ambiguous shapes yield no
viem finding and must not be described as safe.

This decision intentionally prefers bounded false negatives over critical false
positives.

## Architecture

Use two private, viem-specific production modules:

```text
packages/arcready/rules/wallet/viem-transaction-submission-analyzer.ts
packages/arcready/rules/wallet/viem-transaction-submission-lexical.ts
```

Responsibilities:

- `viem-transaction-submission-lexical.ts`
  - exact named-import provenance;
  - executable lexical scopes;
  - direct and one-level immutable `const` bindings;
  - declaration order, shadowing, and reassignment checks;
  - no generic or shared AST framework.
- `viem-transaction-submission-analyzer.ts`
  - compiler/file status boundary;
  - exact client, chain, transport, account, request, and sink grammar;
  - candidate classification and deterministic call ordering.

Both modules remain private and unconsumed during C07C-A. They are not exported
through the package entry and must not import or modify the ethers analyzer.

Rejected alternatives:

1. Continue patching the 989-line monolith — rejected because reviewability and
   the approved budget already failed.
2. Build a full 1,300–1,700-line semantic analyzer — deferred because current
   product value does not justify mutation graphs, alias topology, compiler
   emulation, and broad JavaScript semantics.
3. Extract a shared ethers/viem AST framework — rejected as speculative R3
   infrastructure and an unacceptable C07B regression surface.

## Exact supported positive surface

A viem submission is reportable only when all evidence below is proven in the
same executable flow.

### Imports

Allow exact named ESM imports from exact modules:

```ts
import { createWalletClient, http } from "viem";
import { arcTestnet } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
```

Direct named import aliases are allowed when exact import-declaration identity
is proven.

Reject namespace, default, type-only, CommonJS, dynamic import, user re-export,
and same-spelling local provenance.

### Binding budget

Allow depth 0 or one immutable same-file `const` binding for:

- client;
- request;
- JSON-RPC address account;
- `privateKeyToAccount(...)` account.

`arcTestnet` may be direct or one immutable same-file `const` binding.

`http(...)` must remain direct. Transport bindings are unsupported.

Depth 2+, branching aliases, imported values, wrappers, conditional values,
cross-function values, and cross-file values are unsupported and yield no viem
finding.

### Client

Allow only exact built-in `createWalletClient` with one direct object literal:

```ts
const client = createWalletClient({
  chain: arcTestnet,
  transport: http(),
  account
});
```

The client object must contain exact source-proven chain, transport, and account
evidence. Spreads, computed relevant keys, accessors, methods, prototype-sensitive
keys, duplicate relevant keys, and ambiguous shorthand are unsupported.

### Chain

Allow only exact imported `arcTestnet`, direct or through one immutable `const`.

Do not support:

- numeric chain ID `5042002`;
- direct chain objects;
- `defineChain(...)`;
- viem `arc`;
- Ethereum mainnet;
- omitted or null client chain;
- per-call chain override.

### Transport

Allow only:

```ts
http()
http("https://rpc.testnet.arc.network")
```

The call must use the exact `http` root import, be direct, and have no options
argument. Computed URLs, environment values, wrappers, `custom`, `fallback`,
`webSocket`, imported transports, and non-Arc URLs are unsupported.

### Account

Allow only:

1. an exact lowercase JSON-RPC address literal matching
   `^0x[0-9a-f]{40}$`, direct or through one immutable `const`;
2. exact `privateKeyToAccount(<one argument>)`, direct or through one immutable
   `const`, from the exact `"viem/accounts"` import.

Do not support per-call account override, custom account objects, `toAccount`,
mnemonic/HD accounts, smart accounts, custom `signTransaction`, imported
accounts, or account extension.

### Sink

Allow only an exact non-optional dot call with exactly one request argument:

```ts
client.sendTransaction(request)
```

or the exact direct client expression followed by `.sendTransaction(...)`.

Do not support element access, detached/destructured actions, optional chaining,
`call`/`apply`/`bind`, standalone actions, wrappers, `writeContract`, deployment,
raw, sync, custom, or simulation-derived paths.

### Request and blob evidence

Allow a direct object literal or one immutable same-file `const` object.

The only positive blob grammar in this MVP is an exact own direct property:

```ts
type: "eip4844"
```

The value must be the exact string literal token. Numeric `3`, `"0x3"`,
identifiers, shorthand, computed values, getters, imported values, and template
or concatenated strings are unsupported.

The MVP does not infer EIP-4844 from:

- `maxFeePerBlobGas`;
- `authorizationList` precedence;
- `blobs`;
- `blobVersionedHashes`;
- `sidecars`;
- `kzg`;
- formatter or serializer behavior.

Those source-capable routes remain explicit future milestones.

## Safety contract

The MVP performs the minimum safety analysis necessary for its declared depth-0
and depth-1 surface:

- exact lexical binding identity, not identifier text;
- declaration must dominate the sink;
- approved imports and approved `const` bindings must not be reassigned before
  the sink;
- direct protected client/request/account/chain bindings must not be mutated or
  passed to unknown calls before the sink;
- no evidence may be borrowed from sibling objects or unrelated calls;
- mutations after the sink do not invalidate the earlier call;
- invalid or partial compiler API shapes deterministically return
  `compiler-unavailable` rather than throwing.

The MVP does not implement a general alias graph, general escape analysis,
prototype analysis, or general Object/Reflect mutation engine. A shape that
would require those facilities is outside the positive grammar and yields no
viem finding.

Whole-file barriers should remain limited to existing status-contract needs.
Do not reproduce broad barriers merely to support shapes already declared
unsupported.

## State and consumer contract

Keep the private file statuses:

- `analyzed`;
- `unsupported-file`;
- `compiler-unavailable`;
- `malformed`;
- `unsupported-source` only where the exact approved file-wide contract requires
  it.

Keep deterministic submission records with at least:

- provenance;
- sink;
- structural safety;
- ownership;
- account route;
- transaction kind;
- exact evidence token `eip4844`;
- `callOffset`;
- optional internal reason code.

C07C-A remains unconsumed. C07C-B may later combine only already-valid ethers
and viem records and select the minimum `callOffset`, preserving one finding per
file and existing ethers-first impossible-tie stability.

## Budgets

Production:

- lexical module target: 250–450 physical lines;
- analyzer module target: 350–550 physical lines;
- total target: 700–1,000 physical lines;
- hard stop above 1,100 total production lines.

Tests:

```text
packages/arcready/test/viem-transaction-submission-analyzer.test.ts
packages/arcready/test/viem-transaction-submission-adversarial.test.ts
```

- total target: 1,000–1,400 physical lines;
- hard stop above 1,500 total test lines;
- at most two test files.

No semantic code may use `prettier-ignore` for compression. Do not use generated
fixtures, snapshots, helper files, minification, or formatting compression to
meet budgets.

## Acceptance matrix

The replacement C07C-A matrix should contain approximately 35–50 meaningful
cases rather than preserving the previous 60 labels as artificial coverage.
Each case must prove a distinct supported or deferred contract.

Required positive families:

- direct JSON-RPC account + direct request;
- one `const` client binding;
- one `const` request binding;
- one `const` JSON-RPC account binding;
- direct and one-`const` `privateKeyToAccount` route;
- exact import alias for each approved import;
- direct and one-`const` `arcTestnet`;
- `http()` and exact primary Arc URL;
- multiple valid calls ordered by exact source offsets.

Required fail-closed families:

- wrong import source/export/form and lexical shadowing;
- import or approved binding reassignment before the sink;
- depth 2+, branching alias, wrapper, cross-function, and imported values;
- omitted/null/non-Arc chain and per-call overrides;
- non-Arc/computed/options/custom/fallback/WebSocket transport;
- invalid/mixed-case/custom/imported account routes;
- request binding mutation and unknown-call escape before the sink;
- spread, duplicate relevant key, computed relevant key, getter/method, and
  prototype-sensitive key;
- non-exact type values and all deferred blob-looking fields;
- unsupported sink forms;
- sibling evidence isolation;
- malformed source and progressive invalid compiler shapes;
- exact before/after-sink source-order behavior;
- candidate-local invalidation preserving an unrelated valid candidate.

Every positive family requires at least one meaningful fail-closed mutation.
Tests must assert exact file status, record state/reason where present, reportable
count, and exact `callOffset` where ordering is relevant.

## Deferred roadmap

The following are deliberately deferred and should be opened only from real
usage evidence or a separately approved milestone:

1. local type inference from `maxFeePerBlobGas` and `authorizationList`;
2. `blobs`, KZG, versioned hashes, and sidecars;
3. per-call chain/account overrides;
4. alias depth 2+, branching aliases, and general mutation graphs;
5. imported/cross-function/cross-file request or account resolution;
6. `.extend(...)`, custom actions, transport, formatter, and serializer hooks;
7. `writeContract`, raw, sync, deploy, and account-abstraction paths;
8. direct chain objects and `defineChain`;
9. shared lexical/static-analysis infrastructure.

Before expanding any item, collect at least one concrete user pattern, issue, or
fixture that demonstrates product value. Do not expand only because a shape is
theoretically expressible.

## Replacement implementation strategy

1. Merge this planning amendment before implementation.
2. Create a fresh branch from the resulting `main`:
   `agent/c07c-a-viem-explicit-mvp`.
3. Do not cherry-pick or copy the failed monolith. Reuse only source-premise
   knowledge and independently validated test ideas.
4. Implement lexical/compiler/status contracts first.
5. Implement the exact positive grammar.
6. Add fail-closed and sibling-isolation families.
7. Confirm the analyzer remains unconsumed and package-invisible.
8. Run one comprehensive independent adversarial review.
9. Apply at most one consolidated correction batch.
10. Run one focused re-review. A systemic issue after cycle two stops the
    milestone for another design decision.

## Package and unchanged boundaries

C07C-A must preserve:

- exactly 7 published files;
- exactly 68,925 bytes in the established pnpm smoke artifact;
- no public viem analyzer symbols or declarations;
- no `viem` dependency;
- TypeScript `5.9.3` external and lazy;
- C07B ethers behavior and tests;
- 19 known / 17 default / 7 wallet / 4 canonical rules;
- non-canonical status of `NO_BLOB_TX_ON_ARC`;
- rule ID, severity, message, fix, docs URL, presets, reporters, schema, scoring,
  file order, exits, and one-finding-per-file behavior.

Any drift is a stop condition.

## Failed candidate disposition

`61ce4f68a28f0c0f589cd52a7c47cd7ef78ac344` is rejected audit evidence.

- Do not push it.
- Do not open a PR from it.
- Do not merge it.
- Do not amend it into the replacement.
- Do not use its passing test count as acceptance evidence.
- Preserve the review report and this amendment so future work understands why
  the broad design was abandoned.

## Progress

- [x] Original C07C planning contract merged.
- [x] First C07C-A local candidate implemented.
- [x] Independent adversarial review completed.
- [x] First candidate rejected: 1 blocker / 9 major / 0 minor.
- [x] Conservative explicit-pattern MVP direction selected.
- [ ] This amendment independently reviewed and merged.
- [ ] Replacement C07C-A implemented from fresh main.
- [ ] Replacement C07C-A independently approved.
- [ ] C07C-B integration started.

C07C-B remains blocked until the replacement C07C-A is merged and independently
approved.

## Exit criteria for this amendment

- Exact scope is this one documentation file.
- One independent planning review reports 0 blocker, 0 major, and 0 minor.
- Exact-file Prettier and `git diff --check` pass.
- No production, test, package, dependency, export, inventory, canonical, schema,
  scoring, reporter, or exit behavior changes.
- The amendment is merged before replacement implementation begins.
