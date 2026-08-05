from pathlib import Path


PATH = Path("docs/research/prototypes/c09-r3a-analyzer.mjs")
text = PATH.read_text(encoding="utf-8")

old_output = "  const output = [...text];"
new_output = '  const output = text.split("");'
if text.count(old_output) != 1:
    raise SystemExit(
        f"UTF-16 code-unit preserving mask: expected one match, got {text.count(old_output)}"
    )
text = text.replace(old_output, new_output, 1)

authorization_return = (
    '    return { sinkClass: "authorization", reason: "decision" };'
)
if text.count(authorization_return) != 1:
    raise SystemExit(
        f"authorization return: expected one match, got {text.count(authorization_return)}"
    )
authorization_return_index = text.index(authorization_return)
authorization_start = text.rfind("  if (", 0, authorization_return_index)
if authorization_start < 0:
    raise SystemExit("authorization block start not found")

zero_check = r'''  if (
    new RegExp(
      `\breturn\s+(?:${dependent}\s*==\s*0|0\s*==\s*${dependent})\s*;`
    ).test(text)
  ) {
    return { sinkClass: "safe-observation", reason: "zero-check" };
  }

'''
text = text[:authorization_start] + zero_check + text[authorization_start:]
PATH.write_text(text, encoding="utf-8")
