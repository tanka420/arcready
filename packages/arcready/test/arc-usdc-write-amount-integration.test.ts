import { describe, expect, it } from "vitest";
import {
  DEFAULT_CONFIG,
  arcUsdcAmountConversionRule,
  runRules
} from "../src/index.js";
import type { RuleContext } from "../src/index.js";
import { analyzeArcUsdcWriteAmountCandidates } from "../rules/wallet/arc-usdc-amount-analyzer.js";
import { selectArcUsdcAmountIssue } from "../rules/wallet/arc-usdc-amount-conversion.js";

const USDC = "0x3600000000000000000000000000000000000000";
const WRITE_MESSAGE =
  "Arc USDC ERC-20 transfers use 6-decimal token units, but this amount is parsed with 18-decimal native units.";
const WRITE_FIX =
  "Parse the transfer amount with 6-decimal USDC units before passing it to transfer(...).";
const READ_MESSAGE =
  "An Arc native USDC balance uses 18-decimal units but is being interpreted as a six-decimal ERC-20 amount.";
const READ_FIX =
  "Format the raw Arc native balance with 18 decimals, or divide the native integer amount by 10^12 before treating it as a six-decimal USDC amount.";
const READ_SETUP = `import { JsonRpcProvider, formatUnits } from "ethers";
const provider = new JsonRpcProvider("https://rpc.testnet.arc.network");`;
const READ = "formatUnits(await provider.getBalance(account), 6);";
const write = (literal = "1", address = USDC) => `client.writeContract({
  address: "${address}",
  abi: erc20Abi,
  functionName: "transfer",
  args: [RECIPIENT, parseEther("${literal}")]
});`;
const source = (
  body = write(),
  withRead = false
) => `${withRead ? READ_SETUP : ""}
import { createWalletClient, erc20Abi, http, parseEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arcTestnet } from "viem/chains";
const PRIVATE_KEY = "0x${"1".repeat(64)}";
const RECIPIENT = "0x${"2".repeat(40)}";
const account = privateKeyToAccount(PRIVATE_KEY);
const client = createWalletClient({ account, chain: arcTestnet, transport: http() });
${body}`;
const readOnly = `${READ_SETUP}\n${READ}`;

describe("C06B2 E3 write amount integration", () => {
  it("emits the exact write-only finding", async () => {
    await expect(run(source())).resolves.toEqual([
      finding(WRITE_MESSAGE, WRITE_FIX)
    ]);
  });

  it("preserves the exact read-only C06B1 finding", async () => {
    await expect(run(readOnly)).resolves.toEqual([
      finding(READ_MESSAGE, READ_FIX)
    ]);
  });

  it.each([
    ["write before read", source(`${write()}\n${READ}`, true), WRITE_MESSAGE],
    ["read before write", source(`${READ}\n${write()}`, true), READ_MESSAGE],
    ["no candidate", "const safeAmount = 1n;", undefined],
    [
      "invalid write plus valid read",
      source(`${write("1", `0x4${"6".repeat(39)}`)}\n${READ}`, true),
      READ_MESSAGE
    ],
    [
      "earlier read plus later valid write",
      source(`${READ}\nconst gap = true;\n${write()}`, true),
      READ_MESSAGE
    ]
  ])("selects %s", async (_name, input, expected) => {
    const findings = await run(input);
    expect(findings.map(({ message }) => message)).toEqual(
      expected === undefined ? [] : [expected]
    );
  });

  it("uses kind priority at an equal offset", () => {
    const erc20Read = { kind: "erc20-read-as-native" as const, offset: 7 };
    const nativeRead = { kind: "native-read-as-erc20" as const, offset: 7 };
    const writeCandidate = {
      kind: "erc20-transfer-native18-amount" as const,
      callOffset: 7,
      amountOffset: 9,
      amountLength: 3,
      parserIdentity: "parseEther" as const,
      literal: "1",
      effectiveValue: 10n ** 18n
    };

    expect(
      selectArcUsdcAmountIssue([erc20Read, nativeRead], [writeCandidate])
    ).toBe(nativeRead);
  });

  it("selects the earliest of multiple writes", async () => {
    const input = source(`${write("1")}\n${write("2")}`);
    const writes = await analyzeArcUsdcWriteAmountCandidates(
      "src/amounts.ts",
      input
    );

    expect(writes).toHaveLength(2);
    expect(selectArcUsdcAmountIssue([], writes)).toBe(writes[0]);
  });

  it("is deterministic across repeated analysis", async () => {
    const input = source(`${write()}\n${READ}`, true);
    const first = await run(input);
    await expect(run(input)).resolves.toEqual(first);
  });
});

function finding(message: string, suggestedFix: string) {
  return {
    ruleId: "wallet/ARC_USDC_AMOUNT_CONVERSION",
    severity: "critical",
    preset: "wallet",
    docs: "arc-usdc-amount-conversion",
    message,
    suggestedFix,
    files: ["src/amounts.ts"]
  };
}

function run(input: string) {
  return runRules([arcUsdcAmountConversionRule], {
    projectRoot: "/fixture",
    config: DEFAULT_CONFIG,
    files: ["src/amounts.ts"],
    detectedPresets: {
      detectedPresets: ["wallet"],
      confidence: "high",
      reasons: ["test"]
    },
    readFile: async () => input
  } satisfies RuleContext);
}
