import type { Rule } from "../../core/rules/index.js";
import {
  arrayValues,
  fieldsAt,
  inspectArcChainObjects,
  stringValue,
  supportsArcChainObjectPath
} from "./arc-chain-object-scanner.js";
import type {
  ArcChainObjectCandidate,
  Fields,
  Span
} from "./arc-chain-object-scanner.js";
import { WALLET_DOCS, createWalletFinding } from "./helpers.js";

type Issue = "missing" | "incorrect" | "rpc" | "explorer";

const CHAIN_FIX =
  'Set this object\'s id or chainId to 5042002; use "0x4CEF52" for EIP-3085 string metadata.';
const TEXT: Record<Issue, readonly [string, string]> = {
  missing: [
    "Arc-owned chain metadata is missing a direct literal Arc Testnet chain ID.",
    CHAIN_FIX
  ],
  incorrect: [
    "Arc-owned chain metadata uses a direct literal chain ID other than Arc Testnet 5042002.",
    CHAIN_FIX
  ],
  rpc: [
    "Arc-owned chain metadata contains an RPC URL for Ethereum mainnet, Sepolia, or Holesky.",
    "Replace the non-Arc RPC URL with an Arc-serving endpoint. Arc's primary endpoint is https://rpc.testnet.arc.network; managed and custom Arc providers are valid."
  ],
  explorer: [
    "Arc-owned chain metadata contains an Etherscan URL for Ethereum mainnet, Sepolia, or Holesky.",
    "Replace the non-Arc explorer URL with https://testnet.arcscan.app."
  ]
};

export const arcChainMetadataRule: Rule = {
  id: "wallet/ARC_CHAIN_METADATA",
  name: "Arc chain metadata",
  description:
    "Detects incorrect literal chain IDs and clearly non-Arc endpoints in bounded Arc-owned chain objects.",
  preset: "wallet",
  defaultSeverity: "critical",
  docs: [WALLET_DOCS.chainMetadata],
  async run(context) {
    const findings = [];
    for (const filePath of context.files) {
      if (!supportsArcChainObjectPath(filePath)) continue;
      let source: string;
      try {
        source = await context.readFile(filePath);
      } catch {
        continue;
      }
      const issue = inspectArcChainObjects(source, inspectCandidate);
      if (issue !== undefined) {
        findings.push(
          createWalletFinding(
            arcChainMetadataRule,
            filePath,
            ...TEXT[issue],
            WALLET_DOCS.chainMetadata
          )
        );
      }
    }
    return findings;
  }
};

const ETH_RPC =
  /^(?:cloudflare-eth\.com|(?:mainnet|sepolia|holesky)\.infura\.io|eth-(?:mainnet|sepolia|holesky)\.g\.alchemy\.com|ethereum(?:-(?:sepolia|holesky)-rpc)?\.publicnode\.com)$/;

function inspectCandidate(
  candidate: ArcChainObjectCandidate
): Issue | undefined {
  if (candidate.id === "missing") return "missing";
  if (candidate.id !== 5042002n) return "incorrect";
  const rpc = urls(candidate, "rpc");
  if (rpc === undefined) return undefined;
  if (rpc.some(ethereumRpc)) return "rpc";
  const explorers = urls(candidate, "explorer");
  return explorers?.some(etherscan) ? "explorer" : undefined;
}

function urls(
  candidate: ArcChainObjectCandidate,
  kind: "rpc" | "explorer"
): string[] | undefined {
  const paths =
    kind === "rpc"
      ? [
          ["wsUrls"],
          ["rpcUrls"],
          ["rpcUrls", "default", "http"],
          ["rpcUrls", "default", "webSocket"]
        ]
      : [["blockExplorerUrls"], ["blockExplorers", "default", "url"]];
  const result: string[] = [];
  for (const path of paths) {
    let current: Fields = candidate.fields;
    let span: Span | undefined = current.get(path[0]);
    if (span === undefined) continue;
    if (
      path.length === 1 &&
      path[0] === "rpcUrls" &&
      candidate.masked[span[0]] === "{"
    )
      continue;
    if (
      path.length > 1 &&
      path[0] === "rpcUrls" &&
      candidate.masked[span[0]] === "["
    )
      continue;
    for (const key of path.slice(1)) {
      if (candidate.masked[span[0]] !== "{") return undefined;
      const nested = fieldsAt(candidate.masked, span);
      if (nested === undefined) return undefined;
      current = nested;
      span = current.get(key);
      if (span === undefined) break;
    }
    if (span === undefined) continue;
    if (candidate.masked[span[0]] === "[") {
      const values = arrayValues(candidate.source, candidate.masked, span);
      if (values === undefined) return undefined;
      result.push(...values);
    } else {
      const value = stringValue(candidate.source.slice(...span));
      if (value === undefined) return undefined;
      result.push(value);
    }
  }
  return result;
}

function parsed(value: string): URL | undefined {
  try {
    const url = new URL(value);
    return /^(?:https?|wss?):$/.test(url.protocol) ? url : undefined;
  } catch {
    return undefined;
  }
}

function ethereumRpc(value: string): boolean {
  const url = parsed(value);
  if (url === undefined) return false;
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  const segment = url.pathname.split("/").filter(Boolean)[0]?.toLowerCase();
  return (
    ETH_RPC.test(host) ||
    (host === "rpc.ankr.com" &&
      ["eth", "eth_sepolia", "eth_holesky"].includes(segment ?? ""))
  );
}

function etherscan(value: string): boolean {
  const host = parsed(value)?.hostname.toLowerCase().replace(/\.$/, "");
  return host === "etherscan.io" || host?.endsWith(".etherscan.io") === true;
}
