import type { Rule } from "../../core/rules/index.js";
import {
  BRIDGE_DOCS,
  createBridgeFinding,
  isArcRelated,
  isCctpRelated,
  isCommentOrDocumentationLine,
  isGuidanceAgainstUsage,
  readBridgeFiles
} from "./helpers.js";

const SUGGESTED_FIX =
  "Check the CCTP domain map and set the Arc domain value to 26 wherever Arc routes are configured.";

export const cctpDomain26Rule: Rule = {
  id: "bridge/CCTP_DOMAIN_26",
  name: "CCTP domain 26",
  description: "Detects incorrect Arc CCTP domain configuration.",
  preset: "bridge",
  defaultSeverity: "critical",
  docs: [BRIDGE_DOCS.cctpDomain],
  async run(context) {
    const findings = [];

    for (const { filePath, content } of await readBridgeFiles(context)) {
      if (!isArcRelated(content) || !isCctpRelated(content)) {
        continue;
      }

      if (hasWrongArcDomain(content)) {
        findings.push(
          createBridgeFinding(
            cctpDomain26Rule,
            filePath,
            "Arc CCTP domain config appears to use a value other than 26.",
            SUGGESTED_FIX,
            BRIDGE_DOCS.cctpDomain
          )
        );
      }
    }

    return findings;
  }
};

function hasWrongArcDomain(content: string): boolean {
  const lines = content.split(/\r?\n/).filter(isActionableDomainLine);

  return (
    lines.some((line) =>
      /\bARC(?:_CCTP)?_DOMAIN\b\s*[:=]\s*(?!26\b)\d+\b/i.test(line)
    ) ||
    hasWrongArcDomainInBracedMap(lines) ||
    hasWrongArcDomainInYamlMap(lines)
  );
}

function isActionableDomainLine(line: string): boolean {
  return (
    !isCommentOrDocumentationLine(line) &&
    !isGuidanceAgainstUsage(line, /\bdomain\b/i)
  );
}

function hasWrongArcDomainInBracedMap(lines: string[]): boolean {
  return /\bcctpDomains\b\s*[:=]\s*\{[^{}]*\barc\b\s*:\s*(?!26\b)\d+\b[^{}]*\}/i.test(
    lines.join("\n")
  );
}

function hasWrongArcDomainInYamlMap(lines: string[]): boolean {
  for (const [index, line] of lines.entries()) {
    const header = /^(?<indent>[\t ]*)cctpDomains\s*:\s*$/i.exec(line);
    if (header === null) {
      continue;
    }

    const parentIndent = header.groups?.indent.length ?? 0;
    let childIndent: number | undefined;

    for (const childLine of lines.slice(index + 1)) {
      if (childLine.trim().length === 0) {
        continue;
      }

      const indentation = /^[\t ]*/.exec(childLine)?.[0].length ?? 0;
      if (indentation <= parentIndent) {
        break;
      }

      childIndent ??= indentation;
      if (
        indentation === childIndent &&
        /^\s*arc\s*:\s*(?!26\b)\d+\b/i.test(childLine)
      ) {
        return true;
      }
    }
  }

  return false;
}
