import type { ArcReadyConfig } from "../core/config/index.js";
import { loadConfig } from "../core/config/index.js";
import { discoverFiles } from "../core/fs/index.js";
import type { ScanReport } from "../core/findings/index.js";
import { detectProject, readProjectName } from "../core/project/index.js";
import { createRuleContext, runRules } from "../core/rules/index.js";
import { createScanReport } from "../core/scoring/index.js";
import { getRulesForScan } from "../presets/index.js";

export interface ScanResult {
  report: ScanReport;
  config: ArcReadyConfig;
}

export async function runScan(
  projectRoot = process.cwd()
): Promise<ScanResult> {
  const config = loadConfig(projectRoot);
  const files = discoverFiles({
    projectRoot,
    paths: config.paths,
    exclude: config.exclude
  });
  const detectedPresets = detectProject({ projectRoot, files });
  const rules = getRulesForScan(config.presets, detectedPresets);
  const findings = await runRules(
    rules,
    createRuleContext({
      projectRoot,
      config,
      files,
      detectedPresets
    })
  );
  const report = createScanReport(readProjectName(projectRoot), findings);
  return { report, config };
}

export async function createStubReport(
  projectRoot = process.cwd()
): Promise<ScanReport> {
  const { report } = await runScan(projectRoot);
  return report;
}
