import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createScanReport, getRulesForPresets, runScan } from "../src/index.js";
import type { ArcReadyPreset, Finding } from "../src/index.js";

const repoRoot = join(import.meta.dirname, "..", "..", "..");
const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("cross-preset regression coverage", () => {
  it("keeps preset rule IDs isolated by preset", () => {
    expect(ruleIdsFor("wallet")).toEqual([
      "wallet/ARC_CHAIN_METADATA",
      "wallet/WALLET_NATIVE_USDC_DISPLAY",
      "wallet/NO_ETH_GAS_LABEL",
      "wallet/ONE_CONFIRMATION_FINAL",
      "wallet/PREVRANDAO_NOT_SUPPORTED",
      "wallet/NO_BLOB_TX_ON_ARC"
    ]);

    expect(ruleIdsFor("bridge")).toEqual([
      "bridge/BRIDGE_CONFIRMATIONS_ONE",
      "bridge/CCTP_DOMAIN_26",
      "bridge/NO_WRAPPED_USDC_ON_ARC",
      "bridge/RELAYER_USES_USDC_FOR_GAS",
      "bridge/ATTESTATION_404_NOT_FATAL",
      "bridge/NO_PREVRANDAO_RELAY_SELECTION"
    ]);

    expect(ruleIdsFor("app-kit")).toEqual([
      "app-kit/APPKIT_CHAIN_IDENTIFIER_VALID",
      "app-kit/APPKIT_CAPABILITY_SUPPORTED",
      "app-kit/APPKIT_CUSTOM_RPC_RECOMMENDED",
      "app-kit/UB_DELEGATE_REQUIRED",
      "app-kit/UB_FEE_EXPLANATION_PRESENT",
      "app-kit/APPKIT_BRIDGE_MIN_AMOUNT_NOTE"
    ]);
  });

  it("keeps placeholder rules out of every default preset", () => {
    const ruleIds = getRulesForPresets(["wallet", "bridge", "app-kit"]).map(
      (rule) => rule.id
    );

    expect(ruleIds).toHaveLength(18);
    expect(ruleIds.every((ruleId) => !ruleId.includes("placeholder"))).toBe(
      true
    );
  });

  it("does not run bridge or App Kit checks when wallet preset is selected", async () => {
    const { report } = await runScan(
      createProject("wallet-only", ["wallet"], {
        "src/fixture.ts":
          "import { AppKit } from '@circle-fin/app-kit';\nconst appKitChain = 'arc-testnet';\nexport const bridgeRoute = { chain: 'Arc Testnet', bridge: true, finalityBlocks: 6, token: 'USDC.e' };"
      })
    );

    expect(report.findings).toEqual([]);
    expect(report.status).toBe("pass");
  });

  it("does not run wallet or App Kit checks when bridge preset is selected", async () => {
    const { report } = await runScan(
      createProject("bridge-only", ["bridge"], {
        "src/fixture.ts":
          "import { AppKit } from '@circle-fin/app-kit';\nconst appKitChain = 'arc-testnet';\nexport const walletFlow = { name: 'Arc Testnet', chainId: 5042002, confirmations: 3 };"
      })
    );

    expect(report.findings).toEqual([]);
    expect(report.status).toBe("pass");
  });

  it("does not run wallet or bridge checks when App Kit preset is selected", async () => {
    const { report } = await runScan(
      createProject("app-kit-only", ["app-kit"], {
        "src/fixture.ts":
          "export const walletFlow = { name: 'Arc Testnet', chainId: 5042002, confirmations: 3 };\nexport const bridgeRoute = { chain: 'Arc Testnet', bridge: true, finalityBlocks: 6, token: 'USDC.e' };"
      })
    );

    expect(report.findings).toEqual([]);
    expect(report.status).toBe("pass");
  });

  it("keeps known fixture outcomes stable", async () => {
    await expectFixture("wallet-good", "pass");
    await expectFixture("wallet-bad", "fail");
    await expectFixture("bridge-good", "pass");
    await expectFixture("bridge-bad", "fail");
    await expectFixture("app-kit-good", "pass");
    await expectFixture("app-kit-bad", "fail");
  });

  it("keeps report summary counts and status consistent across presets", () => {
    const report = createScanReport("cross-preset", [
      createFinding("wallet/ONE_CONFIRMATION_FINAL", "critical", "wallet"),
      createFinding("bridge/RELAYER_USES_USDC_FOR_GAS", "critical", "bridge"),
      createFinding(
        "app-kit/APPKIT_CUSTOM_RPC_RECOMMENDED",
        "warning",
        "app-kit"
      )
    ]);

    expect(report.status).toBe("fail");
    expect(report.summary).toEqual({
      critical: 2,
      warning: 1,
      info: 0
    });
    expect(report.findings.map((finding) => finding.preset)).toEqual([
      "wallet",
      "bridge",
      "app-kit"
    ]);
  });
});

function ruleIdsFor(preset: ArcReadyPreset): string[] {
  return getRulesForPresets([preset]).map((rule) => rule.id);
}

function createProject(
  name: string,
  presets: ArcReadyPreset[],
  files: Record<string, string>
): string {
  const projectRoot = mkdtempSync(join(tmpdir(), "arcready-cross-preset-"));
  tempDirs.push(projectRoot);

  writeFixture(projectRoot, "package.json", JSON.stringify({ name }));
  writeFixture(projectRoot, "arcready.config.json", JSON.stringify({ presets }));

  for (const [filePath, content] of Object.entries(files)) {
    writeFixture(projectRoot, filePath, content);
  }

  return projectRoot;
}

async function expectFixture(
  fixtureName: string,
  status: "pass" | "fail"
): Promise<void> {
  const { report } = await runScan(join(repoRoot, "fixtures", fixtureName));

  expect(report.status).toBe(status);
}

function createFinding(
  ruleId: string,
  severity: Finding["severity"],
  preset: Finding["preset"]
): Finding {
  return {
    ruleId,
    severity,
    message: `${ruleId} finding`,
    files: ["src/fixture.ts"],
    preset
  };
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
