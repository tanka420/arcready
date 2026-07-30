import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEMO_FIXTURES,
  FIXTURES,
  fixtureMatchesExpectation,
  renderSummary,
  runFixtureDemo,
  sortedUniqueRuleIds
} from "../../../scripts/demo-fixtures.js";
import type { FixtureValidationResult } from "../../../scripts/demo-fixtures.js";

const REPO_ROOT = resolve(import.meta.dirname, "../../..");

describe("fixture validation script helpers", () => {
  it("defines the demo pair in exact order", () => {
    expect(DEMO_FIXTURES).toEqual([
      {
        name: "broken-arc-integration",
        projectPath: "examples/demo-projects/broken-arc-integration",
        shouldPass: false
      },
      {
        name: "fixed-arc-integration",
        projectPath: "examples/demo-projects/fixed-arc-integration",
        shouldPass: true
      }
    ]);
  });

  it("defines fixtures in validation order", () => {
    expect(FIXTURES.map((fixture) => fixture.name)).toEqual([
      "wallet-good",
      "wallet-bad",
      "bridge-good",
      "bridge-bad",
      "app-kit-good",
      "app-kit-bad",
      "broken-arc-integration",
      "fixed-arc-integration"
    ]);
    expect(FIXTURES.map((fixture) => fixture.projectPath)).toEqual([
      "fixtures/wallet-good",
      "fixtures/wallet-bad",
      "fixtures/bridge-good",
      "fixtures/bridge-bad",
      "fixtures/app-kit-good",
      "fixtures/app-kit-bad",
      "examples/demo-projects/broken-arc-integration",
      "examples/demo-projects/fixed-arc-integration"
    ]);
  });

  it("reuses the exact demo fixture objects in the full fixture list", () => {
    expect(FIXTURES[6]).toBe(DEMO_FIXTURES[0]);
    expect(FIXTURES[7]).toBe(DEMO_FIXTURES[1]);
  });

  it("keeps the complete default fixture order and expectations", async () => {
    const results = await runFixtureDemo(REPO_ROOT);

    expect(results.map(({ fixture }) => fixture)).toEqual([
      "wallet-good",
      "wallet-bad",
      "bridge-good",
      "bridge-bad",
      "app-kit-good",
      "app-kit-bad",
      "broken-arc-integration",
      "fixed-arc-integration",
      "wallet-amount-good",
      "wallet-amount-bad"
    ]);
    expect(results.every(({ matched }) => matched)).toBe(true);
  });

  it("returns sorted unique rule IDs without mutating findings", () => {
    const findings = [
      { ruleId: "wallet/NO_BLOB_TX_ON_ARC" },
      { ruleId: "bridge/CCTP_DOMAIN_26" },
      { ruleId: "wallet/NO_BLOB_TX_ON_ARC" },
      { ruleId: "app-kit/APPKIT_CHAIN_IDENTIFIER_VALID" }
    ];
    const original = structuredClone(findings);

    expect(sortedUniqueRuleIds(findings)).toEqual([
      "app-kit/APPKIT_CHAIN_IDENTIFIER_VALID",
      "bridge/CCTP_DOMAIN_26",
      "wallet/NO_BLOB_TX_ON_ARC"
    ]);
    expect(findings).toEqual(original);
  });

  it("evaluates expected fixture outcomes", () => {
    expect(
      fixtureMatchesExpectation(createResult("wallet-good", true, 0))
    ).toBe(true);
    expect(
      fixtureMatchesExpectation(createResult("wallet-bad", false, 1))
    ).toBe(true);
    expect(
      fixtureMatchesExpectation(createResult("wallet-good", true, 1))
    ).toBe(false);
    expect(
      fixtureMatchesExpectation(
        createResult("broken-arc-integration", false, 0)
      )
    ).toBe(false);
    expect(
      fixtureMatchesExpectation(createResult("fixed-arc-integration", true, 0))
    ).toBe(true);
  });

  it("renders a readable summary table", () => {
    const summary = renderSummary([
      createResult("wallet-good", true, 0),
      createResult("wallet-bad", false, 1)
    ]);

    expect(summary).toContain("Fixture");
    expect(summary).toContain("Status");
    expect(summary).toContain("Critical");
    expect(summary).toContain("wallet-good");
    expect(summary).toContain("wallet-bad");
    expect(summary).toContain("OK");
  });
});

function createResult(
  fixture: string,
  shouldPass: boolean,
  findings: number
): FixtureValidationResult {
  return {
    fixture,
    status: findings === 0 ? "pass" : "fail",
    score: findings === 0 ? 100 : 75,
    critical: findings,
    warning: 0,
    info: 0,
    findings,
    ruleIds: [],
    expected: shouldPass ? "pass" : "findings",
    matched: findings === 0 ? shouldPass : !shouldPass
  };
}
