import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_CONFIG,
  arcUsdcAmountConversionRule,
  runRules
} from "../src/index.js";
import { analyzeArcUsdcWriteAmountFoundation } from "../rules/wallet/arc-usdc-amount-analyzer.js";

const PRIVATE_KEY =
  "0x1111111111111111111111111111111111111111111111111111111111111111";
const USDC = "0x3600000000000000000000000000000000000000";
const UINT256_MAX = (1n << 256n) - 1n;
const UINT256_MAX_LITERAL =
  "115792089237316195423570985008687907853269984665640564039457.584007913129639935";
const PROTECTED_NAMES = [
  "createWalletClient",
  "erc20Abi",
  "http",
  "parseEther",
  "privateKeyToAccount",
  "arcTestnet",
  "PRIVATE_KEY",
  "account",
  "client"
] as const;

const exactSource = (amount = '"1"') => `
import { createWalletClient, erc20Abi, http, parseEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arcTestnet } from "viem/chains";

const PRIVATE_KEY = "${PRIVATE_KEY}";
const RECIPIENT = "0x2222222222222222222222222222222222222222";
const account = privateKeyToAccount(PRIVATE_KEY);
const client = createWalletClient({
  account,
  chain: arcTestnet,
  transport: http()
});

client.writeContract({
  address: "${USDC}",
  abi: erc20Abi,
  functionName: "transfer",
  args: [RECIPIENT, parseEther(${amount})]
});
`;

const noAmount = {
  status: "analyzed",
  foundation: "exact",
  amounts: []
} as const;
const accepted = (source: string, literal: string, effectiveValue: bigint) => ({
  status: "analyzed",
  foundation: "exact",
  amounts: [
    {
      parserIdentity: "parseEther",
      literal,
      amountOffset:
        source.indexOf(`parseEther("${literal}")`) + "parseEther(".length,
      effectiveValue
    }
  ]
});
const unknown = {
  status: "analyzed",
  foundation: "unknown",
  amounts: []
} as const;
const analyze = (source: string, filePath = "src/transfer.ts") =>
  analyzeArcUsdcWriteAmountFoundation(filePath, source);
const expectUnknown = (source: string) =>
  expect(analyze(source)).resolves.toEqual(unknown);

describe("C06B2 E1a exact write foundation", () => {
  it.each([
    ["0", 0n],
    ["0.0", 0n],
    ["0.000000000000000001", 1n],
    ["1", 1_000_000_000_000_000_000n],
    ["1.000000000000000001", 1_000_000_000_000_000_001n],
    ["0.25", 250_000_000_000_000_000n],
    [UINT256_MAX_LITERAL, UINT256_MAX]
  ])("accepts and deterministically normalizes %s", async (literal, value) => {
    const source = exactSource(`"${literal}"`);
    const first = await analyze(source);
    const second = await analyze(source);

    expect(first).toEqual(accepted(source, literal, value));
    expect(second).toEqual(first);
  });

  it("accepts the retained JavaScript foundation", async () => {
    const source = exactSource();
    await expect(analyze(source, "src/transfer.js")).resolves.toEqual(
      accepted(source, "1", 1_000_000_000_000_000_000n)
    );
  });

  it("defers literal evaluation to E1b", async () => {
    await expect(analyze(exactSource("dynamicAmount"))).resolves.toEqual(
      noAmount
    );
  });

  it.each([
    ["leading zero", '"01"'],
    ["missing integer", '".1"'],
    ["missing fraction", '"1."'],
    ["scientific notation", '"1e3"'],
    ["plus sign", '"+1"'],
    ["minus sign", '"-1"'],
    ["whitespace", '" 1"'],
    ["underscore", '"1_0"'],
    ["hex", '"0x1"'],
    ["more than 18 fraction digits", '"0.0000000000000000001"'],
    ["uint256 overflow", `"${UINT256_MAX_LITERAL.slice(0, -1)}6"`],
    ["escaped literal spelling", '"\\u0031"']
  ])("leaves amounts empty for %s", async (_name, amount) => {
    await expect(analyze(exactSource(amount))).resolves.toEqual(noAmount);
  });

  it("rejects an oversized literal before BigInt", async () => {
    const bigint = vi.spyOn(globalThis, "BigInt");
    await expect(
      analyze(exactSource(`"${"1".repeat(100_000)}"`))
    ).resolves.toEqual(noAmount);
    expect(bigint).not.toHaveBeenCalled();
    bigint.mockRestore();
  });

  it.each([
    ["account before root", [1, 0, 2]],
    ["chain before account", [0, 2, 1]]
  ])("rejects %s import declaration order", async (_name, order) => {
    const source = exactSource();
    const imports = source.match(/^import .*;$/gm)!;
    await expectUnknown(
      source.replace(
        imports.join("\n"),
        order.map((index) => imports[index]!).join("\n")
      )
    );
  });

  it.each([
    [
      "aliased root import",
      (source: string) =>
        source.replace("parseEther }", "parseEther as parseNative }")
    ],
    [
      "reordered root import",
      (source: string) =>
        source.replace(
          "createWalletClient, erc20Abi, http, parseEther",
          "createWalletClient, erc20Abi, parseEther, http"
        )
    ],
    [
      "wrong account module",
      (source: string) =>
        source.replace('from "viem/accounts"', 'from "account-kit"')
    ],
    [
      "exported account",
      (source: string) =>
        source.replace("const account =", "export const account =")
    ],
    [
      "typed account",
      (source: string) =>
        source.replace("const account =", "const account: unknown =")
    ],
    [
      "multiple account declarations",
      (source: string) =>
        source.replace(
          "const account = privateKeyToAccount(PRIVATE_KEY);",
          "const account = privateKeyToAccount(PRIVATE_KEY), extra = 1;"
        )
    ],
    [
      "dynamic private key",
      (source: string) =>
        source.replace(
          `const PRIVATE_KEY = "${PRIVATE_KEY}";`,
          "const PRIVATE_KEY = loadPrivateKey();"
        )
    ],
    [
      "inline account key",
      (source: string) =>
        source.replace(
          "privateKeyToAccount(PRIVATE_KEY)",
          `privateKeyToAccount("${PRIVATE_KEY}")`
        )
    ],
    [
      "quoted chain key",
      (source: string) =>
        source.replace("chain: arcTestnet", '"chain": arcTestnet')
    ],
    [
      "quoted transport key",
      (source: string) =>
        source.replace("transport: http()", '"transport": http()')
    ],
    [
      "explicit transport URL",
      (source: string) =>
        source.replace("transport: http()", 'transport: http("rpc")')
    ],
    [
      "non-shorthand account property",
      (source: string) => source.replace("  account,", "  account: account,")
    ],
    [
      "shorthand account initializer",
      (source: string) => source.replace("  account,", "  account = undefined,")
    ],
    [
      "extra client property",
      (source: string) =>
        source.replace(
          "  transport: http()",
          "  transport: http(),\n  batch: undefined"
        )
    ]
  ] as const)("fails closed for %s", async (_name, mutate) => {
    await expectUnknown(mutate(exactSource()));
  });

  it.each([
    ["PRIVATE_KEY", `PRIVATE_KEY = "${PRIVATE_KEY}";`],
    ["account", "account = privateKeyToAccount(PRIVATE_KEY);"],
    ["client", "client = createWalletClient({"]
  ])("rejects using declarations for %s", async (_name, declaration) => {
    for (const keyword of ["using", "await using"])
      await expectUnknown(
        exactSource().replace(
          `const ${declaration}`,
          `${keyword} ${declaration}`
        )
      );
  });

  it.each([
    ["declared parser variable", "declare const parseEther: unknown;"],
    [
      "declared parser function",
      "declare function parseEther(value: string): bigint;"
    ],
    ["declared private key", "declare const PRIVATE_KEY: string;"],
    ["declared account", "declare const account: unknown;"],
    ["declared client", "declare const client: unknown;"],
    ["declared parser namespace", "declare namespace parseEther {}"]
  ])("rejects ambient %s", async (_name, declaration) => {
    await expectUnknown(
      exactSource().replace(
        "const PRIVATE_KEY =",
        `${declaration}\nconst PRIVATE_KEY =`
      )
    );
  });

  it.each([
    [
      "root module string",
      (source: string) => source.replace('from "viem";', 'from "vi\\u0065m";')
    ],
    [
      "createWalletClient import",
      (source: string) =>
        source.replace("createWalletClient,", "createWalletCli\\u0065nt,")
    ],
    [
      "erc20Abi import",
      (source: string) => source.replace("erc20Abi,", "erc20A\\u0062i,")
    ],
    ["http import", (source: string) => source.replace("http,", "ht\\u0074p,")],
    [
      "parseEther import",
      (source: string) => source.replace("parseEther }", "parse\\u0045ther }")
    ],
    [
      "account import",
      (source: string) =>
        source.replace("privateKeyToAccount }", "privateKeyToAcc\\u006funt }")
    ],
    [
      "chain import",
      (source: string) => source.replace("arcTestnet }", "arcTestn\\u0065t }")
    ],
    [
      "PRIVATE_KEY declaration",
      (source: string) =>
        source.replace("const PRIVATE_KEY =", "const PRIV\\u0041TE_KEY =")
    ],
    [
      "account declaration",
      (source: string) =>
        source.replace("const account =", "const acc\\u006funt =")
    ],
    [
      "client declaration",
      (source: string) =>
        source.replace("const client =", "const cli\\u0065nt =")
    ],
    [
      "privateKeyToAccount call",
      (source: string) =>
        source.replace(
          "privateKeyToAccount(PRIVATE_KEY)",
          "privateKeyToAcc\\u006funt(PRIVATE_KEY)"
        )
    ],
    [
      "PRIVATE_KEY use",
      (source: string) =>
        source.replace(
          "privateKeyToAccount(PRIVATE_KEY)",
          "privateKeyToAccount(PRIV\\u0041TE_KEY)"
        )
    ],
    [
      "createWalletClient call",
      (source: string) =>
        source.replace("createWalletClient({", "createWalletCli\\u0065nt({")
    ],
    [
      "account shorthand",
      (source: string) => source.replace("  account,", "  acc\\u006funt,")
    ],
    [
      "chain property",
      (source: string) =>
        source.replace("chain: arcTestnet", "cha\\u0069n: arcTestnet")
    ],
    [
      "arcTestnet use",
      (source: string) =>
        source.replace("chain: arcTestnet", "chain: arcTestn\\u0065t")
    ],
    [
      "transport property",
      (source: string) =>
        source.replace("transport: http()", "transp\\u006frt: http()")
    ],
    [
      "http call",
      (source: string) =>
        source.replace("transport: http()", "transport: ht\\u0074p()")
    ],
    [
      "parseEther call",
      (source: string) =>
        source.replace('parseEther("1")', 'parse\\u0045ther("1")')
    ],
    [
      "private-key literal escape",
      (source: string) =>
        source.replace(`"${PRIVATE_KEY}"`, `"\\u0030${PRIVATE_KEY.slice(1)}"`)
    ]
  ] as const)("rejects unicode-escaped %s", async (_name, mutate) => {
    await expectUnknown(mutate(exactSource()));
  });

  it.each(["viem", "viem/accounts", "viem/chains"])(
    "rejects %s import attributes",
    async (module) => {
      const before = `from "${module}";`;
      await expectUnknown(
        exactSource().replace(
          before,
          `${before.slice(0, -1)} with { type: "json" };`
        )
      );
    }
  );

  it.each([
    ["privateKeyToAccount", "privateKeyToAccount(PRIVATE_KEY)"],
    ["createWalletClient", "createWalletClient({"],
    ["http", "http()"],
    ["parseEther", 'parseEther("1")']
  ])("rejects generic %s calls", async (name, call) => {
    await expectUnknown(
      exactSource().replace(call, call.replace(name, `${name}<unknown>`))
    );
  });

  it.each(PROTECTED_NAMES)(
    "rejects prefix and postfix writes to %s",
    async (name) => {
      const anchor = "client.writeContract({";
      await expectUnknown(
        exactSource().replace(anchor, `${name}++;\n${anchor}`)
      );
      await expectUnknown(
        exactSource().replace(anchor, `++${name};\n${anchor}`)
      );
    }
  );

  it.each(PROTECTED_NAMES)("rejects delete writes to %s", async (name) => {
    const anchor = "client.writeContract({";
    await expectUnknown(
      exactSource().replace(anchor, `delete ${name};\n${anchor}`)
    );
    await expectUnknown(
      exactSource().replace(anchor, `delete (${name});\n${anchor}`)
    );
  });

  it.each([
    ["destructuring", "({ parseEther } = replacements);"],
    ["nested destructuring", "({ parser: parseEther } = replacements);"],
    ["array destructuring", "[parseEther] = replacements;"],
    ["loop target", "for (parseEther of parsers) {}"]
  ])("rejects %s protected writes", async (_name, mutation) => {
    await expectUnknown(
      exactSource().replace(
        "client.writeContract({",
        `${mutation}\nclient.writeContract({`
      )
    );
  });

  it.each([
    ["missing parser call", 'parseEther("1")', "1n"],
    ["optional parser call", 'parseEther("1")', 'parseEther?.("1")'],
    ["zero parser arguments", 'parseEther("1")', "parseEther()"],
    ["two parser arguments", 'parseEther("1")', 'parseEther("1", 18)'],
    [
      "multiple parser calls",
      'parseEther("1")',
      'parseEther("1") + parseEther("2")'
    ]
  ])("rejects %s", async (_name, before, after) => {
    await expectUnknown(exactSource().replace(before, after));
  });

  it("reports compiler unavailability only at the loader boundary", async () => {
    await expect(
      analyzeArcUsdcWriteAmountFoundation(
        "src/transfer.ts",
        exactSource(),
        async () => {
          throw new Error("missing compiler");
        }
      )
    ).resolves.toEqual({
      status: "compiler-unavailable",
      foundation: "unknown",
      amounts: []
    });
  });

  it("rejects malformed and unsupported source", async () => {
    await expect(
      analyze(
        exactSource().replace(
          "client.writeContract({",
          "client.writeContract({{"
        )
      )
    ).resolves.toEqual({
      status: "malformed",
      foundation: "unknown",
      amounts: []
    });
    await expect(
      analyze(exactSource(), "src/transfer.test.ts")
    ).resolves.toEqual({
      status: "unsupported-file",
      foundation: "unknown",
      amounts: []
    });
  });

  it("does not change the existing public rule in E1a", async () => {
    const source = exactSource();
    const findings = await runRules([arcUsdcAmountConversionRule], {
      projectRoot: "/fixture",
      config: DEFAULT_CONFIG,
      files: ["src/transfer.ts"],
      detectedPresets: {
        detectedPresets: ["wallet"],
        confidence: "high",
        reasons: ["test"]
      },
      readFile: async () => source
    });

    expect(findings).toEqual([]);
  });
});
