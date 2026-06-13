import type { Rule } from "../../core/rules/index.js";
import {
  WALLET_DOCS,
  createWalletFinding,
  isArcRelated,
  isCommentOrDocumentationLine,
  isGuidanceAgainstUsage,
  readWalletFiles
} from "./helpers.js";

const SUGGESTED_FIX = "Treat one Arc confirmation as final.";

export const oneConfirmationFinalRule: Rule = {
  id: "wallet/ONE_CONFIRMATION_FINAL",
  name: "One confirmation final",
  description:
    "Detects Ethereum-style multi-confirmation waiting logic on Arc.",
  preset: "wallet",
  defaultSeverity: "critical",
  docs: [WALLET_DOCS.finality],
  async run(context) {
    const findings = [];

    for (const { filePath, content } of await readWalletFiles(context)) {
      if (!isArcRelated(content)) {
        continue;
      }

      if (hasMultiConfirmationLogic(content)) {
        findings.push(
          createWalletFinding(
            oneConfirmationFinalRule,
            filePath,
            "Arc transaction flow appears to wait for more than one confirmation.",
            SUGGESTED_FIX,
            WALLET_DOCS.finality
          )
        );
      }
    }

    return findings;
  }
};

function hasMultiConfirmationLogic(content: string): boolean {
  return content.split(/\r?\n/).some(hasMultiConfirmationLine);
}

function hasMultiConfirmationLine(line: string): boolean {
  if (
    isCommentOrDocumentationLine(line) ||
    isGuidanceAgainstUsage(line, /\bconfirmations?\b/i)
  ) {
    return false;
  }

  return (
    /\bconfirmations?\s*[:=]\s*(?:[2-9]|\d{2,})\b/i.test(line) ||
    /\b(?:[2-9]|\d{2,})\s+confirmations?\b/i.test(line) ||
    hasUnsafeConfirmationCopy(line)
  );
}

function hasUnsafeConfirmationCopy(line: string): boolean {
  return (
    /\b(wait for confirmations|confirming\.\.\.)\b/i.test(line) &&
    /["'`]/.test(line)
  );
}
