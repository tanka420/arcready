from pathlib import Path


PATH = Path("docs/research/prototypes/c09-r3a-analyzer.mjs")


def replace_once(old: str, new: str, label: str) -> None:
    text = PATH.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected one match, got {count}")
    PATH.write_text(text.replace(old, new, 1), encoding="utf-8")


replace_once(
    '''function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&");
}
''',
    '''function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&");
}

function maskNonCode(text) {
  const output = [...text];
  let state = "code";

  for (let index = 0; index < text.length; index += 1) {
    const current = text[index];
    const next = text[index + 1];

    if (state === "line-comment") {
      if (current === "\\n" || current === "\\r") state = "code";
      else output[index] = " ";
      continue;
    }

    if (state === "block-comment") {
      if (current === "*" && next === "/") {
        output[index] = " ";
        output[index + 1] = " ";
        index += 1;
        state = "code";
      } else if (current !== "\\n" && current !== "\\r") {
        output[index] = " ";
      }
      continue;
    }

    if (state === "single-string" || state === "double-string") {
      const quote = state === "single-string" ? "'" : '"';
      if (current === "\\\\") {
        output[index] = " ";
        if (index + 1 < text.length) {
          output[index + 1] = " ";
          index += 1;
        }
      } else {
        if (current === quote) state = "code";
        if (current !== "\\n" && current !== "\\r") output[index] = " ";
      }
      continue;
    }

    if (current === "/" && next === "/") {
      output[index] = " ";
      output[index + 1] = " ";
      index += 1;
      state = "line-comment";
    } else if (current === "/" && next === "*") {
      output[index] = " ";
      output[index + 1] = " ";
      index += 1;
      state = "block-comment";
    } else if (current === "'") {
      output[index] = " ";
      state = "single-string";
    } else if (current === '"') {
      output[index] = " ";
      state = "double-string";
    }
  }

  return output.join("");
}
''',
    "lexical masking helper",
)

replace_once(
    '''    records.push({
      node,
      contract: nearest(ancestors, "ContractDefinition"),
      text: sliceNode(source, node)
    });''',
    '''    const text = sliceNode(source, node);
    records.push({
      node,
      contract: nearest(ancestors, "ContractDefinition"),
      text,
      code: maskNonCode(text)
    });''',
    "masked function record",
)

replace_once(
    '''export function analyzeC09Source(parser, source, metadata = {}) {
  const unsupportedFutureSyntax = /pragma\\s+solidity\\s+[^;]*\\b0\\.9\\./.test(
    source
  );''',
    '''export function analyzeC09Source(parser, source, metadata = {}) {
  const sourceCode = maskNonCode(source);
  const unsupportedFutureSyntax = /pragma\\s+solidity\\s+[^;]*\\b0\\.9\\./.test(
    sourceCode
  );''',
    "masked source pragma",
)

text = PATH.read_text(encoding="utf-8")
record_text_count = text.count("record.text")
if record_text_count < 8:
    raise SystemExit(
        f"expected at least eight record.text analysis uses, got {record_text_count}"
    )
PATH.write_text(text.replace("record.text", "record.code"), encoding="utf-8")
