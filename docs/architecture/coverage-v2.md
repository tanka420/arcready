# Coverage v2

## PR 4C1 boundary

PR 4C1 adds the internal `CoverageV2` contract, strict validation, and a pure
derivation from `DiscoveryInstrumentationV1` and
`RuleExecutionInstrumentationV1`. It does not integrate coverage into
`runScan`, reports, reporters, the CLI, the package entrypoint, or the GitHub
Action. The implementation lives in the internal `core/coverage-v2` module.

Coverage is evidence about which discovery and rule-execution work was
observed. It is not a compatibility verdict. There is no overall coverage
status, percentage, ratio, score, confidence value, enforcement result, or
pass/fail field. In particular, zero findings do not prove compatibility.

## Scope versus coverage

Scope records declared and observed counts. Coverage states describe whether
the corresponding lifecycle work completed. These are separate concepts:

- Discovery completion does not mean analysis completion.
- A candidate file has not necessarily been read or analyzed.
- A successful read does not prove inspection, parsing, or analysis.
- A completed rule does not prove that the rule was applicable.
- Unsupported files are distinct from excluded entries.

## Contract structure

`CoverageV2` uses the existing Contract v2 version and has exactly these
top-level fields:

```text
CoverageV2
|-- contractVersion
|-- scope
|   |-- roots
|   `-- entries
|-- discovery
|-- ruleExecution
|   |-- state
|   `-- counts
|-- analysis
`-- evidence
    `-- ruleContextReads
```

The contract contains aggregate counts and lifecycle states only. It excludes
paths, rule IDs, findings, diagnostics, messages, timestamps, durations, source
content, and raw errors.

## Root scope

Root outcomes preserve requested occurrence multiplicity, including duplicate
configured roots. `observedRootOutcomes` equals the sum of accepted,
unavailable, and outside-project-root outcomes.

When discovery ends normally, `requested` is known and its count equals the
number of observed root outcomes. When discovery terminates fatally,
`requested` is unknown. Fatal traversal can stop before later configured roots
are recorded, so the instrumentation cannot truthfully reconstruct the
original requested total or infer missing outcomes.

## Entry scope

Entry observation is `complete` when discovery ends normally and `truncated`
when discovery terminates fatally. Counts describe only canonical entry records
that were reached:

- `uniqueEncounteredEntries` counts records, not `encounterCount` totals.
- Overlapping roots therefore do not inflate the unique count.
- `excludedEntries` includes excluded files, directories, symlinks, and other
  entries.
- Supported and unsupported extension counts apply only to regular files whose
  extension support was evaluated.
- Unsupported files are not classified as excluded.
- `candidateFiles` counts candidate records; it does not claim reads or
  analysis.
- Descendants never reached by traversal are absent from the counts.

## Discovery coverage

Discovery has four states derived from `discovery.complete` and direct root
outcomes, never from diagnostic text or codes:

- `complete`: discovery ended normally, at least one root occurrence was
  requested, and every requested occurrence was accepted.
- `partial`: discovery ended normally, at least one occurrence was accepted,
  and at least one was unavailable or outside the project root.
- `failed`: discovery terminated because of a fatal discovery operation. Facts
  observed before termination remain available, but requested roots are
  unknown and entry observation is truncated.
- `insufficient`: discovery ended normally and either no root was requested or
  no requested root was accepted.

`complete` describes traversal only. It does not claim complete language
support, file reads, analysis, applicability, or compatibility.

## Rule-execution coverage

Rule counts preserve every selected occurrence, including duplicate rule
objects. They are not deduplicated by rule ID. Selected occurrences are divided
into disabled and scheduled occurrences; scheduled occurrences are divided
into completed and failed occurrences; completed occurrences are divided by
whether normalized detector findings were emitted.

Disabled rules remain counted but are intentionally outside scheduled
execution scope. They are not failed and are not treated as not-applicable.
Legacy fallback findings emitted for execution failures do not contribute to
`normalizedDetectorFindings`.

Rule execution has four states:

- `complete`: at least one occurrence was scheduled and every scheduled
  occurrence completed.
- `partial`: at least one scheduled occurrence completed and at least one
  failed.
- `failed`: at least one occurrence was scheduled and none completed.
- `insufficient`: no occurrence was scheduled, including empty and all-disabled
  selections.

Finding emission and RuleContext read outcomes do not change execution status.

## Read-attempt evidence

`evidence.ruleContextReads` counts every recorded RuleContext read attempt,
preserving multiplicity. It divides attempts into succeeded, failed, and
unsettled outcomes, and separately into representable and unrepresentable path
counts. Project-root and repository-relative paths are representable; the
contract copies neither their values nor attempt indices.

Reads are observed evidence only. They are not correlated with discovery
candidates, do not form file-read coverage, and do not prove inspection,
parsing, or analysis. A failed or unsettled read does not make execution failed
when the owning rule itself completed.

## Analysis and applicability

Current instrumentation has no native detector acknowledgements. Analysis is
therefore always:

```json
{
  "state": "unknown",
  "applicability": "unknown",
  "reason": "analysis-acknowledgements-unavailable"
}
```

No discovery, read, execution, or finding fact changes this value. Applicability
must not be inferred from completed rules, and analysis must not be inferred
from successful reads.

## Diagnostics and operational data

Diagnostics and coverage are separate data. Discovery status comes from
completion and root outcomes; rule-execution status comes from rule outcomes.
Diagnostics are not counted as additional failed subjects and are not copied
into CoverageV2. A future `ScanResultV2` may place diagnostics and coverage in
sibling fields.

Legacy operational candidate-path and finding arrays are also excluded. In
particular, absolute candidate paths and legacy fallback findings are not
CoverageV2 inputs or output.

## Unrepresentable identities

Unrepresentable discovery entries, rule occurrences, and read-attempt paths use
count-only treatment. Coverage does not create anonymous records, hashes,
synthetic identifiers, raw identities, or private identity keys. An
unrepresentable identity does not by itself change discovery or execution
state, and analysis remains unknown independently.

## Pure derivation and validation

`deriveCoverageV2` is an internal pure function. It reads only the two supplied
instrumentation values, constructs new aggregate objects, validates the result,
and returns it. It performs no filesystem or environment access, rule
execution, mutation, global-state access, ordering, caching, time measurement,
or random generation. Equivalent inputs produce equal output.

`validateCoverageV2` requires plain objects, rejects unknown fields at every
level, validates the existing Contract v2 version and every literal state, and
requires all counts to be non-negative safe integers. It enforces:

- Root disposition counts sum to observed roots.
- Known requested roots equal observed roots.
- Unknown requested roots pair only with truncated, failed discovery.
- Discovery states satisfy their exact requested-root, accepted-root, and
  observation invariants.
- Entry category counts stay within encountered-entry bounds, candidates do not
  exceed supported regular files, and the mutually exclusive extension counts
  satisfy
  `extensionSupportedRegularFiles + extensionUnsupportedRegularFiles <= uniqueEncounteredEntries`.
- Selected rules equal disabled plus scheduled rules.
- Scheduled rules equal completed plus failed rules.
- Completed rules equal the two finding-emission counts.
- Unrepresentable rules do not exceed selected rules.
- Normalized detector findings are zero without emitting occurrences and are at
  least the number of emitting occurrences otherwise.
- Rule-execution states satisfy their exact scheduled, completed, and failed
  count invariants.
- Read outcomes and path-representation counts each sum to total attempts.
- Analysis state, applicability, and reason remain the fixed unknown values.

Validation neither mutates nor normalizes its input.

## Deferred work

PR 4C1 does not implement runtime integration or public exports. `ScanResultV2`,
FindingV2 runtime adaptation, diagnostic aggregation, ReportV2, `json-v2`, JSON
Schema, SARIF, baselines, suppressions, enforcement, compatibility policy,
file- or rule-level coverage records, project-detection read instrumentation,
registry or preset instrumentation, and native detector acknowledgements remain
deferred.
