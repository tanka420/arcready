import type { Rule } from "../../core/rules/index.js";
import {
  APP_KIT_DOCS,
  createAppKitFinding,
  getActiveContent,
  isAppKitRelated,
  readAppKitFiles
} from "./helpers.js";

const SUGGESTED_FIX =
  "Configure a dedicated/custom Arc RPC provider for reliable CI, staging, and production-like behavior.";

export const appKitCustomRpcRecommendedRule: Rule = {
  id: "app-kit/APPKIT_CUSTOM_RPC_RECOMMENDED",
  name: "App Kit custom RPC recommended",
  description: "Warns when App Kit Arc Testnet usage lacks custom RPC config.",
  preset: "app-kit",
  defaultSeverity: "warning",
  docs: [APP_KIT_DOCS.customRpc],
  async run(context) {
    const findings = [];

    for (const { filePath, content } of await readAppKitFiles(context)) {
      const activeContent = getActiveContent(content, /\b(RPC|rpc|Arc_Testnet)\b/);

      if (
        !isAppKitRelated(content) ||
        !/\bArc_Testnet\b/.test(activeContent)
      ) {
        continue;
      }

      if (!hasCustomRpcConfig(activeContent)) {
        findings.push(
          createAppKitFinding(
            appKitCustomRpcRecommendedRule,
            filePath,
            "App Kit Arc Testnet integration appears to rely on default/shared RPC configuration.",
            SUGGESTED_FIX,
            APP_KIT_DOCS.customRpc
          )
        );
      }
    }

    return findings;
  }
};

function hasCustomRpcConfig(content: string): boolean {
  return /\b(rpcUrl|rpcUrls|transport|http\s*\(|provider|client|ARC_RPC_URL)\b/.test(
    content
  );
}
