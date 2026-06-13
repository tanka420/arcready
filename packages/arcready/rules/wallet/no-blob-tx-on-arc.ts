import type { Rule } from "../../core/rules/index.js";
import {
  WALLET_DOCS,
  createWalletFinding,
  isArcRelated,
  readWalletFiles
} from "./helpers.js";

const SUGGESTED_FIX =
  "Arc does not support EIP-4844 blob transactions. Use normal EIP-1559 transaction flow.";

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
            "Arc-related code appears to assume EIP-4844 blob transaction support.",
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
  return (
    /\bblobVersionedHashes\b/.test(content) ||
    /\bmaxFeePerBlobGas\b/.test(content) ||
    /\btype\s*:\s*3\b/.test(content) ||
    /\b(blob transaction|blob tx|EIP-4844|4844)\b/i.test(content)
  );
}
