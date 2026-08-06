from pathlib import Path


def replace_once(path: str, old: str, new: str, label: str) -> None:
    target = Path(path)
    text = target.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected 1 match, got {count}")
    target.write_text(text.replace(old, new, 1), encoding="utf-8")


c09d = "docs/research/C09-D.md"
replace_once(
    c09d,
    """When wallet and bridge presets are both selected:

- the source project is parsed once per scan;
- the Foundry association is evaluated once per scan;
- one private record is routed to exactly one shell;
- no duplicate Finding is emitted;
- deterministic file, offset, record, rule, and finding order is preserved.
""",
    """When wallet and bridge presets are both selected:

- the source project is parsed once per scan;
- the Foundry association is evaluated once per scan;
- one private record is routed to exactly one shell;
- no duplicate Finding is emitted;
- deterministic file, offset, record, rule, and finding order is preserved.

A private record emits only when its exact owner shell rule is selected. The
other shell never borrows the record. Wallet-only, bridge-only, both-presets,
and owner-shell-not-selected behavior must be pinned explicitly. Both presets
still produce exactly one finding for one eligible record; ambiguous shell
ownership remains silent.
""",
    "C09-D selected-shell contract",
)
replace_once(
    c09d,
    """The Foundry adapter reads retained JSON artifacts only; it does not execute
`forge`.
""",
    """The Foundry adapter reads retained JSON artifacts only; it does not execute
`forge`.

Foundry v1.7.1 is the reviewed research and schema baseline. A retained broadcast
artifact does not prove which Foundry version produced it. Production validates
the exact supported structure and must not claim producer-version provenance.
""",
    "C09-D Foundry version boundary",
)

c09a = "docs/exec-plans/active/C09A.md"
replace_once(
    c09a,
    "Ambiguous shell ownership fails closed and emits no public finding.\n",
    """Ambiguous shell ownership fails closed and emits no public finding.

A record emits only through its exact owner shell when that shell rule is
selected. The other shell never borrows it. E2 must pin wallet-only, bridge-only,
both-presets, neither-owner, and ambiguous-owner behavior. When both shells are
selected, one eligible private record still becomes exactly one public finding.
""",
    "C09A selected-shell contract",
)
replace_once(
    c09a,
    """The Foundry adapter reads retained JSON artifacts only; it does not execute
`forge`.
""",
    """The Foundry adapter reads retained JSON artifacts only; it does not execute
`forge`. Foundry v1.7.1 is the reviewed schema baseline only; runtime validates
structure and does not claim which Foundry version produced an artifact.
""",
    "C09A Foundry version boundary",
)
replace_once(
    c09a,
    """- bridge and wallet shell-routing corpus;
- repeated analyzer request in one scan returns the same cached records;
""",
    """- bridge and wallet shell-routing corpus;
- wallet-only, bridge-only, both-presets, owner-not-selected, and ambiguous-owner
  behavior;
- repeated analyzer request in one scan returns the same cached records;
""",
    "C09A shell tests",
)

c09 = "docs/exec-plans/active/C09.md"
replace_once(
    c09,
    "Status: Research / Replace",
    "Status: Decision selected; implementation pending",
    "C09 status",
)
replace_once(
    c09,
    """Planning branch: `docs/c09-prevrandao-replacement-plan`

Last reviewed: 2026-08-05
""",
    """Planning branch: `docs/c09-prevrandao-replacement-plan`

Decision record: `docs/research/C09-D.md`

Implementation plan: `docs/exec-plans/active/C09A.md`

Research evidence:

- C09-R1: parser and ownership audit
- C09-R2: 52-case source and project corpus
- C09-R3-A: bounded Solidity value-flow prototype
- C09-R3-B: bounded Foundry deployment-association prototype

Selected disposition: Build one private analyzer with two temporary public
compatibility shells. Production remains blocked until C09-D and C09A are merged
and independently reviewed.

Last reviewed: 2026-08-06
""",
    "C09 decision metadata",
)

roadmap = "docs/roadmap.md"
replace_once(
    roadmap,
    """### C09 — Replace: shared Solidity `PREVRANDAO` value dependency

Replace duplicate wallet and bridge keyword rules with one evidence-backed rule.
Do not preserve unsupported blanket `mixHash` equivalence.
""",
    """### C09 — Build selected: bounded PREVRANDAO dependency analyzer

C09-R1 through R3-B are complete. The reviewed research established bounded
Solidity source/value feasibility and one exact Foundry contract-to-Arc
association family.

C09-D selects Build: one private analyzer with two temporary public compatibility
shells. Both old keyword detectors must be removed. A critical finding requires
both a supported same-function behavior dependency and exact Foundry Arc
deployment ownership for the same concrete contract.

C09A is the next implementation milestone. It must retain the two public IDs,
prevent duplicate findings, add no `solidity` preset or category, preserve
inventory `19 / 16 / 7 / 4`, and keep the rules non-canonical. Production remains
blocked until the decision and implementation plan are approved and merged.
""",
    "roadmap C09 section",
)
replace_once(
    roadmap,
    """1. Begin C09 as the next separately planned milestone: replace duplicate
   PREVRANDAO keyword rules with one evidence-backed shared rule.
2. Continue C10 after C09 unless new user evidence changes priority.
""",
    """1. Review and implement C09A as a bounded analyzer and compatibility-shell
   migration.
2. Continue C10 after C09A closeout unless new user evidence changes priority.
""",
    "roadmap next steps",
)

backlog = "docs/rule-development-backlog.md"
replace_once(
    backlog,
    """### `wallet/PREVRANDAO_NOT_SUPPORTED`

- Decision: Replace.
- Priority: P1.
- Impact: Required change.
- Replace with one shared Solidity value-dependency rule.
- Do not preserve blanket `mixHash` equivalence.
""",
    """### `wallet/PREVRANDAO_NOT_SUPPORTED`

- Decision: Build selected; C09A implementation pending.
- Priority: P1.
- Impact: Required change.
- Retain as a temporary compatibility shell over one shared private analyzer.
- Emit only exact owned non-bridge records when this shell is selected.
- Remove the current keyword detector and all blanket `mixHash` equivalence.
- Preserve non-canonical status and inventory during the compatibility period.
""",
    "wallet backlog C09",
)
replace_once(
    backlog,
    """### `bridge/NO_PREVRANDAO_RELAY_SELECTION`

- Decision: Replace.
- Priority: P1.
- Impact: Required change.
- Merge into the shared Solidity value-dependency rule.
""",
    """### `bridge/NO_PREVRANDAO_RELAY_SELECTION`

- Decision: Build selected; C09A implementation pending.
- Priority: P1.
- Impact: Required change.
- Retain as a temporary relay/validator/sequencer compatibility shell over the
  shared private analyzer.
- Emit only exact owned bridge-relay records when this shell is selected.
- Remove the current keyword detector and prevent cross-shell duplication.
- Preserve non-canonical status and inventory during the compatibility period.
""",
    "bridge backlog C09",
)
replace_once(
    backlog,
    """C09    Next: replace duplicate PREVRANDAO keyword rules
C10    Then: add versioned App Kit compatibility analysis
""",
    """C09-D  Complete: bounded Build disposition selected
C09A   Next: implement private analyzer and compatibility shells
C10    Then: add versioned App Kit compatibility analysis
""",
    "backlog sequence",
)
replace_once(
    backlog,
    """C08A governance cleanup is complete. C09 is the next approved sequencing target.
Other Advice-only expansion should not interrupt this sequence without real user
evidence.
""",
    """C09 research and decision are complete. C09A is the next approved sequencing
target. Production remains blocked until the decision and implementation plan
merge. Other analyzer expansion should not interrupt this sequence without real
user evidence.
""",
    "backlog sequence note",
)
