import { readFile } from "node:fs/promises";
import type { ArcReadyConfig, ArcReadyPreset } from "../config/index.js";
import type { Finding, Severity } from "../findings/index.js";
import type { ProjectDetection } from "../project/index.js";
import { executeRules } from "./instrumentation.js";

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
  return executeRules(rules, context);
}
