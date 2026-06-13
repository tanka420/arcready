import type {
  Finding,
  FindingStatus,
  ScanReport,
  ScanSummary
} from "../findings/index.js";

export function summarizeFindings(findings: Finding[]): ScanSummary {
  return findings.reduce<ScanSummary>(
    (summary, finding) => {
      summary[finding.severity] += 1;
      return summary;
    },
    {
      critical: 0,
      warning: 0,
      info: 0
    }
  );
}

export function scoreFindings(findings: Finding[]): number {
  const summary = summarizeFindings(findings);
  const score =
    100 - summary.critical * 25 - summary.warning * 10 - summary.info * 2;

  return Math.max(0, score);
}

export function statusFromSummary(summary: ScanSummary): FindingStatus {
  if (summary.critical > 0) {
    return "fail";
  }

  if (summary.warning > 0) {
    return "warn";
  }

  return "pass";
}

export function createScanReport(
  project: string,
  findings: Finding[] = []
): ScanReport {
  const summary = summarizeFindings(findings);

  return {
    project,
    score: scoreFindings(findings),
    status: statusFromSummary(summary),
    summary,
    findings
  };
}
