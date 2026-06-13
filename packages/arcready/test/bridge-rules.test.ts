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
      preset: "bridge"
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

  it("CCTP_DOMAIN_26 flags wrong Arc CCTP domain", async () => {
    const findings = await runBridgeRule(
      cctpDomain26Rule,
      "export const ARC_DOMAIN = 6; // Arc CCTP depositForBurn attestation"
    );

    expect(findings[0]).toMatchObject({
      ruleId: "bridge/CCTP_DOMAIN_26",
      severity: "critical",
      docs: "arc-cctp-domain"
    });
  });

  it("CCTP_DOMAIN_26 allows Arc CCTP domain 26", async () => {
    await expect(
      runBridgeRule(
        cctpDomain26Rule,
        "export const ARC_DOMAIN = 26; // Arc CCTP depositForBurn attestation"
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
      docs: "arc-canonical-usdc"
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

  it("RELAYER_USES_USDC_FOR_GAS flags ETH relayer funding", async () => {
    const findings = await runBridgeRule(
      relayerUsesUsdcForGasRule,
      "Arc relayer setup: fund with ETH before running the relay script."
    );

    expect(findings[0]).toMatchObject({
      ruleId: "bridge/RELAYER_USES_USDC_FOR_GAS",
      severity: "critical",
      docs: "arc-usdc-gas"
    });
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
      docs: "arc-cctp-attestation"
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

  it("NO_PREVRANDAO_RELAY_SELECTION flags PREVRANDAO relay selection", async () => {
    const findings = await runBridgeRule(
      noPrevrandaoRelaySelectionRule,
      "const chain = 'Arc Testnet'; const relaySelection = block.prevrandao % relayers.length;"
    );

    expect(findings[0]).toMatchObject({
      ruleId: "bridge/NO_PREVRANDAO_RELAY_SELECTION",
      severity: "critical",
      docs: "arc-prevrandao"
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
