from pathlib import Path

path = Path("docs/research/fixtures/c09-r3a-prototype.mjs")
text = path.read_text(encoding="utf-8")
old = '''  if (expression?.type === "Identifier") return expression.name;
  if (expression?.type !== "ElementaryTypeNameExpression") return null;
  if (typeof expression.typeName === "string") return expression.typeName;
  return expression.typeName?.name ?? expression.typeName?.type ?? null;
'''
new = '''  if (
    expression?.type === "Identifier" ||
    expression?.type === "ElementaryTypeName"
  ) {
    return expression.name;
  }
  if (expression?.type !== "ElementaryTypeNameExpression") return null;
  if (typeof expression.typeName === "string") return expression.typeName;
  return expression.typeName?.name ?? expression.typeName?.type ?? null;
'''
if text.count(old) != 1:
    raise SystemExit(f"cast shape marker count: {text.count(old)}")
path.write_text(text.replace(old, new, 1), encoding="utf-8")
