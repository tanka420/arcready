from pathlib import Path


PATH = Path("docs/research/prototypes/c09-r3a-analyzer.mjs")


def replace_once(old: str, new: str, label: str) -> None:
    text = PATH.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected one match, got {count}")
    PATH.write_text(text.replace(old, new, 1), encoding="utf-8")


replace_once(
    '  const output = [...text];',
    '  const output = text.split("");',
    "UTF-16 code-unit preserving mask",
)

marker = '''  if (
    new RegExp(
      `\\breturn\\b[^;]*(?:${dependent}[^;]*(?:==|!=|<|>|<=|>=)|(?:==|!=|<|>|<=|>=)[^;]*${dependent})[^;]*;`
    ).test(text) ||
    new RegExp(`\\bif\\s*\\([^)]*${dependent}[^)]*\\)`).test(text)
  ) {
    return { sinkClass: "authorization", reason: "decision" };
  }
'''
replacement = '''  if (
    new RegExp(
      `\\breturn\\s+(?:${dependent}\\s*==\\s*0|0\\s*==\\s*${dependent})\\s*;`
    ).test(text)
  ) {
    return { sinkClass: "safe-observation", reason: "zero-check" };
  }

  if (
    new RegExp(
      `\\breturn\\b[^;]*(?:${dependent}[^;]*(?:==|!=|<|>|<=|>=)|(?:==|!=|<|>|<=|>=)[^;]*${dependent})[^;]*;`
    ).test(text) ||
    new RegExp(`\\bif\\s*\\([^)]*${dependent}[^)]*\\)`).test(text)
  ) {
    return { sinkClass: "authorization", reason: "decision" };
  }
'''
replace_once(marker, replacement, "zero compatibility return before authorization")
