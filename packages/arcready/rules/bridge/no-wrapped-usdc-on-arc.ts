import type { Rule } from "../../core/rules/index.js";
import {
  BRIDGE_DOCS,
  createBridgeFinding,
  isArcRelated,
  isBridgeRelated,
  readBridgeFiles
} from "./helpers.js";

const SUGGESTED_FIX =
  "Use canonical Arc USDC through the intended bridge route, and remove Arc-side USDC.e, wUSDC, or bridged-USDC asset mappings.";
const WRAPPED_USDC_LITERAL_PATTERN =
  /^(USDC\.e|wUSDC|wrapped USDC|bridged USDC)$/i;
const WRAPPED_USDC_TERM_PATTERN =
  /\b(USDC\.e|wUSDC|wrapped USDC|bridged USDC)\b/i;
const NEGATIVE_GUIDANCE_PATTERN =
  /\b(do not|don't|never|avoid|unsupported|not supported|should not|must not|instead of|rather than)\b/i;
const DOCUMENTATION_PREFIX_PATTERN = /^(?:#|>|[-*]\s)/;
const RELEVANT_FIELDS = new Set([
  "chain",
  "token",
  "asset",
  "sourceChain",
  "sourceToken",
  "destinationChain",
  "destinationToken"
]);
interface ObjectCandidate {
  readonly occurrences: Map<string, number>;
  readonly values: Map<string, string[]>;
  member: string[];
  parentheses: number;
  brackets: number;
  unsupported: boolean;
}
type LexicalState =
  | "code"
  | "single"
  | "double"
  | "template"
  | "line"
  | "block";

export const noWrappedUsdcOnArcRule: Rule = {
  id: "bridge/NO_WRAPPED_USDC_ON_ARC",
  name: "No wrapped USDC on Arc",
  description: "Detects wrapped USDC routes in Arc bridge configuration.",
  preset: "bridge",
  defaultSeverity: "critical",
  docs: [BRIDGE_DOCS.canonicalUsdc],
  async run(context) {
    const findings = [];

    for (const { filePath, content } of await readBridgeFiles(context)) {
      if (!isArcRelated(content) || !isBridgeRelated(content)) {
        continue;
      }

      if (hasWrappedUsdcRoute(content)) {
        findings.push(
          createBridgeFinding(
            noWrappedUsdcOnArcRule,
            filePath,
            "Arc bridge route appears to use wrapped or bridged USDC as the Arc asset.",
            SUGGESTED_FIX,
            BRIDGE_DOCS.canonicalUsdc
          )
        );
      }
    }

    return findings;
  }
};
function hasWrappedUsdcRoute(content: string): boolean {
  const candidates: ObjectCandidate[] = [];
  let state: LexicalState = "code";
  let escaped = false;
  let atLineStart = true;

  for (let index = 0; index < content.length; index += 1) {
    const character = content[index] ?? "";
    const next = content[index + 1] ?? "";
    const candidate = candidates.at(-1);

    if (character === "\n") {
      atLineStart = true;
    } else if (atLineStart && !isWhitespace(character)) {
      atLineStart = false;
      if (state === "code" && candidate === undefined) {
        const newline = content.indexOf("\n", index);
        const lineEnd = newline === -1 ? content.length : newline;
        if (shouldIgnorePhysicalLine(content.slice(index, lineEnd))) {
          index = lineEnd - 1;
          continue;
        }
      }
    }

    if (state === "line") {
      if (character === "\n") {
        state = "code";
        candidate?.member.push("\n");
      }
      continue;
    }
    if (state === "block") {
      if (character === "*" && next === "/") {
        state = "code";
        candidate?.member.push(" ");
        index += 1;
      }
      continue;
    }
    if (state !== "code") {
      candidate?.member.push(character);
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (
        (state === "single" && character === "'") ||
        (state === "double" && character === '"') ||
        (state === "template" && character === "`")
      ) {
        state = "code";
      }
      continue;
    }

    if (character === "/" && (next === "/" || next === "*")) {
      candidate?.member.push(" ");
      state = next === "/" ? "line" : "block";
      index += 1;
    } else if (character === "'" || character === '"' || character === "`") {
      candidate?.member.push(character);
      state =
        character === "'"
          ? "single"
          : character === '"'
            ? "double"
            : "template";
    } else if (character === "{") {
      if (candidate !== undefined) candidate.unsupported = true;
      candidates.push({
        occurrences: new Map(),
        values: new Map(),
        member: [],
        parentheses: 0,
        brackets: 0,
        unsupported: false
      });
    } else if (character === "}" && candidate !== undefined) {
      if (candidate.parentheses !== 0 || candidate.brackets !== 0) {
        candidate.unsupported = true;
      }
      finishMember(candidate);
      candidates.pop();
      if (!candidate.unsupported && hasArcOwnedWrappedUsdc(candidate))
        return true;
    } else if (candidate !== undefined) {
      if (character === "(") candidate.parentheses += 1;
      if (character === ")") candidate.parentheses -= 1;
      if (character === "[") candidate.brackets += 1;
      if (character === "]") candidate.brackets -= 1;
      if (candidate.parentheses < 0 || candidate.brackets < 0) {
        candidate.unsupported = true;
      }
      if (
        character === "," &&
        candidate.parentheses === 0 &&
        candidate.brackets === 0
      ) {
        finishMember(candidate);
      } else {
        candidate.member.push(character);
      }
    }
  }

  return false;
}
function shouldIgnorePhysicalLine(line: string): boolean {
  if (DOCUMENTATION_PREFIX_PATTERN.test(line)) return true;
  if (!WRAPPED_USDC_TERM_PATTERN.test(line)) return false;

  let outside = "";
  let quote = "";
  let block = false;
  let escaped = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index] ?? "";
    const next = line[index + 1] ?? "";
    if (block) {
      if (character === "*" && next === "/") {
        block = false;
        index += 1;
      }
    } else if (quote !== "") {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = "";
    } else if (character === "/" && next === "/") {
      break;
    } else if (character === "/" && next === "*") {
      block = true;
      index += 1;
    } else if (["'", '"', "`"].includes(character)) {
      quote = character;
    } else {
      outside += character;
    }
  }
  return NEGATIVE_GUIDANCE_PATTERN.test(outside);
}
function finishMember(candidate: ObjectCandidate): void {
  const member = candidate.member.join("").trim();
  candidate.member = [];
  if (member.length === 0) return;
  if (member.startsWith("...") || !isIdentifierStart(member[0])) {
    candidate.unsupported = true;
    return;
  }

  let end = 1;
  while (isIdentifierPart(member[end])) end += 1;
  const fieldName = member.slice(0, end);
  while (isWhitespace(member[end])) end += 1;

  if (end === member.length) {
    recordOccurrence(candidate, fieldName);
    return;
  }
  if (member[end] !== ":") {
    candidate.unsupported = true;
    return;
  }
  if (!RELEVANT_FIELDS.has(fieldName)) return;

  recordOccurrence(candidate, fieldName);
  const value = parseDirectLiteral(member.slice(end + 1).trim());
  if (value === undefined) return;
  const values = candidate.values.get(fieldName);
  if (values === undefined) candidate.values.set(fieldName, [value]);
  else values.push(value);
}

function recordOccurrence(candidate: ObjectCandidate, fieldName: string): void {
  if (!RELEVANT_FIELDS.has(fieldName)) return;
  candidate.occurrences.set(
    fieldName,
    (candidate.occurrences.get(fieldName) ?? 0) + 1
  );
}

function parseDirectLiteral(source: string): string | undefined {
  if (source.length === 0) return undefined;
  if ([...source].every((character) => character >= "0" && character <= "9")) {
    return source;
  }
  const quote = source[0];
  if (
    (quote !== "'" && quote !== '"' && quote !== "`") ||
    source.at(-1) !== quote
  ) {
    return undefined;
  }

  let escaped = false;
  for (let index = 1; index < source.length - 1; index += 1) {
    const character = source[index];
    if (escaped) escaped = false;
    else if (character === "\\") escaped = true;
    else if (
      character === quote ||
      (quote === "`" && character === "$" && source[index + 1] === "{")
    ) {
      return undefined;
    }
  }
  return source.slice(1, -1);
}

function isIdentifierStart(character: string | undefined): boolean {
  return character !== undefined && /[A-Za-z_$]/.test(character);
}

function isIdentifierPart(character: string | undefined): boolean {
  return character !== undefined && /[\w$]/.test(character);
}

function isWhitespace(character: string | undefined): boolean {
  return character !== undefined && /\s/.test(character);
}

function hasArcOwnedWrappedUsdc(fields: ObjectCandidate): boolean {
  return (
    hasWrappedUsdcForRole(fields, "chain", ["token", "asset"]) ||
    hasWrappedUsdcForRole(fields, "sourceChain", ["sourceToken"]) ||
    hasWrappedUsdcForRole(fields, "destinationChain", ["destinationToken"])
  );
}

function hasWrappedUsdcForRole(
  fields: ObjectCandidate,
  chainField: string,
  tokenFields: readonly string[]
): boolean {
  const chain = getUnambiguousFieldValue(fields, [chainField]);
  const token = getUnambiguousFieldValue(fields, tokenFields);

  return (
    chain !== undefined &&
    token !== undefined &&
    isArcChainLiteral(chain) &&
    WRAPPED_USDC_LITERAL_PATTERN.test(token)
  );
}

function getUnambiguousFieldValue(
  fields: ObjectCandidate,
  fieldNames: readonly string[]
): string | undefined {
  const occurrenceCount = fieldNames.reduce(
    (count, fieldName) => count + (fields.occurrences.get(fieldName) ?? 0),
    0
  );
  const values = fieldNames.flatMap(
    (fieldName) => fields.values.get(fieldName) ?? []
  );
  return occurrenceCount === 1 && values.length === 1 ? values[0] : undefined;
}

function isArcChainLiteral(value: string): boolean {
  return (
    /^(Arc(?: Testnet)?|Arc_Testnet)$/i.test(value) ||
    value === "arcTestnet" ||
    value === "5042002"
  );
}
