from pathlib import Path


PATH = Path("docs/exec-plans/active/C09.md")


def replace_once(old: str, new: str, label: str) -> None:
    text = PATH.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected 1 match, got {count}")
    PATH.write_text(text.replace(old, new, 1), encoding="utf-8")


replace_once(
    "- direct or one immutable same-function local binding;",
    "- direct or one single-assignment same-function local binding;",
    "local binding terminology",
)

replace_once(
    """Supporting `block.difficulty` without proven compiler/EVM-target context is not
approved. Supporting inline assembly does not authorize general Yul analysis.

## 7. Candidate reportable dependencies
""",
    """Supporting `block.difficulty` without proven compiler/EVM-target context is not
approved. Supporting inline assembly does not authorize general Yul analysis.

### Parser and dependency feasibility

The package currently depends on TypeScript and does not include a Solidity
parser. C09 must not assume that the TypeScript compiler can parse Solidity or
prove contract/function ownership.

C09-R1 must compare bounded parser inputs:

- a maintained Solidity parser dependency;
- compiler-produced standard JSON AST supplied as research input;
- a deliberately narrow custom tokenizer/parser for only the approved grammar.

The comparison must record:

- supported Solidity and Yul versions;
- malformed-source and recovery behavior;
- source offsets and deterministic AST ownership;
- licensing, maintenance, package size, and supply-chain risk;
- test-only versus production dependency cost;
- whether generated or compiler AST input would change the user workflow;
- fail-closed behavior for unsupported syntax.

A research prototype may use a temporary test-only parser dependency or retained
AST fixture. No production dependency or compiler requirement is authorized
before C09-D selects an implementation architecture.

## 7. Candidate reportable dependencies
""",
    "parser feasibility section",
)

replace_once(
    """The first prototype may use a deliberately narrow same-file or exact adjacent
configuration contract. Wider project association requires a separate reviewed
capability.
""",
    """A `.sol`-only parser cannot prove that the contract is deployed to Arc merely
because another repository file mentions Arc.

C09-R3 must therefore separate ownership feasibility:

### C09-R3-A — source and value-dependency feasibility

- evaluate Solidity source ownership, function ownership, bounded local flow, and
  supported sinks using explicit synthetic ownership input in the research
  harness;
- do not treat that harness input as proof that production repository ownership
  exists;
- determine whether the parser can classify source/value behavior independently
  of deployment association.

### C09-R3-B — deployment-association feasibility

- separately test one bounded association between a Solidity contract and an
  exact Arc deployment configuration;
- define the accepted file types, directory relationship, contract/deployment
  identifier ownership, ambiguity rules, and deterministic ordering;
- fail closed for imported, computed, multichain, duplicate, or conflicting
  deployment configuration;
- treat meaningful production emission as blocked when no reviewed association
  can prove that the analyzed contract targets Arc.

The first production implementation must not silently convert synthetic R3-A
ownership into repository evidence. Wider project association requires a
separate reviewed capability.
""",
    "ownership feasibility split",
)

replace_once(
    """- pin current Arc and Solidity semantics;
- inventory both public IDs, exports, presets, catalog metadata, tests, fixtures,
  reporters, and default finding-count impact;
- document public preset/category constraints;
- remove blanket `mixHash` equivalence from the proposed premise;
- define the minimum Arc ownership and value-dependency evidence.
""",
    """- pin current Arc and Solidity semantics;
- inventory both public IDs, exports, presets, catalog metadata, tests, fixtures,
  reporters, and default finding-count impact;
- document public preset/category constraints;
- inventory Solidity parser, compiler-AST, and narrow-tokenizer options;
- record parser version coverage, malformed-source behavior, licensing,
  maintenance, supply-chain, and production-dependency cost;
- remove blanket `mixHash` equivalence from the proposed premise;
- define the minimum Arc ownership and value-dependency evidence.
""",
    "R1 parser inventory",
)

replace_once(
    """### C09-R3 — private disposable feasibility prototype

- parse Solidity without changing public rule behavior;
- prove exact source ownership, bounded local flow, and supported direct sinks;
- evaluate direct `block.prevrandao` first;
- evaluate inline assembly and `block.difficulty` only as separate bounded
  families;
- run the complete corpus and first-party pressure shapes;
- discard the prototype if it requires a general Solidity data-flow platform.
""",
    """### C09-R3 — private disposable feasibility prototype

#### R3-A — parser, source, and dependency experiment

- use only the reviewed research parser input selected by R1;
- parse Solidity without changing public rule behavior;
- use explicit synthetic Arc ownership input only to isolate parser and
  value-dependency feasibility;
- prove exact contract/function source ownership, bounded local flow, and
  supported direct sinks;
- evaluate direct `block.prevrandao` first;
- evaluate inline assembly and `block.difficulty` only as separate bounded
  families;
- run the complete corpus and source-level pressure shapes.

#### R3-B — bounded Arc deployment association

- test one explicit association between the analyzed contract and an exact Arc
  deployment configuration;
- keep file types, directory relation, identifiers, ambiguity, and conflict
  handling bounded and deterministic;
- run deployment-association false-positive and false-negative pressure cases;
- report production public-emission eligibility as blocked when the association
  cannot be proven.

Discard the prototype if either experiment requires a general Solidity data-flow
platform, unrestricted cross-file analysis, or an unreviewed production parser
dependency.
""",
    "R3 split",
)

replace_once(
    """- keep research artifacts private or under `docs/research` and test-only scope;
- do not change either production rule during R1 through R3;
""",
    """- keep research artifacts private or under `docs/research` and test-only scope;
- do not add a production Solidity parser dependency before C09-D;
- do not change either production rule during R1 through R3;
""",
    "risk control parser dependency",
)

replace_once(
    """- the Arc ownership boundary is explicit;
- reportable value-dependency and sink families are explicit;
""",
    """- the Arc ownership boundary separates synthetic source experiments from
  production deployment association;
- parser and dependency feasibility is explicitly gated;
- reportable value-dependency and sink families are explicit;
""",
    "exit criteria gates",
)
