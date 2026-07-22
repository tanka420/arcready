import type { Rule } from "../../core/rules/index.js";
import * as bridge from "./helpers.js";

export const relayerUsesUsdcForGasRule: Rule = {
  id: "bridge/RELAYER_USES_USDC_FOR_GAS",
  name: "Relayer uses USDC for gas",
  description: "Detects ETH-based Arc relayer funding assumptions.",
  preset: "bridge",
  defaultSeverity: "critical",
  docs: [bridge.BRIDGE_DOCS.usdcGas],
  async run(context) {
    const findings = [];
    for (const { filePath, content } of await bridge.readBridgeFiles(context)) {
      if (!/\.[jt]sx?$/i.test(filePath) || !hasWrongToken(content)) continue;
      findings.push(
        bridge.createBridgeFinding(
          relayerUsesUsdcForGasRule,
          filePath,
          "Arc relayer funding appears to assume ETH is used for gas.",
          "Check relayer funding and gas-token config; Arc relayer gas should be modeled as USDC rather than ETH.",
          bridge.BRIDGE_DOCS.usdcGas
        )
      );
    }
    return findings;
  }
};

function hasWrongToken(source: string): boolean {
  const masked = maskInert(source);
  const declaration =
    /(?:^|[;\r\n])[\t ]*(?:export[\t ]+)?const[\t ]+([A-Za-z_$][A-Za-z0-9_$]*)[\t ]*=[\t ]*\{/g;
  for (const match of masked.matchAll(declaration)) {
    const prefix = masked.slice(0, match.index);
    if ((prefix.match(/{/g) ?? []).length !== (prefix.match(/}/g) ?? []).length)
      continue;
    const start = (match.index ?? 0) + match[0].lastIndexOf("{");
    const end = objectEnd(masked, start);
    if (
      end < 0 ||
      !/^(?:[\t ]*;|[\t ]*(?=\r?\n|$))/.test(masked.slice(end + 1))
    )
      continue;
    if (inspectObject(source, masked, start, end, match[1], 0, false))
      return true;
  }
  return false;
}

function inspectObject(
  source: string,
  masked: string,
  start: number,
  end: number,
  owner: string,
  depth: number,
  envelopeSpread: boolean
): boolean {
  const members = directMembers(masked, start, end);
  if (members === undefined) return false;
  const counts = new Map<string, number>();
  const values = new Map<string, string>();
  const children: Array<readonly [number, number, string]> = [];
  let invalid = envelopeSpread,
    nested = false,
    spread = false;
  for (const [memberStart, memberEnd] of members) {
    const part = masked.slice(memberStart, memberEnd);
    if (part.trim() === "") continue;
    if (/^\s*\.\.\./.test(part)) {
      invalid = spread = true;
      continue;
    }
    const property = /^\s*([A-Za-z_$][A-Za-z0-9_$]*)\s*:/.exec(part);
    if (property === null) {
      invalid = true;
      continue;
    }
    const key = property[1];
    const colon = part.indexOf(":", property[0].length - 1);
    const visible = part.slice(colon + 1).trim();
    const valueStart = memberStart + part.indexOf(visible, colon + 1);
    const valueEnd = valueStart + visible.length;
    const original = source.slice(valueStart, valueEnd);
    if (visible.startsWith("{")) {
      const childEnd = objectEnd(masked, valueStart);
      nested = true;
      if (childEnd !== valueEnd - 1) invalid = true;
      else children.push([valueStart, childEnd, key]);
      continue;
    }
    if (/^(?:relayerGasToken|gasToken|chain|chainId)$/.test(key)) {
      counts.set(key, (counts.get(key) ?? 0) + 1);
      const value =
        key === "chainId" && /^\d+$/.test(original)
          ? original
          : stringValue(original);
      if (value === undefined) invalid = true;
      else values.set(key, value);
    } else if (
      stringValue(original) === undefined &&
      !/^(?:true|false|null|-?\d+(?:\.\d+)?)$/.test(original)
    )
      invalid = true;
  }
  const childKeys = children.map(([, , key]) => key);
  if (
    depth === 0 &&
    !invalid &&
    new Set(childKeys).size === childKeys.length &&
    children.some(([childStart, childEnd, key]) =>
      inspectObject(source, masked, childStart, childEnd, key, 1, spread)
    )
  )
    return true;
  if (invalid || nested) return false;
  if (
    (counts.get("relayerGasToken") ?? 0) + (counts.get("gasToken") ?? 0) !==
      1 ||
    (counts.get("chain") ?? 0) > 1 ||
    (counts.get("chainId") ?? 0) > 1
  )
    return false;
  const chain = values.get("chain");
  const chainId = values.get("chainId");
  if (
    (chain !== undefined &&
      !/^(?:Arc(?: Testnet)?|Arc_Testnet|arcTestnet)$/i.test(chain)) ||
    (chainId !== undefined && chainId !== "5042002")
  )
    return false;
  const relayerToken = values.get("relayerGasToken");
  return (
    (hasSegment(owner, "arc") ||
      chain !== undefined ||
      chainId === "5042002") &&
    (relayerToken !== undefined ||
      hasSegment(owner, "relayer") ||
      hasSegment(owner, "relay")) &&
    /^ETH$/i.test(relayerToken ?? values.get("gasToken") ?? "")
  );
}

function directMembers(masked: string, start: number, end: number) {
  const members: Array<readonly [number, number]> = [];
  let memberStart = start + 1,
    braces = 0;
  for (let index = memberStart; index < end; index += 1) {
    const character = masked[index];
    if (character === "{") braces += 1;
    if (character === "}") braces -= 1;
    if (character === "," && braces === 0) {
      members.push([memberStart, index]);
      memberStart = index + 1;
    }
  }
  if (braces !== 0) return undefined;
  members.push([memberStart, end]);
  return members;
}

function objectEnd(masked: string, start: number): number {
  let depth = 0;
  for (let index = start; index < masked.length; index += 1) {
    if (masked[index] === "{") depth += 1;
    if (masked[index] === "}" && --depth === 0) return index;
  }
  return -1;
}

function stringValue(source: string): string | undefined {
  const match = /^"([^"\\\r\n]*)"$|^'([^'\\\r\n]*)'$/.exec(source);
  return match?.[1] ?? match?.[2];
}

function hasSegment(owner: string, expected: string): boolean {
  return owner
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(/[_$\s]+/)
    .some((segment) => segment.toLowerCase() === expected);
}

function maskInert(source: string): string {
  return source.replace(
    /"(?:\\[\s\S]|[^"\\])*(?:"|$)|'(?:\\[\s\S]|[^'\\])*(?:'|$)|`(?:\\[\s\S]|[^`\\])*(?:`|$)|\/\/[^\r\n]*|\/\*[\s\S]*?(?:\*\/|$)/g,
    (token) => {
      const quoted =
        (token[0] === "'" || token[0] === '"') && token.at(-1) === token[0];
      return token.replace(/[^\r\n]/g, (character, index) =>
        quoted && (index === 0 || index === token.length - 1) ? character : " "
      );
    }
  );
}
