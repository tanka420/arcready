import { describe, expect, it } from "vitest";
import * as arcready from "../src/index.js";
import { createPresetRegistry, getRulesForPresets } from "../src/index.js";
import type { Rule } from "../src/index.js";

describe("preset registry", () => {
  it("returns rules by preset", () => {
    const walletRule = createRule("wallet/test", "wallet");
    const bridgeRule = createRule("bridge/test", "bridge");
    const registry = createPresetRegistry({
      wallet: [walletRule],
      bridge: [bridgeRule]
    });

    expect(registry.getRulesForPresets(["wallet"])).toEqual([walletRule]);
  });

  it("deduplicates duplicate rule IDs", () => {
    const firstRule = createRule("shared/test", "wallet");
    const duplicateRule = createRule("shared/test", "bridge");
    const registry = createPresetRegistry({
      wallet: [firstRule],
      bridge: [duplicateRule]
    });

    expect(registry.getRulesForPresets(["wallet", "bridge"])).toEqual([
      firstRule
    ]);
  });

  it("uses detected presets when configured presets are empty", () => {
    const appKitRule = createRule("app-kit/test", "app-kit");
    const registry = createPresetRegistry({
      "app-kit": [appKitRule]
    });

    expect(
      registry.getRulesForScan([], {
        detectedPresets: ["app-kit"],
        confidence: "high",
        reasons: ["package.json contains @circle-fin/app-kit"]
      })
    ).toEqual([appKitRule]);
  });

  it("does not expose placeholder rules from the public entrypoint", () => {
    expect("walletPlaceholderRule" in arcready).toBe(false);
    expect("appKitPlaceholderRule" in arcready).toBe(false);
    expect("bridgePlaceholderRule" in arcready).toBe(false);
  });

  it("does not include placeholder rules in default presets", () => {
    const ruleIds = getRulesForPresets(["wallet", "app-kit", "bridge"]).map(
      (rule) => rule.id
    );

    expect(ruleIds).not.toContain("wallet/placeholder");
    expect(ruleIds).not.toContain("app-kit/placeholder");
    expect(ruleIds).not.toContain("bridge/placeholder");
  });

  it("keeps active rules available through default presets", () => {
    expect(getRulesForPresets(["wallet"]).map((rule) => rule.id)).toContain(
      "wallet/ARC_CHAIN_METADATA"
    );
    expect(getRulesForPresets(["app-kit"]).map((rule) => rule.id)).toContain(
      "app-kit/APPKIT_CHAIN_IDENTIFIER_VALID"
    );
    expect(getRulesForPresets(["bridge"]).map((rule) => rule.id)).toContain(
      "bridge/BRIDGE_CONFIRMATIONS_ONE"
    );
  });
});

function createRule(id: string, preset: Rule["preset"]): Rule {
  return {
    id,
    name: id,
    description: "test rule",
    preset,
    defaultSeverity: "info",
    docs: [],
    run: () => []
  };
}
