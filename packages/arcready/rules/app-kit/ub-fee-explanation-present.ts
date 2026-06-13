import type { Rule } from "../../core/rules/index.js";
import {
  APP_KIT_DOCS,
  createAppKitFinding,
  isAppKitRelated,
  readAppKitFiles
} from "./helpers.js";

const SUGGESTED_FIX =
  "Show spend amount, destination received amount, protocol/forwarding fees, and source gas before confirmation.";

export const ubFeeExplanationPresentRule: Rule = {
  id: "app-kit/UB_FEE_EXPLANATION_PRESENT",
  name: "Unified Balance fee explanation present",
  description:
    "Detects Unified Balance confirmation UI without visible fee explanation.",
  preset: "app-kit",
  defaultSeverity: "warning",
  docs: [APP_KIT_DOCS.ubFees],
  async run(context) {
    const findings = [];

    for (const { filePath, content } of await readAppKitFiles(context)) {
      if (!isAppKitRelated(content)) {
        continue;
      }

      if (
        hasUnifiedBalanceConfirmation(content) &&
        !hasFeeExplanation(content)
      ) {
        findings.push(
          createAppKitFinding(
            ubFeeExplanationPresentRule,
            filePath,
            "Unified Balance payment confirmation appears to lack fee explanation.",
            SUGGESTED_FIX,
            APP_KIT_DOCS.ubFees
          )
        );
      }
    }

    return findings;
  }
};

function hasUnifiedBalanceConfirmation(content: string): boolean {
  return (
    /\bunifiedBalance\b/i.test(content) &&
    /\b(spend|payment|confirm|confirmation|checkout)\b/i.test(content)
  );
}

function hasFeeExplanation(content: string): boolean {
  return /\b(estimateSpend|fee|forwardingFee|sourceGas|destinationAmount|receivedAmount)\b/i.test(
    content
  );
}
