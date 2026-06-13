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
  it("ARC_CHAIN_METADATA flags missing Arc chain ID", async () => {
    const findings = await runWalletRule(
      arcChainMetadataRule,
      "export const arc = { name: 'Arc Testnet', chainId: 1, rpcUrls: {} };"
    );

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      ruleId: "wallet/ARC_CHAIN_METADATA",
      severity: "critical",
      preset: "wallet",
      docs: "arc-chain-metadata"
    });
  });

  it("ARC_CHAIN_METADATA allows valid Arc chain metadata", async () => {
    await expect(
      runWalletRule(
        arcChainMetadataRule,
        "export const arc = { name: 'Arc Testnet', chainId: 5042002, rpcUrls: { default: { http: ['https://rpc.arc'] } }, blockExplorers: { default: { url: 'https://explorer.arc' } } };"
      )
    ).resolves.toEqual([]);
  });

  it("WALLET_NATIVE_USDC_DISPLAY flags ETH native currency", async () => {
    const findings = await runWalletRule(
      walletNativeUsdcDisplayRule,
      "export const arc = { name: 'Arc Testnet', chainId: 5042002, nativeCurrency: { name: 'ETH', symbol: 'ETH' } };"
    );

    expect(findings[0]).toMatchObject({
      ruleId: "wallet/WALLET_NATIVE_USDC_DISPLAY",
      severity: "critical",
      suggestedFix: "Set Arc native currency name/symbol to USDC."
    });
  });

  it("WALLET_NATIVE_USDC_DISPLAY allows USDC native currency", async () => {
    await expect(
      runWalletRule(
        walletNativeUsdcDisplayRule,
        "export const arc = { name: 'Arc Testnet', chainId: 5042002, nativeCurrency: { name: 'USDC', symbol: 'USDC' } };"
      )
    ).resolves.toEqual([]);
  });

  it("NO_ETH_GAS_LABEL flags ETH or gwei fee labels in Arc UI", async () => {
    const findings = await runWalletRule(
      noEthGasLabelRule,
      "const chainId = 5042002;\nexport const label = 'Network fee: 0.01 ETH';"
    );

    expect(findings[0]).toMatchObject({
      ruleId: "wallet/NO_ETH_GAS_LABEL",
      severity: "critical",
      docs: "arc-usdc-gas"
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

  it("ONE_CONFIRMATION_FINAL flags multi-confirmation Arc logic", async () => {
    const findings = await runWalletRule(
      oneConfirmationFinalRule,
      "const chainId = 5042002;\nawait waitForTransactionReceipt({ hash, confirmations: 12 });"
    );

    expect(findings[0]).toMatchObject({
      ruleId: "wallet/ONE_CONFIRMATION_FINAL",
      severity: "critical",
      docs: "arc-finality"
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

  it("PREVRANDAO_NOT_SUPPORTED flags PREVRANDAO usage", async () => {
    const findings = await runWalletRule(
      prevrandaoNotSupportedRule,
      "const chainId = 5042002;\nconst seed = block.prevrandao;"
    );

    expect(findings[0]).toMatchObject({
      ruleId: "wallet/PREVRANDAO_NOT_SUPPORTED",
      severity: "critical",
      docs: "arc-prevrandao"
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

  it("NO_BLOB_TX_ON_ARC flags blob transaction assumptions", async () => {
    const findings = await runWalletRule(
      noBlobTxOnArcRule,
      "const chainId = 5042002;\nconst tx = { type: 3, maxFeePerBlobGas: 1n };"
    );

    expect(findings[0]).toMatchObject({
      ruleId: "wallet/NO_BLOB_TX_ON_ARC",
      severity: "critical",
      docs: "arc-blob-transactions"
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
  rules: RuleContext["config"]["rules"] = {}
) {
  return runRules([rule], {
    projectRoot: "/fixture",
    config: {
      ...DEFAULT_CONFIG,
      rules
    },
    files: ["src/fixture.ts"],
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
