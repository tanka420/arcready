import type { Rule } from "../../core/rules/index.js";
import {
  APP_KIT_DOCS,
  createAppKitFinding,
  isAppKitRelated,
  readAppKitFiles
} from "./helpers.js";

const SUGGESTED_FIX =
  "Add minimum amount and fee guardrails for Arc-origin bridge flows so the user does not attempt a bridge where fees exceed the transfer amount.";

export const appKitBridgeMinAmountNoteRule: Rule = {
  id: "app-kit/APPKIT_BRIDGE_MIN_AMOUNT_NOTE",
  name: "App Kit bridge minimum amount note",
  description:
    "Warns when Arc-origin App Kit bridge flows lack minimum amount or fee guardrails.",
  preset: "app-kit",
  defaultSeverity: "warning",
  docs: [APP_KIT_DOCS.bridgeMinAmount],
  async run(context) {
    const findings = [];

    for (const { filePath, content } of await readAppKitFiles(context)) {
      if (!isAppKitRelated(content)) {
        continue;
      }

      if (hasArcOriginBridge(content) && !hasAmountOrFeeGuard(content)) {
        findings.push(
          createAppKitFinding(
            appKitBridgeMinAmountNoteRule,
            filePath,
            "Arc-origin App Kit bridge flow appears to lack minimum amount or fee guardrails.",
            SUGGESTED_FIX,
            APP_KIT_DOCS.bridgeMinAmount
          )
        );
      }
    }

    return findings;
  }
};

function hasArcOriginBridge(content: string): boolean {
  return (
    /\bbridge\b/i.test(content) &&
    /\b(sourceChain|fromChain|originChain)\b[\s\S]{0,120}\bArc_Testnet\b/.test(
      content
    ) &&
    /\bamount\b/i.test(content)
  );
}

function hasAmountOrFeeGuard(content: string): boolean {
  return /\b(minAmount|minimum|maxFee|fee)\b/i.test(content);
}
