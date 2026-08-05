import type {
  ArcReadyPreset,
  ArcReadyRuleLevel
} from "../core/config/index.js";
import type { ProjectDetection } from "../core/project/index.js";
import type { Rule } from "../core/rules/index.js";
import {
  appKitChainIdentifierValidRule,
  appKitCustomRpcRecommendedRule,
  ubDelegateRequiredRule,
  ubFeeExplanationPresentRule
} from "../rules/app-kit/index.js";
import {
  attestation404NotFatalRule,
  bridgeRules
} from "../rules/bridge/index.js";
import { walletRules } from "../rules/wallet/index.js";

export type PresetRuleMap = Record<ArcReadyPreset, Rule[]>;

export interface PresetRegistry {
  register(preset: ArcReadyPreset, rules: Rule[]): void;
  getRulesForPresets(presets: ArcReadyPreset[]): Rule[];
  getRulesForScan(
    configuredPresets: ArcReadyPreset[],
    detection: ProjectDetection
  ): Rule[];
}

// Deprecated unsupported rules remain in the known public inventory, while the
// policy-only taxonomy catalog does not configure runtime preset selection.
const appKitDefaultPresetRules: Rule[] = [
  appKitChainIdentifierValidRule,
  appKitCustomRpcRecommendedRule,
  ubDelegateRequiredRule,
  ubFeeExplanationPresentRule
];

// `bridgeRules` remains the all-known public inventory. Default bridge scans use
// this private subset so default exclusion does not remove the public rule ID.
const bridgeDefaultPresetRules: Rule[] = bridgeRules.filter(
  (rule) => rule.id !== attestation404NotFatalRule.id
);

// Built-in default-excluded rules may be selected only through the top-level
// default helper. Custom PresetRegistry instances never receive this registry.
const defaultExcludedRules: Rule[] = [attestation404NotFatalRule];

export function createPresetRegistry(
  initialRules: Partial<Record<ArcReadyPreset, Rule[]>> = {}
): PresetRegistry {
  const rulesByPreset: PresetRuleMap = {
    wallet: [...(initialRules.wallet ?? [])],
    "app-kit": [...(initialRules["app-kit"] ?? [])],
    bridge: [...(initialRules.bridge ?? [])]
  };

  return {
    register(preset, rules) {
      rulesByPreset[preset] = [...rulesByPreset[preset], ...rules];
    },
    getRulesForPresets(presets) {
      return dedupeRules(presets.flatMap((preset) => rulesByPreset[preset]));
    },
    getRulesForScan(configuredPresets, detection) {
      const presets =
        configuredPresets.length > 0
          ? configuredPresets
          : detection.detectedPresets;

      return dedupeRules(presets.flatMap((preset) => rulesByPreset[preset]));
    }
  };
}

export const defaultPresetRegistry = createPresetRegistry({
  wallet: walletRules,
  "app-kit": appKitDefaultPresetRules,
  bridge: bridgeDefaultPresetRules
});

export function getRulesForPresets(presets: ArcReadyPreset[]): Rule[] {
  return defaultPresetRegistry.getRulesForPresets(presets);
}

export function getRulesForScan(
  configuredPresets: ArcReadyPreset[],
  detection: ProjectDetection,
  configuredRules: Readonly<Record<string, ArcReadyRuleLevel>> = {}
): Rule[] {
  const presetRules = defaultPresetRegistry.getRulesForScan(
    configuredPresets,
    detection
  );
  const optedInRules = defaultExcludedRules.filter((rule) =>
    isEnabledRuleLevel(configuredRules[rule.id])
  );

  return dedupeRules([...presetRules, ...optedInRules]);
}

function isEnabledRuleLevel(
  level: ArcReadyRuleLevel | undefined
): level is Exclude<ArcReadyRuleLevel, "off"> {
  return level === "info" || level === "warning" || level === "critical";
}

function dedupeRules(rules: Rule[]): Rule[] {
  const dedupedRules = new Map<string, Rule>();

  for (const rule of rules) {
    if (!dedupedRules.has(rule.id)) {
      dedupedRules.set(rule.id, rule);
    }
  }

  return [...dedupedRules.values()];
}
