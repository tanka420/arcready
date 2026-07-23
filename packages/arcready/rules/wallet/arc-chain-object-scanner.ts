export type Span = readonly [number, number];
export type Fields = ReadonlyMap<string, Span>;

export interface ArcChainObjectCandidate {
  readonly source: string;
  readonly masked: string;
  readonly fields: Fields;
  readonly span: Span;
  readonly owner: string;
  readonly id: bigint | "missing";
}

const FAMILY =
  /^(?:id|chainId|name|chainName|nativeCurrency|rpcUrls|wsUrls|blockExplorers|blockExplorerUrls)$/;
const TERMINAL =
  /^\s*(?:as\s+const\b\s*)?(?:satisfies\s+[A-Za-z_$][\w$]*(?:\s*\.\s*[A-Za-z_$][\w$]*)*(?:\s*<\s*[A-Za-z_$][\w$]*(?:\s*\.\s*[A-Za-z_$][\w$]*)*\s*>)?\s*)?(;|$)/;
const CONTINUATION =
  /^(?:\?\.|&&|\|\||\?\?|as\b|satisfies\b|in\b|instanceof\b|[.(*%+!`?:,=<>&|^-]|[[]|[/])/;

export function supportsArcChainObjectPath(filePath: string): boolean {
  const path = filePath.replaceAll("\\", "/");
  const name = path.split("/").at(-1) ?? "";
  return (
    /\.[jt]s$/i.test(name) &&
    !/\.(?:test|spec)\.[jt]s$/i.test(name) &&
    !/(?:^|\/)(?:test|tests|__tests__)(?:\/|$)/i.test(path)
  );
}

export function inspectArcChainObjects<T>(
  source: string,
  inspectCandidate: (candidate: ArcChainObjectCandidate) => T | undefined
): T | undefined {
  const masked = mask(source);
  if (masked === undefined) return undefined;
  const declaration =
    /(?:^|[\r\n])\s*(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:(defineChain)\s*\(\s*)?\{/g;
  for (const match of masked.matchAll(declaration)) {
    const start = (match.index ?? 0) + match[0].lastIndexOf("{");
    const end = closeAt(masked, start, "{", "}");
    if (end < 0 || !balanced(masked, start, end)) continue;
    if (masked.slice(start, end + 1).includes("/")) continue;
    let suffixAt = end + 1;
    if (match[2]) {
      const callClose = /^\s*\)/.exec(masked.slice(suffixAt));
      if (callClose === null) continue;
      suffixAt += callClose[0].length;
    }
    if (!terminal(masked, suffixAt)) continue;
    const rootSpan: Span = [start, end + 1];
    const root = fieldsAt(masked, rootSpan);
    if (root === undefined || masked.slice(start, end).includes("..."))
      continue;
    const direct = candidate(source, masked, root, rootSpan, match[1]);
    if (direct !== undefined) {
      const result = inspectCandidate(direct);
      if (result !== undefined) return result;
    }
    const children = [...root].filter(([key]) => arcSegment(key));
    if (children.length !== 1 || masked[children[0][1][0]] !== "{") continue;
    const [childOwner, childSpan] = children[0];
    const child = fieldsAt(masked, childSpan);
    if (child === undefined) continue;
    const nested = candidate(source, masked, child, childSpan, childOwner);
    if (nested === undefined) continue;
    const result = inspectCandidate(nested);
    if (result !== undefined) return result;
  }
  return undefined;
}

function candidate(
  source: string,
  masked: string,
  fields: Fields,
  span: Span,
  owner: string
): ArcChainObjectCandidate | undefined {
  if (masked.slice(...span).includes("/")) return undefined;
  const families = new Set(
    [...fields.keys()].filter((key) => FAMILY.test(key)).map(family)
  );
  if (families.size < 2) return undefined;
  const named = ["name", "chainName"].some((key) => {
    const field = fields.get(key);
    return (
      field !== undefined &&
      stringValue(source.slice(...field)) === "Arc Testnet"
    );
  });
  const strong = arcSegment(owner) || named;
  const id = idValue(source, fields);
  if (id === "ambiguous") return undefined;
  if (!strong && id !== 5042002n) return undefined;
  return { source, masked, fields, span, owner, id };
}

function idValue(
  source: string,
  fields: Fields
): bigint | "missing" | "ambiguous" {
  const spans = [fields.get("id"), fields.get("chainId")].filter(
    (span): span is Span => span !== undefined
  );
  if (spans.length === 0) return "missing";
  const values = spans.map((span) => {
    const text = source.slice(...span).trim();
    const value = stringValue(text) ?? text;
    if (!/^(?:\d+|0x[\da-f]+)$/i.test(value)) return undefined;
    if (/^0x4cf4b2$/i.test(value)) return 5042002n;
    try {
      return BigInt(value);
    } catch {
      return undefined;
    }
  });
  if (
    values.some((value) => value === undefined) ||
    (values.length === 2 && values[0] !== values[1])
  )
    return "ambiguous";
  return values[0] as bigint;
}

export function fieldsAt(masked: string, span: Span): Fields | undefined {
  const endAt = closeAt(masked, span[0], "{", "}");
  if (masked[span[0]] !== "{" || endAt !== span[1] - 1) return undefined;
  const fields = new Map<string, Span>();
  for (const member of members(masked, span[0], span[1] - 1)) {
    const part = masked.slice(...member);
    if (part.trim() === "") continue;
    const property = /^\s*([A-Za-z_$][\w$]*)\s*:/.exec(part);
    if (property === null || fields.has(property[1])) return undefined;
    const colon = part.indexOf(":", property[0].length - 1);
    const start =
      member[0] +
      colon +
      1 +
      (part.slice(colon + 1).match(/^\s*/)?.[0].length ?? 0);
    const end = member[1] - (part.match(/\s*$/)?.[0].length ?? 0);
    if (start >= end) return undefined;
    fields.set(property[1], [start, end]);
  }
  return fields;
}

export function arrayValues(
  source: string,
  masked: string,
  span: Span
): string[] | undefined {
  const endAt = closeAt(masked, span[0], "[", "]");
  if (masked[span[0]] !== "[" || endAt !== span[1] - 1) return undefined;
  const result: string[] = [];
  for (const item of members(masked, span[0], span[1] - 1)) {
    if (masked.slice(...item).trim() === "") continue;
    const value = stringValue(source.slice(...item));
    if (value === undefined) return undefined;
    result.push(value);
  }
  return result;
}

export function stringValue(source: string): string | undefined {
  const match = /^\s*"([^"\\\r\n]*)"\s*$|^\s*'([^'\\\r\n]*)'\s*$/.exec(source);
  return match?.[1] ?? match?.[2];
}

function terminal(source: string, start: number): boolean {
  const remainder = source.slice(start);
  const lineBreak = remainder.search(/[\r\n]/);
  const line = lineBreak < 0 ? remainder : remainder.slice(0, lineBreak);
  const match = TERMINAL.exec(line);
  if (match === null) return false;
  if (match[1] === ";") return true;
  const next = lineBreak < 0 ? "" : remainder.slice(lineBreak).trimStart();
  return next === "" || !CONTINUATION.test(next);
}

function balanced(source: string, start: number, end: number): boolean {
  const stack: string[] = [];
  for (let index = start; index <= end; index++) {
    const char = source[index];
    if (char === "{" || char === "[" || char === "(") stack.push(char);
    else if (char === "}" && stack.pop() !== "{") return false;
    else if (char === "]" && stack.pop() !== "[") return false;
    else if (char === ")" && stack.pop() !== "(") return false;
  }
  return stack.length === 0;
}

function members(source: string, start: number, end: number): Span[] {
  const result: Span[] = [];
  let from = start + 1;
  let braces = 0;
  let brackets = 0;
  let parentheses = 0;
  for (let index = from; index < end; index++) {
    const char = source[index];
    if (char === "{") braces++;
    else if (char === "}") braces--;
    else if (char === "[") brackets++;
    else if (char === "]") brackets--;
    else if (char === "(") parentheses++;
    else if (char === ")") parentheses--;
    else if (
      char === "," &&
      braces === 0 &&
      brackets === 0 &&
      parentheses === 0
    ) {
      result.push([from, index]);
      from = index + 1;
    }
  }
  result.push([from, end]);
  return result;
}

function closeAt(
  source: string,
  start: number,
  open: string,
  close: string
): number {
  let depth = 0;
  for (let index = start; index < source.length; index++) {
    if (source[index] === open) depth++;
    if (source[index] === close && --depth === 0) return index;
  }
  return -1;
}

function family(key: string): string {
  if (key === "id" || key === "chainId") return "id";
  if (key === "name" || key === "chainName") return "name";
  if (key === "rpcUrls" || key === "wsUrls") return "rpc";
  if (key === "blockExplorers" || key === "blockExplorerUrls")
    return "explorer";
  return key;
}

function arcSegment(identifier: string): boolean {
  return identifier
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(/[_$\s]+/)
    .some((segment) => segment.toLowerCase() === "arc");
}

function mask(source: string): string | undefined {
  let malformed = false;
  const masked = source.replace(
    /"(?:\\[\s\S]|[^"\\])*(?:"|$)|'(?:\\[\s\S]|[^'\\])*(?:'|$)|`(?:\\[\s\S]|[^`\\])*(?:`|$)|\/\/[^\r\n]*|\/\*[\s\S]*?(?:\*\/|$)/g,
    (token) => {
      const quote = token[0];
      const quoted = quote === '"' || quote === "'" || quote === "`";
      const terminated = quoted ? token.at(-1) === quote : token.endsWith("*/");
      if ((quoted || token.startsWith("/*")) && !terminated) malformed = true;
      const preserve = terminated && quoted;
      return token.replace(/[^\r\n]/g, (char, index) =>
        preserve && (index === 0 || index === token.length - 1) ? char : " "
      );
    }
  );
  return malformed ? undefined : masked;
}
