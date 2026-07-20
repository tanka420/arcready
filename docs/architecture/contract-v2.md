# Internal Contract v2 foundation

ArcReady Contract v2 is internal and experimental. The current public `Rule`,
`Finding`, `ScanResult`, `ScanReport`, reporter, configuration, scoring, CLI, and
GitHub Action contracts remain authoritative. Contract v2 is not exported from
the package entry point and is not a supported public API.

## PR 4A scope

This foundation defines the literal contract version `2.0`, repository-relative
source locations, exact-location fingerprints, `FindingV2`,
`ScanDiagnosticV2`, and a `RuleDefinitionV2` wrapper for a legacy `Rule` plus
internal `RuleMetadata`. It also provides pure runtime validators and the
`defineLegacyRuleV2` normalization helper. It does not register rules or connect
any v2 type to discovery, analysis, reporting, serialization, enforcement, or
the existing runtime.

The contract version is independent from ArcReady's npm package version.
Contract v2 does not yet define a JSON Schema URI or `$schema` field.

## Source locations

Source paths are repository-relative and use forward slashes. Normalization
converts backslashes, removes leading and embedded `.` segments, and preserves
case and Unicode. Empty paths, absolute paths, Windows drive-qualified paths,
UNC paths, URL-like inputs, control characters, and every `..` traversal segment are
rejected without using platform-dependent path resolution. A normalized path
never contains the absolute project root.

Lines and columns are one-based. Starts are inclusive, ends are exclusive, and
columns count UTF-16 code units. A missing region denotes a file-level location;
a missing primary location denotes project-level evidence. A region may omit its
end, and equal start and end positions form a valid zero-length region. An end
before its start is invalid. Locations do not contain snippets.

## Exact fingerprints

`arcready/exact-location/v1` hashes the UTF-8 JSON encoding of this fixed-order
array with Node's SHA-256 implementation:

```text
[
  "arcready/exact-location/v1",
  ruleId,
  normalizedRepositoryPathOrProjectMarker,
  startLineOr0,
  startColumnOr0,
  endLineOr0,
  endColumnOr0,
  detectorDiscriminator
]
```

The digest is lowercase hexadecimal with a `sha256:` prefix. Detector
discriminators are trimmed, required, limited to 256 characters, and may not
contain control characters. They must be stable detector instance keys—not raw
source text, snippets, secrets, stack traces, regex source, or arbitrary debug
data.

Messages, titles, taxonomy, impact, confidence, legacy severity, score,
timestamps, absolute roots, snippets, and environment data are not fingerprint
inputs. Excerpts are evidence only. The scheme is intentionally honest about
its limits: line movement, formatting that moves a region, file renames, and
location changes produce different fingerprints. It provides exact-location
stability, not semantic or contextual stability.

## Findings and diagnostics

`FindingV2` represents compatibility evidence. It keeps taxonomy, impact,
maturity, confidence, and future enforcement as distinct concepts. It has no
legacy severity, numeric score, CI failure state, baseline state, suppression
state, timestamp, absolute path, arbitrary properties, or stack trace. Evidence
is a closed union of observed values, stable pattern identifiers,
configuration values, and documented assumptions. Pattern excerpts are
optional and capped at 1,000 characters; scalar evidence strings are capped at
2,048 characters. Every finding must contain at least one evidence item.

Only stable compatibility, experimental compatibility, and advice metadata may
classify a `FindingV2`. The broader rule inventory may still contain
needs-research and remove-or-replace metadata, but those taxonomies cannot
produce Contract v2 compatibility findings because their detector contracts are
not defensible or are deprecated.

`ScanDiagnosticV2` separately represents configuration, discovery, read, parse,
unsupported-language, rule-execution, and internal tool problems. Diagnostics
are not findings, and findings do not embed diagnostics. Existing rule
exceptions continue to use the legacy behavior; this PR does not connect
diagnostics to `runRules` or `runScan`.

Severity is absent because the legacy critical/warning/info level currently
mixes classification and enforcement concerns. Score is absent because a
single numeric score can conceal incomplete execution or coverage. Neither
legacy concept is reinterpreted by this internal foundation.

## RuleDefinitionV2

`RuleDefinitionV2` declares Contract v2 metadata and capabilities around the
current public `Rule`. The wrapper checks rule/metadata identity, preset/category
agreement, existing taxonomy invariants, at least one declared analysis engine,
deterministically ordered lowercase extensions, location precision, and
deterministic parser requirement identifiers. Remove-or-replace metadata remains
valid only when it is deprecated, future-disabled, and carries the existing
replacement or no-replacement direction.

Unlike `FindingV2`, `RuleDefinitionV2` continues to accept valid needs-research
and remove-or-replace metadata so the complete known inventory remains
representable. Direct invocation of deprecated rules remains legacy-only until
those rules are removed or migrated in a later change.

The wrapper does not define a native v2 detector interface, implement an
analysis engine, register a rule, mutate its inputs, or affect runtime rule
selection.

## Validation, determinism, and security boundaries

All validators are pure and report invalid input with
`ContractV2ValidationError`. They close object and union shapes at runtime,
validate nested locations, reject unsupported enum values, bound strings and
collections, reject non-finite evidence numbers, and prevent arbitrary evidence
or finding extension objects. These controls reduce accidental leakage and
nondeterminism; they do not inspect detector intent or prove that a caller did
not place sensitive content in a permitted message or evidence field.

ArcReady remains a static compatibility linter, not a certification, security
audit, runtime simulation, or guarantee that an integration will work.

## Deferred architecture and migration

Truthful coverage and reporting require instrumented discovery and execution,
so `ScanCoverageV2`, coverage percentage or status, `ScanResultV2`, `ReportV2`,
report summaries, enforcement evaluation, and status validators are deferred.
The planned status model is multidimensional:

- execution status: whether analysis completed reliably;
- coverage status: what was and was not analyzed;
- finding result: what compatibility evidence was produced.

Numeric score deprecation and enforcement policy will be designed only after
those dimensions are available. The staged migration is planned to proceed
through instrumented discovery, `CoverageV2`, `ScanResultV2`, `ReportV2`,
`json-v2`, human reporters, enforcement policy, SARIF, and finally baseline and
suppression support. A legacy `Finding` adapter, report adapters, schemas, and
all runtime integration remain deliberately unimplemented in PR 4A.
