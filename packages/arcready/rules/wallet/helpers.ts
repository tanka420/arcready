import type { Finding } from "../../core/findings/index.js";
import type { Rule, RuleContext } from "../../core/rules/index.js";

export const WALLET_DOCS = {
  chainMetadata: "arc-chain-metadata",
  usdcGas: "arc-usdc-gas",
  finality: "arc-finality",
  prevrandao: "arc-prevrandao",
  blobTransactions: "arc-blob-transactions"
} as const;

export interface WalletFileContent {
  filePath: string;
  content: string;
}

export async function readWalletFiles(
  context: RuleContext
): Promise<WalletFileContent[]> {
  const files: WalletFileContent[] = [];

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

export function hasChainConfigShape(content: string): boolean {
  return (
    /\bdefineChain\s*\(/.test(content) ||
    /\bchainId\b/.test(content) ||
    /\bid\s*:\s*\d+/.test(content) ||
    /\bnativeCurrency\b/.test(content) ||
    /\brpcUrls\b/.test(content) ||
    /\bblockExplorers\b/.test(content) ||
    /\bexplorer[s]?\b/i.test(content)
  );
}

export function isCommentOrDocumentationLine(line: string): boolean {
  const trimmed = line.trim();

  return (
    trimmed.startsWith("//") ||
    trimmed.startsWith("/*") ||
    trimmed.startsWith("*") ||
    trimmed.startsWith("#") ||
    trimmed.startsWith(">") ||
    /^[-*]\s+/.test(trimmed)
  );
}

export function isGuidanceAgainstUsage(
  text: string,
  termPattern: RegExp
): boolean {
  if (!termPattern.test(text)) {
    return false;
  }

  return /\b(do not|don't|never|avoid|unsupported|not supported|should not|must not|instead of|rather than)\b/i.test(
    text
  );
}

export function createWalletFinding(
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
    preset: "wallet"
  };
}

export function fileHasLineMatch(
  content: string,
  predicate: (line: string) => boolean
): boolean {
  return content.split(/\r?\n/).some(predicate);
}
