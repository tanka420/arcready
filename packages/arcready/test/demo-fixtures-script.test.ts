import { describe, expect, it } from "vitest";
import {
  FIXTURES,
  fixtureMatchesExpectation,
  renderSummary
} from "../../../scripts/demo-fixtures.js";
import type { FixtureValidationResult } from "../../../scripts/demo-fixtures.js";

describe("fixture validation script helpers", () => {
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
    expected: shouldPass ? "pass" : "findings",
    matched: findings === 0 ? shouldPass : !shouldPass
  };
}
