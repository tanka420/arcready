import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_CONFIG,
  arcChainMetadataRule,
  createStubReport,
  noBlobTxOnArcRule,
  noEthGasLabelRule,
  oneConfirmationFinalRule,
  prevrandaoNotSupportedRule,
  runRules,
  walletNativeUsdcDisplayRule
} from "../src/index.js";
import type { Rule, RuleContext } from "../src/index.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("wallet rules", () => {
  const wrongMetadata = '{ id: 1, name: "Arc Testnet" }';
  const directWrongMetadata = `const arcTestnet = ${wrongMetadata}`;
  const defineWrongMetadata = `const arcTestnet =\n  defineChain(${wrongMetadata})`;
  const wrapperMetadata = (members: string) => `const chains = { ${members} };`;
  const positiveMetadataCases = [
    [
      "P01 / T06 / NL11 no-semicolon object at end of file",
      directWrongMetadata,
      "incorrect"
    ],
    [
      "P02 / T10 plain direct defineChain",
      "export const arcTestnet = defineChain({ id: 1, name: 'Arc Testnet' })",
      "incorrect"
    ],
    [
      "P03 missing ID",
      "const arcTestnet = { name: 'Arc Testnet', rpcUrls: ['https://rpc.testnet.arc.network'] };",
      "missing"
    ],
    [
      "P04 Ethereum RPC",
      "const chain = { id: 5042002, rpcUrls: ['https://cloudflare-eth.com'] };",
      "rpc"
    ],
    [
      "P05 Etherscan explorer",
      "const chain = { id: 5042002, blockExplorerUrls: ['https://sepolia.etherscan.io'] };",
      "explorer"
    ],
    [
      "P06 unrelated correct ID",
      "const helper = { id: 5042002, name: 'Other' };\nconst arcTestnet = { id: 1, name: 'Arc Testnet' };",
      "incorrect"
    ],
    [
      "P07 Ethereum siblings",
      "const mainnet = { id: 1, rpcUrls: ['https://cloudflare-eth.com'] };\nconst arcTestnet = { id: 2, name: 'Arc Testnet' };",
      "incorrect"
    ],
    [
      "P08 / W04 exactly one Arc-named wrapper child",
      "export const chains = { mainnet: { id: 1, name: 'Ethereum' }, arcTestnet: { id: 1, name: 'Arc Testnet' } };",
      "incorrect"
    ],
    [
      "I01 wrong numeric hexadecimal literal",
      "const arcTestnet = { id: 0x1, name: 'Arc Testnet' };",
      "incorrect"
    ],
    [
      "I02 wrong quoted decimal literal",
      "const arcTestnet = { chainId: '1', name: 'Arc Testnet' };",
      "incorrect"
    ],
    [
      "I03 wrong quoted hexadecimal literal",
      "const arcTestnet = { chainId: '0x1', name: 'Arc Testnet' };",
      "incorrect"
    ],
    [
      "U01 / S04 quoted Ethereum RPC URL",
      "const arcTestnet = { id: 5042002, rpcUrls: { default: { http: ['https://cloudflare-eth.com'] } } };",
      "rpc"
    ],
    [
      "U02 Ethereum URL at rpcUrls.default.webSocket",
      "const arcTestnet = { id: 5042002, rpcUrls: { default: { webSocket: ['wss://sepolia.infura.io/ws/v3/demo'] } } };",
      "rpc"
    ],
    [
      "U03 / S04 quoted Etherscan explorer URL",
      "const arcTestnet = { id: 5042002, blockExplorers: { default: { url: 'https://etherscan.io' } } };",
      "explorer"
    ],
    [
      "S05 slash characters in comments remain inert",
      'const arcTestnet = {\n  id: 1, // slash /\n  name: "Arc Testnet" /* slash / */\n};',
      "incorrect"
    ],
    [
      "WR05 quoted URL sibling remains inert",
      wrapperMetadata(
        `url: "https://example.com", arcTestnet: ${wrongMetadata}`
      ),
      "incorrect"
    ],
    [
      "WR06 template sibling with slash and brace remains inert",
      wrapperMetadata("note: `slash / brace }`, arcTestnet: " + wrongMetadata),
      "incorrect"
    ],
    [
      "WR07 comment slash sibling remains inert",
      wrapperMetadata(
        `arcTestnet: ${wrongMetadata}, // regex example: /};/\nvalue: 1`
      ),
      "incorrect"
    ],
    [
      "T07 / A02 direct object with as const",
      "const arcTestnet = { id: 1, name: 'Arc Testnet' } as const;",
      "incorrect"
    ],
    [
      "T08 direct object with satisfies Chain",
      "const arcTestnet = { id: 1, name: 'Arc Testnet' } satisfies Chain;",
      "incorrect"
    ],
    [
      "T09 / A03 direct object with as const satisfies Chain",
      "const arcTestnet = { id: 1, name: 'Arc Testnet' } as const satisfies Chain;",
      "incorrect"
    ],
    [
      "T11 defineChain with satisfies Chain",
      "const arcTestnet = defineChain({ id: 1, name: 'Arc Testnet' }) satisfies Chain;",
      "incorrect"
    ],
    [
      "T12 / NL13 semicolon followed by same-line code",
      "const arcTestnet = { id: 1, name: 'Arc Testnet' }; const other = 1;",
      "incorrect"
    ],
    [
      "NL12 no-semicolon object followed by next-line const",
      `${directWrongMetadata}\nconst other = 1`,
      "incorrect"
    ],
    [
      "non-Arc name keeps identifier ownership",
      "const arcTestnet = { id: 1, name: 'Ethereum' };",
      "incorrect"
    ]
  ] as const;

  it.each(positiveMetadataCases)(
    "ARC_CHAIN_METADATA finds %s",
    async (_name, source, issue) => {
      const findings = await runWalletRule(arcChainMetadataRule, source);
      const messages = {
        missing:
          "Arc-owned chain metadata is missing a direct literal Arc Testnet chain ID.",
        incorrect:
          "Arc-owned chain metadata uses a direct literal chain ID other than Arc Testnet 5042002.",
        rpc: "Arc-owned chain metadata contains an RPC URL for Ethereum mainnet, Sepolia, or Holesky.",
        explorer:
          "Arc-owned chain metadata contains an Etherscan URL for Ethereum mainnet, Sepolia, or Holesky."
      } as const;

      expect(findings).toHaveLength(1);
      expect(findings[0]).toMatchObject({
        ruleId: "wallet/ARC_CHAIN_METADATA",
        severity: "critical",
        preset: "wallet",
        docs: "arc-chain-metadata",
        message: messages[issue]
      });
      expect(findings[0]?.suggestedFix).not.toMatch(/USDC|display|decimals/i);
    }
  );

  const malformedMetadata = (member: string) =>
    `const arcTestnet = {\n  id: 1,\n  ${member}\n};`;
  const slashMetadata = (member: string) =>
    malformedMetadata(`name: "Arc Testnet",\n  ${member}`);
  const negativeMetadataCases = [
    [
      "N01 official endpoints",
      "const arcTestnet = { id: 5042002, name: 'Arc Testnet', rpcUrls: { default: { http: ['https://rpc.testnet.arc.network'], webSocket: ['wss://rpc.testnet.arc.network'] } }, blockExplorers: { default: { url: 'https://testnet.arcscan.app' } } };"
    ],
    [
      "N02 EIP-3085 hex string",
      "const arcTestnet = { chainId: '0x4CF4B2', chainName: 'Arc Testnet', rpcUrls: ['https://rpc.testnet.arc.network'] };"
    ],
    [
      "N03 numeric hex",
      "const arcTestnet = { id: 0x4cf4b2, name: 'Arc Testnet' };"
    ],
    [
      "V01 direct quoted decimal chain ID",
      "const arcTestnet = { chainId: '5042002', name: 'Arc Testnet' };"
    ],
    [
      "U04 Etherscan lookalike host",
      "const arcTestnet = { id: 5042002, blockExplorers: { default: { url: 'https://etherscan.io.example.com' } } };"
    ],
    [
      "T01 property access after object",
      'const arcTestnet =\n  { id: 1, name: "Arc Testnet" }.foo;'
    ],
    [
      "T02 conditional expression after object",
      'const arcTestnet =\n  { id: 1, name: "Arc Testnet" } ? first : second;'
    ],
    [
      "T03 binary continuation after object",
      'const arcTestnet =\n  { id: 1, name: "Arc Testnet" } + other;'
    ],
    [
      "T04 chained defineChain result",
      'const arcTestnet =\n  defineChain({ id: 1, name: "Arc Testnet" }).extend({});'
    ],
    [
      "T05 optional chaining after defineChain",
      'const arcTestnet =\n  defineChain({ id: 1, name: "Arc Testnet" })?.custom;'
    ],
    [
      "RXL01 declaration-like text in regex literal",
      'const matcher =\n  /; const arcTestnet = { id: 1, name: "Arc Testnet" };/;',
      "src/matcher.js"
    ],
    ["M01 mismatched parenthesis", malformedMetadata('name: "Arc Testnet")')],
    ["M02 mismatched bracket", malformedMetadata('name: "Arc Testnet"]')],
    ["M03 unclosed parenthesis", malformedMetadata('name: ("Arc Testnet"')],
    ["M04 unclosed bracket", malformedMetadata('name: ["Arc Testnet"')],
    [
      "M05 mismatched nested delimiters",
      malformedMetadata("rpcUrls: { default: [ }")
    ],
    ["NL01 cross-line property access", `${directWrongMetadata}\n  .foo;`],
    ["NL02 cross-line optional access", `${directWrongMetadata}\n  ?.foo;`],
    [
      "NL03 cross-line binary continuation",
      `${directWrongMetadata}\n  + other;`
    ],
    [
      "NL04 cross-line conditional",
      `${directWrongMetadata}\n  ? first : second;`
    ],
    ["NL05 cross-line indexing", `${directWrongMetadata}\n  [0];`],
    ["NL06 cross-line call", `${directWrongMetadata}\n  ();`],
    [
      "NL07 cross-line unsupported cast",
      `${directWrongMetadata}\n  as unknown as Chain;`
    ],
    [
      "NL08 cross-line complex satisfies",
      `${directWrongMetadata}\n  satisfies Complex & Chain;`
    ],
    [
      "NL09 cross-line defineChain call",
      `${defineWrongMetadata}\n    .extend({});`
    ],
    [
      "NL10 cross-line defineChain optional access",
      `${defineWrongMetadata}\n    ?.custom;`
    ],
    ["E01 cross-line strict inequality", `${directWrongMetadata}\n!== other;`],
    ["E02 cross-line inequality", `${directWrongMetadata}\n!= other;`],
    [
      "E03 cross-line TypeScript non-null access",
      `${directWrongMetadata}\n!["property"];`
    ],
    ["B01 tagged-template continuation", `${directWrongMetadata}\n\`tag\`;`],
    [
      "B02 declaration-like source inside standalone template",
      'const example = `\n  const arcTestnet = { id: 1, name: "Arc Testnet" };\n`;'
    ],
    [
      "B03 template-valued metadata",
      "const chain = {\n  id: 1,\n  name: `Arc Testnet`\n};"
    ],
    [
      "A01 malformed as constsatisfies suffix",
      `${directWrongMetadata} as constsatisfies Chain;`
    ],
    [
      "S01 regex containing brace and semicolon",
      slashMetadata("pattern: /};/")
    ],
    ["S02 regex containing brace", slashMetadata("pattern: /}/")],
    ["S03 division expression", slashMetadata("value: total / count")],
    [
      "WR01 regex /};/ sibling after Arc child",
      wrapperMetadata(`arcTestnet: ${wrongMetadata}, pattern: /};/`)
    ],
    [
      "WR02 regex /}/ sibling after Arc child",
      wrapperMetadata(`arcTestnet: ${wrongMetadata}, pattern: /}/`)
    ],
    [
      "WR03 division sibling after Arc child",
      wrapperMetadata(`arcTestnet: ${wrongMetadata}, value: total / count`)
    ],
    [
      "WR04 division sibling before Arc child",
      wrapperMetadata(`value: total / count, arcTestnet: ${wrongMetadata}`)
    ],
    [
      "W01 imported and object Arc-named children",
      `const chains = { arcImported: importedArc, arcTestnet: ${wrongMetadata} };`
    ],
    [
      "W02 two object Arc-named children",
      `const chains = { arcOne: ${wrongMetadata}, arcTwo: ${wrongMetadata} };`
    ],
    [
      "W03 only Arc-named child is imported",
      "const chains = { arcTestnet: importedArc };"
    ],
    [
      "N04 isolated Ethereum sibling",
      "const arcTestnet = { id: 5042002, name: 'Arc Testnet' };\nconst mainnet = { id: 1, rpcUrls: ['https://cloudflare-eth.com'], blockExplorerUrls: ['https://etherscan.io'] };"
    ],
    [
      "N05 managed or custom endpoint",
      "const arcTestnet = { id: 5042002, rpcUrls: ['https://arc-testnet.g.alchemy.com/v2/demo', 'https://rpc.corp.example'] };"
    ],
    [
      "N06 documentation prose",
      "export const docs = 'Arc Testnet uses chainId 1, rpcUrls, and Etherscan';"
    ],
    [
      "N07 comments",
      "// const arcTestnet = { id: 1, rpcUrls: ['https://cloudflare-eth.com'] };\n/* Arc Testnet chainId */"
    ],
    [
      "N08 strings and templates",
      "const text = \"const arcTestnet = { id: 1, rpcUrls: ['https://cloudflare-eth.com'] }\";\nconst template = `Arc Testnet ${5042002} etherscan.io`;"
    ],
    [
      "N09 Ethereum only",
      "const mainnet = { id: 1, name: 'Ethereum', rpcUrls: ['https://cloudflare-eth.com'] };"
    ],
    [
      "N10 computed ID",
      "const arcTestnet = { id: ARC_ID, name: 'Arc Testnet', rpcUrls: ['https://cloudflare-eth.com'] };"
    ],
    [
      "N11 computed RPC",
      "const arcTestnet = { id: 5042002, rpcUrls: ARC_RPC_URLS };"
    ],
    [
      "N12 spread",
      "const arcTestnet = { ...base, id: 1, name: 'Arc Testnet' };"
    ],
    [
      "N13 duplicate same key",
      "const arcTestnet = { id: 1, id: 5042002, name: 'Arc Testnet' };"
    ],
    [
      "N14 conflicting aliases",
      "const arcTestnet = { id: 5042002, chainId: 1, name: 'Arc Testnet' };"
    ],
    [
      "N15 coherent aliases",
      "const arcTestnet = { id: 5042002, chainId: '5042002', name: 'Arc Testnet' };"
    ],
    ["N16 quoted key", "const arcTestnet = { 'id': 1, name: 'Arc Testnet' };"],
    [
      "N16 computed key",
      "const arcTestnet = { [chainKey]: 1, name: 'Arc Testnet' };"
    ],
    [
      "N17 malformed object",
      "const arcTestnet = { id: 1, name: 'Arc Testnet';"
    ],
    [
      "N18 deep wrapper",
      "const config = { networks: { arcTestnet: { id: 1, name: 'Arc Testnet' } } };"
    ],
    [
      "N19 unrelated wrong endpoint",
      "const arcTestnet = { id: 5042002, name: 'Arc Testnet' };\nconst rpc = 'https://cloudflare-eth.com';"
    ],
    ["N20 default export", "export default { id: 1, name: 'Arc Testnet' };"],
    ["N21 let", "let arcTestnet = { id: 1, name: 'Arc Testnet' };"],
    ["N21 var", "var arcTestnet = { id: 1, name: 'Arc Testnet' };"]
  ] as const;

  it.each(negativeMetadataCases)(
    "ARC_CHAIN_METADATA ignores %s",
    async (_name, source, filePath) => {
      await expect(
        runWalletRule(arcChainMetadataRule, source, {}, filePath)
      ).resolves.toEqual([]);
    }
  );

  it.each([".js", ".ts"])(
    "ARC_CHAIN_METADATA supports %s",
    async (extension) => {
      const findings = await runWalletRule(
        arcChainMetadataRule,
        "const arcTestnet = { id: 1, name: 'Arc Testnet' };",
        {},
        `src/chain${extension}`
      );
      expect(findings).toHaveLength(1);
    }
  );

  it.each([".jsx", ".tsx", ".json", ".md", ".mdx", ".yaml", ".yml", ".sol"])(
    "ARC_CHAIN_METADATA ignores %s",
    async (extension) => {
      await expect(
        runWalletRule(
          arcChainMetadataRule,
          "const arcTestnet = { id: 1, name: 'Arc Testnet' };",
          {},
          `src/chain${extension}`
        )
      ).resolves.toEqual([]);
    }
  );

  it("ARC_CHAIN_METADATA ignores declaration-like JSX text in .tsx", async () => {
    await expect(
      runWalletRule(
        arcChainMetadataRule,
        '<div>const arcTestnet = { id: 1, name: "Arc Testnet" };</div>',
        {},
        "src/component.tsx"
      )
    ).resolves.toEqual([]);
  });

  it.each([
    "src/chain.test.ts",
    "src/chain.spec.js",
    "test/chain.ts",
    "tests/chain.ts",
    "src/__tests__/chain.ts"
  ])("ARC_CHAIN_METADATA ignores test path %s", async (filePath) => {
    await expect(
      runWalletRule(
        arcChainMetadataRule,
        "const arcTestnet = { id: 1, name: 'Arc Testnet' };",
        {},
        filePath
      )
    ).resolves.toEqual([]);
  });

  it("ARC_CHAIN_METADATA emits at most one deterministic finding per file", async () => {
    const source =
      "const arcFirst = { id: 1, name: 'Arc Testnet' };\nconst arcSecond = { id: 2, name: 'Arc Testnet' };";
    const first = await runWalletRule(arcChainMetadataRule, source);
    const second = await runWalletRule(arcChainMetadataRule, source);
    expect(first).toHaveLength(1);
    expect(first).toEqual(second);
  });

  it("ARC_CHAIN_METADATA keeps read failures non-fatal", async () => {
    const findings = await runRules([arcChainMetadataRule], {
      projectRoot: "/fixture",
      config: DEFAULT_CONFIG,
      files: ["src/unreadable.ts", "src/arc.ts"],
      detectedPresets: {
        detectedPresets: ["wallet"],
        confidence: "high",
        reasons: ["test"]
      },
      readFile: async (filePath) => {
        if (filePath.endsWith("unreadable.ts")) throw new Error("unreadable");
        return "const arcTestnet = { id: 1, name: 'Arc Testnet' };";
      }
    });
    expect(findings).toHaveLength(1);
  });

  const nativeMessage =
    "Arc-owned chain metadata sets nativeCurrency.name to ETH/Ethereum or nativeCurrency.symbol to a value other than USDC.";
  const nativeFix =
    'Set nativeCurrency.symbol to "USDC". If nativeCurrency.name is "ETH" or "Ethereum", replace it with a USDC-facing name such as "USDC" or "USD Coin". Handle Arc native accounting precision and USDC display precision according to the integration surface.';
  const positiveNativeCurrencyCases = [
    [
      "P01 direct ETH name",
      'const arcChain = { id: 5042002, nativeCurrency: { name: "ETH" } };'
    ],
    [
      "P02 direct Ethereum name",
      'const arcChain = { id: 5042002, nativeCurrency: { name: "Ethereum" } };'
    ],
    [
      "P03 direct ETH symbol",
      'const arcChain = { id: 5042002, nativeCurrency: { name: "USD Coin", symbol: "ETH" } };'
    ],
    [
      "P04 direct DAI symbol",
      'const arcChain = { id: 5042002, nativeCurrency: { symbol: "DAI" } };'
    ],
    [
      "empty symbol",
      'const arcChain = { id: 5042002, nativeCurrency: { symbol: "" } };'
    ],
    [
      "whitespace-padded USDC symbol",
      'const arcChain = { id: 5042002, nativeCurrency: { symbol: " USDC " } };'
    ],
    [
      "P05 Arc identifier with wrong ID",
      'const arcTestnet = { id: 1, nativeCurrency: { symbol: "ETH" } };'
    ],
    [
      "P06 generic identifier with Arc ID",
      'const chain = { id: 5042002, nativeCurrency: { symbol: "ETH" } };'
    ],
    [
      "P07 exact Arc Testnet name",
      'const chain = { name: "Arc Testnet", nativeCurrency: { name: "ETH" } };'
    ],
    [
      "P08 direct defineChain",
      'export const arcChain = defineChain({ id: 5042002, nativeCurrency: { symbol: "ETH" } });'
    ],
    [
      "P09 as const",
      'const arcChain = { id: 5042002, nativeCurrency: { symbol: "ETH" } } as const;'
    ],
    [
      "P10 satisfies",
      'const arcChain = { id: 5042002, nativeCurrency: { symbol: "ETH" } } satisfies Chain;'
    ],
    [
      "P11 one Arc wrapper child",
      'const chains = { arcTestnet: { id: 5042002, nativeCurrency: { symbol: "ETH" } } };'
    ],
    [
      "P12 Ethereum sibling before Arc child",
      'const chains = { mainnet: { id: 1, nativeCurrency: { symbol: "ETH" } }, arcTestnet: { id: 5042002, nativeCurrency: { symbol: "DAI" } } };'
    ],
    [
      "P13 Ethereum sibling after Arc child",
      'const chains = { arcTestnet: { id: 5042002, nativeCurrency: { symbol: "DAI" } }, mainnet: { id: 1, nativeCurrency: { symbol: "ETH" } } };'
    ],
    [
      "P14 bad name and symbol",
      'const arcChain = { id: 5042002, nativeCurrency: { name: "ETH", symbol: "DAI" } };'
    ],
    [
      "P16 numeric hexadecimal Arc ID",
      'const chain = { id: 0x4cf4b2, nativeCurrency: { symbol: "ETH" } };'
    ],
    [
      "P16 quoted hexadecimal Arc ID",
      'const chain = { chainId: "0x4CF4B2", nativeCurrency: { symbol: "ETH" } };'
    ],
    [
      "P17 unresolved name with direct bad symbol",
      'const arcChain = { id: 5042002, nativeCurrency: { name: importedName, symbol: "ETH" } };'
    ]
  ] as const;

  it.each(positiveNativeCurrencyCases)(
    "WALLET_NATIVE_USDC_DISPLAY finds %s",
    async (_name, source) => {
      const findings = await runWalletRule(walletNativeUsdcDisplayRule, source);

      expect(findings).toEqual([
        {
          ruleId: "wallet/WALLET_NATIVE_USDC_DISPLAY",
          severity: "critical",
          message: nativeMessage,
          files: ["src/fixture.ts"],
          suggestedFix: nativeFix,
          docs: "arc-usdc-gas",
          preset: "wallet"
        }
      ]);
    }
  );

  const negativeNativeCurrencyCases = [
    [
      "N01 Ethereum sibling bad and Arc sibling safe",
      'const chains = { mainnet: { id: 1, nativeCurrency: { symbol: "ETH" } }, arcTestnet: { id: 5042002, nativeCurrency: { name: "USD Coin", symbol: "USDC" } } };'
    ],
    [
      "N02 unrelated generic ETH metadata",
      'const arcChain = { id: 5042002, nativeCurrency: { symbol: "USDC" } };\nconst other = { id: 1, nativeCurrency: { symbol: "ETH" } };'
    ],
    [
      "N03 gasToken",
      'const arcRelayer = { chainId: 5042002, gasToken: "ETH" };'
    ],
    ["N04 feeToken", 'const config = { feeToken: "ETH" };'],
    [
      "N05 Arc relayer ETH config",
      'const arcRelayer = { chainId: 5042002, name: "Arc Testnet", gasToken: "ETH" };'
    ],
    [
      "N06 arbitrary UI copy",
      'const arcChain = { id: 5042002, name: "Arc Testnet" };\nconst label = "Pay gas in ETH";'
    ],
    [
      "N07 guidance",
      'const arcChain = { id: 5042002, name: "Arc Testnet" };\nconst help = "Do not show ETH on Arc";'
    ],
    [
      "N08 declaration in comment",
      '// const arcChain = { id: 5042002, nativeCurrency: { symbol: "ETH" } };'
    ],
    [
      "N09 declaration in string",
      "const example = 'const arcChain = { id: 5042002, nativeCurrency: { symbol: \"ETH\" } };';"
    ],
    [
      "N10 declaration in template",
      'const example = `const arcChain = { id: 5042002, nativeCurrency: { symbol: "ETH" } };`;'
    ],
    [
      "N11 declaration in regex",
      'const matcher = /; const arcChain = { id: 5042002, nativeCurrency: { symbol: "ETH" } };/;'
    ],
    [
      "N14 imported nativeCurrency",
      "const arcChain = { id: 5042002, nativeCurrency: importedCurrency };"
    ],
    [
      "N15 computed name",
      'const arcChain = { id: 5042002, nativeCurrency: { name: importedName, symbol: "USDC" } };'
    ],
    [
      "N15 computed symbol",
      'const arcChain = { id: 5042002, nativeCurrency: { name: "USD Coin", symbol: importedSymbol } };'
    ],
    [
      "N16 nativeCurrency spread",
      'const arcChain = { id: 5042002, nativeCurrency: { ...base, symbol: "ETH" } };'
    ],
    [
      "N17 duplicate name",
      'const arcChain = { id: 5042002, nativeCurrency: { name: "USDC", name: "ETH", symbol: "USDC" } };'
    ],
    [
      "N17 duplicate symbol",
      'const arcChain = { id: 5042002, nativeCurrency: { name: "USDC", symbol: "USDC", symbol: "ETH" } };'
    ],
    [
      "N18 deep wrapper",
      'const config = { networks: { arcTestnet: { id: 5042002, nativeCurrency: { symbol: "ETH" } } } };'
    ],
    [
      "N19 array root",
      'const chains = [{ id: 5042002, name: "Arc Testnet", nativeCurrency: { symbol: "ETH" } }];'
    ],
    [
      "N20 malformed candidate",
      'const arcChain = { id: 5042002, nativeCurrency: { symbol: "ETH" };'
    ],
    [
      "N22 decimals 18",
      'const arcChain = { id: 5042002, nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 } };'
    ],
    [
      "N23 decimals 6",
      'const arcChain = { id: 5042002, nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 6 } };'
    ],
    [
      "decimals 9",
      'const arcChain = { id: 5042002, nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 9 } };'
    ],
    [
      "computed decimals",
      'const arcChain = { id: 5042002, nativeCurrency: { name: "USDC", symbol: "USDC", decimals: importedDecimals } };'
    ],
    [
      "N24 USD Coin name",
      'const arcChain = { id: 5042002, nativeCurrency: { name: "USD Coin", symbol: "USDC" } };'
    ],
    [
      "mixed-case USDC symbol",
      'const arcChain = { id: 5042002, nativeCurrency: { name: "Circle USD", symbol: "usDc" } };'
    ],
    [
      "N25 Ethereum only",
      'const mainnet = { id: 1, name: "Ethereum", nativeCurrency: { name: "Ether", symbol: "ETH" } };'
    ],
    [
      "N26 nativeCurrency only",
      'const arcTestnet = { nativeCurrency: { symbol: "ETH" } };'
    ],
    [
      "N27 template symbol",
      "const arcChain = { id: 5042002, nativeCurrency: { symbol: `ETH` } };"
    ],
    [
      "N28 string nativeCurrency",
      'const arcChain = { id: 5042002, nativeCurrency: "ETH" };'
    ],
    [
      "call nativeCurrency",
      'const arcChain = { id: 5042002, nativeCurrency: createCurrency("ETH") };'
    ],
    [
      "N29 default export",
      'export default { id: 5042002, name: "Arc Testnet", nativeCurrency: { symbol: "ETH" } };'
    ],
    [
      "N30 let declaration",
      'let arcChain = { id: 5042002, nativeCurrency: { symbol: "ETH" } };'
    ],
    [
      "N30 var declaration",
      'var arcChain = { id: 5042002, nativeCurrency: { symbol: "ETH" } };'
    ],
    [
      "N31 parent spread",
      'const arcChain = { ...base, id: 5042002, nativeCurrency: { symbol: "ETH" } };'
    ],
    [
      "N32 conflicting IDs",
      'const arcChain = { id: 5042002, chainId: 1, nativeCurrency: { symbol: "ETH" } };'
    ],
    [
      "N33 terminal continuation",
      'const arcChain = { id: 5042002, nativeCurrency: { symbol: "ETH" } }.extend;'
    ],
    [
      "non-segment arcadia owner",
      'const arcadia = { id: 1, nativeCurrency: { symbol: "ETH" } };'
    ],
    [
      "non-segment monarch owner",
      'const monarch = { id: 1, nativeCurrency: { symbol: "ETH" } };'
    ]
  ] as const;

  it.each(negativeNativeCurrencyCases)(
    "WALLET_NATIVE_USDC_DISPLAY ignores %s",
    async (_name, source) => {
      await expect(
        runWalletRule(walletNativeUsdcDisplayRule, source)
      ).resolves.toEqual([]);
    }
  );

  it.each([".jsx", ".tsx", ".json", ".md", ".mdx", ".yaml", ".yml", ".sol"])(
    "WALLET_NATIVE_USDC_DISPLAY ignores unsupported file %s",
    async (extension) => {
      await expect(
        runWalletRule(
          walletNativeUsdcDisplayRule,
          'const arcChain = { id: 5042002, nativeCurrency: { symbol: "ETH" } };',
          {},
          `src/chain${extension}`
        )
      ).resolves.toEqual([]);
    }
  );

  it.each([
    "src/chain.test.ts",
    "src/chain.spec.js",
    "test/chain.ts",
    "tests/chain.ts",
    "src/__tests__/chain.ts"
  ])("WALLET_NATIVE_USDC_DISPLAY ignores test path %s", async (filePath) => {
    await expect(
      runWalletRule(
        walletNativeUsdcDisplayRule,
        'const arcChain = { id: 5042002, nativeCurrency: { symbol: "ETH" } };',
        {},
        filePath
      )
    ).resolves.toEqual([]);
  });

  it("WALLET_NATIVE_USDC_DISPLAY continues past a safe Arc candidate", async () => {
    const source =
      'const arcFirst = { id: 5042002, nativeCurrency: { symbol: "USDC" } };\nconst arcSecond = { id: 5042002, nativeCurrency: { symbol: "ETH" } };';
    const findings = await runWalletRule(walletNativeUsdcDisplayRule, source);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toBe(nativeMessage);
  });

  it("WALLET_NATIVE_USDC_DISPLAY reports the first bad candidate deterministically", async () => {
    const source =
      'const arcFirst = { id: 5042002, nativeCurrency: { symbol: "ETH" } };\nconst arcSecond = { id: 5042002, nativeCurrency: { symbol: "DAI" } };';
    const first = await runWalletRule(walletNativeUsdcDisplayRule, source);
    const second = await runWalletRule(walletNativeUsdcDisplayRule, source);
    expect(first).toHaveLength(1);
    expect(first).toEqual(second);
  });

  it("NO_ETH_GAS_LABEL flags ETH or gwei fee labels in Arc UI", async () => {
    const findings = await runWalletRule(
      noEthGasLabelRule,
      "const chainId = 5042002;\nexport const label = 'Network fee: 0.01 ETH';"
    );

    expect(findings[0]).toMatchObject({
      ruleId: "wallet/NO_ETH_GAS_LABEL",
      severity: "critical",
      docs: "arc-usdc-gas",
      message: expect.stringContaining("ETH/gwei"),
      suggestedFix: expect.stringContaining("user-facing")
    });
  });

  it("NO_ETH_GAS_LABEL ignores non-Arc ETH fee labels", async () => {
    await expect(
      runWalletRule(
        noEthGasLabelRule,
        "export const label = 'Network fee: 0.01 ETH';"
      )
    ).resolves.toEqual([]);
  });

  it("NO_ETH_GAS_LABEL ignores comments warning against ETH fee labels", async () => {
    await expect(
      runWalletRule(
        noEthGasLabelRule,
        "const chainId = 5042002;\n// Do not show Arc gas fees as ETH or gwei."
      )
    ).resolves.toEqual([]);
  });

  it("ONE_CONFIRMATION_FINAL flags multi-confirmation Arc logic", async () => {
    const findings = await runWalletRule(
      oneConfirmationFinalRule,
      "const chainId = 5042002;\nawait waitForTransactionReceipt({ hash, confirmations: 12 });"
    );

    expect(findings[0]).toMatchObject({
      ruleId: "wallet/ONE_CONFIRMATION_FINAL",
      severity: "critical",
      docs: "arc-finality",
      message: expect.stringContaining("more than one confirmation"),
      suggestedFix: expect.stringContaining("1 confirmation")
    });
  });

  it("ONE_CONFIRMATION_FINAL allows one confirmation", async () => {
    await expect(
      runWalletRule(
        oneConfirmationFinalRule,
        "const chainId = 5042002;\nawait waitForTransactionReceipt({ hash, confirmations: 1 });"
      )
    ).resolves.toEqual([]);
  });

  it("ONE_CONFIRMATION_FINAL ignores guidance against multi-confirmation waits", async () => {
    await expect(
      runWalletRule(
        oneConfirmationFinalRule,
        "const chainId = 5042002;\nexport const guidance = 'Do not wait for 12 confirmations on Arc.';"
      )
    ).resolves.toEqual([]);
  });

  it("PREVRANDAO_NOT_SUPPORTED flags PREVRANDAO usage", async () => {
    const findings = await runWalletRule(
      prevrandaoNotSupportedRule,
      "const chainId = 5042002;\nconst seed = block.prevrandao;"
    );

    expect(findings[0]).toMatchObject({
      ruleId: "wallet/PREVRANDAO_NOT_SUPPORTED",
      severity: "critical",
      docs: "arc-prevrandao",
      message: expect.stringContaining("PREVRANDAO"),
      suggestedFix: expect.stringContaining("randomness source")
    });
  });

  it("PREVRANDAO_NOT_SUPPORTED ignores non-Arc PREVRANDAO usage", async () => {
    await expect(
      runWalletRule(
        prevrandaoNotSupportedRule,
        "const seed = block.prevrandao;"
      )
    ).resolves.toEqual([]);
  });

  it("PREVRANDAO_NOT_SUPPORTED ignores comments warning against PREVRANDAO", async () => {
    await expect(
      runWalletRule(
        prevrandaoNotSupportedRule,
        "const chainId = 5042002;\n// PREVRANDAO is not supported for Arc wallet randomness."
      )
    ).resolves.toEqual([]);
  });

  it("NO_BLOB_TX_ON_ARC flags a proven Arc ethers type-3 submission", async () => {
    const findings = await runWalletRule(
      noBlobTxOnArcRule,
      `import { JsonRpcProvider, Wallet } from "ethers";
const provider = new JsonRpcProvider("https://rpc.testnet.arc.network");
const signer = new Wallet(key, provider);
signer.sendTransaction({ type: 3 });`
    );

    expect(findings).toHaveLength(1);
    expect(findings[0]).toEqual({
      ruleId: "wallet/NO_BLOB_TX_ON_ARC",
      severity: "critical",
      files: ["src/fixture.ts"],
      preset: "wallet",
      docs: "arc-blob-transactions",
      message:
        "Arc transaction submission uses EIP-4844 transaction type 3, which Arc does not support.",
      suggestedFix:
        "Submit a type-2 EIP-1559 transaction on Arc instead (`type: 2`) and remove any blob-only fields present in the submitted transaction."
    });
  });

  it("NO_BLOB_TX_ON_ARC ignores non-Arc blob transaction code", async () => {
    await expect(
      runWalletRule(
        noBlobTxOnArcRule,
        "const tx = { type: 3, maxFeePerBlobGas: 1n };"
      )
    ).resolves.toEqual([]);
  });

  it("NO_BLOB_TX_ON_ARC ignores guidance against blob transactions", async () => {
    await expect(
      runWalletRule(
        noBlobTxOnArcRule,
        "const chainId = 5042002;\nexport const warning = 'Do not use EIP-4844 blob transactions on Arc.';"
      )
    ).resolves.toEqual([]);
  });

  it("supports severity overrides for wallet rules", async () => {
    const findings = await runWalletRule(
      arcChainMetadataRule,
      "export const arc = { name: 'Arc Testnet', chainId: 1, rpcUrls: {} };",
      {
        "wallet/ARC_CHAIN_METADATA": "warning"
      }
    );

    expect(findings[0]?.severity).toBe("warning");
  });

  it("supports disabling wallet rules", async () => {
    const findings = await runWalletRule(
      arcChainMetadataRule,
      "export const arc = { name: 'Arc Testnet', chainId: 1, rpcUrls: {} };",
      {
        "wallet/ARC_CHAIN_METADATA": "off"
      }
    );

    expect(findings).toEqual([]);
  });

  it("scan pipeline with wallet preset runs wallet rules", async () => {
    const projectRoot = createTempProject();
    writeFixture(
      projectRoot,
      "package.json",
      JSON.stringify({ name: "bad-wallet-fixture" })
    );
    writeFixture(
      projectRoot,
      "src/chain.ts",
      "export const arc = { name: 'Arc Testnet', chainId: 1, rpcUrls: {} };"
    );

    const report = await createStubReport(projectRoot);

    expect(report).toMatchObject({
      project: "bad-wallet-fixture",
      status: "fail",
      score: 75,
      summary: {
        critical: 1,
        warning: 0,
        info: 0
      }
    });
    expect(report.findings[0]?.ruleId).toBe("wallet/ARC_CHAIN_METADATA");
  });
});

async function runWalletRule(
  rule: Rule,
  content: string,
  rules: RuleContext["config"]["rules"] = {},
  filePath = "src/fixture.ts"
) {
  return runRules([rule], {
    projectRoot: "/fixture",
    config: {
      ...DEFAULT_CONFIG,
      rules
    },
    files: [filePath],
    detectedPresets: {
      detectedPresets: ["wallet"],
      confidence: "high",
      reasons: ["test"]
    },
    readFile: async () => content
  });
}

function createTempProject(): string {
  const projectRoot = mkdtempSync(join(tmpdir(), "arcready-wallet-"));
  tempDirs.push(projectRoot);
  return projectRoot;
}

function writeFixture(
  projectRoot: string,
  filePath: string,
  content: string
): void {
  const absolutePath = join(projectRoot, filePath);
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, content);
}
