export { createStubReport, runScan } from "./report.js";
export type { ScanResult } from "./report.js";
export {
  CONFIG_FILE_NAME,
  DEFAULT_CONFIG,
  loadConfig
} from "../core/config/index.js";
export { discoverFiles } from "../core/fs/index.js";
export { detectProject, readProjectName } from "../core/project/index.js";
export { createRuleContext, runRules } from "../core/rules/index.js";
export {
  createScanReport,
  scoreFindings,
  statusFromSummary,
  summarizeFindings
} from "../core/scoring/index.js";
export type {
  ArcReadyConfig,
  ArcReadyFailLevel,
  ArcReadyPreset,
  ArcReadyReporter,
  ArcReadyRuleLevel
} from "../core/config/index.js";
export type { DiscoverFilesOptions } from "../core/fs/index.js";
export type {
  Finding,
  FindingStatus,
  ScanReport,
  ScanSummary,
  Severity
} from "../core/findings/index.js";
export type {
  DetectProjectOptions,
  DetectionConfidence,
  ProjectDetection
} from "../core/project/index.js";
export type {
  CreateRuleContextOptions,
  DiscoveredFile,
  Rule,
  RuleContext
} from "../core/rules/index.js";
export {
  appKitPlaceholderRule,
  bridgePlaceholderRule,
  createPresetRegistry,
  defaultPresetRegistry,
  getRulesForPresets,
  getRulesForScan,
  walletPlaceholderRule
} from "../presets/index.js";
export type { PresetRegistry, PresetRuleMap } from "../presets/index.js";
export { getReporter } from "../reporters/index.js";
export { htmlReporter } from "../reporters/html/index.js";
export { jsonReporter } from "../reporters/json/index.js";
export { markdownReporter } from "../reporters/markdown/index.js";
export { terminalReporter } from "../reporters/terminal/index.js";
export type { Reporter, ReporterFormat } from "../reporters/index.js";
export {
  appKitBridgeMinAmountNoteRule,
  appKitCapabilitySupportedRule,
  appKitChainIdentifierValidRule,
  appKitCustomRpcRecommendedRule,
  appKitRules,
  ubDelegateRequiredRule,
  ubFeeExplanationPresentRule
} from "../rules/app-kit/index.js";
export {
  attestation404NotFatalRule,
  bridgeConfirmationsOneRule,
  bridgeRules,
  cctpDomain26Rule,
  noPrevrandaoRelaySelectionRule,
  noWrappedUsdcOnArcRule,
  relayerUsesUsdcForGasRule
} from "../rules/bridge/index.js";
export {
  arcChainMetadataRule,
  noBlobTxOnArcRule,
  noEthGasLabelRule,
  oneConfirmationFinalRule,
  prevrandaoNotSupportedRule,
  walletNativeUsdcDisplayRule,
  walletRules
} from "../rules/wallet/index.js";
export { runCli } from "./cli.js";
export type { CliIo } from "./cli.js";
