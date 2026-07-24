# ArcReady Engineering Working Agreement

## Purpose

This document defines the default development workflow for ArcReady. It applies
to future milestones, bug fixes, rule work, canonicalization, CLI and reporter
changes, dependency work, releases, and repository maintenance.

The workflow is risk-based rather than ceremony-based. It removes redundant
work while preserving the strongest appropriate quality gate.

## Priority order

1. Product correctness.
2. Technical correctness.
3. Evidence quality and fail-closed behavior.
4. Resolution of known blockers.
5. Maintainability and truthful documentation.
6. Time and token efficiency.

When speed conflicts with required evidence, review, or validation, quality wins.

## Risk classes

### R0 — Documentation or metadata only

Examples:

- typo corrections
- date or link updates
- wording that does not change rule policy or product claims

Minimum process:

1. define the narrow scope
2. edit
3. inspect the diff
4. run relevant formatting or documentation checks
5. rely on CI before merge

### R1 — Local settled-contract change

Examples:

- message correction
- focused regression fix
- local helper change with an existing contract

Minimum process:

1. write a short task contract
2. implement with a regression test
3. run targeted validation
4. self-review the exact diff
5. run the full gate once the change is stable
6. obtain normal PR review

### R2 — Rule hardening or bounded analyzer

Examples:

- new ownership path
- source or sink classification
- viem or ethers support
- fail-closed syntax expansion

Required process:

1. create or update an exec plan
2. lock the supported and unsupported surface
3. define the threat model and acceptance matrix
4. implement in reviewable slices
5. run targeted validation during development
6. obtain independent adversarial review before release-candidate validation
7. correct until no known blocker remains
8. run the full gate
9. prepare a release candidate and final review

### R3 — Architecture or external contract

Examples:

- canonical runtime changes
- FindingV2, CoverageV2, or ScanResultV2 changes
- public API, schema, scoring, or exit behavior
- shared AST infrastructure
- runtime dependency changes

Required process:

1. research first-party premises and repository constraints
2. compare viable designs and record the decision
3. independently review the plan
4. split implementation into bounded PRs when practical
5. prove backward compatibility or document an approved break
6. perform independent adversarial review
7. run the full gate and package-level validation
8. merge only after explicit contract and boundary proof

## Standard lifecycle

### 0. Intake and classification

Record:

- user or developer problem
- expected product value
- risk class
- initial scope and non-goals
- go, defer, research, replace, or retire decision

Do not begin implementation merely because a legacy rule already exists.

### 1. Baseline and evidence

Verify:

- expected branch and exact HEAD
- clean working tree and index
- relationship to `origin/main`
- package and tool versions when relevant
- current source, tests, roadmap, catalog, and quality-audit state
- first-party external premise for unstable or integration-specific behavior

Stop on a material baseline mismatch. Do not silently rebase the task onto an
unknown state.

### 2. Specification proportional to risk

`R0` and most `R1` work may use a short task note.

`R2` and `R3` work use an exec plan based on
`docs/exec-plans/TEMPLATE.md`. The plan must define:

- product goal
- supported surface
- unsupported surface
- evidence and ownership model
- ambiguity policy
- threat model
- acceptance matrix
- implementation slices
- validation and exit criteria

The plan is a source of truth, not a copy of every repository invariant.

### 3. Adversarial design review before code

For `R2` and `R3`, attempt to break the design before implementation.

Mutate positive examples across:

- ownership and sibling networks
- lexical scope and shadowing
- imports and reassignment
- spread, computed, duplicate, omitted, and malformed syntax
- library and API identity
- source, sink, and call-site relationships
- unsupported wrappers and cross-file flow

Update the plan and matrix before code when a missing semantic class is found.

### 4. Implementation in bounded slices

Prefer slices with one clear responsibility and test boundary. Avoid large
multi-purpose analyzers when smaller components can express the contract.

Do not create a generic framework in anticipation of hypothetical consumers.
Extract shared infrastructure only after the common semantics are demonstrated.

### 5. Fast development loop

During implementation:

1. edit one bounded slice
2. run targeted tests
3. run the relevant build or type check
4. inspect the diff
5. add or mutate counterexamples
6. correct and repeat

Do not create a release bundle or run every repository-wide check after each
small correction.

The active exec plan owns its targeted command list; there is no single generic
fast gate that is correct for every milestone.

### 6. Independent pre-RC review

Before full validation, an independent reviewer examines:

- contract adherence
- architecture and coupling
- unsupported behavior that is accidentally accepted
- false-positive and false-negative counterexamples
- claim-versus-code accuracy
- scope drift

The reviewer must do more than confirm existing tests pass.

### 7. Correction and escalation

There is no numerical cap on corrections.

Classify each defect:

- **A — local defect:** fix locally, add a regression test, rerun targeted checks
- **B — missing contract class:** update the spec, add the entire mutation family,
  and review the semantic group
- **C — architecture defect:** pause patching, redesign or split the work, then
  review the new plan

Repeated defects from the same class are evidence that a local patch is no
longer sufficient.

### 8. Release-candidate full gate

Run only after source-level review is stable:

```text
corepack pnpm verify:full
```

Then perform milestone-specific built CLI, fixture, package-size, schema,
canonical, inventory, or public API checks as required by the plan.

If the candidate changes after a failure or review finding, rerun affected
targeted checks and the complete release-candidate gate.

### 9. Review artifact or draft PR

Prepare a review bundle only for a real candidate, not every working revision.
Use candidate names such as `pre-rc`, `rc1`, `rc2`, and `approved` rather than
turning each local fix into a new release version.

The bundle should contain machine-readable metadata, an exact patch, validation
evidence, and hashes. Use `corepack pnpm review:bundle -- ...` when applicable.

### 10. Final review and merge

Merge only when all required exit criteria pass on the exact candidate commit.

Do not merge with:

- a known blocker
- unsupported claims in docs
- unexplained scope drift
- failing or missing required CI
- unresolved canonical, inventory, public API, or dependency impact

### 11. Post-merge learning

Record a short retrospective only when it creates reusable value, such as:

- a defect found materially late
- repeated defects from one semantic class
- an architecture reversal
- a CI, packaging, or review-bundle failure
- a premise correction

Convert the lesson to the narrowest durable asset:

- rule-specific issue → regression test
- analyzer-wide issue → checklist, helper, or mutation family
- workflow issue → script or working-agreement update
- product premise issue → catalog, roadmap, or backlog decision

Do not turn `AGENTS.md` into a history of individual bugs.

## Validation model

### Targeted validation

Used repeatedly during development. It should cover the changed component,
its nearest consumers, and high-risk regressions.

### Full validation

Used for a stable candidate and required before merge for runtime-affecting work.
The repository command is:

```text
corepack pnpm verify:full
```

CI and local development must use the same source command so the gate does not
drift between environments.

### Review is not replaced by validation

Tests prove the cases encoded in tests. They do not prove that the supported
surface is correctly defined or that all material counterexample classes were
considered. `R2` and `R3` therefore require independent adversarial review.

## Exit criteria

A material milestone is complete only when:

1. the product goal is met
2. the premise is supported
3. supported cases behave as specified
4. material negative, ambiguous, and contradictory cases fail closed
5. the threat model and acceptance matrix are covered
6. no known blocker remains
7. code, tests, docs, and claims agree
8. targeted validation passes
9. full validation passes
10. independent review passes for `R2` and `R3`
11. canonical, inventory, public API, dependency, and package boundaries are
    proven or intentionally changed
12. residual limitations are explicit
13. required CI passes on the exact candidate commit

This does not claim that all possible bugs are impossible. It establishes that
no known blocker remains inside the declared and tested scope.

## Process metrics

For `R2` and `R3`, record enough data to improve the workflow:

- command durations
- number of full-gate runs
- number of release candidates
- stage where each blocker was found
- repeated semantic defect classes
- false positives and false negatives on real or representative repositories
- planning-to-merge elapsed time

Optimize based on measured waste, not assumptions.
