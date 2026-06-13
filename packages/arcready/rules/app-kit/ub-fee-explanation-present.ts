import type { Rule } from "../../core/rules/index.js";
import {
  APP_KIT_DOCS,
  createAppKitFinding,
  getActiveContent,
  isAppKitRelated,
  readAppKitFiles
} from "./helpers.js";

const SUGGESTED_FIX =
  "Add user-facing confirmation copy for spend amount, destination received amount, forwarding or protocol fees, and source gas before submission.";

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
            "Unified Balance confirmation UI appears to omit fee or received-amount context.",
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
  const activeContent = getActiveContent(
    content,
    /\b(unifiedBalance|fee|fees|forwardingFee|receivedAmount)\b/i
  );

  return (
    /\bunifiedBalance\b/i.test(activeContent) &&
    /\b(spend|payment|confirm|confirmation|checkout)\b/i.test(activeContent)
  );
}

function hasFeeExplanation(content: string): boolean {
  const activeContent = getActiveContent(content);

  return /\b(estimateSpend|fee|forwardingFee|sourceGas|destinationAmount|receivedAmount)\b/i.test(
    activeContent
  );
}
