from pathlib import Path


def replace_once(path: str, old: str, new: str, label: str) -> None:
    target = Path(path)
    text = target.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected 1 match, got {count}")
    target.write_text(text.replace(old, new, 1), encoding="utf-8")


def replace_all_required(path: str, old: str, new: str, label: str) -> None:
    target = Path(path)
    text = target.read_text(encoding="utf-8")
    count = text.count(old)
    if count == 0:
        raise SystemExit(f"{label}: expected at least 1 match")
    target.write_text(text.replace(old, new), encoding="utf-8")


def replace_between(
    path: str, start: str, end: str, replacement: str, label: str
) -> None:
    target = Path(path)
    text = target.read_text(encoding="utf-8")
    start_count = text.count(start)
    end_count = text.count(end)
    if start_count != 1 or end_count != 1:
        raise SystemExit(f"{label}: start={start_count} end={end_count}")
    start_index = text.index(start)
    end_index = text.index(end, start_index + len(start))
    target.write_text(
        text[:start_index] + replacement + text[end_index:], encoding="utf-8"
    )


c08 = "docs/exec-plans/completed/C08.md"
replace_once(
    c08,
    "Status: Decision selected; migration pending",
    "Status: Complete",
    "C08 status",
)
replace_all_required(
    c08,
    "docs/exec-plans/active/C08A.md",
    "docs/exec-plans/completed/C08A.md",
    "C08 implementation-plan path",
)
replace_all_required(
    c08,
    "docs/exec-plans/active/C08.md",
    "docs/exec-plans/completed/C08.md",
    "C08 self path",
)
replace_once(
    c08,
    "Last reviewed: 2026-08-05\n",
    """Last reviewed: 2026-08-05

Implementation evidence:

- C08A-E1: PR #53, merge `6cb5cd59b5bfa477c07f91470b579e16b5e052ad`
- C08A-E2: PR #54, merge `e4f0ccbdd04b7da91def8ed6834aa91fb32236ac`
- C08A-E3: PR #55, docs/governance closeout
- Independent review: `APPROVE` with 0 blocker / 0 major / 0 minor for E1 and E2
""",
    "C08 implementation evidence",
)
replace_once(
    c08,
    """The remaining C08 exit is implementation and closeout under C08A:

- default bridge execution excludes the rule;
- explicit non-off configuration selects only this known default-excluded rule;
- public ID compatibility is retained for one deprecation period;
- rule and catalog policy become deprecated advice;
- inventory, fixtures, reports, scoring, and CLI changes are verified;
- a later Retire review trigger is recorded.

C08 remains active until that migration is merged and independently reviewed.
""",
    """C08 and C08A are complete.

The reviewed migration now guarantees:

- default bridge execution excludes the rule;
- explicit `info`, `warning`, and `critical` configuration selects only the known
  default-excluded rule exactly once;
- missing, `off`, and unknown configuration remains non-selecting;
- public ID compatibility is retained for one deprecation period;
- rule and catalog policy are deprecated Advice-only guidance;
- inventory is 19 known / 16 default / 7 wallet / 4 canonical;
- fixture, report, scoring, `failOn`, CLI, schema, reporter, and FindingV2
  regressions were covered by the full repository gate;
- the R3 prototype remains research-only and is not imported into production.

Retire review trigger: revisit the public rule ID after one compatibility period
or earlier if usage evidence shows that the optional heuristic provides no
material value.
""",
    "C08 final closeout",
)

c08a = "docs/exec-plans/completed/C08A.md"
replace_once(c08a, "Status: Planned", "Status: Complete", "C08A status")
replace_all_required(
    c08a,
    "docs/exec-plans/active/C08A.md",
    "docs/exec-plans/completed/C08A.md",
    "C08A self path",
)
replace_all_required(
    c08a,
    "docs/exec-plans/active/C08.md",
    "docs/exec-plans/completed/C08.md",
    "C08 parent path",
)
replace_once(
    c08a,
    "Planning branch: `docs/c08-d-advice-only-decision`\n\nLast reviewed: 2026-08-05",
    """Planning branch: `docs/c08-d-advice-only-decision`

Implementation branches:

- E1: `feature/c08a-e1-explicit-advice-selection`
- E2: `feature/c08a-e2-advisory-policy`
- E3: `docs/c08a-e3-closeout`

Merged implementation:

- E1 PR #53: `6cb5cd59b5bfa477c07f91470b579e16b5e052ad`
- E2 PR #54: `e4f0ccbdd04b7da91def8ed6834aa91fb32236ac`
- E3 PR #55: docs/governance closeout

Last reviewed: 2026-08-05""",
    "C08A implementation metadata",
)
replace_once(
    c08a,
    "## 15. Conclusion\n",
    """## 15. Completion record

C08A completed the approved Advice-only migration in three independently bounded
phases.

### E1 result

PR #53 preserved the public all-known inventory while separating the private
default bridge subset. The default scan excludes the attestation heuristic, and
only explicit `info`, `warning`, or `critical` configuration selects the known
excluded rule. Missing, `off`, and unknown IDs remain non-selecting. Custom
registries remain isolated.

### E2 result

PR #54 changed the direct/default severity to `info`, replaced unconditional
retry wording with conditional remediation, and aligned runtime taxonomy, runtime
catalog, documentation catalog, and tests. The detector implementation itself
was not widened.

### E3 verification

The completed contract is:

```text
19 known / 16 default / 7 wallet / 4 canonical
```

Default fixture and DX01 finding-count changes are intentional and were pinned by
E1. E2 passed focused policy tests and the full repository gate. CI, Repository
Verification, ArcReady Action Smoke, and ArcReady Example passed on the final E2
head before merge.

E1 and E2 each received independent `APPROVE` reviews with zero blocker, major,
and minor findings. E3 changes governance documentation only and re-runs full
repository verification before closeout merge.

The public ID remains available for one compatibility period. Retire review is
triggered after that period or earlier if real usage provides no justification
for retaining the optional heuristic.

## 16. Conclusion
""",
    "C08A completion section",
)

roadmap = "docs/roadmap.md"
replace_once(
    roadmap,
    "**Status:** Active roadmap after C08 Advice-only decision",
    "**Status:** Active roadmap after C08A Advice-only migration",
    "roadmap status",
)
replace_once(
    roadmap,
    "Inventory remains 19 known / 17 default / 7 wallet / 4 canonical.",
    "Inventory is 19 known / 16 default / 7 wallet / 4 canonical.",
    "roadmap current inventory",
)
replace_between(
    roadmap,
    "### C08 — Advice-only decision selected: CCTP attestation control flow\n",
    "### C09 — Replace: shared Solidity `PREVRANDAO` value dependency\n",
    """### C08 — Complete: CCTP attestation Advice-only migration

C08-R1 through R3 and C08-D established that the existing proximity heuristic
could not support a critical compatibility finding. C08A completed the reviewed
Advice-only disposition.

PR #53 separated the public all-known bridge inventory from the private default
bridge subset and added a narrow explicit opt-in path. PR #54 changed the rule's
default severity to `info`, made remediation conditional on burn/hash/domain
validation, and aligned runtime and documentation catalog policy as deprecated
advice.

The detector remains unchanged and low-confidence. It is not scheduled by
default, cannot affect normal default scoring or exits, and remains available
only through explicit non-off configuration during one compatibility period.

Inventory is now 19 known / 16 default / 7 wallet / 4 canonical. The R3
prototype remains research-only. Revisit Retire after one compatibility period
or earlier if usage evidence shows no material value.

### C09 — Replace: shared Solidity `PREVRANDAO` value dependency
""",
    "roadmap C08 section",
)
replace_once(
    roadmap,
    """1. Review and implement C08A as a bounded Advice-only migration.
2. Continue C09 and C10 in the existing sequence after C08A closeout.
3. Keep native write analysis blocked pending first-party premise clarification.
4. Continue gathering real unsupported-pattern and false-positive/negative
   evidence.
5. Reopen deferred C06B2 or C07C families only from concrete usage evidence or a
   separately approved milestone.
""",
    """1. Begin C09 as the next separately planned milestone: replace duplicate
   PREVRANDAO keyword rules with one evidence-backed shared rule.
2. Continue C10 after C09 unless new user evidence changes priority.
3. Keep native write analysis blocked pending first-party premise clarification.
4. Continue gathering real unsupported-pattern and false-positive/negative
   evidence.
5. Reopen deferred C06B2, C07C, or C08 families only from concrete usage
   evidence or a separately approved milestone.
""",
    "roadmap next steps",
)

backlog = "docs/rule-development-backlog.md"
replace_between(
    backlog,
    "### `bridge/ATTESTATION_404_NOT_FATAL`\n",
    "### `bridge/NO_PREVRANDAO_RELAY_SELECTION`\n",
    """### `bridge/ATTESTATION_404_NOT_FATAL`

- Decision: Complete as Advice-only migration.
- Priority: P3 during the compatibility/deprecation period.
- Impact: Recommendation.
- C08-R1 through R3, C08-D, and C08A are complete.
- PR #53 removed the rule from default bridge execution while preserving the
  public ID and added a narrow explicit opt-in path for known non-off levels.
- PR #54 changed direct/default severity to `info`, removed the unconditional
  retry claim, and aligned runtime/docs catalog policy as deprecated advice.
- Inventory is 19 known / 16 default / 7 wallet / 4 canonical.
- The detector remains a low-confidence proximity heuristic and is not eligible
  for canonical FindingV2 or default CI failure.
- Revisit Retire after one compatibility period or earlier if usage evidence
  shows no material value.

### `bridge/NO_PREVRANDAO_RELAY_SELECTION`
""",
    "backlog attestation section",
)
replace_once(
    backlog,
    """C08-D  Complete: Advice-only disposition selected
C08A   Next: default-exclude and deprecate the attestation heuristic
C09    Then: replace duplicate PREVRANDAO keyword rules
C10    Then: add versioned App Kit compatibility analysis
""",
    """C08-D  Complete: Advice-only disposition selected
C08A   Complete: default-excluded deprecated attestation advice
C09    Next: replace duplicate PREVRANDAO keyword rules
C10    Then: add versioned App Kit compatibility analysis
""",
    "backlog sequence",
)
replace_once(
    backlog,
    """C08A is current governance cleanup required by the reviewed C08 decision. Other
Advice-only expansion should not interrupt this sequence without real user
evidence.
""",
    """C08A governance cleanup is complete. C09 is the next approved sequencing target.
Other Advice-only expansion should not interrupt this sequence without real user
evidence.
""",
    "backlog current milestone",
)
