import type { Finding } from "../../core/findings/index.js";
import type { Rule, RuleContext } from "../../core/rules/index.js";

export const APP_KIT_DOCS = {
  chainIdentifier: "arc-appkit-chain-identifier",
  capabilities: "arc-appkit-capabilities",
  customRpc: "arc-appkit-custom-rpc",
  ubDelegate: "arc-unified-balance-delegate",
  ubFees: "arc-unified-balance-fees",
  bridgeMinAmount: "arc-appkit-bridge-min-amount"
} as const;

export interface AppKitFileContent {
  filePath: string;
  content: string;
}

export async function readAppKitFiles(
  context: RuleContext
): Promise<AppKitFileContent[]> {
  const files: AppKitFileContent[] = [];

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

export function isAppKitRelated(content: string): boolean {
  return /(@circle-fin\/app-kit|Circle App Kit|\bAppKit\b|\bapp-kit\b)/i.test(
    content
  );
}

export function isArcRelated(content: string): boolean {
  return (
    /\bArc_Testnet\b/.test(content) ||
    /\bArc(?:\s+Testnet)?\b/i.test(content) ||
    /\barcTestnet\b/.test(content) ||
    /\b5042002\b/.test(content)
  );
}

export function createAppKitFinding(
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
    preset: "app-kit"
  };
}
