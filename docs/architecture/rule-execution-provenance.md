# Internal rule-execution provenance

## PR 4D1A boundary

PR 4D1A adds an unversioned internal execution result that preserves the origin
of compatibility-era legacy findings. It does not add a FindingV2 adapter,
runtime ScanResultV2 aggregation, public exports, or new serialized output.

The previous shared executor returned one flat `Finding[]` containing both
normalized detector output and executor-created fallback warnings. Once those
values entered the flat array, their origin could not be recovered safely.
Messages, severities, rule IDs, array positions, diagnostics, and object identity
are not provenance and must never be used to infer it.

## Per-occurrence model

One selected input rule maps to one occurrence in supplied array order:

```text
RuleExecutionResult
`-- occurrences[]
    |-- disabled / not-run
    |   `-- detectorFindings: []
    |-- scheduled / completed
    |   `-- detectorFindings: Finding[]
    `-- scheduled / failed
        |-- detectorFindings: []
        `-- fallbackFinding: Finding
```

Each occurrence carries its zero-based `selectionIndex`, which equals its array
position. Duplicate rule objects and duplicate rule IDs therefore remain
distinct without hashes, synthetic IDs, sorting, or deduplication.

Rule identity reuses the instrumentation safety boundary. A representable ID is
stored as `{ kind: "rule-id", id }`; an unsafe identity becomes
`{ kind: "unrepresentable" }` without retaining the rejected value. Raw Rule
objects, registry origin, and preset-selection origin are absent.

Field names provide the complete finding-origin vocabulary. A separate origin
marker would duplicate the meaning of `detectorFindings` and `fallbackFinding`
and could contradict their structural lifecycle invariants.

## Detector findings and atomic normalization

A scheduled rule completes only after `Rule.run` resolves and the complete
returned finding array normalizes successfully. The normalized detector records
remain in detector-return order and are committed together to the completed
occurrence. They are not cloned, sorted, or deduplicated.

If execution or any normalization step fails, temporary normalized records are
discarded. The failed occurrence commits no detector findings and contains one
legacy fallback finding instead. A disabled occurrence runs no detector and has
neither detector nor fallback findings.

## Fallback and diagnostic separation

The fallback finding retains the existing legacy rule ID, severity, message,
empty files array, suggested fix, documentation, preset, and occurrence position.
Its message still contains the current raw error-message text for legacy output
compatibility. The structured result stores neither the raw Error object nor its
stack.

Canonical diagnostics are not part of `RuleExecutionResult`. Legacy execution
does not construct or validate diagnostics. Only the instrumented recorder
projects a failed occurrence into the existing sanitized
`RULE_EXECUTION_FAILED` diagnostic, using safe occurrence identity rather than
inspecting fallback text. It constructs exactly one diagnostic per instrumented
failed occurrence and retains failure-occurrence order.

Read attempts also remain instrumentation evidence. They are collected only by
the existing instrumented RuleContext wrapper and do not appear in provenance.
Successful, failed, and unsettled outcomes, including fire-and-forget snapshot
behavior, retain their existing meaning.

## Shared execution and projections

One sequential lower-level loop produces structured occurrences. It has two
projections:

```text
legacy runRules
  -> executeRulesStructured with original RuleContext
  -> projectLegacyFindings
  -> Finding[]

runRulesInstrumented
  -> executeRulesStructured with read-recording RuleContext
  -> projectLegacyFindings
  -> existing RuleExecutionInstrumentationV1
```

The pure legacy projection appends completed detector findings in their original
order, one failed fallback at its occurrence position, and nothing for disabled
occurrences. It returns a new flat array while preserving finding and nested
references, duplicates, and values. It does not mutate, clone, sort, deduplicate,
or create diagnostics.

Instrumentation keeps its existing lifecycle fields, normalized detector counts,
unknown applicability, read snapshots, and diagnostic values. A fallback never
contributes to `normalizedFindingCount`.

## Validation and security

The internal validator requires one plain result object with an occurrence array,
plain direct occurrences, exact lifecycle-specific keys, safe selection indexes,
safe or unrepresentable rule identity, real detector arrays, and mutually
exclusive completed, failed, and disabled states. It checks only the structural
legacy Finding object boundary and does not introduce stricter payload semantics
that would reject currently accepted custom-rule output.

The result has no Contract v2 version and is not part of CoverageV2 or
ScanResultV2. It contains no diagnostic, read attempt, raw Error, stack,
timestamp, duration, environment value, source content field, raw Rule object,
hash, or synthetic ID. It is direct-import only and is not a public or serialized
contract.

## Deferred adapter boundary

A future FindingV2 adapter will receive only selection identity, a safely
representable rule ID, detector findings, approved rule metadata, and a
deterministic repository-scoped location resolver. It must not receive fallback
findings, diagnostics, raw Rule objects, read attempts, raw errors, or full
instrumentation. Unrepresentable identities require a future canonical
adaptation-diagnostic policy.

FindingV2 conversion, evidence and fingerprint policy, runtime ScanResultV2
aggregation, ReportV2, and reporter integration remain deferred.
