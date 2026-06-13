import type { Finding, Severity } from "../../core/findings/index.js";
import { PACKAGE_VERSION } from "../../src/package.js";
import type { Reporter } from "../index.js";

const SEVERITY_ORDER: Severity[] = ["critical", "warning", "info"];

export const terminalReporter: Reporter = {
  format: "terminal",
  render(report) {
    const lines = [
      `ArcReady v${PACKAGE_VERSION}`,
      "",
      `Project: ${report.project}`,
      `Score: ${report.score}`,
      `Status: ${report.status}`,
      `Summary: ${report.summary.critical} critical, ${report.summary.warning} warning, ${report.summary.info} info`,
      ""
    ];

    if (report.findings.length === 0) {
      lines.push("No findings.");
      return `${lines.join("\n")}\n`;
    }

    lines.push("Findings:");

    for (const severity of SEVERITY_ORDER) {
      const findings = report.findings.filter(
        (finding) => finding.severity === severity
      );

      if (findings.length === 0) {
        continue;
      }

      lines.push("", `${severity.toUpperCase()} (${findings.length})`);

      for (const finding of findings) {
        lines.push(...renderFinding(finding));
      }
    }

    return `${lines.join("\n")}\n`;
  }
};

function renderFinding(finding: Finding): string[] {
  const lines = [
    `- ${finding.ruleId}`,
    `  Message: ${finding.message}`,
    `  Files: ${finding.files.length > 0 ? finding.files.join(", ") : "n/a"}`
  ];

  if (finding.suggestedFix) {
    lines.push(`  Suggested fix: ${finding.suggestedFix}`);
  }

  return lines;
}
