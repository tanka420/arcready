import type { Rule } from "../../core/rules/index.js";
import {
  WALLET_DOCS,
  createWalletFinding,
  fileHasLineMatch,
  isArcRelated,
  isCommentOrDocumentationLine,
  isGuidanceAgainstUsage,
  readWalletFiles
} from "./helpers.js";

const SUGGESTED_FIX =
  "Update user-facing gas and network fee labels to show USDC, and verify no Arc fee UI still references ETH or gwei.";

export const noEthGasLabelRule: Rule = {
  id: "wallet/NO_ETH_GAS_LABEL",
  name: "No ETH gas label",
  description: "Detects ETH or gwei labels in Arc gas and fee UI.",
  preset: "wallet",
  defaultSeverity: "critical",
  docs: [WALLET_DOCS.usdcGas],
  async run(context) {
    const findings = [];

    for (const { filePath, content } of await readWalletFiles(context)) {
      if (!isArcRelated(content)) {
        continue;
      }

      if (
        fileHasLineMatch(
          content,
          (line) =>
            !isCommentOrDocumentationLine(line) &&
            !isGuidanceAgainstUsage(line, /\b(ETH|gwei)\b/i) &&
            /\b(ETH|gwei)\b/i.test(line) &&
            /\b(gas|fee|network fee|transaction fee|native fee)\b/i.test(line)
        )
      ) {
        findings.push(
          createWalletFinding(
            noEthGasLabelRule,
            filePath,
            "Arc wallet fee UI appears to label gas or network fees as ETH/gwei.",
            SUGGESTED_FIX,
            WALLET_DOCS.usdcGas
          )
        );
      }
    }

    return findings;
  }
};
