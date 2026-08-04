import { describe, expect, it } from "vitest";
import {
  DEFAULT_CONFIG,
  arcUsdcAmountConversionRule,
  runRules
} from "../src/index.js";
import { analyzeArcUsdcWriteAmountCandidates } from "../rules/wallet/arc-usdc-amount-analyzer.js";

const PRIVATE_KEY =
  "0x1111111111111111111111111111111111111111111111111111111111111111";
const USDC = "0x3600000000000000000000000000000000000000";
const UINT256_MAX = (1n << 256n) - 1n;
const UINT256_MAX_LITERAL =
  "115792089237316195423570985008687907853269984665640564039457.584007913129639935";

const request = (amount = '"1"') => `{
  address: "${USDC}",
  abi: erc20Abi,
  functionName: "transfer",
  args: [RECIPIENT, parseEther(${amount})]
}`;
const write = (amount = '"1"') => `client.writeContract(${request(amount)});`;
const exactSource = (body = write()) => `
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

${body}
`;
const analyze = (source: string, filePath = "src/transfer.ts") =>
  analyzeArcUsdcWriteAmountCandidates(filePath, source);
const candidate = (
  source: string,
  literal: string,
  effectiveValue: bigint,
  from = 0
) => {
  const callOffset = source.indexOf("client.writeContract(", from);
  const amountOffset = source.indexOf(`"${literal}"`, callOffset);
  return {
    kind: "erc20-transfer-native18-amount",
    callOffset,
    amountOffset,
    amountLength: literal.length + 2,
    parserIdentity: "parseEther",
    literal,
    effectiveValue
  };
};
const expectNone = (source: string) =>
  expect(analyze(source)).resolves.toEqual([]);

describe("C06B2 E2 exact write sink", () => {
  it.each([
    ["1", 1_000_000_000_000_000_000n],
    ["0.000000000000000001", 1n],
    [UINT256_MAX_LITERAL, UINT256_MAX]
  ])("collects and deterministically locates %s", async (literal, value) => {
    const source = exactSource(write(`"${literal}"`));
    const expected = [candidate(source, literal, value)];

    await expect(analyze(source)).resolves.toEqual(expected);
    await expect(analyze(source)).resolves.toEqual(expected);
  });

  it("collects the exact JavaScript sink", async () => {
    const source = exactSource();
    await expect(analyze(source, "src/transfer.js")).resolves.toEqual([
      candidate(source, "1", 1_000_000_000_000_000_000n)
    ]);
  });

  it("collects two valid writes in source order", async () => {
    const source = exactSource(`${write('"1"')}\n${write('"2"')}`);
    const first = candidate(source, "1", 1_000_000_000_000_000_000n);
    const second = candidate(
      source,
      "2",
      2_000_000_000_000_000_000n,
      first.callOffset + 1
    );

    await expect(analyze(source)).resolves.toEqual([first, second]);
  });

  it("isolates an invalid sibling from a later valid write", async () => {
    const invalid = write().replace(
      USDC,
      "0x4600000000000000000000000000000000000000"
    );
    const source = exactSource(`${invalid}\n${write('"2"')}`);
    const firstCall = source.indexOf("client.writeContract(");

    await expect(analyze(source)).resolves.toEqual([
      candidate(source, "2", 2_000_000_000_000_000_000n, firstCall + 1)
    ]);
  });

  it.each([
    [
      "zero",
      (source: string) => source.replace('parseEther("1")', 'parseEther("0")')
    ],
    [
      "decimal zero",
      (source: string) => source.replace('parseEther("1")', 'parseEther("0.0")')
    ],
    [
      "invalid literal",
      (source: string) => source.replace('parseEther("1")', 'parseEther("01")')
    ],
    [
      "overflow literal",
      (source: string) =>
        source.replace(
          'parseEther("1")',
          `parseEther("${UINT256_MAX_LITERAL.slice(0, -1)}6")`
        )
    ],
    [
      "wrong address",
      (source: string) =>
        source.replace(USDC, "0x4600000000000000000000000000000000000000")
    ],
    [
      "escaped address",
      (source: string) =>
        source.replace(`"${USDC}"`, `"\\u0030${USDC.slice(1)}"`)
    ],
    [
      "address binding",
      () =>
        exactSource(
          `const TOKEN = "${USDC}";\n${write().replace(`"${USDC}"`, "TOKEN")}`
        )
    ],
    [
      "custom ABI",
      (source: string) => source.replace("abi: erc20Abi", "abi: []")
    ],
    [
      "bound ABI",
      () =>
        exactSource(
          `const ABI = erc20Abi;\n${write().replace("abi: erc20Abi", "abi: ABI")}`
        )
    ],
    [
      "wrong function",
      (source: string) =>
        source.replace('functionName: "transfer"', 'functionName: "approve"')
    ],
    [
      "bound function",
      () =>
        exactSource(
          `const fn = "transfer";\n${write().replace('functionName: "transfer"', "functionName: fn")}`
        )
    ],
    [
      "escaped function",
      (source: string) => source.replace('"transfer"', '"trans\\u0066er"')
    ],
    [
      "property order",
      (source: string) =>
        source.replace(
          `  address: "${USDC}",\n  abi: erc20Abi,`,
          `  abi: erc20Abi,\n  address: "${USDC}",`
        )
    ],
    [
      "extra property",
      (source: string) => source.replace("  args:", "  gas: 1n,\n  args:")
    ],
    [
      "missing property",
      (source: string) => source.replace('  functionName: "transfer",\n', "")
    ],
    [
      "quoted key",
      (source: string) => source.replace("  address:", '  "address":')
    ],
    [
      "computed key",
      (source: string) => source.replace("  address:", '  ["address"]:')
    ],
    [
      "spread property",
      () =>
        exactSource(
          `const part = {};\n${write().replace(`  address: "${USDC}",`, `  ...part,\n  address: "${USDC}",`)}`
        )
    ],
    [
      "method property",
      (source: string) =>
        source.replace(
          'functionName: "transfer"',
          'functionName() { return "transfer"; }'
        )
    ],
    [
      "accessor property",
      (source: string) =>
        source.replace(
          'functionName: "transfer"',
          'get functionName() { return "transfer"; }'
        )
    ],
    [
      "parenthesized request",
      () => exactSource(`client.writeContract((${request()}));`)
    ],
    [
      "wrapped request",
      () => exactSource(`client.writeContract(identity(${request()}));`)
    ],
    [
      "request binding",
      () =>
        exactSource(
          `const REQUEST = ${request()};\nclient.writeContract(REQUEST);`
        )
    ],
    [
      "args binding",
      () =>
        exactSource(
          `const ARGS = [RECIPIENT, parseEther("1")];\n${write().replace('args: [RECIPIENT, parseEther("1")]', "args: ARGS")}`
        )
    ],
    [
      "one argument",
      (source: string) =>
        source.replace(
          'args: [RECIPIENT, parseEther("1")]',
          "args: [RECIPIENT]"
        )
    ],
    [
      "three arguments",
      (source: string) =>
        source.replace(
          'args: [RECIPIENT, parseEther("1")]',
          'args: [RECIPIENT, parseEther("1"), 3]'
        )
    ],
    [
      "spread amount",
      (source: string) =>
        source.replace('parseEther("1")]', '...parseEther("1")]')
    ],
    [
      "omitted amount",
      (source: string) => source.replace('parseEther("1")]', "]")
    ],
    [
      "amount binding",
      () =>
        exactSource(
          `const AMOUNT = "1";\n${write().replace('parseEther("1")', "parseEther(AMOUNT)")}`
        )
    ],
    [
      "parser-result binding",
      () =>
        exactSource(
          `const AMOUNT = parseEther("1");\n${write().replace('parseEther("1")', "AMOUNT")}`
        )
    ],
    [
      "wrapped amount",
      (source: string) =>
        source.replace('parseEther("1")]', '(parseEther("1"))]')
    ],
    [
      "optional sink",
      (source: string) =>
        source.replace("client.writeContract(", "client.writeContract?.(")
    ],
    [
      "element sink",
      (source: string) =>
        source.replace("client.writeContract(", 'client["writeContract"](')
    ],
    [
      "call wrapper",
      () => exactSource(`client.writeContract.call(client, ${request()});`)
    ],
    [
      "apply wrapper",
      () => exactSource(`client.writeContract.apply(client, [${request()}]);`)
    ],
    [
      "forwarding wrapper",
      () => exactSource(`function submit() { return ${write()} }\nsubmit();`)
    ],
    [
      "escaped receiver",
      (source: string) =>
        source.replace("client.writeContract(", "cli\\u0065nt.writeContract(")
    ],
    [
      "escaped property",
      (source: string) =>
        source.replace("client.writeContract(", "client.writeContr\\u0061ct(")
    ],
    ["zero sink arguments", () => exactSource("client.writeContract();")],
    [
      "two sink arguments",
      () => exactSource(`client.writeContract(${request()}, {});`)
    ],
    [
      "detached sink",
      () =>
        exactSource(
          `const writeContract = client.writeContract;\nwriteContract(${request()});`
        )
    ],
    [
      "aliased client",
      () =>
        exactSource(
          `const wallet = client;\n${write().replace("client.", "wallet.")}`
        )
    ],
    [
      "temporary client",
      () =>
        exactSource(
          write().replace(
            "client",
            "createWalletClient({ account, chain: arcTestnet, transport: http() })"
          )
        )
    ],
    [
      "generic sink",
      (source: string) =>
        source.replace(
          "client.writeContract(",
          "client.writeContract<unknown>("
        )
    ],
    [
      "non-retained client",
      () =>
        exactSource(
          `const other = getClient();\n${write().replace("client.", "other.")}`
        )
    ],
    [
      "reordered foundation imports",
      (source: string) => {
        const imports = source.match(/^import .*;$/gm)!;
        return source.replace(
          imports.join("\n"),
          [imports[1], imports[0], imports[2]].join("\n")
        );
      }
    ],
    [
      "mutated foundation",
      (source: string) => source.replace("chain: arcTestnet", "chain: mainnet")
    ]
  ] as const)("produces no candidate for %s", async (_name, mutate) => {
    await expectNone(mutate(exactSource()));
  });

  it("does not integrate E2 into the public rule", async () => {
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
