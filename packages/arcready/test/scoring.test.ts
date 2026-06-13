import { describe, expect, it } from "vitest";
import { createScanReport, scoreFindings, statusFromSummary } from "../src/index.js";
import type { Finding } from "../src/index.js";

describe("scoring", () => {
  it("scores no findings as 100 and pass", () => {
    const report = createScanReport("example-project", []);

    expect(report).toEqual({
      project: "example-project",
      score: 100,
      status: "pass",
      summary: {
        critical: 0,
        warning: 0,
        info: 0
      },
      findings: []
    });
  });

  it("scores critical, warning, and info findings", () => {
    const findings: Finding[] = [
      createFinding("arc/critical", "critical"),
      createFinding("arc/warning", "warning"),
      createFinding("arc/info", "info")
    ];

    expect(scoreFindings(findings)).toBe(63);
    expect(createScanReport("example-project", findings)).toMatchObject({
      project: "example-project",
      score: 63,
      status: "fail",
      summary: {
        critical: 1,
        warning: 1,
        info: 1
      }
    });
  });

  it("floors score at zero", () => {
    const findings = Array.from({ length: 5 }, (_, index) =>
      createFinding(`arc/critical-${index}`, "critical")
    );

    expect(scoreFindings(findings)).toBe(0);
  });
});

describe("statusFromSummary", () => {
  it("returns fail when there are critical findings", () => {
    expect(statusFromSummary({ critical: 1, warning: 0, info: 0 })).toBe("fail");
    expect(statusFromSummary({ critical: 3, warning: 2, info: 1 })).toBe("fail");
  });

  it("returns warn when there are warnings but no criticals", () => {
    expect(statusFromSummary({ critical: 0, warning: 1, info: 0 })).toBe("warn");
    expect(statusFromSummary({ critical: 0, warning: 2, info: 5 })).toBe("warn");
  });

  it("returns pass when there are no criticals or warnings", () => {
    expect(statusFromSummary({ critical: 0, warning: 0, info: 0 })).toBe("pass");
    expect(statusFromSummary({ critical: 0, warning: 0, info: 3 })).toBe("pass");
  });
});

function createFinding(ruleId: string, severity: Finding["severity"]): Finding {
  return {
    ruleId,
    severity,
    message: `${ruleId} message`,
    files: ["src/example.ts"],
    suggestedFix: "Update the integration.",
    docs: "https://example.com/docs",
    preset: "wallet"
  };
}
