# FindingV2 adapter

## Boundary

PR 4D2B adds the first private legacy-to-FindingV2 adapter slice. It supports
exactly these detector rules:

- `bridge/CCTP_DOMAIN_26`
- `bridge/NO_WRAPPED_USDC_ON_ARC`

They were selected because each detector emits at most one finding per rule and
file, identifies one affected file, has approved catalog documentation, and can
support truthful file-level pattern evidence without changing detector output.

The adapter is not publicly exported and is not connected to `runScan`,
`ScanResultV2`, the CLI, reporters, scoring, status, presets, configuration, or
the GitHub Action.

## Input and provenance

The input is one scheduled, completed occurrence with a safe selected-rule
identity and detector-origin findings:

```text
completed occurrence
|-- selectionIndex (diagnostic context only)
|-- safe selected rule ID
`-- detectorFindings[]
    `-- adapter -> FindingV2 or sanitized diagnostic
```

Failed occurrences cannot satisfy this input type. Their `fallbackFinding`
field is structurally absent from the adapter boundary. Disabled occurrences,
unrepresentable identities, and unsupported rule IDs are also rejected before
adaptation. Raw rules, project roots, instrumentation, reads, and existing
diagnostics are not adapter inputs.

## Specifications and metadata

Each supported rule has an explicit specification. Its `RuleDefinitionV2`
combines the existing legacy rule with its approved taxonomy catalog entry and
validates before use. Title, classification, default confidence, and
documentation therefore remain catalog/definition-derived rather than being
duplicated in adapter metadata.

The adapter-specific values are:

| Rule | Pattern ID | Detector discriminator |
|---|---|---|
| `bridge/CCTP_DOMAIN_26` | `bridge.cctp-domain.non-26` | `cctp-domain-non-26` |
| `bridge/NO_WRAPPED_USDC_ON_ARC` | `bridge.wrapped-usdc.arc-route` | `wrapped-usdc-arc-route` |

Specifications additionally carry the approved rule-specific confidence reason
and remediation summary. Confidence basis is `adapter`; both catalog confidence
levels are `medium`. Remove-or-replace and other unsupported taxonomy states
cannot produce a specification for this adapter.

Contract v2 structural validation alone is not sufficient for specification
approval. Validation rebuilds the current approved specification and requires
the supplied legacy Rule object identity, complete catalog-derived metadata,
non-function legacy Rule descriptor, and execution capabilities to match that
approved definition exactly. Caller-substituted classification, documentation,
confidence metadata, rule packs, or execution capabilities are rejected even
when they are otherwise valid Contract v2 values. Pattern ID, detector
discriminator, confidence reason, and remediation summary are likewise locked
to the two approved rule specifications. This is an integrity comparison, not
a claim of runtime immutability or deep freezing.

## Location policy

The adapter requires exactly one legacy file. Zero files and multiple files,
including duplicate entries, produce diagnostics. It never chooses the first
file, deduplicates file entries, or invents related locations.

The project root is hidden behind an injected resolver. The resolver recognizes
POSIX and Windows paths independently of the host platform, rejects UNC and
drive-relative forms, rejects URL-like and control-bearing input, and rejects a
raw `..` segment before normalization. Absolute input must use the project
root's path family and be lexically contained by that root. No filesystem read,
`realpath`, or symlink dereference occurs.

Successful resolution emits only a normalized repository-relative forward-slash
path:

```text
operational path + trusted root
              |
              v
       lexical containment
              |
              v
     { path: "src/file.ts" }
```

Locations are file-level only. Regions, lines, and columns are not invented.
`relatedLocations` is always empty.

## Evidence and canonical mapping

Each adapted finding contains exactly one `pattern-match` evidence record. Its
pattern ID comes from the approved specification and its location equals the
primary file location. The adapter does not include an excerpt, source content,
regex source, legacy message, severity, or fallback information as evidence.
It never rereads source files.

The legacy normalized message remains the FindingV2 display message. Legacy
severity, files, preset, documentation slug, suggested-fix field, and runtime
severity override are not copied as canonical classification data. Remediation
comes from the specification; documentation and classification come from the
validated definition.

## Exact fingerprints and duplicates

The adapter creates `arcready/exact-location/v1` fingerprints from only:

1. the safe selected rule ID;
2. the normalized file-level primary location; and
3. the stable detector discriminator.

Selection index, detector index, message, severity, source content, execution
order, time, and fallback information do not affect fingerprints.

Within one adapter invocation, every member of a duplicate fingerprint group is
rejected and one `FINDING_V2_DUPLICATE_FINGERPRINT` diagnostic is emitted at the
first member's detector-relative position. There is no first-wins or last-wins
deduplication. Cross-occurrence duplicate detection remains the responsibility
of PR 4C2B before `ScanResultV2` construction.

## Diagnostics and partial adaptation

The adapter emits exactly four diagnostic codes:

- `FINDING_V2_LOCATION_MISSING`
- `FINDING_V2_LOCATION_AMBIGUOUS`
- `FINDING_V2_LOCATION_UNREPRESENTABLE`
- `FINDING_V2_DUPLICATE_FINGERPRINT`

Location diagnostics are recoverable analysis warnings. The duplicate
diagnostic is a recoverable analysis error. All use the existing
`internal-error` category and `tool` origin. Messages are fixed and exclude raw
paths, source content, raw errors, stacks, and fallback text.

Location failures reject only the affected detector finding. Valid unrelated
findings remain in detector order. Duplicate groups are removed as a group while
unrelated findings remain. Programmer errors and contract-invariant failures
throw rather than being converted to warnings.

## Known limitations and next step

Both detectors remain text-pattern based. CCTP domain detection cannot resolve
computed maps or distinguish every Arc numeric property. Wrapped-USDC detection
cannot prove destination-chain deployment or eliminate all multichain source
contexts. Findings intentionally contain no source excerpts or region-level
locations.

Runtime ScanResultV2 aggregation is not implemented here. PR 4C2B is the next
vertical-slice step: it will aggregate occurrence outputs, handle exact
fingerprint collisions across occurrences, and build the internal
`ScanResultV2` while preserving the legacy runtime.
