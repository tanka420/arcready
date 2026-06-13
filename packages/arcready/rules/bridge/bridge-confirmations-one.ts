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
  "Set Arc required confirmations to 1 and treat Arc finality as deterministic.";

export const bridgeConfirmationsOneRule: Rule = {
  id: "bridge/BRIDGE_CONFIRMATIONS_ONE",
  name: "Bridge confirmations one",
  description: "Detects non-Arc finality configuration in bridge flows.",
  preset: "bridge",
  defaultSeverity: "critical",
  docs: [BRIDGE_DOCS.finality],
  async run(context) {
    const findings = [];

    for (const { filePath, content } of await readBridgeFiles(context)) {
      if (!isArcRelated(content) || !isBridgeRelated(content)) {
        continue;
      }

      if (hasMultiConfirmationBridgeLogic(content)) {
        findings.push(
          createBridgeFinding(
            bridgeConfirmationsOneRule,
            filePath,
            "Arc bridge or relayer flow appears to require more than one confirmation.",
            SUGGESTED_FIX,
            BRIDGE_DOCS.finality
          )
        );
      }
    }

    return findings;
  }
};

function hasMultiConfirmationBridgeLogic(content: string): boolean {
  return content.split(/\r?\n/).some((line) => {
    if (
      isCommentOrDocumentationLine(line) ||
      isGuidanceAgainstUsage(line, /\bconfirmations?\b/i)
    ) {
      return false;
    }

    return (
      /\b(requiredConfirmations|confirmations|finalityBlocks|waitForConfirmations)\s*[:=]\s*(?:[2-9]|\d{2,})\b/i.test(
        line
      ) || /\b(?:[2-9]|\d{2,})\s+confirmations?\b/i.test(line)
    );
  });
}
