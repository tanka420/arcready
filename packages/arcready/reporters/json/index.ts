import type { ScanReport } from "../../core/findings/index.js";
import type { Reporter } from "../index.js";

export const jsonReporter: Reporter = {
  format: "json",
  render(report) {
    return `${JSON.stringify(stableReport(report), null, 2)}\n`;
  }
};

function stableReport(report: ScanReport): ScanReport {
  return {
    project: report.project,
    score: report.score,
    status: report.status,
    summary: {
      critical: report.summary.critical,
      warning: report.summary.warning,
      info: report.summary.info
    },
    findings: report.findings.map((finding) => ({
      ruleId: finding.ruleId,
      severity: finding.severity,
      message: finding.message,
      files: [...finding.files],
      suggestedFix: finding.suggestedFix,
      docs: finding.docs,
      preset: finding.preset
    }))
  };
}
