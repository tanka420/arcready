import type { Rule } from "../../core/rules/index.js";
import {
  WALLET_DOCS,
  createWalletFinding,
  isArcRelated,
  readWalletFiles
} from "./helpers.js";

const SUGGESTED_FIX =
  "Check nativeCurrency, gas token, and fee-token display fields; Arc fees should be shown as USDC.";

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
            "Arc wallet native asset display appears to show ETH instead of USDC.",
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
