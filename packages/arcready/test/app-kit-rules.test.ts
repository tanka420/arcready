import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_CONFIG,
  appKitBridgeMinAmountNoteRule,
  appKitCapabilitySupportedRule,
  appKitChainIdentifierValidRule,
  appKitCustomRpcRecommendedRule,
  createStubReport,
  runRules,
  ubDelegateRequiredRule,
  ubFeeExplanationPresentRule
} from "../src/index.js";
import type { Rule, RuleContext } from "../src/index.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("app-kit rules", () => {
  it("APPKIT_CHAIN_IDENTIFIER_VALID flags invalid Arc identifiers", async () => {
    const findings = await runAppKitRule(
      appKitChainIdentifierValidRule,
      "import { AppKit } from '@circle-fin/app-kit';\nconst chain = 'arc-testnet';"
    );

    expect(findings[0]).toMatchObject({
      ruleId: "app-kit/APPKIT_CHAIN_IDENTIFIER_VALID",
      severity: "critical",
      docs: "arc-appkit-chain-identifier",
      preset: "app-kit"
    });
  });

  it("APPKIT_CHAIN_IDENTIFIER_VALID allows Arc_Testnet", async () => {
    await expect(
      runAppKitRule(
        appKitChainIdentifierValidRule,
        "import { AppKit } from '@circle-fin/app-kit';\nconst chain = 'Arc_Testnet';"
      )
    ).resolves.toEqual([]);
  });

  it("APPKIT_CAPABILITY_SUPPORTED flags unguarded Arc capability calls", async () => {
    const findings = await runAppKitRule(
      appKitCapabilitySupportedRule,
      "import { AppKit } from '@circle-fin/app-kit';\nconst chain = 'Arc_Testnet';\nawait appKit.bridge({ amount });"
    );

    expect(findings[0]).toMatchObject({
      ruleId: "app-kit/APPKIT_CAPABILITY_SUPPORTED",
      severity: "warning",
      docs: "arc-appkit-capabilities"
    });
  });

  it("APPKIT_CAPABILITY_SUPPORTED allows guarded capability calls", async () => {
    await expect(
      runAppKitRule(
        appKitCapabilitySupportedRule,
        "import { AppKit } from '@circle-fin/app-kit';\nconst chain = 'Arc_Testnet';\nif (capabilities.includes('bridge')) await appKit.bridge({ amount });"
      )
    ).resolves.toEqual([]);
  });

  it("APPKIT_CUSTOM_RPC_RECOMMENDED flags missing custom RPC", async () => {
    const findings = await runAppKitRule(
      appKitCustomRpcRecommendedRule,
      "import { AppKit } from '@circle-fin/app-kit';\nconst chain = 'Arc_Testnet';"
    );

    expect(findings[0]).toMatchObject({
      ruleId: "app-kit/APPKIT_CUSTOM_RPC_RECOMMENDED",
      severity: "warning",
      docs: "arc-appkit-custom-rpc"
    });
  });

  it("APPKIT_CUSTOM_RPC_RECOMMENDED allows custom RPC", async () => {
    await expect(
      runAppKitRule(
        appKitCustomRpcRecommendedRule,
        "import { AppKit } from '@circle-fin/app-kit';\nconst chain = 'Arc_Testnet';\nconst rpcUrl = process.env.ARC_RPC_URL;"
      )
    ).resolves.toEqual([]);
  });

  it("UB_DELEGATE_REQUIRED flags Unified Balance spend without delegate language", async () => {
    const findings = await runAppKitRule(
      ubDelegateRequiredRule,
      "import { AppKit } from '@circle-fin/app-kit';\nawait appKit.unifiedBalance.spend({ provider: 'Circle Wallets', wallet: 'server wallet' });"
    );

    expect(findings[0]).toMatchObject({
      ruleId: "app-kit/UB_DELEGATE_REQUIRED",
      severity: "warning",
      docs: "arc-unified-balance-delegate"
    });
  });

  it("UB_DELEGATE_REQUIRED allows delegate language", async () => {
    await expect(
      runAppKitRule(
        ubDelegateRequiredRule,
        "import { AppKit } from '@circle-fin/app-kit';\nconst delegateWallet = await createDelegate();\nawait appKit.unifiedBalance.spend({ delegateWallet });"
      )
    ).resolves.toEqual([]);
  });

  it("UB_FEE_EXPLANATION_PRESENT flags confirmation UI without fee language", async () => {
    const findings = await runAppKitRule(
      ubFeeExplanationPresentRule,
      "import { AppKit } from '@circle-fin/app-kit';\nexport function Confirm() { return 'Confirm unifiedBalance spend payment'; }"
    );

    expect(findings[0]).toMatchObject({
      ruleId: "app-kit/UB_FEE_EXPLANATION_PRESENT",
      severity: "warning",
      docs: "arc-unified-balance-fees"
    });
  });

  it("UB_FEE_EXPLANATION_PRESENT allows fee explanation", async () => {
    await expect(
      runAppKitRule(
        ubFeeExplanationPresentRule,
        "import { AppKit } from '@circle-fin/app-kit';\nexport function Confirm() { return 'Confirm unifiedBalance spend with forwardingFee and receivedAmount'; }"
      )
    ).resolves.toEqual([]);
  });

  it("APPKIT_BRIDGE_MIN_AMOUNT_NOTE flags Arc-origin bridge without guards", async () => {
    const findings = await runAppKitRule(
      appKitBridgeMinAmountNoteRule,
      "import { AppKit } from '@circle-fin/app-kit';\nawait appKit.bridge({ sourceChain: 'Arc_Testnet', amount });"
    );

    expect(findings[0]).toMatchObject({
      ruleId: "app-kit/APPKIT_BRIDGE_MIN_AMOUNT_NOTE",
      severity: "warning",
      docs: "arc-appkit-bridge-min-amount"
    });
  });

  it("APPKIT_BRIDGE_MIN_AMOUNT_NOTE allows minimum amount guards", async () => {
    await expect(
      runAppKitRule(
        appKitBridgeMinAmountNoteRule,
        "import { AppKit } from '@circle-fin/app-kit';\nif (amount > minAmount) await appKit.bridge({ sourceChain: 'Arc_Testnet', amount, maxFee });"
      )
    ).resolves.toEqual([]);
  });

  it("does not flag generic non-App-Kit code", async () => {
    await expect(
      runAppKitRule(
        appKitBridgeMinAmountNoteRule,
        "await bridge({ sourceChain: 'Arc_Testnet', amount });"
      )
    ).resolves.toEqual([]);
  });

  it("supports severity overrides for App Kit rules", async () => {
    const findings = await runAppKitRule(
      appKitCustomRpcRecommendedRule,
      "import { AppKit } from '@circle-fin/app-kit';\nconst chain = 'Arc_Testnet';",
      {
        "app-kit/APPKIT_CUSTOM_RPC_RECOMMENDED": "critical"
      }
    );

    expect(findings[0]?.severity).toBe("critical");
  });

  it("supports disabling App Kit rules", async () => {
    const findings = await runAppKitRule(
      appKitCustomRpcRecommendedRule,
      "import { AppKit } from '@circle-fin/app-kit';\nconst chain = 'Arc_Testnet';",
      {
        "app-kit/APPKIT_CUSTOM_RPC_RECOMMENDED": "off"
      }
    );

    expect(findings).toEqual([]);
  });

  it("scan pipeline with app-kit preset runs App Kit rules", async () => {
    const projectRoot = createTempProject();
    writeFixture(
      projectRoot,
      "arcready.config.json",
      JSON.stringify({ presets: ["app-kit"] })
    );
    writeFixture(
      projectRoot,
      "package.json",
      JSON.stringify({ name: "bad-app-kit-fixture" })
    );
    writeFixture(
      projectRoot,
      "src/appkit.ts",
      "import { AppKit } from '@circle-fin/app-kit';\nconst chain = 'arc-testnet';"
    );

    const report = await createStubReport(projectRoot);

    expect(report).toMatchObject({
      project: "bad-app-kit-fixture",
      status: "fail",
      score: 75,
      summary: {
        critical: 1,
        warning: 0,
        info: 0
      }
    });
    expect(report.findings[0]?.ruleId).toBe(
      "app-kit/APPKIT_CHAIN_IDENTIFIER_VALID"
    );
  });
});

async function runAppKitRule(
  rule: Rule,
  content: string,
  rules: RuleContext["config"]["rules"] = {}
) {
  return runRules([rule], {
    projectRoot: "/fixture",
    config: {
      ...DEFAULT_CONFIG,
      presets: ["app-kit"],
      rules
    },
    files: ["src/fixture.ts"],
    detectedPresets: {
      detectedPresets: ["app-kit"],
      confidence: "high",
      reasons: ["test"]
    },
    readFile: async () => content
  });
}

function createTempProject(): string {
  const projectRoot = mkdtempSync(join(tmpdir(), "arcready-app-kit-"));
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
