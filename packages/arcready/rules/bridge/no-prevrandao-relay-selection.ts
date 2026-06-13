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
  "Do not use PREVRANDAO on Arc for relayer selection or randomness. Use deterministic selection, offchain coordination, oracle, or another documented randomness source.";

export const noPrevrandaoRelaySelectionRule: Rule = {
  id: "bridge/NO_PREVRANDAO_RELAY_SELECTION",
  name: "No PREVRANDAO relay selection",
  description: "Detects PREVRANDAO usage in Arc relay selection logic.",
  preset: "bridge",
  defaultSeverity: "critical",
  docs: [BRIDGE_DOCS.prevrandao],
  async run(context) {
    const findings = [];

    for (const { filePath, content } of await readBridgeFiles(context)) {
      if (!isArcRelated(content) || !isBridgeRelated(content)) {
        continue;
      }

      if (hasPrevrandaoRelaySelection(content)) {
        findings.push(
          createBridgeFinding(
            noPrevrandaoRelaySelectionRule,
            filePath,
            "Arc relayer selection appears to use PREVRANDAO or mixHash randomness.",
            SUGGESTED_FIX,
            BRIDGE_DOCS.prevrandao
          )
        );
      }
    }

    return findings;
  }
};

function hasPrevrandaoRelaySelection(content: string): boolean {
  return content.split(/\r?\n/).some((line) => {
    if (
      isCommentOrDocumentationLine(line) ||
      isGuidanceAgainstUsage(line, /\b(block\.prevrandao|PREVRANDAO|prevrandao|mixHash)\b/)
    ) {
      return false;
    }

    return (
      /\b(block\.prevrandao|PREVRANDAO|prevrandao|mixHash)\b/.test(line) &&
      /(relay|relayer|selection|select|shuffle|randomness|random)/i.test(line)
    );
  });
}
