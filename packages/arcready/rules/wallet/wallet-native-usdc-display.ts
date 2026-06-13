import type { Rule } from "../../core/rules/index.js";
import {
  WALLET_DOCS,
  createWalletFinding,
  isArcRelated,
  readWalletFiles
} from "./helpers.js";

const SUGGESTED_FIX = "Set Arc native currency name/symbol to USDC.";

export const walletNativeUsdcDisplayRule: Rule = {
  id: "wallet/WALLET_NATIVE_USDC_DISPLAY",
  name: "Wallet native USDC display",
  description: "Detects Arc native currency displayed as ETH instead of USDC.",
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
        hasEthNativeCurrency(content) ||
        hasVisibleEthNativeFeeConfig(content)
      ) {
        findings.push(
          createWalletFinding(
            walletNativeUsdcDisplayRule,
            filePath,
            "Arc native currency appears to be displayed as ETH.",
            SUGGESTED_FIX,
            WALLET_DOCS.usdcGas
          )
        );
      }
    }

    return findings;
  }
};

function hasEthNativeCurrency(content: string): boolean {
  return /nativeCurrency\s*:\s*{[\s\S]{0,300}\b(name|symbol)\s*:\s*["'`](ETH|Ethereum)["'`]/i.test(
    content
  );
}

function hasVisibleEthNativeFeeConfig(content: string): boolean {
  return /(native currency|nativeCurrency|fee token|feeToken|gas token|gasToken)\s*[:=]\s*["'`]?(ETH|Ethereum)\b/i.test(
    content
  );
}
