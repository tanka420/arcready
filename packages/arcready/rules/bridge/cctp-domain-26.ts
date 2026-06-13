import type { Rule } from "../../core/rules/index.js";
import {
  BRIDGE_DOCS,
  createBridgeFinding,
  isArcRelated,
  isCctpRelated,
  readBridgeFiles
} from "./helpers.js";

const SUGGESTED_FIX = "Use CCTP domain 26 for Arc.";

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
            "Arc CCTP domain appears to be configured with a value other than 26.",
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
  return (
    /\bARC(?:_CCTP)?_DOMAIN\b\s*[:=]\s*(?!26\b)\d+\b/i.test(content) ||
    /\bcctpDomains\b[\s\S]{0,400}\barc\b\s*:\s*(?!26\b)\d+\b/i.test(content)
  );
}
