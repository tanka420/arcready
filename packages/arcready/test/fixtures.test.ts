import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runScan } from "../src/index.js";

const repoRoot = join(import.meta.dirname, "..", "..", "..");

describe("validation fixtures", () => {
  it("wallet-good passes without findings", async () => {
    const { report } = await runScan(pathToFixture("wallet-good"));

    expect(report.findings).toEqual([]);
    expect(report.status).toBe("pass");
  });

  it("wallet-bad triggers ONE_CONFIRMATION_FINAL", async () => {
    const { report } = await runScan(pathToFixture("wallet-bad"));

    expect(hasFinding(report, "wallet/ONE_CONFIRMATION_FINAL")).toBe(true);
    expect(report.status).toBe("fail");
  });

  it("bridge-good passes without findings", async () => {
    const { report } = await runScan(pathToFixture("bridge-good"));

    expect(report.findings).toEqual([]);
    expect(report.status).toBe("pass");
  });

  it("bridge-bad triggers bridge validation", async () => {
    const { report } = await runScan(pathToFixture("bridge-bad"));

    expect(
      hasFinding(report, "bridge/BRIDGE_CONFIRMATIONS_ONE") ||
        hasFinding(report, "bridge/RELAYER_USES_USDC_FOR_GAS")
    ).toBe(true);
    expect(report.status).toBe("fail");
  });

  it("app-kit-good passes without findings", async () => {
    const { report } = await runScan(pathToFixture("app-kit-good"));

    expect(report.findings).toEqual([]);
    expect(report.status).toBe("pass");
  });

  it("app-kit-bad triggers APPKIT_CHAIN_IDENTIFIER_VALID", async () => {
    const { report } = await runScan(pathToFixture("app-kit-bad"));

    expect(hasFinding(report, "app-kit/APPKIT_CHAIN_IDENTIFIER_VALID")).toBe(
      true
    );
    expect(report.status).toBe("fail");
  });
});

function pathToFixture(name: string): string {
  return join(repoRoot, "fixtures", name);
}

function hasFinding(
  report: Awaited<ReturnType<typeof runScan>>["report"],
  ruleId: string
): boolean {
  return report.findings.some((finding) => finding.ruleId === ruleId);
}
