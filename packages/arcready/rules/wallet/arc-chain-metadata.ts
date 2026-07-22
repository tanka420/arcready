import type { Rule } from "../../core/rules/index.js";
import { WALLET_DOCS, createWalletFinding } from "./helpers.js";

type Span = readonly [number, number];
type Fields = ReadonlyMap<string, Span>;
type Issue = "missing" | "incorrect" | "rpc" | "explorer";

const CHAIN_FIX =
  'Set this object\'s id or chainId to 5042002; use "0x4CF4B2" for EIP-3085 string metadata.';
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
      if (!supported(filePath)) continue;
      let source: string;
      try {
        source = await context.readFile(filePath);
      } catch {
        continue;
      }
      const issue = inspect(source);
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

function supported(filePath: string): boolean {
  const path = filePath.replaceAll("\\", "/");
  const name = path.split("/").at(-1) ?? "";
  return (
    /\.[jt]s$/i.test(name) &&
    !/\.(?:test|spec)\.[jt]s$/i.test(name) &&
    !/(?:^|\/)(?:test|tests|__tests__)(?:\/|$)/i.test(path)
  );
}

const inspect = (() => {
  const FAMILY =
    /^(?:id|chainId|name|chainName|nativeCurrency|rpcUrls|wsUrls|blockExplorers|blockExplorerUrls)$/;
  const ETH_RPC =
    /^(?:cloudflare-eth\.com|(?:mainnet|sepolia|holesky)\.infura\.io|eth-(?:mainnet|sepolia|holesky)\.g\.alchemy\.com|ethereum(?:-(?:sepolia|holesky)-rpc)?\.publicnode\.com)$/;
  const TERMINAL =
    /^\s*(?:as\s+const\b\s*)?(?:satisfies\s+[A-Za-z_$][\w$]*(?:\s*\.\s*[A-Za-z_$][\w$]*)*(?:\s*<\s*[A-Za-z_$][\w$]*(?:\s*\.\s*[A-Za-z_$][\w$]*)*\s*>)?\s*)?(;|$)/;
  const CONTINUATION =
    /^(?:\?\.|&&|\|\||\?\?|as\b|satisfies\b|in\b|instanceof\b|[.(*%+!`?:,=<>&|^-]|[[]|[/])/;
  function scan(source: string): Issue | undefined {
    const masked = mask(source);
    if (masked === undefined) return undefined;
    const declaration =
      /(?:^|[\r\n])\s*(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:(defineChain)\s*\(\s*)?\{/g;
    for (const match of masked.matchAll(declaration)) {
      const start = (match.index ?? 0) + match[0].lastIndexOf("{");
      const end = closeAt(masked, start, "{", "}");
      if (end < 0 || !balanced(masked, start, end)) continue;
      if (masked.slice(start, end + 1).includes("/")) continue;
      let suffixAt = end + 1;
      if (match[2]) {
        const callClose = /^\s*\)/.exec(masked.slice(suffixAt));
        if (callClose === null) continue;
        suffixAt += callClose[0].length;
      }
      if (!terminal(masked, suffixAt)) continue;
      const root = fieldsAt(masked, [start, end + 1]);
      if (root === undefined || masked.slice(start, end).includes("..."))
        continue;
      const direct = candidate(
        source,
        masked,
        root,
        [start, end + 1],
        match[1]
      );
      if (direct !== undefined) return direct;
      const children = [...root].filter(([key]) => arcSegment(key));
      if (children.length !== 1 || masked[children[0][1][0]] !== "{") continue;
      const [childOwner, childSpan] = children[0];
      const child = fieldsAt(masked, childSpan);
      if (child === undefined) continue;
      const nested = candidate(source, masked, child, childSpan, childOwner);
      if (nested !== undefined) return nested;
    }
    return undefined;
  }
  function terminal(source: string, start: number): boolean {
    const remainder = source.slice(start);
    const lineBreak = remainder.search(/[\r\n]/);
    const line = lineBreak < 0 ? remainder : remainder.slice(0, lineBreak);
    const match = TERMINAL.exec(line);
    if (match === null) return false;
    if (match[1] === ";") return true;
    const next = lineBreak < 0 ? "" : remainder.slice(lineBreak).trimStart();
    return next === "" || !CONTINUATION.test(next);
  }
  function balanced(source: string, start: number, end: number): boolean {
    const stack: string[] = [];
    for (let index = start; index <= end; index++) {
      const char = source[index];
      if (char === "{" || char === "[" || char === "(") stack.push(char);
      else if (char === "}" && stack.pop() !== "{") return false;
      else if (char === "]" && stack.pop() !== "[") return false;
      else if (char === ")" && stack.pop() !== "(") return false;
    }
    return stack.length === 0;
  }
  function candidate(
    source: string,
    masked: string,
    fields: Fields,
    span: Span,
    owner: string
  ): Issue | undefined {
    if (masked.slice(...span).includes("/")) return undefined;
    const families = new Set(
      [...fields.keys()].filter((key) => FAMILY.test(key)).map(family)
    );
    if (families.size < 2) return undefined;
    const named = ["name", "chainName"].some((key) => {
      const span = fields.get(key);
      return (
        span !== undefined &&
        stringValue(source.slice(...span)) === "Arc Testnet"
      );
    });
    const strong = arcSegment(owner) || named;
    const id = idValue(source, fields);
    if (id === "ambiguous") return undefined;
    if (id === "missing" && strong) return "missing";
    if (typeof id === "bigint" && id !== 5042002n)
      return strong ? "incorrect" : undefined;
    if (!strong && id !== 5042002n) return undefined;
    const rpc = urls(source, masked, fields, "rpc");
    if (rpc === undefined) return undefined;
    if (rpc.some(ethereumRpc)) return "rpc";
    const explorers = urls(source, masked, fields, "explorer");
    return explorers?.some(etherscan) ? "explorer" : undefined;
  }
  function idValue(
    source: string,
    fields: Fields
  ): bigint | "missing" | "ambiguous" {
    const spans = [fields.get("id"), fields.get("chainId")].filter(
      (span): span is Span => span !== undefined
    );
    if (spans.length === 0) return "missing";
    const values = spans.map((span) => {
      const text = source.slice(...span).trim(),
        value = stringValue(text) ?? text;
      if (!/^(?:\d+|0x[\da-f]+)$/i.test(value)) return undefined;
      if (/^0x4cf4b2$/i.test(value)) return 5042002n;
      try {
        return BigInt(value);
      } catch {
        return undefined;
      }
    });
    if (
      values.some((value) => value === undefined) ||
      (values.length === 2 && values[0] !== values[1])
    )
      return "ambiguous";
    return values[0] as bigint;
  }
  function urls(
    source: string,
    masked: string,
    fields: Fields,
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
      let current = fields,
        span = current.get(path[0]);
      if (span === undefined) continue;
      if (path.length === 1 && path[0] === "rpcUrls" && masked[span[0]] === "{")
        continue;
      if (path.length > 1 && path[0] === "rpcUrls" && masked[span[0]] === "[")
        continue;
      for (const key of path.slice(1)) {
        if (masked[span[0]] !== "{") return undefined;
        const nested = fieldsAt(masked, span);
        if (nested === undefined) return undefined;
        current = nested;
        span = current.get(key);
        if (span === undefined) break;
      }
      if (span === undefined) continue;
      if (masked[span[0]] === "[") {
        const values = arrayValues(source, masked, span);
        if (values === undefined) return undefined;
        result.push(...values);
      } else {
        const value = stringValue(source.slice(...span));
        if (value === undefined) return undefined;
        result.push(value);
      }
    }
    return result;
  }
  function fieldsAt(masked: string, span: Span): Fields | undefined {
    const endAt = closeAt(masked, span[0], "{", "}");
    if (masked[span[0]] !== "{" || endAt !== span[1] - 1) return undefined;
    const fields = new Map<string, Span>();
    for (const member of members(masked, span[0], span[1] - 1)) {
      const part = masked.slice(...member);
      if (part.trim() === "") continue;
      const property = /^\s*([A-Za-z_$][\w$]*)\s*:/.exec(part);
      if (property === null || fields.has(property[1])) return undefined;
      const colon = part.indexOf(":", property[0].length - 1);
      const start =
        member[0] +
        colon +
        1 +
        (part.slice(colon + 1).match(/^\s*/)?.[0].length ?? 0);
      const end = member[1] - (part.match(/\s*$/)?.[0].length ?? 0);
      if (start >= end) return undefined;
      fields.set(property[1], [start, end]);
    }
    return fields;
  }
  function arrayValues(
    source: string,
    masked: string,
    span: Span
  ): string[] | undefined {
    const endAt = closeAt(masked, span[0], "[", "]");
    if (masked[span[0]] !== "[" || endAt !== span[1] - 1) return undefined;
    const result: string[] = [];
    for (const item of members(masked, span[0], span[1] - 1)) {
      if (masked.slice(...item).trim() === "") continue;
      const value = stringValue(source.slice(...item));
      if (value === undefined) return undefined;
      result.push(value);
    }
    return result;
  }
  function members(source: string, start: number, end: number): Span[] {
    const result: Span[] = [];
    let from = start + 1,
      braces = 0,
      brackets = 0,
      parentheses = 0;
    for (let index = from; index < end; index++) {
      const char = source[index];
      if (char === "{") braces++;
      else if (char === "}") braces--;
      else if (char === "[") brackets++;
      else if (char === "]") brackets--;
      else if (char === "(") parentheses++;
      else if (char === ")") parentheses--;
      else if (
        char === "," &&
        braces === 0 &&
        brackets === 0 &&
        parentheses === 0
      ) {
        result.push([from, index]);
        from = index + 1;
      }
    }
    result.push([from, end]);
    return result;
  }
  function closeAt(
    source: string,
    start: number,
    open: string,
    close: string
  ): number {
    let depth = 0;
    for (let index = start; index < source.length; index++) {
      if (source[index] === open) depth++;
      if (source[index] === close && --depth === 0) return index;
    }
    return -1;
  }
  function family(key: string): string {
    if (key === "id" || key === "chainId") return "id";
    if (key === "name" || key === "chainName") return "name";
    if (key === "rpcUrls" || key === "wsUrls") return "rpc";
    if (key === "blockExplorers" || key === "blockExplorerUrls")
      return "explorer";
    return key;
  }
  function stringValue(source: string): string | undefined {
    const match = /^\s*"([^"\\\r\n]*)"\s*$|^\s*'([^'\\\r\n]*)'\s*$/.exec(
      source
    );
    return match?.[1] ?? match?.[2];
  }
  function arcSegment(identifier: string): boolean {
    return identifier
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
      .split(/[_$\s]+/)
      .some((segment) => segment.toLowerCase() === "arc");
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

  function mask(source: string): string | undefined {
    let malformed = false;
    const masked = source.replace(
      /"(?:\\[\s\S]|[^"\\])*(?:"|$)|'(?:\\[\s\S]|[^'\\])*(?:'|$)|`(?:\\[\s\S]|[^`\\])*(?:`|$)|\/\/[^\r\n]*|\/\*[\s\S]*?(?:\*\/|$)/g,
      (token) => {
        const quote = token[0],
          quoted = quote === '"' || quote === "'" || quote === "`";
        const terminated = quoted
          ? token.at(-1) === quote
          : token.endsWith("*/");
        if ((quoted || token.startsWith("/*")) && !terminated) malformed = true;
        const preserve = terminated && quoted;
        return token.replace(/[^\r\n]/g, (char, index) =>
          preserve && (index === 0 || index === token.length - 1) ? char : " "
        );
      }
    );
    return malformed ? undefined : masked;
  }
  return scan;
})();
