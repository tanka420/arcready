import type { ArcReadyPreset } from "../config/index.js";

export type Severity = "info" | "warning" | "critical";
export type FindingStatus = "pass" | "warn" | "fail";

export interface Finding {
  ruleId: string;
  severity: Severity;
  message: string;
  files: string[];
  suggestedFix?: string;
  docs?: string;
  preset?: ArcReadyPreset;
}

export interface ScanSummary {
  critical: number;
  warning: number;
  info: number;
}

export interface ScanReport {
  project: string;
  score: number;
  status: FindingStatus;
  summary: ScanSummary;
  findings: Finding[];
}
