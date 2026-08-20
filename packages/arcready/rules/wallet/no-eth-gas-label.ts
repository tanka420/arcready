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
  "If this text is rendered to Arc wallet users, display the fee in USDC or USD. Gwei remains valid for internal gas-price units and calculations; correct contrasts, documentation, and non-Arc content may not require changes.";

export const noEthGasLabelRule: Rule = {
  id: "wallet/NO_ETH_GAS_LABEL",
  name: "No ETH gas label",
  description:
    "Provides low-confidence advice when a file with Arc evidence also contains a gas or fee line mentioning ETH or Gwei.",
  preset: "wallet",
  defaultSeverity: "info",
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
            "Gas or fee text mentioning ETH/Gwei is co-located in a file with Arc evidence; review whether the text is a user-facing Arc fee label.",
            SUGGESTED_FIX,
            WALLET_DOCS.usdcGas
          )
        );
      }
    }

    return findings;
  }
};
