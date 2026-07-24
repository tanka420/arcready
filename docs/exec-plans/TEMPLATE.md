# <Milestone> Exec Plan

Status: Draft | Approved | Implementing | Pre-RC | RC | Complete

Risk class: R0 | R1 | R2 | R3

Owner:

Base branch:

Base SHA:

Last reviewed:

## 1. Product goal

Describe the user or developer problem and the value of solving it.

## 2. Decision

State whether the work is build, research, advice-only, replace, retire, or
complete. Explain why it should be done now.

## 3. Premise and sources

List first-party documentation, source, repository evidence, versions, access
dates, and unresolved uncertainty.

## 4. Current state

Describe the existing behavior, architecture, tests, known limitations, and
relevant inventory or canonical status.

## 5. Scope

### Supported

List exact files, languages, libraries, APIs, object shapes, bindings, evidence,
sources, sinks, and outputs in scope.

### Non-goals

List unsupported behavior explicitly.

## 6. Evidence and ownership model

Define proven Arc, proven non-Arc, unknown, and conflicting states. Describe how
evidence propagates and where it must stop.

## 7. Architecture options

Compare viable approaches, including regression risk, coupling, line count,
testability, future reuse, and unnecessary generalization.

### Chosen approach

Record the decision and why rejected alternatives are worse.

## 8. Threat model

List false-positive and false-negative risks, including malformed, ambiguous,
imported, computed, reassigned, multichain, sibling-scope, and library-lookalike
cases relevant to this milestone.

## 9. Acceptance matrix

For each case record:

| ID | Class | Input shape | Expected result | Reason |
| --- | --- | --- | --- | --- |
| P01 | Positive |  |  |  |
| N01 | Negative |  |  |  |
| A01 | Ambiguous |  |  |  |
| M01 | Malformed |  |  |  |
| C01 | Contradictory |  |  |  |

## 10. Implementation slices

For each slice record:

- goal
- files added or changed
- production and test line budget
- dependencies
- migration risk
- targeted validation
- stop conditions

## 11. Validation plan

### Targeted development commands

List milestone-specific fast checks.

### Full repository gate

```text
corepack pnpm verify:full
```

### Additional release-candidate checks

List built CLI, fixture, package, schema, inventory, canonical, performance, or
real-repository checks required by the milestone.

## 12. Boundary impact

Record intended impact on:

- legacy behavior
- canonical runtime
- FindingV2 / CoverageV2 / ScanResultV2
- rule inventory and order
- public API and schema
- package contents and size
- dependencies and licenses
- reporters, scoring, and exit behavior

Use `none` only after verification.

## 13. Progress

- [ ] baseline verified
- [ ] premise verified
- [ ] plan reviewed
- [ ] threat model approved
- [ ] acceptance matrix approved
- [ ] implementation complete
- [ ] targeted validation passed
- [ ] independent pre-RC review passed
- [ ] full validation passed
- [ ] release-candidate review passed
- [ ] documentation aligned
- [ ] merged

## 14. Review findings

Track each finding with status, severity, root-cause class, correction, regression
evidence, and review result.

## 15. Decision log

Record material scope, architecture, or contract changes with date and rationale.
Do not silently change the milestone contract during implementation.

## 16. Residual limitations

List unsupported cases and why they remain outside scope. Ensure product claims
match these limits.

## 17. Exit criteria

Copy and specialize the applicable criteria from
`docs/engineering/working-agreement.md`. The milestone is not complete while a
known blocker remains.

## 18. Completion record

Record final commit, PR, validation summary, review result, and any reusable
workflow lesson before moving the plan from `active/` to `completed/`.
