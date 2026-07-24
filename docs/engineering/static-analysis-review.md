# Static Analysis Review Checklist

Use this checklist for `R2` and `R3` analyzer work. Tailor it to the declared
surface; do not broaden a milestone merely to check every item.

The purpose is to expose missing semantic classes before release, not to claim
complete analysis of all JavaScript, TypeScript, Solidity, or runtime behavior.

## 1. Product and premise

- What concrete integration failure is being prevented?
- Is the premise supported by current first-party documentation or source?
- Is the rule a compatibility blocker, warning, advice-only check, replacement,
  research item, or retirement candidate?
- Does severity match the proven impact?
- Would a finding help a developer take a correct action?

## 2. Declared surface

- Exact file extensions and paths supported
- Test, declaration, ambient, generated, fixture, and documentation exclusions
- Supported libraries, versions, imports, APIs, and syntax forms
- Direct expressions and allowed binding depth
- Explicit non-goals
- Runtime behavior that static analysis cannot prove

Reject undocumented accidental support.

## 3. Parser and file boundaries

Consider:

- malformed syntax
- parse-valid but runtime-invalid code
- `.d.ts` and ambient declarations
- test and spec files
- JSX and TSX
- module versus script semantics
- namespaces and module declarations
- comments, strings, examples, and documentation prose

## 4. Lexical and binding boundaries

Consider:

- nearest visible declaration
- block, function, class, namespace, catch, loop, and module scope
- shadowing
- duplicate declarations
- use before declaration
- reassignment and increment/decrement writes
- destructuring
- named function or class expression self-bindings
- imports versus local lookalikes
- sibling function or sibling object leakage

## 5. Import and library identity

Verify:

- named imports
- aliased named imports
- namespace imports
- type-only imports
- default imports where relevant
- local shadowing of imported names
- lookalike functions from other packages
- version-specific API differences
- unsupported wrappers, adapters, and subclasses

A method name alone is not library identity.

## 6. Ownership and context

Define evidence states explicitly:

- proven Arc
- proven non-Arc
- unknown
- conflicting

Test:

- Arc chain plus Arc RPC
- Arc chain plus known non-Arc RPC
- non-Arc chain plus Arc-looking call-site override
- Arc client plus non-Arc override
- custom or injected provider without static network evidence
- imported clients or chains
- sibling Arc and Ethereum clients in one file
- same-named clients in different scopes
- reassigned owners

Critical findings require the relevant source, sink, or object to be owned by the
proven Arc context, not merely colocated in the same file.

## 7. Object-shape safety

For every critical evidence object, decide and test policy for:

- direct property assignment
- shorthand property
- quoted key
- computed key
- spread assignment
- duplicate key
- getter and setter
- method declaration
- missing property
- extra property
- nested object
- array and sparse array
- `Object.assign`
- conditional selection
- factory result
- one immutable binding
- imported or cross-file object

Do not accept a shape merely because `properties.length` or `elements.length`
looks correct. Reject omitted and spread elements where a concrete expression is
required.

## 8. Calls, sources, and sinks

Verify:

- exact receiver identity
- exact method or imported function identity
- optional chaining
- direct call versus method reference
- missing, extra, spread, omitted, or reordered arguments
- required `await` semantics when the source value depends on resolution
- valid await context
- submitted versus prepared, signed, populated, simulated, or documented calls
- one-hop binding limits
- call-site override conflicts
- source and sink must belong to the same proven flow

## 9. Value and unit semantics

When the rule models values:

- define source unit and target unit
- define exact safe conversions
- distinguish read-side and write-side flow
- reject unknown arithmetic
- handle literal formats and separators deliberately
- test commutative forms only when semantics allow
- do not infer runtime types from text alone
- prove that a conversion belongs to the same value flow

## 10. Control-flow semantics

When the rule models control flow:

- terminal versus retryable paths
- branch ownership
- thrown, returned, retried, and ignored outcomes
- typed error versus message text
- fallthrough
- loop and polling boundaries
- callback and async boundaries
- unreachable or declaration-only code

Do not promote a control-flow rule from keyword matching without proving the
relevant path relationship.

## 11. Finding contract

Confirm:

- rule ID, preset, severity, and docs slug
- one finding per file or per occurrence policy
- deterministic ordering
- stable and non-leaking fingerprint inputs
- accurate file and region location
- truthful confidence and capabilities
- remediation matches the detected issue
- no unsupported claim in message or documentation
- legacy, FindingV2, scoring, and exit behavior impact

## 12. Adversarial mutation families

Start from every positive example and mutate at least the relevant classes:

- remove required evidence
- replace Arc with a non-Arc value
- add conflicting evidence
- move evidence to a sibling scope
- shadow or reassign a binding
- import the owner or value
- add spread, computed, duplicate, shorthand, method, getter, or setter forms
- replace a concrete argument with missing, omitted, sparse, or spread syntax
- change the library while preserving method names
- prepare or sign without submitting
- place positive-looking text in comments, strings, or docs
- combine a valid Arc flow with an unrelated invalid non-Arc flow
- combine an invalid Arc flow with a valid non-Arc flow

Record why each case is positive, negative, or deliberately unsupported.

## 13. Regression and boundary proof

Check:

- prior dedicated tests remain unchanged unless the contract intentionally
  changes
- cross-preset behavior
- rule order and inventory counts
- canonical runtime and adapter selection
- public exports and schema
- package contents and size
- lazy dependency boundaries
- built CLI positive and negative cases
- deterministic repeated execution

## 14. Review outcome

A review should report:

- blockers
- non-blocking improvements
- unsupported but truthfully documented cases
- evidence inspected
- counterexamples executed
- residual risk
- approval or changes-required decision

Passing existing tests alone is not approval.

## 15. Escalation

When multiple findings share a semantic cause:

- update the contract and mutation family
- prefer one bounded shared primitive over repeated ad hoc checks
- redesign when the ownership or flow model cannot express the required proof
- do not keep extending prompts and local conditionals indefinitely

Continue until no known blocker remains in the declared scope.
