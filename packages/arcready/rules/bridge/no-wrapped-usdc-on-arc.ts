import type { Rule } from "../../core/rules/index.js";
import {
  BRIDGE_DOCS,
  createBridgeFinding,
  isArcRelated,
  isBridgeRelated,
  readBridgeFiles
} from "./helpers.js";

const SUGGESTED_FIX =
  "Use canonical Arc USDC / CCTP burn-and-mint flow. Do not introduce wrapped USDC variants on Arc.";

export const noWrappedUsdcOnArcRule: Rule = {
  id: "bridge/NO_WRAPPED_USDC_ON_ARC",
  name: "No wrapped USDC on Arc",
  description: "Detects wrapped USDC routes in Arc bridge configuration.",
  preset: "bridge",
  defaultSeverity: "critical",
  docs: [BRIDGE_DOCS.canonicalUsdc],
  async run(context) {
    const findings = [];

    for (const { filePath, content } of await readBridgeFiles(context)) {
      if (!isArcRelated(content) || !isBridgeRelated(content)) {
        continue;
      }

      if (/\b(USDC\.e|wUSDC|wrapped USDC|bridged USDC)\b/i.test(content)) {
        findings.push(
          createBridgeFinding(
            noWrappedUsdcOnArcRule,
            filePath,
            "Arc bridge route appears to use wrapped or bridged USDC.",
            SUGGESTED_FIX,
            BRIDGE_DOCS.canonicalUsdc
          )
        );
      }
    }

    return findings;
  }
};
