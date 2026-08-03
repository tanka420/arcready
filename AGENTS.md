# ArcReady Repository Instructions

## Product contract

ArcReady is an Arc-specific, local-first, CI-friendly static compatibility gate
for wallet, bridge, App Kit, and dApp integration code.

ArcReady should detect a small set of common Arc integration problems with
findings that developers can trust and act on.

ArcReady is not a generic EVM linter, security auditor, compiler, transaction
simulator, runtime verifier, general-purpose program-analysis framework, or
hosted dashboard.

## Product decision test

Before starting material work, confirm:

1. Arc developers realistically encounter the problem;
2. ArcReady can detect it within a narrow, truthful, maintainable boundary;
3. the finding provides a clear corrective action.

Defer, research, replace, or retire work that does not satisfy all three.

## Sources of truth

- approved plans define intended behavior and boundaries;
- executable code and tests show current behavior and regression evidence;
- fixture manifests and validation scripts own generated counts and summaries;
- CI workflows define executable merge gates;
- this file defines the default repository operating contract;
- the current task defines the requested delta within those boundaries.

Stop and report material conflicts. Do not duplicate generated fixture,
provenance, relation, or outcome counts across plans, roadmap, backlog, and tests.

## Required reading

Before material work, read:

- `docs/engineering/working-agreement.md`;
- `docs/engineering/static-analysis-review.md` for analyzer or rule work;
- the active exec plan when one exists;
- relevant rule catalog, roadmap, and quality-audit sections.

## Risk classification

- `R0`: documentation or metadata with no runtime or policy impact;
- `R1`: settled local implementation or governance change;
- `R2`: rule hardening or bounded analyzer behavior;
- `R3`: architecture, canonical runtime, schema, public API, dependency, scoring,
  or exit-behavior change.

Use the smallest process that fully covers the actual risk.

## Default delivery model

```text
product brief
→ baseline and premise
→ time-boxed spike
→ architecture review
→ working vertical slice
→ risk-based regression expansion
→ final independent review
→ full gate
→ adoption gate
```

R2 and R3 work must run a spike and architecture review before a large plan or
fixture matrix. Implement an end-to-end vertical slice before broad regression
expansion.

Do not build a generic framework for hypothetical consumers. Extract shared
infrastructure only when at least two real consumers need the same stable
semantics.

## Static-analysis principles

- Critical findings require evidence tied to the relevant Arc-owned flow.
- Do not combine unrelated file-level text into a critical finding.
- Fail closed for ambiguous, conflicting, imported, computed, malformed,
  reassigned, cross-file, or unsupported evidence.
- Prefer a smaller truthful surface over broad speculative matching.
- Do not claim support beyond implemented and tested behavior.
- Keep advice-only guidance separate from compatibility blockers.
- Fixture count is not a quality target.
- Product value and truthful boundaries take precedence over framework breadth.

## Correction policy

- **A — local defect:** fix locally and add the smallest regression;
- **B — missing contract class:** update the bounded contract and representative
  mutation family;
- **C — architecture defect:** stop patching and redesign, split, defer, or retire.

Two consecutive review/correction cycles exposing the same B or C root cause
require a scope cut, milestone split, or architecture reset.

Do not expand fixtures while the architecture boundary is moving. A second full
independent review is required only when a correction materially changes the
approved architecture or external contract.

## Validation

Use targeted tests and the smallest relevant build loop during development.

Before merge, runtime-affecting changes must pass:

```text
corepack pnpm verify:full
```

Inspect the exact diff and confirm code, tests, docs, inventory, canonical
boundaries, package shape, and public claims agree.

R2 and R3 require architecture review and final independent adversarial review.
Do not run the full repository gate after every mechanical correction.

## Adoption gate

Do not broaden a merged analyzer automatically.

A follow-up should normally require a real repository or user report, repeated
unsupported patterns, measured false-positive/false-negative evidence, a
first-party premise change, or two real consumers requiring the same capability.

Prefer hardening, report clarity, remediation quality, and real usage evidence
over speculative analyzer expansion.

## Git and scope discipline

- Verify branch, HEAD, base, and working-tree state before editing.
- Keep governance changes separate from feature branches.
- Do not include unrelated changes.
- Do not use destructive Git commands for ordinary workflow problems.
- Do not commit, push, create a PR, or merge unless explicitly authorized.
- Default to a draft PR for agent-created changes.
- Do not merge while a known blocker remains.
- Preserve legacy output and public boundaries unless approved scope changes them.

## Change reporting

State the product problem, why now, risk, architecture decision or spike result,
files changed, demonstrated behavior, deliberately unchanged behavior,
validation, review, limitations, and boundary impact.

Record concrete evidence rather than describing confidence as proof.
