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
  return content.split(/\r?\n/).some((line) => {
    if (
      isCommentOrDocumentationLine(line) ||
      isGuidanceAgainstUsage(line, /\bdomain\b/i)
    ) {
      return false;
    }

    return (
      /\bARC(?:_CCTP)?_DOMAIN\b\s*[:=]\s*(?!26\b)\d+\b/i.test(line) ||
      /\bcctpDomains\b.*\barc\b\s*:\s*(?!26\b)\d+\b/i.test(line) ||
      /\barc\b\s*:\s*(?!26\b)\d+\b/i.test(line)
    );
  });
}
