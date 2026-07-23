import type { Rule } from "../../core/rules/index.js";
import {
  analyzeArcUsdcAmountFile,
  supportsArcUsdcAmountPath
} from "./arc-usdc-amount-analyzer.js";
import type { ArcUsdcAmountIssueKind } from "./arc-usdc-amount-analyzer.js";
import { createWalletFinding } from "./helpers.js";

const DOCS = "arc-usdc-amount-conversion";
const TEXT: Record<ArcUsdcAmountIssueKind, readonly [string, string]> = {
  "native-read-as-erc20": [
    "An Arc native USDC balance uses 18-decimal units but is being interpreted as a six-decimal ERC-20 amount.",
    "Format the raw Arc native balance with 18 decimals, or divide the native integer amount by 10^12 before treating it as a six-decimal USDC amount."
  ],
  "erc20-read-as-native": [
    "An Arc USDC ERC-20 amount uses six-decimal units but is being interpreted as an 18-decimal native amount.",
    "Format the Arc USDC ERC-20 balance with 6 decimals. Multiply by 10^12 only when converting it into an 18-decimal native amount."
  ]
};

export const arcUsdcAmountConversionRule: Rule = {
  id: "wallet/ARC_USDC_AMOUNT_CONVERSION",
  name: "Arc USDC amount conversion",
  description:
    "Detects proven Arc USDC amount-unit mismatches across native and ERC-20 interfaces.",
  preset: "wallet",
  defaultSeverity: "critical",
  docs: [DOCS],
  async run(context) {
    const findings = [];
    for (const filePath of context.files) {
      if (!supportsArcUsdcAmountPath(filePath)) continue;
      let source: string;
      try {
        source = await context.readFile(filePath);
      } catch {
        continue;
      }
      const issue = (await analyzeArcUsdcAmountFile(filePath, source))[0];
      if (issue !== undefined) {
        findings.push(
          createWalletFinding(
            arcUsdcAmountConversionRule,
            filePath,
            ...TEXT[issue.kind],
            DOCS
          )
        );
      }
    }
    return findings;
  }
};
