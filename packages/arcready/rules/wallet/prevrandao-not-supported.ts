import type { Rule } from "../../core/rules/index.js";
import {
  WALLET_DOCS,
  createWalletFinding,
  isArcRelated,
  isCommentOrDocumentationLine,
  isGuidanceAgainstUsage,
  readWalletFiles
} from "./helpers.js";

const SUGGESTED_FIX =
  "Do not use PREVRANDAO for randomness or selection logic on Arc.";

export const prevrandaoNotSupportedRule: Rule = {
  id: "wallet/PREVRANDAO_NOT_SUPPORTED",
  name: "PREVRANDAO not supported",
  description: "Detects PREVRANDAO assumptions in Arc-related code.",
  preset: "wallet",
  defaultSeverity: "critical",
  docs: [WALLET_DOCS.prevrandao],
  async run(context) {
    const findings = [];

    for (const { filePath, content } of await readWalletFiles(context)) {
      if (!isArcRelated(content)) {
        continue;
      }

      if (hasActivePrevrandaoUsage(content)) {
        findings.push(
          createWalletFinding(
            prevrandaoNotSupportedRule,
            filePath,
            "Arc-related code appears to use PREVRANDAO or mixHash.",
            SUGGESTED_FIX,
            WALLET_DOCS.prevrandao
          )
        );
      }
    }

    return findings;
  }
};

function hasActivePrevrandaoUsage(content: string): boolean {
  return content.split(/\r?\n/).some((line) => {
    if (
      isCommentOrDocumentationLine(line) ||
      isGuidanceAgainstUsage(line, /\b(block\.prevrandao|PREVRANDAO|prevrandao|mixHash)\b/)
    ) {
      return false;
    }

    return /\b(block\.prevrandao|PREVRANDAO|prevrandao|mixHash)\b/.test(line);
  });
}
