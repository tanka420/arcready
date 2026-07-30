import type { Rule } from "../../core/rules/index.js";
import {
  analyzeArcTransactionSubmissionFile,
  supportsArcTransactionSubmissionPath
} from "./arc-transaction-submission-analyzer.js";
import type { EthersTransactionSubmission } from "./arc-transaction-submission-analyzer.js";
import {
  analyzeViemTransactionSubmissionFile,
  supportsViemTransactionSubmissionPath
} from "./viem-transaction-submission-analyzer.js";
import type { ViemTransactionSubmission } from "./viem-transaction-submission-analyzer.js";
import { WALLET_DOCS, createWalletFinding } from "./helpers.js";

const MESSAGE =
  "Arc transaction submission uses EIP-4844 transaction type 3, which Arc does not support.";
const SUGGESTED_FIX =
  "Submit a type-2 EIP-1559 transaction on Arc instead (`type: 2`) and remove any blob-only fields present in the submitted transaction.";

export const noBlobTxOnArcRule: Rule = {
  id: "wallet/NO_BLOB_TX_ON_ARC",
  name: "No blob transactions on Arc",
  description:
    "Detects exact EIP-4844 transaction submissions in supported ethers and viem Arc flows.",
  preset: "wallet",
  defaultSeverity: "critical",
  docs: [WALLET_DOCS.blobTransactions],
  async run(context) {
    const findings = [];
    for (const filePath of context.files) {
      if (
        !supportsArcTransactionSubmissionPath(filePath) &&
        !supportsViemTransactionSubmissionPath(filePath)
      )
        continue;
      let source: string;
      try {
        source = await context.readFile(filePath);
      } catch {
        continue;
      }
      const [ethersAnalysis, viemAnalysis] = await Promise.all([
        analyzeArcTransactionSubmissionFile(filePath, source),
        analyzeViemTransactionSubmissionFile(filePath, source)
      ]);
      if (
        ethersAnalysis.status === "compiler-unavailable" ||
        viemAnalysis.status === "compiler-unavailable"
      ) {
        throw new Error("typescript compiler unavailable");
      }
      const violation = selectEarliestC07CViolation(
        ethersAnalysis.submissions,
        viemAnalysis.submissions
      );
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

export function selectEarliestC07CViolation(
  ethersSubmissions: readonly EthersTransactionSubmission[],
  viemSubmissions: readonly ViemTransactionSubmission[]
): EthersTransactionSubmission | ViemTransactionSubmission | undefined {
  const earliestEthers = selectEarliestC07BViolation(ethersSubmissions);
  let earliestViem: ViemTransactionSubmission | undefined;

  for (const submission of viemSubmissions) {
    if (
      submission.provenance !== "viem-wallet-client" ||
      submission.sink !== "sendTransaction" ||
      submission.structuralSafety !== "proven-safe" ||
      submission.ownership !== "proven-arc" ||
      (submission.accountRoute !== "json-rpc-address" &&
        submission.accountRoute !== "private-key-local-account") ||
      submission.transactionKind !== "proven-blob" ||
      submission.evidenceToken !== "eip4844"
    ) {
      continue;
    }

    if (
      earliestViem === undefined ||
      submission.callOffset < earliestViem.callOffset
    ) {
      earliestViem = submission;
    }
  }

  if (
    earliestViem !== undefined &&
    (earliestEthers === undefined ||
      earliestViem.callOffset < earliestEthers.callOffset)
  ) {
    return earliestViem;
  }

  return earliestEthers;
}
