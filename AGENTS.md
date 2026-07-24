# ArcReady Repository Instructions

## Product contract

ArcReady is an Arc-specific, local-first, CI-friendly static compatibility gate
for wallet, bridge, App Kit, and dApp integration code.

ArcReady is not a generic EVM linter, security auditor, compiler, transaction
simulator, runtime monitor, or hosted dashboard.

Quality takes priority over speed. Time and token optimization may remove
redundant or mechanical work, but must not weaken analysis, review, validation,
acceptance criteria, or resolution of known blockers.

## Sources of truth

Use each source for its proper role:

- approved product, architecture, and exec-plan documents define intended behavior
- executable code and tests show current behavior and regression evidence
- validation scripts and CI workflows define the executable merge gates
- this `AGENTS.md` defines the default repository operating contract
- the current task prompt defines the requested delta within those boundaries

When these sources conflict materially, stop and report the conflict. Do not
silently treat current code as the intended contract or let a task prompt weaken
repository quality requirements.

A task-specific approved exec plan may narrow scope, but it must not silently
contradict the product contract or repository quality requirements.

## Required reading

Before material work, read the relevant sections of:

- `docs/engineering/working-agreement.md`
- `docs/engineering/static-analysis-review.md` for analyzer or rule work
- the active file under `docs/exec-plans/active/`, when one exists
- rule catalog, roadmap, and quality-audit documents relevant to the change

## Risk classification

Classify work before implementation:

- `R0`: documentation or metadata with no runtime or policy impact
- `R1`: local implementation change with a settled contract
- `R2`: rule hardening or bounded analyzer behavior
- `R3`: architecture, canonical runtime, schema, public API, dependency, scoring,
  or exit-behavior change

Use the smallest process that fully covers the risk. Do not skip required review
or validation merely because a change is small in line count.

## Static-analysis principles

- Critical findings require evidence tied to the relevant Arc-owned object,
  client, provider, call, transaction, control-flow branch, or UI surface.
- Do not combine unrelated file-level Arc text and error keywords into a
  critical finding.
- Fail closed for ambiguous, conflicting, imported, computed, malformed,
  reassigned, cross-file, or otherwise unsupported evidence.
- Prefer a smaller truthful supported surface over broad speculative matching.
- Do not claim support beyond the implemented and tested behavior.
- Do not canonicalize a rule merely because its legacy detector exists.
- Keep advice-only guidance separate from compatibility blockers.
- Extract shared infrastructure only when at least two real consumers need the
  same stable semantics and regression tests prove behavior is preserved.

## Correction policy

There is no fixed limit on correction rounds. Continue until no known blocker
remains in the declared scope.

When repeated defects share a cause, stop patching individual symptoms and
escalate appropriately:

- local defect: fix locally and add a regression test
- missing contract class: update the spec and add the full mutation family
- architecture defect: redesign or split the work before continuing

## Validation

During implementation, run targeted tests and the smallest relevant build loop.
Before merge, all runtime-affecting changes must pass the full repository gate:

```text
corepack pnpm verify:full
```

Also inspect the exact diff, run the milestone-specific adversarial matrix, and
confirm that code, tests, docs, inventory, canonical boundaries, and public
claims agree.

Passing tests is necessary but not sufficient for `R2` and `R3` work. These
changes require independent adversarial review.

## Git and scope discipline

- Verify branch, HEAD, base, and working-tree state before editing.
- Do not include unrelated changes.
- Do not use destructive Git commands to solve ordinary workflow problems.
- Do not commit, push, create a PR, or merge unless the task explicitly
  authorizes that action.
- Default to a draft PR for agent-created changes.
- Do not merge while a known blocker remains.
- Preserve legacy output, canonical inventory, public API, package shape, and
  dependency boundaries unless the approved scope explicitly changes them.

## Change reporting

Every material change report must state:

- goal and risk class
- files changed
- behavior changed and deliberately unchanged
- validation run and its result
- remaining limitations or unresolved decisions
- canonical, inventory, public API, dependency, and package impact

Do not describe confidence as proof. Record concrete evidence.
