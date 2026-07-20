# Internal ScanResultV2 runtime

PR 4C2B connects the existing private discovery, execution, FindingV2,
CoverageV2, and ScanResultV2 foundations for the first time. It is a fixed
vertical slice. It does not replace or modify the public legacy runtime.

## Private boundary

The runtime is available only by direct internal import:

```ts
interface RunInternalScanV2Options {
  readonly projectRoot: string;
  readonly config: ArcReadyConfig;
}

function runInternalScanV2(
  options: RunInternalScanV2Options
): Promise<ScanResultV2>;
```

`projectRoot` is resolved once to an operational absolute path. `config` is
required and must already be normalized by the existing configuration system.
That system remains the sole owner of config fields, enums, defaults, and
policy validation. The runtime checks only its outer options boundary and the
config's outer plain-object shape; it does not load or independently validate
configuration policy.

Before asynchronous work, the runtime uses `structuredClone` once to snapshot
the complete normalized config. This avoids retaining caller references without
enumerating current fields or values, so future normalized fields are neither
rejected nor silently dropped. A non-cloneable config is a programmer error.
The caller value is never frozen or mutated.

The function is not exported from `src/index.ts`. It returns only a validated
`ScanResultV2`; discovery and rule instrumentation remain private inputs to
CoverageV2 construction.

## Fixed canonical rule slice

The first canonical slice contains exactly these rules in this order:

```text
0  bridge/CCTP_DOMAIN_26
1  bridge/NO_WRAPPED_USDC_ON_ARC
```

Each executable rule comes from its approved FindingV2 adapter specification.
The runtime checks the tuple ID, specification ID, executable rule ID,
occurrence identity, and instrumentation identity at their shared selection
index.

The other 16 known rules are not executed. Running all 18 while adapting only
two would make canonical coverage ambiguous and silently omit unsupported
results. Adding a rule to this runtime therefore requires an approved adapter
and a later explicit slice change; there is no mutable adapter or rule
registry.

Configured presets and detected presets do not widen or narrow selection.
Project detection still runs so `RuleContext.detectedPresets` contains the real
existing detection result. That result does not change FindingV2 confidence or
CoverageV2 applicability.

`config.rules[id] === "off"` disables the matching selected occurrence.
Non-off severity overrides retain existing detector normalization behavior but
do not change canonical classification, confidence, evidence, documentation,
or fingerprints. Overrides for unselected rules do not cause those rules to
execute.

## Pipeline

```text
projectRoot + normalized config
              |
              v
    validate and snapshot config
              |
              v
   discoverFilesInstrumented once
       |                  |
       |                  +--> discovery facts and diagnostics
       v
operational absolute candidate files
              |
              v
safe repository-relative sort keys
              |
              v
      direct code-unit ordering
              |
              v
 detectProject + createRuleContext
              |
              v
runRulesStructuredInstrumented once
       |                  |
       |                  +--> execution facts and diagnostics
       v
   structured rule occurrences
              |
              v
 completed supported occurrences only
              |
              v
    adaptDetectorOccurrenceV2
       |                  |
       |                  +--> adapter diagnostics
       v
 ordered canonical candidates
              |
              v
 cross-occurrence collision rejection
       |                  |
       |                  +--> collision diagnostics
       v
 unique canonical findings
              |
              +-----------------------------+
                                            |
discovery + execution instrumentation       |
              |                             |
              v                             |
       deriveCoverageV2                     |
              |                             |
              +---------------+-------------+
                              |
                              v
                    buildScanResultV2
                              |
                              v
                 validated independent result
```

## Instrumented discovery and file order

The runtime calls `discoverFilesInstrumented` exactly once. Legacy
`discoverFiles` is not called, so discovery traversal is not duplicated. The
operational file array contains absolute paths and never becomes canonical
output. Discovery instrumentation supplies safe scope, entry, completeness,
and diagnostic facts.

The runtime creates one trusted repository location resolver. Every discovered
file must resolve to a validated repository-relative location. Failure to do so
is an internal invariant error with a fixed message that excludes the rejected
path.

Files are copied and sorted by canonical repository-relative path using direct
code-unit comparison. The operational path is used only as a private tie-break
for identical canonical keys. No `localeCompare` or locale-sensitive collation
is used, discovery files are not silently deduplicated, and legacy discovery
ordering remains unchanged.

Unavailable roots and empty file sets may still return a ScanResultV2.
Instrumented discovery owns its existing complete/incomplete state and
sanitized diagnostics. Zero files and zero findings do not establish
compatibility.

## One structured execution loop

`runRulesStructuredInstrumented` creates one existing execution recorder,
calls `executeRulesStructured` once, and returns both the validated
`RuleExecutionResult` and the recorder snapshot. It does not project legacy
findings or create diagnostics.

`runRulesInstrumented` delegates to the seam and then performs its existing
legacy projection. Its finding values and references, instrumentation,
selection indexes, read attempts, diagnostics, and execution order remain
unchanged. `runRules` and `executeRules` are unchanged.

The runtime requires exactly two structured occurrences and two instrumentation
outcomes. Selection indexes, safe rule identities, scheduling, execution state,
and normalized finding counts must align. A mismatch is an internal invariant
failure.

## Occurrence provenance

```text
disabled  --> no adapter, no finding, no adapter diagnostic
completed --> adapt detectorFindings with the matching approved specification
failed    --> no adapter; fallbackFinding remains structurally excluded
```

Failed occurrences contribute only the existing fixed `RULE_EXECUTION_FAILED`
diagnostic and execution coverage. The runtime never inspects fallback text.
Unsupported or unrepresentable occurrence identities are invariant failures,
not silently omitted rules.

Repository-specific location failures remain adapter diagnostics, and valid
unrelated findings survive them. Adapter programmer or Contract v2 failures
throw; internal bugs do not become compatibility warnings. The adapter uses
the location resolver and does not reread source files.

## Cross-occurrence duplicates

The FindingV2 adapter already rejects duplicate exact fingerprints within one
occurrence. The runtime separately groups successful adapter outputs across
occurrences by exact fingerprint.

Every member of a collision group is rejected. There is no first-wins or
last-wins behavior, and selection index is never added to a fingerprint. One
validated diagnostic is emitted per group:

```text
code         FINDING_V2_CROSS_OCCURRENCE_DUPLICATE_FINGERPRINT
category     internal-error
level        error
phase        analysis
origin       tool
recoverable  true
message      Canonical findings were rejected because multiple rule
             occurrences produced the same exact fingerprint.
```

The diagnostic includes a rule ID only when all members agree and a location
only when all validated primary locations are exactly equal. It never contains
the fingerprint, selection index, absolute path, source content, finding
message, severity, raw error, stack, or fallback text.

Collision groups are ordered by their first candidate's global occurrence and
adapter-finding order. Unrelated findings retain candidate order before the
ScanResultV2 builder performs its final fingerprint sort. The builder remains
the duplicate-fingerprint validation backstop.

## Diagnostic order

ScanResultV2 diagnostics use four fixed buckets:

```text
1  discovery diagnostics in existing discovery order
2  rule-execution diagnostics in existing occurrence order
3  adapter diagnostics in occurrence and detector-relative order
4  collision diagnostics ordered by first collision candidate
```

Diagnostics are not globally sorted or interleaved backward between buckets.
One narrow internal four-bucket assembly helper concatenates them in the order
above. It preserves order inside every bucket and preserves diagnostic object
references while returning a new array. It does not inspect, validate, clone,
sort, or mutate diagnostics. The helper is not a general event or orchestration
abstraction. The ScanResultV2 builder remains the final validator and preserves
the supplied diagnostic order.

## CoverageV2

The runtime calls the existing `deriveCoverageV2` with discovery and rule
instrumentation. It does not change CoverageV2.

`selectedOccurrences` is exactly two. Disabled, scheduled, completed, failed,
emitting, non-emitting, and normalized detector finding counts describe actual
occurrences. Normalized detector finding count is an execution fact, not an
adapted FindingV2 count. Adapter rejection does not retroactively change it.

Discovery scope and completeness retain their existing meaning. Analysis stays
fixed at:

```text
state          unknown
applicability  unknown
reason         analysis-acknowledgements-unavailable
```

There is no known-rule inventory, adapter percentage, compatibility
percentage, score, status, or pass/fail field.

## ScanResultV2 ownership

The orchestrator supplies unique findings and ordered diagnostics to the
existing `buildScanResultV2`. That builder continues to own input validation,
the deep independent snapshot, exact-fingerprint finding sorting, duplicate
backstop, diagnostic order preservation, and final result validation.

The only orchestrator use of `structuredClone` is the complete normalized config
snapshot at its input boundary. The ScanResultV2 builder independently remains
the owner of the final canonical result snapshot. The orchestrator does not add
project name, project root, score, status, summary, timestamp, duration, package
version, raw instrumentation, or legacy report fields.

## Failure behavior

Invalid options, an empty root, a non-object or non-cloneable normalized config,
unsafe discovered operational paths, unexpected preset-detection failures,
occurrence alignment failures, unsupported identities, adapter invariant
failures, CoverageV2 builder failures, and ScanResultV2 builder failures throw.
Configuration value policy errors remain the responsibility of the existing
configuration system before this internal runtime is called.

Instrumented discovery retains its existing recoverable repository behavior,
including incomplete results and sanitized diagnostics. Rules that throw or
fail normalization become failed occurrences with one sanitized execution
diagnostic. Detector-caught read failures remain observable read evidence;
escaping read failures become failed rule occurrences. Adapter location
failures become sanitized adapter diagnostics. Cross-occurrence collisions
remove all group findings and add one sanitized diagnostic.

No failure path copies raw exceptions into canonical output.

## Determinism and security

Equivalent repository state and normalized configuration produce deeply equal
ScanResultV2 values. The runtime uses fixed rule order, one discovery call, one
rule loop, canonical file sort keys, direct code-unit comparison, occurrence
alignment, stable adapter order, stable collision order, and fixed diagnostic
buckets.

It introduces no timestamps, durations, random IDs, parallel execution, or
caches. Absolute paths, source content, raw errors, stacks, fallback text,
configuration objects, discovery results, execution results, adapter results,
and instrumentation are not exposed or mutated. The complete normalized config
snapshot shares no nested array or record references with the caller.

## Deferred integration

PR 4C2B does not change `runScan`, the CLI, reporters, GitHub Actions, public
exports, or package contents. It does not implement ReportV2 or `json-v2`.

The next vertical slice is PR 4E1: an internal or explicitly opt-in ReportV2 or
`json-v2` projection over this validated private runtime.
