# Internal ScanResultV2 Contract

PR 4C2A introduces `ScanResultV2` as the internal aggregate for one future v2
scan result. A result is neutral canonical data, not a user-facing report,
serializer shape, compatibility verdict, or enforcement decision. This contract
establishes a stable composition boundary without changing the current scanner,
CLI, reporters, public JavaScript API, or published package behavior.

## Contract shape

```text
ScanResultV2
|-- contractVersion: "2.0"
|-- coverage: CoverageV2
|-- findings: FindingV2[]
`-- diagnostics: ScanDiagnosticV2[]
```

Coverage appears exactly once. Findings and diagnostics use the existing v2
contract primitives. Project or subject identity, legacy findings, discovery
instrumentation, rule-execution instrumentation, scores, summaries, statuses,
compatibility, policy, enforcement, timestamps, and durations are not part of
this aggregate. Zero findings therefore does not imply compatibility.

## Construction and ownership

`buildScanResultV2` accepts already-normalized `CoverageV2`, `FindingV2`, and
`ScanDiagnosticV2` values. It validates those canonical inputs before taking one
whole-graph `structuredClone` snapshot. The builder retains no references to the
input object graph and does not mutate or freeze caller-owned values.

The cloned findings are sorted by their exact fingerprint values using direct
ECMAScript string code-unit comparison. Every exact fingerprint must be unique;
duplicate fingerprints are rejected even when the associated finding records
differ. Diagnostics retain caller-supplied order and may contain duplicate codes
or identical records because their order is evidence-bearing.

The completed aggregate is validated again before it is returned. This makes the
builder a pure internal boundary: equivalent inputs produce equivalent values,
and later caller mutations cannot alter the result.

## Validation policy

`validateScanResultV2` requires a plain top-level object with exactly
`contractVersion`, `coverage`, `findings`, and `diagnostics`. Direct finding and
diagnostic entries must also be plain objects. The validator delegates nested
contract checks to the existing CoverageV2, FindingV2, and ScanDiagnosticV2
validators, requires version alignment, and enforces sorted, unique findings.

The aggregate adds no equations between coverage counts and finding or diagnostic
counts. Those relationships require a later integration policy and are not
inferred by this contract.

## Legacy failure and instrumentation boundaries

The current legacy rule-failure path creates a fallback `Finding`, while
instrumented rule execution creates a canonical rule-execution diagnostic. The
fallback finding is operational failure information, not detector compatibility
evidence, and must never be adapted into `FindingV2`. A future `ScanResultV2` may
contain the canonical diagnostic only.

Runtime adaptation first requires structured provenance that distinguishes
detector findings from fallback failures. Message parsing, severity matching,
rule-ID matching, and array-position guessing are prohibited substitutes for
that provenance.

Raw `DiscoveryInstrumentationV1`, `RuleExecutionInstrumentationV1`, root and
entry outcomes, read-attempt records, selection indexes, absolute candidate
paths, legacy operational findings, and debug streams remain outside the result.
`CoverageV2` already carries the approved aggregate evidence.

## Integration boundary

This module is internal. It is not exported from the package entry point and is
not wired into `runScan`, CLI commands, reporters, scoring, presets, the GitHub
Action, or the package payload. The current legacy runtime remains the fallback
and continues to produce its existing output.

Deferred work includes structured provenance, the `FindingV2` adapter, runtime
aggregation, project identity, `ReportV2`, `json-v2`, SARIF, baselines,
suppressions, enforcement, JSON Schema, runtime cutover and fallback policy,
reporter integration, and any additional cross-field invariants. None of those
features is implemented by PR 4C2A.
