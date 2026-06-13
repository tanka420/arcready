import type { Rule } from "../../core/rules/index.js";
import {
  BRIDGE_DOCS,
  createBridgeFinding,
  isArcRelated,
  isCommentOrDocumentationLine,
  isGuidanceAgainstUsage,
  readBridgeFiles
} from "./helpers.js";

const SUGGESTED_FIX =
  "Check relayer funding and gas-token config; Arc relayer gas should be modeled as USDC rather than ETH.";

export const relayerUsesUsdcForGasRule: Rule = {
  id: "bridge/RELAYER_USES_USDC_FOR_GAS",
  name: "Relayer uses USDC for gas",
  description: "Detects ETH-based Arc relayer funding assumptions.",
  preset: "bridge",
  defaultSeverity: "critical",
  docs: [BRIDGE_DOCS.usdcGas],
  async run(context) {
    const findings = [];

    for (const { filePath, content } of await readBridgeFiles(context)) {
      if (
        !isArcRelated(content) ||
        !/\b(relayers?|relay|relayerGasToken|gasToken|feeToken)\b/i.test(content)
      ) {
        continue;
      }

      if (hasEthRelayerFunding(content)) {
        findings.push(
          createBridgeFinding(
            relayerUsesUsdcForGasRule,
            filePath,
            "Arc relayer funding appears to assume ETH is used for gas.",
            SUGGESTED_FIX,
            BRIDGE_DOCS.usdcGas
          )
        );
      }
    }

    return findings;
  }
};

function hasEthRelayerFunding(content: string): boolean {
  return content.split(/\r?\n/).some((line) => {
    if (
      isCommentOrDocumentationLine(line) ||
      isGuidanceAgainstUsage(line, /\bETH\b/i)
    ) {
      return false;
    }

    return (
      /\b(ETH funding|native ETH|fund with ETH|relayer ETH|gas token ETH|allocate ETH|send ETH|fund.*ETH)\b/i.test(
        line
      ) ||
      /\b(?:gasToken|feeToken|relayerGasToken)\b\s*[:=]\s*["'`]ETH["'`]/i.test(
        line
      )
    );
  });
}
