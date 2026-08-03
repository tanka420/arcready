# <Milestone> Exec Plan

Status: Draft | Approved | Implementing | Pre-RC | RC | Complete

Risk class: R0 | R1 | R2 | R3

Owner:

Base branch:

Base SHA:

Last reviewed:

## 1. Product brief

### Problem

Describe the concrete user or developer problem.

### Why now

Record the repository, user, issue, adoption, or first-party evidence that makes
this work worth doing now.

### Product value

State what the developer can do better after this milestone.

## 2. Decision and risk

Decision: Build | Research | Advice-only | Replace | Retire | Defer | Complete

Explain the decision, risk class, and why a smaller or later change would be
worse.

## 3. Premise and uncertainty

List first-party documentation and source, pinned versions or commits, access
dates, repository evidence, and unresolved or conflicting premises.

A conflicting premise must be blocked or separated from the build surface.

## 4. Supported and unsupported surface

### Supported

Define the smallest exact files, languages, libraries, APIs, object shapes,
bindings, evidence, sources, sinks, and outputs in scope.

### Unsupported

List intentionally unsupported families. Unsupported behavior must not be
described as safe.

### Non-goals

List public, runtime, schema, reporter, scoring, dependency, package, and
follow-up work that this milestone does not change.

## 5. Architecture spike and decision

### Spike

Record the time-box, representative examples, prototype result, difficult tests,
dependency inspection, and assumptions disproved.

### Options considered

Compare only viable approaches.

### Chosen approach

State the bounded evidence model, private/public boundary, and why the selected
approach has the lowest justified complexity.

### Stop conditions

Define conditions that require scope cut, split, reset, defer, or retirement.

Do not expand a large fixture matrix before this decision is reviewed.

## 6. Vertical-slice contract

Define the first end-to-end path:

```text
source
→ analyzer
→ candidate
→ rule selection
→ finding or safe result
→ executable test
```

Record the accepted example, safe or fail-closed example, expected output, legacy
behavior, expected files, and production/test budgets.

## 7. Representative regression classes

Record representative classes rather than duplicating the complete executable
fixture inventory.

| ID  | Class         | Representative mutation | Expected result | Risk covered |
| --- | ------------- | ----------------------- | --------------- | ------------ |
| P01 | Positive      |                         |                 |              |
| S01 | Safe          |                         |                 |              |
| N01 | Negative      |                         |                 |              |
| A01 | Ambiguous     |                         |                 |              |
| M01 | Malformed     |                         |                 |              |
| C01 | Contradictory |                         |                 |              |

The complete fixture matrix, counts, and summaries belong in one executable
manifest or test-data source.

## 8. Validation and review

### Targeted development commands

List the smallest fast checks.

### Architecture review

Record the result before fixture expansion for R2/R3.

### Final independent review

Record the exact candidate and result for R2/R3.

### Full repository gate

```text
corepack pnpm verify:full
```

### Additional release-candidate checks

List built CLI, fixture, package, schema, inventory, canonical, performance, or
real-repository checks.

## 9. Boundary impact and progress

Record impact on legacy behavior, canonical runtime, FindingV2/CoverageV2/
ScanResultV2, rule inventory, public API/schema, package contents, dependencies,
reporters, scoring, and exit behavior.

Progress:

- [ ] baseline verified
- [ ] product brief accepted
- [ ] premise verified
- [ ] spike completed
- [ ] architecture reviewed
- [ ] vertical slice working
- [ ] representative regressions complete
- [ ] targeted validation passed
- [ ] final independent review passed
- [ ] full validation passed
- [ ] documentation aligned
- [ ] exact-head CI passed
- [ ] merged

## 10. Exit and completion record

### Residual limitations

List unsupported behavior and why it remains outside scope.

### Exit criteria

Specialize the applicable criteria from
`docs/engineering/working-agreement.md`.

### Completion record

Record final commit, PR, validation summary, independent review result, boundary
impact, and post-merge adoption evidence required before expansion.

### Decision log

Record only material product, scope, architecture, or contract changes. Do not
turn the plan into a history of every local correction.
