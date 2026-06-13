import type { Finding, Severity } from "../../core/findings/index.js";
import type { Reporter } from "../index.js";

const SEVERITY_ORDER: Severity[] = ["critical", "warning", "info"];

export const markdownReporter: Reporter = {
  format: "markdown",
  render(report) {
    const lines = [
      "# ArcReady Report",
      "",
      `**Project:** ${report.project}  `,
      `**Score:** ${report.score}  `,
      `**Status:** ${report.status}  `,
      "",
      "## Summary",
      "",
      "| Severity | Count |",
      "|---|---:|",
      `| Critical | ${report.summary.critical} |`,
      `| Warning | ${report.summary.warning} |`,
      `| Info | ${report.summary.info} |`,
      ""
    ];

    if (report.findings.length === 0) {
      lines.push("## Findings", "", "No findings.");
      return `${lines.join("\n")}\n`;
    }

    for (const severity of SEVERITY_ORDER) {
      const findings = report.findings
        .filter((finding) => finding.severity === severity)
        .sort(compareFindings);

      if (findings.length === 0) {
        continue;
      }

      lines.push(`## ${titleCase(severity)} Findings`, "");

      for (const finding of findings) {
        lines.push(...renderFinding(finding), "");
      }
    }

    return `${lines.join("\n").trimEnd()}\n`;
  }
};

function renderFinding(finding: Finding): string[] {
  const files = [...finding.files].sort();
  const docs = finding.docs ? [finding.docs].sort() : [];
  const lines = [
    `### ${headingRuleId(finding.ruleId)}`,
    "",
    `**Preset:** ${finding.preset ?? "unknown"}  `,
    `**Severity:** ${finding.severity}  `,
    "",
    `**Message:** ${finding.message}`,
    "",
    "**Files:**",
    "",
    ...(files.length > 0 ? files.map((file) => `- \`${file}\``) : ["- `n/a`"])
  ];

  if (finding.suggestedFix) {
    lines.push("", "**Suggested fix:**", "", finding.suggestedFix);
  }

  if (docs.length > 0) {
    lines.push("", "**Docs:**", "", ...docs.map((doc) => `- \`${doc}\``));
  }

  return lines;
}

function compareFindings(left: Finding, right: Finding): number {
  return (
    left.ruleId.localeCompare(right.ruleId) ||
    left.message.localeCompare(right.message)
  );
}

function headingRuleId(ruleId: string): string {
  return ruleId.includes("/") ? (ruleId.split("/").at(-1) ?? ruleId) : ruleId;
}

function titleCase(value: string): string {
  return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`;
}
