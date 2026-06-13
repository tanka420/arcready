import type { Rule } from "../../core/rules/index.js";
import {
  BRIDGE_DOCS,
  createBridgeFinding,
  isArcRelated,
  readBridgeFiles
} from "./helpers.js";

const SUGGESTED_FIX = "Arc relayers need USDC for gas, not ETH.";

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
      if (!isArcRelated(content) || !/\brelayer?\b/i.test(content)) {
        continue;
      }

      if (hasEthRelayerFunding(content)) {
        findings.push(
          createBridgeFinding(
            relayerUsesUsdcForGasRule,
            filePath,
            "Arc relayer funding appears to assume ETH gas funding.",
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
  return /\b(ETH funding|native ETH|fund with ETH|relayer ETH|gas token ETH|allocate ETH|send ETH|fund.*ETH)\b/i.test(
    content
  );
}
