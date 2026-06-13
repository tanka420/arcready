import { readFile } from "node:fs/promises";
import type { ArcReadyConfig, ArcReadyPreset } from "../config/index.js";
import type { Finding, Severity } from "../findings/index.js";
import type { ProjectDetection } from "../project/index.js";

export type DiscoveredFile = string;

export interface Rule {
  id: string;
  name: string;
  description: string;
  preset: ArcReadyPreset;
  defaultSeverity: Severity;
  docs: string[];
  run(context: RuleContext): Promise<Finding[]> | Finding[];
}

export interface RuleContext {
  projectRoot: string;
  config: ArcReadyConfig;
  files: DiscoveredFile[];
  detectedPresets: ProjectDetection;
  readFile(filePath: string): Promise<string>;
}

export interface CreateRuleContextOptions {
  projectRoot: string;
  config: ArcReadyConfig;
  files: DiscoveredFile[];
  detectedPresets: ProjectDetection;
}

export function createRuleContext(
  options: CreateRuleContextOptions
): RuleContext {
  return {
    projectRoot: options.projectRoot,
    config: options.config,
    files: options.files,
    detectedPresets: options.detectedPresets,
    readFile: (filePath) => readFile(filePath, "utf8")
  };
}

export async function runRules(
  rules: Rule[],
  context: RuleContext
): Promise<Finding[]> {
  const findings: Finding[] = [];

  for (const rule of rules) {
    const severityOverride = context.config.rules[rule.id];

    if (severityOverride === "off") {
      continue;
    }

    try {
      const ruleFindings = await rule.run(context);
      findings.push(...normalizeFindings(rule, ruleFindings, severityOverride));
    } catch (error) {
      findings.push(createRuleErrorFinding(rule, error, severityOverride));
    }
  }

  return findings;
}

function normalizeFindings(
  rule: Rule,
  findings: Finding[],
  severityOverride: ArcReadyConfig["rules"][string] | undefined
): Finding[] {
  return findings.map((finding) => ({
    ...finding,
    ruleId: finding.ruleId || rule.id,
    severity: resolveFindingSeverity(
      severityOverride,
      finding.severity ?? rule.defaultSeverity
    ),
    files: finding.files ?? [],
    docs: finding.docs ?? rule.docs[0],
    preset: finding.preset ?? rule.preset
  }));
}

function createRuleErrorFinding(
  rule: Rule,
  error: unknown,
  severityOverride: ArcReadyConfig["rules"][string] | undefined
): Finding {
  const message = error instanceof Error ? error.message : String(error);
  const severity = severityOverride === "critical" ? "critical" : "warning";

  return {
    ruleId: rule.id,
    severity,
    message: `Rule "${rule.id}" failed: ${message}`,
    files: [],
    suggestedFix:
      "Check the rule implementation or disable this rule temporarily.",
    docs: rule.docs[0],
    preset: rule.preset
  };
}

function resolveFindingSeverity(
  severityOverride: ArcReadyConfig["rules"][string] | undefined,
  defaultSeverity: Severity
): Severity {
  if (
    severityOverride === "info" ||
    severityOverride === "warning" ||
    severityOverride === "critical"
  ) {
    return severityOverride;
  }

  return defaultSeverity;
}
