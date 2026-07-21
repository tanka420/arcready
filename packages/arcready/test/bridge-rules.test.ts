import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_CONFIG,
  attestation404NotFatalRule,
  bridgeConfirmationsOneRule,
  cctpDomain26Rule,
  createStubReport,
  noPrevrandaoRelaySelectionRule,
  noWrappedUsdcOnArcRule,
  relayerUsesUsdcForGasRule,
  runRules
} from "../src/index.js";
import type { Rule, RuleContext } from "../src/index.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("bridge rules", () => {
  it("BRIDGE_CONFIRMATIONS_ONE flags multi-confirmation Arc bridge config", async () => {
    const findings = await runBridgeRule(
      bridgeConfirmationsOneRule,
      "export const arcBridge = { chain: 'Arc Testnet', requiredConfirmations: 12 };"
    );

    expect(findings[0]).toMatchObject({
      ruleId: "bridge/BRIDGE_CONFIRMATIONS_ONE",
      severity: "critical",
      docs: "arc-finality",
      preset: "bridge",
      message: expect.stringContaining("more than one confirmation"),
      suggestedFix: expect.stringContaining("1")
    });
  });

  it("BRIDGE_CONFIRMATIONS_ONE allows one confirmation", async () => {
    await expect(
      runBridgeRule(
        bridgeConfirmationsOneRule,
        "export const arcBridge = { chain: 'Arc Testnet', requiredConfirmations: 1 };"
      )
    ).resolves.toEqual([]);
  });

  it("BRIDGE_CONFIRMATIONS_ONE ignores guidance against slow finality", async () => {
    await expect(
      runBridgeRule(
        bridgeConfirmationsOneRule,
        "const chain = 'Arc Testnet';\nexport const docs = 'Do not wait for 12 confirmations in Arc bridge settlement.';"
      )
    ).resolves.toEqual([]);
  });

  it.each([
    ["ARC_DOMAIN", "const ARC_DOMAIN = 7;"],
    ["ARC_CCTP_DOMAIN", "const ARC_CCTP_DOMAIN = 7;"],
    ["case and whitespace variants", "const arc_cctp_domain : 7;"]
  ])("CCTP_DOMAIN_26 flags wrong explicit %s", async (_name, source) => {
    const findings = await runBridgeRule(
      cctpDomain26Rule,
      `Arc CCTP bridge\n${source}`
    );

    expect(findings[0]).toMatchObject({
      ruleId: "bridge/CCTP_DOMAIN_26",
      severity: "critical",
      docs: "arc-cctp-domain",
      message: expect.stringContaining("other than 26"),
      suggestedFix: expect.stringContaining("26")
    });
  });

  it.each([
    ["ARC_DOMAIN", "const ARC_DOMAIN = 26;"],
    ["ARC_CCTP_DOMAIN", "const ARC_CCTP_DOMAIN = 26;"]
  ])("CCTP_DOMAIN_26 allows correct explicit %s", async (_name, source) => {
    await expect(
      runBridgeRule(cctpDomain26Rule, `Arc CCTP bridge\n${source}`)
    ).resolves.toEqual([]);
  });

  it("CCTP_DOMAIN_26 flags an inline named domain map", async () => {
    const findings = await runBridgeRule(
      cctpDomain26Rule,
      "Arc CCTP bridge\nconst cctpDomains = { arc: 7 };"
    );

    expect(findings).toHaveLength(1);
    expect(findings[0]?.ruleId).toBe("bridge/CCTP_DOMAIN_26");
  });

  it("CCTP_DOMAIN_26 allows a correct inline named domain map", async () => {
    await expect(
      runBridgeRule(
        cctpDomain26Rule,
        "Arc CCTP bridge\nconst cctpDomains = { arc: 26 };"
      )
    ).resolves.toEqual([]);
  });

  it("CCTP_DOMAIN_26 flags a flat multiline named domain map", async () => {
    const findings = await runBridgeRule(
      cctpDomain26Rule,
      "Arc CCTP bridge\nconst cctpDomains = {\n  arc: 7\n};"
    );

    expect(findings).toHaveLength(1);
  });

  it("CCTP_DOMAIN_26 allows a correct flat multiline named domain map", async () => {
    await expect(
      runBridgeRule(
        cctpDomain26Rule,
        "Arc CCTP bridge\nconst cctpDomains = {\n  arc: 26\n};"
      )
    ).resolves.toEqual([]);
  });

  it("CCTP_DOMAIN_26 flags a directly indented YAML domain map", async () => {
    const findings = await runBridgeRule(
      cctpDomain26Rule,
      "Arc CCTP bridge\ncctpDomains:\n  arc: 7"
    );

    expect(findings).toHaveLength(1);
  });

  it("CCTP_DOMAIN_26 allows a correct directly indented YAML domain map", async () => {
    await expect(
      runBridgeRule(
        cctpDomain26Rule,
        "Arc CCTP bridge\ncctpDomains:\n  arc: 26"
      )
    ).resolves.toEqual([]);
  });

  it.each([
    ["braced", "const cctpDomains = {\r\n  arc: 7\r\n};"],
    ["YAML", "cctpDomains:\r\n  arc: 7"]
  ])(
    "CCTP_DOMAIN_26 supports CRLF in a multiline %s map",
    async (_name, source) => {
      const findings = await runBridgeRule(
        cctpDomain26Rule,
        `Arc CCTP bridge\r\n${source}`
      );

      expect(findings).toHaveLength(1);
    }
  );

  it("CCTP_DOMAIN_26 ignores an unrelated Arc chain ID", async () => {
    await expect(
      runBridgeRule(
        cctpDomain26Rule,
        "Arc CCTP bridge\nconst chainIds = { arc: 5042002 };"
      )
    ).resolves.toEqual([]);
  });

  it("CCTP_DOMAIN_26 ignores an Arc chain ID next to the correct domain", async () => {
    await expect(
      runBridgeRule(
        cctpDomain26Rule,
        "Arc CCTP bridge\nconst cctpDomains = { arc: 26 };\nconst chainIds = { arc: 5042002 };"
      )
    ).resolves.toEqual([]);
  });

  it("CCTP_DOMAIN_26 ignores unrelated Arc numeric configuration", async () => {
    await expect(
      runBridgeRule(
        cctpDomain26Rule,
        "Arc CCTP bridge\nconst retryByChain = { arc: 7 };"
      )
    ).resolves.toEqual([]);
  });

  it("CCTP_DOMAIN_26 ignores documentation warning about wrong domains", async () => {
    await expect(
      runBridgeRule(
        cctpDomain26Rule,
        "const chain = 'Arc Testnet';\n// CCTP note: do not set ARC_DOMAIN = 6; use 26."
      )
    ).resolves.toEqual([]);
  });

  it("CCTP_DOMAIN_26 ignores a commented incorrect named-map entry", async () => {
    await expect(
      runBridgeRule(
        cctpDomain26Rule,
        "Arc CCTP bridge\nconst cctpDomains = {\n  // arc: 7\n  arc: 26\n};"
      )
    ).resolves.toEqual([]);
  });

  it("CCTP_DOMAIN_26 ignores negative guidance about an incorrect domain", async () => {
    await expect(
      runBridgeRule(
        cctpDomain26Rule,
        "Arc CCTP bridge\nconst guidance = 'Do not use ARC_DOMAIN = 7 for the Arc CCTP domain.';"
      )
    ).resolves.toEqual([]);
  });

  it("NO_WRAPPED_USDC_ON_ARC flags wrapped USDC routes", async () => {
    const findings = await runBridgeRule(
      noWrappedUsdcOnArcRule,
      "export const route = { chain: 'Arc Testnet', bridge: true, token: 'USDC.e' };"
    );

    expect(findings[0]).toMatchObject({
      ruleId: "bridge/NO_WRAPPED_USDC_ON_ARC",
      severity: "critical",
      docs: "arc-canonical-usdc",
      message: expect.stringContaining("wrapped or bridged USDC"),
      suggestedFix: expect.stringContaining("canonical Arc USDC")
    });
  });

  it("NO_WRAPPED_USDC_ON_ARC allows canonical USDC routes", async () => {
    await expect(
      runBridgeRule(
        noWrappedUsdcOnArcRule,
        "export const route = { chain: 'Arc Testnet', bridge: true, token: 'USDC' };"
      )
    ).resolves.toEqual([]);
  });

  it("NO_WRAPPED_USDC_ON_ARC ignores guidance against wrapped USDC", async () => {
    await expect(
      runBridgeRule(
        noWrappedUsdcOnArcRule,
        "const chain = 'Arc Testnet';\nexport const docs = 'Do not route USDC.e or wrapped USDC to Arc bridge users.';"
      )
    ).resolves.toEqual([]);
  });

  it("RELAYER_USES_USDC_FOR_GAS flags ETH relayer funding", async () => {
    const findings = await runBridgeRule(
      relayerUsesUsdcForGasRule,
      "Arc relayer setup: fund with ETH before running the relay script."
    );

    expect(findings[0]).toMatchObject({
      ruleId: "bridge/RELAYER_USES_USDC_FOR_GAS",
      severity: "critical",
      docs: "arc-usdc-gas",
      message: expect.stringContaining("ETH is used for gas"),
      suggestedFix: expect.stringContaining("USDC")
    });
  });

  it("RELAYER_USES_USDC_FOR_GAS flags ETH relayer gas token config", async () => {
    const findings = await runBridgeRule(
      relayerUsesUsdcForGasRule,
      "export const arcRelayer = { chain: 'Arc Testnet', relayerGasToken: 'ETH' };"
    );

    expect(findings[0]).toMatchObject({
      ruleId: "bridge/RELAYER_USES_USDC_FOR_GAS",
      severity: "critical",
      docs: "arc-usdc-gas",
      message: expect.stringContaining("ETH is used for gas"),
      suggestedFix: expect.stringContaining("gas-token")
    });
  });

  it("RELAYER_USES_USDC_FOR_GAS ignores guidance against ETH funding", async () => {
    await expect(
      runBridgeRule(
        relayerUsesUsdcForGasRule,
        "const chain = 'Arc Testnet';\n// Relayer setup: do not fund with ETH; use USDC for gas."
      )
    ).resolves.toEqual([]);
  });

  it("RELAYER_USES_USDC_FOR_GAS allows USDC relayer funding", async () => {
    await expect(
      runBridgeRule(
        relayerUsesUsdcForGasRule,
        "Arc relayer setup: fund the relayer wallet with USDC for gas."
      )
    ).resolves.toEqual([]);
  });

  it("ATTESTATION_404_NOT_FATAL flags fatal 404 attestation handling", async () => {
    const findings = await runBridgeRule(
      attestation404NotFatalRule,
      "async function pollAttestation(response) { // CCTP attestation\n if (response.status === 404) throw new Error('attestation failed');\n}"
    );

    expect(findings[0]).toMatchObject({
      ruleId: "bridge/ATTESTATION_404_NOT_FATAL",
      severity: "critical",
      docs: "arc-cctp-attestation",
      message: expect.stringContaining("HTTP 404"),
      suggestedFix: expect.stringContaining("retryable pending")
    });
  });

  it("ATTESTATION_404_NOT_FATAL allows pending 404 handling", async () => {
    await expect(
      runBridgeRule(
        attestation404NotFatalRule,
        "async function pollAttestation(response) { // CCTP attestation\n if (response.status === 404) return { status: 'pending', retry: true };\n}"
      )
    ).resolves.toEqual([]);
  });

  it("ATTESTATION_404_NOT_FATAL ignores retry guidance about 404", async () => {
    await expect(
      runBridgeRule(
        attestation404NotFatalRule,
        "const flow = 'CCTP attestation on Arc';\n// Do not treat attestation 404 as fatal; retry while pending."
      )
    ).resolves.toEqual([]);
  });

  it("NO_PREVRANDAO_RELAY_SELECTION flags PREVRANDAO relay selection", async () => {
    const findings = await runBridgeRule(
      noPrevrandaoRelaySelectionRule,
      "const chain = 'Arc Testnet'; const relaySelection = block.prevrandao % relayers.length;"
    );

    expect(findings[0]).toMatchObject({
      ruleId: "bridge/NO_PREVRANDAO_RELAY_SELECTION",
      severity: "critical",
      docs: "arc-prevrandao",
      message: expect.stringContaining("PREVRANDAO"),
      suggestedFix: expect.stringContaining("relay selection")
    });
  });

  it("NO_PREVRANDAO_RELAY_SELECTION ignores non-Arc relay randomness", async () => {
    await expect(
      runBridgeRule(
        noPrevrandaoRelaySelectionRule,
        "const relaySelection = block.prevrandao % relayers.length;"
      )
    ).resolves.toEqual([]);
  });

  it("NO_PREVRANDAO_RELAY_SELECTION ignores guidance against PREVRANDAO selection", async () => {
    await expect(
      runBridgeRule(
        noPrevrandaoRelaySelectionRule,
        "const chain = 'Arc Testnet';\n// Do not use PREVRANDAO or mixHash for relayer selection randomness."
      )
    ).resolves.toEqual([]);
  });

  it("does not flag generic non-Arc bridge code", async () => {
    await expect(
      runBridgeRule(
        noWrappedUsdcOnArcRule,
        "export const route = { chain: 'Ethereum', bridge: true, token: 'USDC.e' };"
      )
    ).resolves.toEqual([]);
  });

  it("supports severity overrides for bridge rules", async () => {
    const findings = await runBridgeRule(
      bridgeConfirmationsOneRule,
      "export const arcBridge = { chain: 'Arc Testnet', confirmations: 6 };",
      {
        "bridge/BRIDGE_CONFIRMATIONS_ONE": "warning"
      }
    );

    expect(findings[0]?.severity).toBe("warning");
  });

  it("supports disabling bridge rules", async () => {
    const findings = await runBridgeRule(
      bridgeConfirmationsOneRule,
      "export const arcBridge = { chain: 'Arc Testnet', confirmations: 6 };",
      {
        "bridge/BRIDGE_CONFIRMATIONS_ONE": "off"
      }
    );

    expect(findings).toEqual([]);
  });

  it("scan pipeline with bridge preset runs bridge rules", async () => {
    const projectRoot = createTempProject();
    writeFixture(
      projectRoot,
      "arcready.config.json",
      JSON.stringify({ presets: ["bridge"] })
    );
    writeFixture(
      projectRoot,
      "package.json",
      JSON.stringify({ name: "bad-bridge-fixture" })
    );
    writeFixture(
      projectRoot,
      "src/bridge.ts",
      "export const arcBridge = { chain: 'Arc Testnet', finalityBlocks: 6 };"
    );

    const report = await createStubReport(projectRoot);

    expect(report).toMatchObject({
      project: "bad-bridge-fixture",
      status: "fail",
      score: 75,
      summary: {
        critical: 1,
        warning: 0,
        info: 0
      }
    });
    expect(report.findings[0]?.ruleId).toBe("bridge/BRIDGE_CONFIRMATIONS_ONE");
  });
});

async function runBridgeRule(
  rule: Rule,
  content: string,
  rules: RuleContext["config"]["rules"] = {}
) {
  return runRules([rule], {
    projectRoot: "/fixture",
    config: {
      ...DEFAULT_CONFIG,
      presets: ["bridge"],
      rules
    },
    files: ["src/fixture.ts"],
    detectedPresets: {
      detectedPresets: ["bridge"],
      confidence: "high",
      reasons: ["test"]
    },
    readFile: async () => content
  });
}

function createTempProject(): string {
  const projectRoot = mkdtempSync(join(tmpdir(), "arcready-bridge-"));
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
