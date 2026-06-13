import type { Rule } from "../../core/rules/index.js";
import {
  APP_KIT_DOCS,
  createAppKitFinding,
  getActiveContent,
  isAppKitRelated,
  readAppKitFiles
} from "./helpers.js";

const SUGGESTED_FIX =
  "Check whether this Unified Balance spend path needs a delegate wallet flow, and add explicit delegate handling when the signer cannot approve spends directly.";

export const ubDelegateRequiredRule: Rule = {
  id: "app-kit/UB_DELEGATE_REQUIRED",
  name: "Unified Balance delegate required",
  description:
    "Detects Unified Balance spend flows that may ignore delegate caveats.",
  preset: "app-kit",
  defaultSeverity: "warning",
  docs: [APP_KIT_DOCS.ubDelegate],
  async run(context) {
    const findings = [];

    for (const { filePath, content } of await readAppKitFiles(context)) {
      if (!isAppKitRelated(content)) {
        continue;
      }

      if (
        hasUnifiedBalanceSpendFlow(content) &&
        !hasDelegateLanguage(content)
      ) {
        findings.push(
          createAppKitFinding(
            ubDelegateRequiredRule,
            filePath,
            "Unified Balance spend flow may be missing delegate wallet handling.",
            SUGGESTED_FIX,
            APP_KIT_DOCS.ubDelegate
          )
        );
      }
    }

    return findings;
  }
};

function hasUnifiedBalanceSpendFlow(content: string): boolean {
  const activeContent = getActiveContent(
    content,
    /\b(unifiedBalance|delegate|delegation)\b/i
  );

  return (
    /\b(unifiedBalance|spendFromUnifiedBalance)\b/i.test(activeContent) &&
    /\b(spend|Gateway|SCA|server wallet|dev-controlled|Circle Wallets)\b/i.test(
      activeContent
    )
  );
}

function hasDelegateLanguage(content: string): boolean {
  const activeContent = getActiveContent(content);

  return /\b(delegate|delegation|delegateWallet|createDelegate)\b/i.test(
    activeContent
  );
}
