# Scan instrumentation

## PR 4B1 boundary

PR 4B1 adds internal file-discovery instrumentation. It records facts observed
by the existing synchronous traversal without changing the public
`discoverFiles(options): string[]` API or any scan, rule, finding, score,
reporter, CLI, or Action output.

This instrumentation is not a compatibility certification and is not a claim
of repository coverage. It does not say that a candidate is compatible,
applicable to a rule, read, parsed, or analyzed.

## Shared collector and projections

One collector owns root iteration, containment and existence checks, metadata
lookup, symlink handling, exclusion matching, directory traversal, extension
filtering, candidate deduplication, and fatal-error capture.

It has two projections:

- `discoverFiles` uses the default synchronous filesystem adapter, returns the
  existing sorted absolute candidate paths, and rethrows the original first
  filesystem error.
- The internal `discoverFilesInstrumented` uses the same collector and returns
  legacy operational candidate paths plus canonical discovery facts. It is not
  exported from the package entrypoint.

The collector traverses once. It does not use lifecycle callbacks or a generic
event bus. The narrow filesystem adapter covers only the existing `exists`,
`lstat`, and directory-read operations and exists to make failure tests
deterministic.

## Factual terminology

A **requested root** is one item in `options.paths`. Root records retain the
original zero-based request index and preserve duplicate requests.

Root dispositions mean:

- `accepted`: the request passed lexical containment and the existing
  existence check;
- `outside-project-root`: the request failed lexical containment;
- `unavailable`: the existing existence check returned false. This does not
  distinguish absence from inaccessibility.

An **encountered entry** is an entry for which `lstat` succeeded. Its type is
`directory`, `file`, `symlink`, or `other`. Descendants are not encountered
unless traversal actually reaches them.

An **excluded entry** is one where traversal stopped for exactly one of these
reasons:

- `configured-pattern`: the first configured matcher accepted the normalized
  path. Only that matcher's zero-based index is retained;
- `scanner-directory`: the entry is a directory named `node_modules`, `dist`,
  `coverage`, `.next`, or `.git` and no earlier configured pattern stopped it;
- `symlink-not-followed`: the entry is a symlink. Targets are never followed or
  recorded.

An **unsupported file** is a non-excluded regular file whose extension is not
in the existing supported-extension set. Unsupported is a support decision,
not an exclusion.

A **candidate** is a supported, non-excluded regular file added to the existing
deduplicated candidate set. Candidate does not mean read, parsed, or analyzed.
Overlapping roots increment `encounterCount`; a repeated encounter is not an
exclusion.

`complete: true` means traversal reached its normal end without a fatal
metadata or directory-read failure. It does not mean complete repository
coverage, support for all repository content, or successful analysis.

## Fatal discovery operations

The first thrown `lstat` or directory-read error stops traversal immediately.
Later siblings and later requested roots are not visited. Facts recorded before
the failure remain available to the internal projection.

Legacy discovery rethrows the original error object and does not return partial
files. Instrumented discovery returns the partial result, sets `complete` to
false, and adds exactly one validated `ScanDiagnosticV2` with code
`DISCOVERY_LSTAT_FAILED` or `DISCOVERY_READ_DIRECTORY_FAILED`.

Diagnostics use fixed generic messages and do not contain raw errors, error
names, stacks, absolute paths, working directories, usernames, environment
values, filenames in messages, or file contents.

## Path safety and ordering

The collector deliberately keeps two relative-path representations. The
legacy traversal path applies `toPosixPath` to the native relative path and is
used for existing exclusion matching and directory behavior. This preserves
legacy semantics, including on POSIX when a filename contains a literal
backslash.

The canonical instrumentation path is derived from the raw native relative
path before legacy separator conversion. On Windows, native backslash
separators are converted to `/` before Contract v2 normalization. On POSIX,
`/` is the separator and a backslash is a literal filename character. Because
Contract v2 currently interprets backslashes as separators, any such POSIX
path is represented as `unrepresentable` instead of being rewritten into an
ambiguous canonical path. Root outcomes, entry outcomes, and diagnostic
locations all use this native-safe representation.

Canonical discovery paths use one of three representations:

- the root itself is `{ kind: "project-root" }`;
- a safely normalized path within the root is
  `{ kind: "repository-relative", path }`;
- a path rejected by Contract v2 normalization is
  `{ kind: "unrepresentable" }`.

An unrepresentable record never contains the rejected raw path. Private
absolute identities may be used while collecting to prevent unrelated
unrepresentable entries from collapsing, but those identities are not returned.
An unrepresentable canonical path does not remove a candidate from the legacy
file array.

Root outcomes retain request-index order. Canonical entries put the project
root first, then repository-relative paths in deterministic JavaScript
code-unit order, then unrepresentable entries in deterministic private-identity
order. Fatal diagnostics retain operation order.

The legacy file projection deliberately keeps its existing absolute paths and
`localeCompare` ordering. Canonical instrumentation ordering is never applied
to that projection.

## Serialization boundary

`InstrumentedDiscoveryResult.files` is legacy operational data containing
absolute filesystem paths. It is not canonical instrumentation and must not be
serialized into Report v2, JSON v2, SARIF, telemetry, or persisted baseline
data.

`InstrumentedDiscoveryResult.instrumentation` is the canonical sanitized
portion. Future ScanResult v2 integration must explicitly project or omit the
legacy `files` array rather than serializing the complete internal result.

## Deferred work

PR 4B1 does not record file reads, parsers, analysis engines, rule selection,
rule execution, findings, applicability, scoring, or enforcement.

PR 4B2 is planned to add internal rule-selection and execution facts and
per-attempt read outcomes while preserving legacy rule behavior. PR 4C may then
derive a truthful `CoverageV2` from facts the runtime actually records.
`CoverageV2`, `ScanResultV2`, and `ReportV2` do not exist in this implementation.
