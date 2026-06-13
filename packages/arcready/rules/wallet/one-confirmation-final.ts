import type { Rule } from "../../core/rules/index.js";
import {
  WALLET_DOCS,
  createWalletFinding,
  isArcRelated,
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
  return (
    /\bconfirmations?\s*[:=]\s*(?:[2-9]|\d{2,})\b/i.test(content) ||
    /\b(?:[2-9]|\d{2,})\s+confirmations?\b/i.test(content) ||
    /waitForTransactionReceipt\s*\([\s\S]{0,300}confirmations?\s*:\s*(?:[2-9]|\d{2,})/i.test(
      content
    ) ||
    /\bwait for confirmations\b/i.test(content) ||
    /\bconfirming\.\.\./i.test(content)
  );
}
