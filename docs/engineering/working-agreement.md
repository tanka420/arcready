# ArcReady Engineering Working Agreement

## Purpose

ArcReady uses a product-led, evidence-gated delivery model:

```text
product problem
→ bounded evidence
→ time-boxed architecture spike
→ early architecture decision
→ working vertical slice
→ risk-based regression expansion
→ final independent review
→ adoption gate
```

The workflow is risk-based rather than ceremony-based. It preserves truthful,
fail-closed analysis while preventing small milestones from becoming open-ended
research programs.

## Product north star

ArcReady is an Arc-specific, local-first, CI-friendly static compatibility gate.
It should detect a small set of common Arc integration problems with findings
that developers can trust and act on.

ArcReady is not a generic EVM linter, compiler, security auditor, transaction
simulator, runtime verifier, hosted dashboard, or general-purpose
program-analysis platform.

New work should proceed only when:

1. Arc developers realistically encounter the problem;
2. ArcReady can detect it within a narrow, truthful, maintainable boundary;
3. the finding gives the developer a clear corrective action.

## Priority order

1. Product value.
2. Product correctness.
3. Technical correctness.
4. Evidence quality and fail-closed behavior.
5. Resolution of known blockers.
6. Maintainability.
7. Time and token efficiency.

Quality wins when speed conflicts with a required boundary. Ceremony that does
not improve the boundary should be removed.

## Risk classes

### R0 — Documentation or metadata without policy impact

Examples include typo, date, link, or wording corrections that do not change
product, rule, review, or merge policy.

Minimum process:

1. define the narrow scope;
2. edit;
3. inspect the exact diff;
4. run relevant formatting or documentation checks;
5. rely on required CI before merge.

### R1 — Settled local contract or governance change

Examples include focused regression fixes, local helper changes under an
established contract, and workflow documentation that changes process but not
runtime behavior.

Minimum process:

1. write a short task contract;
2. implement the narrow change;
3. add regression evidence when behavior changes;
4. run targeted validation;
5. inspect the exact diff;
6. run the full gate only when required by the affected boundary;
7. obtain normal PR review.

### R2 — Rule hardening or bounded analyzer behavior

Required process:

1. write a short product brief and why-now statement;
2. verify the first-party premise and repository baseline;
3. run a time-boxed architecture spike;
4. record one bounded architecture decision;
5. obtain architecture review before expanding fixtures;
6. implement one end-to-end vertical slice;
7. expand regressions according to demonstrated risk;
8. run targeted validation during development;
9. obtain one final independent adversarial implementation review;
10. run the full repository gate on the stable candidate;
11. merge only after exact-head CI and required review pass.

### R3 — Architecture or external contract

Required process:

1. write a product and compatibility brief;
2. research first-party premises and repository constraints;
3. compare viable designs in a time-boxed spike;
4. independently review the architecture decision;
5. split implementation into bounded vertical slices;
6. prove backward compatibility or document an approved break;
7. perform final independent adversarial review;
8. run full and package-level validation;
9. merge only after explicit contract, migration, and boundary proof.

## Standard lifecycle

### 0. Intake and product evidence

Record the user problem, why it matters now, available evidence, risk class,
scope, non-goals, and go/defer/research/replace/retire decision.

Do not begin implementation only because a legacy rule or roadmap entry exists.

### 1. Baseline and premise

Verify branch, exact HEAD, clean working tree, relationship to `origin/main`,
relevant source and tests, and first-party premises.

Stop on a material baseline or premise conflict.

### 2. Time-boxed architecture spike

R2 and R3 work should normally begin with a spike lasting approximately half a
day to two working days.

A spike may include:

- 5–10 complete examples;
- one private prototype;
- dependency-source inspection;
- the hardest representative tests;
- comparison of reuse versus a new private helper.

A spike must not change public output, build a speculative framework, create a
large fixture matrix, or claim production readiness.

If the spike does not establish a viable bounded approach, defer, split, or
retire the milestone before writing a large plan.

### 3. Proportional specification

R0 and most R1 work use a short task note.

R2 and R3 use `docs/exec-plans/TEMPLATE.md`. The plan is a decision record, not a
duplicate implementation.

The complete fixture inventory belongs in executable test data or a manifest,
not duplicated manually across the plan, roadmap, and backlog.

### 4. Architecture review before fixture expansion

For R2 and R3, independently challenge ownership, source and sink identity,
imports, shadowing, reassignment, malformed syntax, wrappers, cross-file flow,
accidental generalization, and public boundaries.

A Class C architecture defect pauses implementation. Redesign or split the work
before adding more fixtures.

### 5. Working vertical slice

Prefer the smallest end-to-end path:

```text
source
→ analyzer
→ candidate
→ rule selection
→ finding or safe result
→ executable test
```

The slice may remain private until review, but it must exercise the real
integration path.

### 6. Risk-based regression expansion

After the slice works, add regressions for demonstrated risks such as wrong
network, address, ABI, function, sink, aliases, shadowing, malformed syntax,
boundaries, overflow, ordering, sibling isolation, and legacy preservation.

Fixture count is not a quality target.

### 7. Fast development loop

During implementation:

1. edit one bounded behavior;
2. run targeted tests;
3. run the relevant build or type check;
4. inspect the exact diff;
5. add the smallest regression that proves the correction;
6. repeat.

Do not run every repository-wide check after each small correction.

### 8. Correction and escalation

Classify each defect:

- **A — local defect:** fix locally and add a regression;
- **B — missing contract class:** update the bounded contract and representative
  mutation family;
- **C — architecture defect:** stop patching and redesign, split, defer, or retire.

There is no arbitrary cap on unrelated local defects. However, two consecutive
review/correction cycles exposing the same B or C root cause require a scope cut,
milestone split, or architecture reset.

Do not expand fixtures while the architecture boundary is moving.

### 9. Final independent review

A stable R2 or R3 implementation receives one complete independent adversarial
review. Another full review is required only when a correction materially
changes the approved architecture or external contract.

### 10. Release-candidate gate

Run after source-level review is stable:

```text
corepack pnpm verify:full
```

Then run milestone-specific CLI, fixture, package, schema, canonical, inventory,
or public API checks.

### 11. Pull request and merge

The PR must state the product problem, why now, risk, architecture decision or
spike result, demonstrated vertical slice, exact scope, validation, review,
boundary impact, and residual limitations.

Merge only when required checks and reviews pass on the exact head commit.

### 12. Post-merge adoption gate

Do not automatically broaden a merged analyzer.

A follow-up should normally require a real user or repository report, repeated
unsupported patterns, a first-party premise change, two real consumers needing
the same stable capability, or measured false-positive/false-negative evidence.

## Single source of truth

Use one executable source for generated evidence:

- fixture manifests own counts and distributions;
- validation scripts compute generated summaries;
- code owns implemented behavior;
- plans own approved intent and boundaries;
- roadmap and backlog own priority and status only.

Do not maintain the same counts or matrices manually in multiple documents.

## Validation model

Use targeted validation repeatedly during development. Run full validation only
when the candidate is stable and before merge for runtime-affecting work:

```text
corepack pnpm verify:full
```

Tests do not independently establish that the product claim or supported surface
is correct. R2 and R3 therefore require architecture review and final independent
review, not repeated full reviews after every mechanical correction.

## Exit criteria

A material milestone is complete only when:

1. the product problem and why-now case remain valid;
2. the premise is supported;
3. the supported surface behaves as specified;
4. material unsupported cases fail closed;
5. the vertical slice demonstrates end-to-end value;
6. representative regressions pass;
7. no known blocker remains;
8. code, tests, docs, and claims agree;
9. targeted validation passes;
10. full validation passes when required;
11. independent review passes for R2 and R3;
12. canonical, inventory, public API, dependency, and package boundaries are
    proven or intentionally changed;
13. residual limitations are explicit;
14. required CI passes on the exact candidate commit.

## Process metrics

For R2 and R3, record planning-to-first-slice time, planning-to-merge time, full
gate runs, stage where blockers were found, repeated B/C root causes, fixture
growth caused by real findings, and real false-positive/false-negative evidence.
