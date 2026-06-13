import type { Rule } from "../../core/rules/index.js";
import {
  WALLET_DOCS,
  createWalletFinding,
  fileHasLineMatch,
  isArcRelated,
  readWalletFiles
} from "./helpers.js";

const SUGGESTED_FIX =
  "Arc gas fees are paid in USDC. Replace ETH/gwei fee labels with USDC fee display.";

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
            /\b(ETH|gwei)\b/i.test(line) &&
            /\b(gas|fee|network fee|transaction fee|native fee)\b/i.test(line)
        )
      ) {
        findings.push(
          createWalletFinding(
            noEthGasLabelRule,
            filePath,
            "Arc fee UI appears to label gas or network fees as ETH/gwei.",
            SUGGESTED_FIX,
            WALLET_DOCS.usdcGas
          )
        );
      }
    }

    return findings;
  }
};
