import { describe, expect, it } from "vitest";
import {
  htmlReporter,
  jsonReporter,
  markdownReporter,
  terminalReporter
} from "../src/index.js";
import type { ScanReport } from "../src/index.js";

describe("terminalReporter", () => {
  it("renders a clean report", () => {
    const output = terminalReporter.render(createReport([]));

    expect(output).toContain("ArcReady v");
    expect(output).toContain("Project: fixture");
    expect(output).toContain("Score: 100");
    expect(output).toContain("Status: pass");
    expect(output).toContain("Summary: 0 critical, 0 warning, 0 info");
    expect(output).toContain("No findings.");
  });

  it("renders findings grouped by severity", () => {
    const output = terminalReporter.render(
      createReport([
        {
          ruleId: "wallet/NO_ETH_GAS_LABEL",
          severity: "critical",
          message: "Arc fee UI labels gas as ETH.",
          files: ["src/fees.tsx"],
          suggestedFix: "Display fees as USDC.",
          docs: "arc-usdc-gas",
          preset: "wallet"
        },
        {
          ruleId: "wallet/example",
          severity: "warning",
          message: "Example warning.",
          files: [],
          preset: "wallet"
        }
      ])
    );

    expect(output).toContain("CRITICAL (1)");
    expect(output).toContain("WARNING (1)");
    expect(output).toContain("- wallet/NO_ETH_GAS_LABEL");
    expect(output).toContain("Message: Arc fee UI labels gas as ETH.");
    expect(output).toContain("Files: src/fees.tsx");
    expect(output).toContain("Suggested fix: Display fees as USDC.");
  });
});

describe("jsonReporter", () => {
  it("produces parseable JSON", () => {
    const output = jsonReporter.render(createReport([]));

    expect(JSON.parse(output)).toEqual(createReport([]));
  });

  it("includes expected fields", () => {
    const parsed = JSON.parse(jsonReporter.render(createReport([])));

    expect(Object.keys(parsed)).toEqual([
      "project",
      "score",
      "status",
      "summary",
      "findings"
    ]);
    expect(parsed.summary).toEqual({
      critical: 0,
      warning: 0,
      info: 0
    });
  });
});

describe("markdownReporter", () => {
  it("renders a clean report", () => {
    const output = markdownReporter.render(createReport([]));

    expect(output).toBe(`# ArcReady Report

**Project:** fixture  
**Score:** 100  
**Status:** pass  

## Summary

| Severity | Count |
|---|---:|
| Critical | 0 |
| Warning | 0 |
| Info | 0 |

## Findings

No findings.
`);
  });

  it("renders critical, warning, and info findings", () => {
    const output = markdownReporter.render(
      createReport([
        {
          ruleId: "wallet/NO_ETH_GAS_LABEL",
          severity: "critical",
          message: "Arc uses USDC as gas but ETH labeling was found.",
          files: ["src/components/FeeRow.tsx"],
          suggestedFix: "Replace ETH labels with USDC fee display.",
          docs: "arc-usdc-gas",
          preset: "wallet"
        },
        {
          ruleId: "app-kit/APPKIT_CUSTOM_RPC_RECOMMENDED",
          severity: "warning",
          message: "Custom RPC is missing.",
          files: ["src/appkit.ts"],
          suggestedFix: "Configure a dedicated Arc RPC.",
          docs: "arc-appkit-custom-rpc",
          preset: "app-kit"
        },
        {
          ruleId: "bridge/example",
          severity: "info",
          message: "Informational finding.",
          files: ["src/bridge.ts"],
          preset: "bridge"
        }
      ])
    );

    expect(output).toContain("## Critical Findings");
    expect(output).toContain("## Warning Findings");
    expect(output).toContain("## Info Findings");
    expect(output).toContain("### NO_ETH_GAS_LABEL");
    expect(output).toContain("**Preset:** wallet  ");
    expect(output).toContain("- `src/components/FeeRow.tsx`");
    expect(output).toContain("**Suggested fix:**");
    expect(output).toContain("- `arc-usdc-gas`");
  });

  it("renders deterministically", () => {
    const output = markdownReporter.render(
      createReport([
        {
          ruleId: "wallet/B_RULE",
          severity: "critical",
          message: "Second",
          files: ["z.ts", "a.ts"],
          docs: "docs-b",
          preset: "wallet"
        },
        {
          ruleId: "wallet/A_RULE",
          severity: "critical",
          message: "First",
          files: ["b.ts", "a.ts"],
          docs: "docs-a",
          preset: "wallet"
        }
      ])
    );

    expect(output.indexOf("### A_RULE")).toBeLessThan(
      output.indexOf("### B_RULE")
    );
    expect(output.indexOf("- `a.ts`")).toBeLessThan(output.indexOf("- `b.ts`"));
  });
});

describe("htmlReporter", () => {
  it("renders a clean report", () => {
    const output = htmlReporter.render(createReport([]));

    expect(output).toContain("<!doctype html>");
    expect(output).toContain('<html lang="en">');
    expect(output).toContain("<title>ArcReady Report - fixture</title>");
    expect(output).toContain("<h1>ArcReady Report</h1>");
    expect(output).toContain("Project: fixture");
    expect(output).toContain("Score");
    expect(output).toContain("pass");
    expect(output).toContain("Critical");
    expect(output).toContain("Warning");
    expect(output).toContain("Info");
    expect(output).toContain("No findings.");
    expect(output).toContain("Generated by ArcReady");
  });

  it("renders critical, warning, and info findings", () => {
    const output = htmlReporter.render(
      createReport([
        {
          ruleId: "wallet/NO_ETH_GAS_LABEL",
          severity: "critical",
          message: "Arc fee UI labels gas as ETH.",
          files: ["src/fees.tsx"],
          suggestedFix: "Display fees as USDC.",
          docs: "arc-usdc-gas",
          preset: "wallet"
        },
        {
          ruleId: "app-kit/APPKIT_CUSTOM_RPC_RECOMMENDED",
          severity: "warning",
          message: "Custom RPC is missing.",
          files: ["src/appkit.ts"],
          suggestedFix: "Configure a dedicated Arc RPC.",
          docs: "arc-appkit-custom-rpc",
          preset: "app-kit"
        },
        {
          ruleId: "bridge/example",
          severity: "info",
          message: "Informational finding.",
          files: ["src/bridge.ts"],
          preset: "bridge"
        }
      ])
    );

    expect(output).toContain("Critical Findings");
    expect(output).toContain("Warning Findings");
    expect(output).toContain("Info Findings");
    expect(output).toContain("wallet/NO_ETH_GAS_LABEL");
    expect(output).toContain("Preset: wallet");
    expect(output).toContain("Severity: critical");
    expect(output).toContain("<code>src/fees.tsx</code>");
    expect(output).toContain("Suggested fix:");
    expect(output).toContain("arc-usdc-gas");
  });

  it("escapes user-controlled content", () => {
    const output = htmlReporter.render({
      ...createReport([
        {
          ruleId: "wallet/<script>",
          severity: "critical",
          message: "Bad <script>alert('x')</script> & data",
          files: ["src/<file>.tsx"],
          suggestedFix: 'Use "safe" output',
          docs: "docs/<unsafe>",
          preset: "wallet"
        }
      ]),
      project: "<project>"
    });

    expect(output).toContain("&lt;project&gt;");
    expect(output).toContain("wallet/&lt;script&gt;");
    expect(output).toContain(
      "Bad &lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt; &amp; data"
    );
    expect(output).toContain("<code>src/&lt;file&gt;.tsx</code>");
    expect(output).toContain("Use &quot;safe&quot; output");
    expect(output).toContain("docs/&lt;unsafe&gt;");
    expect(output).not.toContain("<script>alert");
  });

  it("renders deterministically", () => {
    const output = htmlReporter.render(
      createReport([
        {
          ruleId: "wallet/B_RULE",
          severity: "critical",
          message: "Second",
          files: ["z.ts", "a.ts"],
          docs: "docs-b",
          preset: "wallet"
        },
        {
          ruleId: "wallet/A_RULE",
          severity: "critical",
          message: "First",
          files: ["b.ts", "a.ts"],
          docs: "docs-a",
          preset: "wallet"
        }
      ])
    );

    expect(output.indexOf("wallet/A_RULE")).toBeLessThan(
      output.indexOf("wallet/B_RULE")
    );
    expect(output.indexOf("<code>a.ts</code>")).toBeLessThan(
      output.indexOf("<code>b.ts</code>")
    );
  });
});

function createReport(findings: ScanReport["findings"]): ScanReport {
  return {
    project: "fixture",
    score: findings.length === 0 ? 100 : 65,
    status: findings.length === 0 ? "pass" : "fail",
    summary: {
      critical: findings.filter((finding) => finding.severity === "critical")
        .length,
      warning: findings.filter((finding) => finding.severity === "warning")
        .length,
      info: findings.filter((finding) => finding.severity === "info").length
    },
    findings
  };
}
