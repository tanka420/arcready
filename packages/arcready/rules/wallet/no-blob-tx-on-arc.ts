import type { Rule } from "../../core/rules/index.js";
import {
  analyzeArcTransactionSubmissionFile,
  supportsArcTransactionSubmissionPath
} from "./arc-transaction-submission-analyzer.js";
import type { EthersTransactionSubmission } from "./arc-transaction-submission-analyzer.js";
import { WALLET_DOCS, createWalletFinding } from "./helpers.js";

const MESSAGE =
  "Arc transaction submission uses EIP-4844 transaction type 3, which Arc does not support.";
const SUGGESTED_FIX =
  "Submit a type-2 EIP-1559 transaction on Arc instead (`type: 2`) and remove any blob-only fields present in the submitted transaction.";

export const noBlobTxOnArcRule: Rule = {
  id: "wallet/NO_BLOB_TX_ON_ARC",
  name: "No blob transactions on Arc",
  description:
    "Detects exact ethers type-3 transaction submissions on proven Arc providers.",
  preset: "wallet",
  defaultSeverity: "critical",
  docs: [WALLET_DOCS.blobTransactions],
  async run(context) {
    const findings = [];
    for (const filePath of context.files) {
      if (!supportsArcTransactionSubmissionPath(filePath)) continue;
      let source: string;
      try {
        source = await context.readFile(filePath);
      } catch {
        continue;
      }
      const analysis = await analyzeArcTransactionSubmissionFile(
        filePath,
        source
      );
      if (analysis.status === "compiler-unavailable") {
        throw new Error("typescript compiler unavailable");
      }
      const violation = selectEarliestC07BViolation(analysis.submissions);
      if (violation !== undefined) {
        findings.push(
          createWalletFinding(
            noBlobTxOnArcRule,
            filePath,
            MESSAGE,
            SUGGESTED_FIX,
            WALLET_DOCS.blobTransactions
          )
        );
      }
    }
    return findings;
  }
};

export function selectEarliestC07BViolation(
  submissions: readonly EthersTransactionSubmission[]
): EthersTransactionSubmission | undefined {
  let earliest: EthersTransactionSubmission | undefined;
  for (const submission of submissions) {
    if (
      (submission.provenance === "ethers-wallet" ||
        submission.provenance === "ethers-json-rpc-signer") &&
      submission.sink === "sendTransaction" &&
      submission.ownership === "proven-arc" &&
      submission.transaction.safe === true &&
      submission.transaction.kind === "proven-blob" &&
      submission.transaction.exactTypeToken === 3 &&
      (earliest === undefined || submission.callOffset < earliest.callOffset)
    ) {
      earliest = submission;
    }
  }
  return earliest;
}
