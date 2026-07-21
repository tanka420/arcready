import type { Rule } from "../../core/rules/index.js";
import {
  BRIDGE_DOCS,
  createBridgeFinding,
  isArcRelated,
  isBridgeRelated,
  isCommentOrDocumentationLine,
  isGuidanceAgainstUsage,
  readBridgeFiles
} from "./helpers.js";

const SUGGESTED_FIX =
  "Use canonical Arc USDC through the intended bridge route, and remove Arc-side USDC.e, wUSDC, or bridged-USDC asset mappings.";

const WRAPPED_USDC_TERM_PATTERN =
  /\b(USDC\.e|wUSDC|wrapped USDC|bridged USDC)\b/i;
const WRAPPED_USDC_LITERAL_PATTERN =
  /^(USDC\.e|wUSDC|wrapped USDC|bridged USDC)$/i;
const FLAT_BRACED_OBJECT_PATTERN = /\{[^{}]*\}/g;
const DIRECT_FIELD_NAME_PATTERN = /(?:^|[,{]\s*)([A-Za-z_$][\w$]*)\s*:/g;
const DIRECT_LITERAL_FIELD_PATTERN =
  /(?:^|[,{]\s*)([A-Za-z_$][\w$]*)\s*:\s*(?:"([^"\r\n]*)"|'([^'\r\n]*)'|`([^`\r\n]*)`|(\d+))(?=\s*(?:,|}))/g;
const QUOTED_FIELD_PATTERN = /(?:^|[,{]\s*)["'`][^"'`\r\n]+["'`]\s*:/;
const COMPUTED_FIELD_PATTERN = /(?:^|[,{]\s*)\[[^\]\r\n]+\]\s*:/;

interface DirectLiteralFields {
  readonly occurrences: ReadonlyMap<string, number>;
  readonly values: ReadonlyMap<string, readonly string[]>;
}

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
  const actionableContent = content
    .split(/\r?\n/)
    .map((line) =>
      isCommentOrDocumentationLine(line) ||
      isGuidanceAgainstUsage(line, WRAPPED_USDC_TERM_PATTERN)
        ? ""
        : line
    )
    .join("\n");

  return (actionableContent.match(FLAT_BRACED_OBJECT_PATTERN) ?? []).some(
    hasArcOwnedWrappedUsdc
  );
}

function hasArcOwnedWrappedUsdc(objectSource: string): boolean {
  if (
    objectSource.includes("...") ||
    QUOTED_FIELD_PATTERN.test(objectSource) ||
    COMPUTED_FIELD_PATTERN.test(objectSource)
  ) {
    return false;
  }

  const fields = collectDirectLiteralFields(objectSource);

  return (
    hasWrappedUsdcForRole(fields, "chain", ["token", "asset"]) ||
    hasWrappedUsdcForRole(fields, "sourceChain", ["sourceToken"]) ||
    hasWrappedUsdcForRole(fields, "destinationChain", ["destinationToken"])
  );
}

function collectDirectLiteralFields(objectSource: string): DirectLiteralFields {
  const occurrences = new Map<string, number>();
  const values = new Map<string, string[]>();

  for (const match of objectSource.matchAll(DIRECT_FIELD_NAME_PATTERN)) {
    const fieldName = match[1];
    if (fieldName !== undefined) {
      occurrences.set(fieldName, (occurrences.get(fieldName) ?? 0) + 1);
    }
  }

  for (const match of objectSource.matchAll(DIRECT_LITERAL_FIELD_PATTERN)) {
    const fieldName = match[1];
    const value = match[2] ?? match[3] ?? match[4] ?? match[5];
    if (fieldName === undefined || value === undefined) {
      continue;
    }

    const existingValues = values.get(fieldName);
    if (existingValues === undefined) {
      values.set(fieldName, [value]);
    } else {
      existingValues.push(value);
    }
  }

  return { occurrences, values };
}

function hasWrappedUsdcForRole(
  fields: DirectLiteralFields,
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
  fields: DirectLiteralFields,
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
