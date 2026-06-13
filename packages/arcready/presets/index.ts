import type { ArcReadyPreset } from "../core/config/index.js";
import type { ProjectDetection } from "../core/project/index.js";
import type { Rule } from "../core/rules/index.js";
import { appKitRules } from "../rules/app-kit/index.js";
import { bridgeRules } from "../rules/bridge/index.js";
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
  "app-kit": appKitRules,
  bridge: bridgeRules
});

export function getRulesForPresets(presets: ArcReadyPreset[]): Rule[] {
  return defaultPresetRegistry.getRulesForPresets(presets);
}

export function getRulesForScan(
  configuredPresets: ArcReadyPreset[],
  detection: ProjectDetection
): Rule[] {
  return defaultPresetRegistry.getRulesForScan(configuredPresets, detection);
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
