from pathlib import Path

# Normalize the one C09A anchor before applying the main exact-string patch.
path = Path(".github/scripts/c09-d-review-fix.py")
text = path.read_text(encoding="utf-8")
marker = 'c09a = "docs/exec-plans/active/C09A.md"'
start = text.index(marker)
prefix = text[:start]
tail = text[start:]
old = '''    """The Foundry adapter reads retained JSON artifacts only; it does not execute
`forge`.
""",
    """The Foundry adapter reads retained JSON artifacts only; it does not execute
`forge`. Foundry v1.7.1 is the reviewed schema baseline only; runtime validates
structure and does not claim which Foundry version produced an artifact.
""",
'''
new = '''    "C09A does not execute `forge` and does not query RPC or explorers.\\n",
    """C09A does not execute `forge` and does not query RPC or explorers.
Foundry v1.7.1 is the reviewed schema baseline only; runtime validates structure
and does not claim which Foundry version produced an artifact.
""",
'''
if tail.count(old) != 1:
    raise SystemExit(f"C09A anchor-fix expected 1 match, got {tail.count(old)}")
path.write_text(prefix + tail.replace(old, new, 1), encoding="utf-8")
