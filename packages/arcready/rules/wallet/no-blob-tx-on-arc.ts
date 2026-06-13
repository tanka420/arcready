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
  "Remove EIP-4844 blob transaction fields from Arc wallet flows and use a normal EIP-1559 transaction configuration.";

export const noBlobTxOnArcRule: Rule = {
  id: "wallet/NO_BLOB_TX_ON_ARC",
  name: "No blob transactions on Arc",
  description: "Detects EIP-4844 blob transaction assumptions on Arc.",
  preset: "wallet",
  defaultSeverity: "critical",
  docs: [WALLET_DOCS.blobTransactions],
  async run(context) {
    const findings = [];

    for (const { filePath, content } of await readWalletFiles(context)) {
      if (!isArcRelated(content)) {
        continue;
      }

      if (hasBlobTransactionAssumption(content)) {
        findings.push(
          createWalletFinding(
            noBlobTxOnArcRule,
            filePath,
            "Arc wallet code appears to assume EIP-4844 blob transaction support.",
            SUGGESTED_FIX,
            WALLET_DOCS.blobTransactions
          )
        );
      }
    }

    return findings;
  }
};

function hasBlobTransactionAssumption(content: string): boolean {
  return content.split(/\r?\n/).some((line) => {
    if (
      isCommentOrDocumentationLine(line) ||
      isGuidanceAgainstUsage(line, /\b(blob|EIP-4844|4844)\b/i)
    ) {
      return false;
    }

    return (
      /\bblobVersionedHashes\b/.test(line) ||
      /\bmaxFeePerBlobGas\b/.test(line) ||
      /\btype\s*:\s*3\b/.test(line) ||
      /\b(blob transaction|blob tx|EIP-4844)\b/i.test(line)
    );
  });
}
