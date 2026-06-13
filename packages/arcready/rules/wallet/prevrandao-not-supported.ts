import type { Rule } from "../../core/rules/index.js";
import {
  WALLET_DOCS,
  createWalletFinding,
  isArcRelated,
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

      if (
        /\b(block\.prevrandao|PREVRANDAO|prevrandao|mixHash)\b/.test(content)
      ) {
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
