from pathlib import Path

path = Path("docs/research/fixtures/c09-r3a-prototype.mjs")
text = path.read_text(encoding="utf-8")
old = '''function identifierNames(node) {
  return descendants(node, (candidate) => candidate.type === "Identifier").map(
    (candidate) => candidate.name
  );
}

'''
if text.count(old) != 1:
    raise SystemExit(f"identifierNames helper count: {text.count(old)}")
path.write_text(text.replace(old, "", 1), encoding="utf-8")
