import type { Rule } from "../../core/rules/index.js";
import {
  WALLET_DOCS,
  createWalletFinding,
  hasChainConfigShape,
  isArcRelated,
  readWalletFiles
} from "./helpers.js";

const SUGGESTED_FIX =
  "Verify the Arc wallet chain config uses chain ID 5042002, Arc RPC/explorer metadata, and USDC native asset display.";

export const arcChainMetadataRule: Rule = {
  id: "wallet/ARC_CHAIN_METADATA",
  name: "Arc chain metadata",
  description: "Detects incorrect Arc Testnet chain metadata.",
  preset: "wallet",
  defaultSeverity: "critical",
  docs: [WALLET_DOCS.chainMetadata],
  async run(context) {
    const findings = [];

    for (const { filePath, content } of await readWalletFiles(context)) {
      if (!isArcRelated(content) || !hasChainConfigShape(content)) {
        continue;
      }

      if (!hasConcreteChainConfig(content)) {
        continue;
      }

      if (!/\b5042002\b/.test(content)) {
        findings.push(
          createWalletFinding(
            arcChainMetadataRule,
            filePath,
            "Arc wallet metadata appears to omit Arc Testnet chain ID 5042002.",
            SUGGESTED_FIX,
            WALLET_DOCS.chainMetadata
          )
        );
        continue;
      }

      if (hasObviousWrongExplorerOrRpc(content)) {
        findings.push(
          createWalletFinding(
            arcChainMetadataRule,
            filePath,
            "Arc wallet metadata appears to mix Arc with non-Arc RPC or explorer settings.",
            SUGGESTED_FIX,
            WALLET_DOCS.chainMetadata
          )
        );
      }
    }

    return findings;
  }
};

function hasObviousWrongExplorerOrRpc(content: string): boolean {
  const configLines = content
    .split(/\r?\n/)
    .filter((line) => /\b(rpcUrls|blockExplorers|explorer|url)\b/i.test(line));

  return configLines.some(
    (line) =>
      /(etherscan|ethereum|mainnet|sepolia|holesky|infura|alchemy)/i.test(
        line
      ) && !/\barc\b/i.test(line)
  );
}

function hasConcreteChainConfig(content: string): boolean {
  return (
    /\bdefineChain\s*\(/.test(content) ||
    /\b(?:export\s+)?(?:const|let|var)\s+\w*(?:arc|chain)\w*\s*=\s*{[\s\S]{0,800}\b(chainId|id|nativeCurrency|rpcUrls|blockExplorers)\b/i.test(
      content
    ) ||
    /\b(chainId|id)\s*:\s*\d+[\s\S]{0,500}\b(nativeCurrency|rpcUrls|blockExplorers)\b/i.test(
      content
    )
  );
}
