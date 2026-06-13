import type { Finding } from "../../core/findings/index.js";
import type { Rule, RuleContext } from "../../core/rules/index.js";

export const BRIDGE_DOCS = {
  finality: "arc-finality",
  cctpDomain: "arc-cctp-domain",
  canonicalUsdc: "arc-canonical-usdc",
  usdcGas: "arc-usdc-gas",
  attestation: "arc-cctp-attestation",
  prevrandao: "arc-prevrandao"
} as const;

export interface BridgeFileContent {
  filePath: string;
  content: string;
}

export async function readBridgeFiles(
  context: RuleContext
): Promise<BridgeFileContent[]> {
  const files: BridgeFileContent[] = [];

  for (const filePath of context.files) {
    try {
      files.push({
        filePath,
        content: await context.readFile(filePath)
      });
    } catch {
      continue;
    }
  }

  return files;
}

export function isArcRelated(content: string): boolean {
  return (
    /\bArc(?:\s+Testnet)?\b/i.test(content) ||
    /\bArc_Testnet\b/i.test(content) ||
    /\barcTestnet\b/.test(content) ||
    /\b5042002\b/.test(content)
  );
}

export function isBridgeRelated(content: string): boolean {
  return /(bridge|bridging|relayer?|relay|CCTP|depositForBurn|attestation|burn-and-mint|route|routing)/i.test(
    content
  );
}

export function isCctpRelated(content: string): boolean {
  return /\b(CCTP|depositForBurn|receiveMessage|attestation)\b/i.test(content);
}

export function createBridgeFinding(
  rule: Rule,
  filePath: string,
  message: string,
  suggestedFix: string,
  docs: string
): Finding {
  return {
    ruleId: rule.id,
    severity: rule.defaultSeverity,
    message,
    files: [filePath],
    suggestedFix,
    docs,
    preset: "bridge"
  };
}
