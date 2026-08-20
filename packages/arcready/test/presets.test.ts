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

  it("keeps retained rules available through default presets", () => {
    expect(arcready.walletRules.map((rule) => rule.id)).toContain(
      "wallet/NO_ETH_GAS_LABEL"
    );
    expect(getRulesForPresets(["wallet"]).map((rule) => rule.id)).toEqual([
      "wallet/ARC_CHAIN_METADATA",
      "wallet/WALLET_NATIVE_USDC_DISPLAY",
      "wallet/ARC_USDC_AMOUNT_CONVERSION",
      "wallet/ONE_CONFIRMATION_FINAL",
      "wallet/PREVRANDAO_NOT_SUPPORTED",
      "wallet/NO_BLOB_TX_ON_ARC"
    ]);
    expect(getRulesForPresets(["app-kit"]).map((rule) => rule.id)).toContain(
      "app-kit/APPKIT_CHAIN_IDENTIFIER_VALID"
    );
    expect(getRulesForPresets(["bridge"]).map((rule) => rule.id)).toContain(
      "bridge/BRIDGE_CONFIRMATIONS_ONE"
    );
  });

  it("exports only the C06B1 rule policy through the public API", () => {
    expect(arcready.arcUsdcAmountConversionRule.id).toBe(
      "wallet/ARC_USDC_AMOUNT_CONVERSION"
    );
    expect("analyzeArcUsdcAmountFile" in arcready).toBe(false);
    expect("ArcUsdcAmountIssueKind" in arcready).toBe(false);
  });

  it("preserves deprecated App Kit rules as public inventory exports", () => {
    expect(arcready.appKitRules.map((rule) => rule.id)).toEqual([
      "app-kit/APPKIT_CHAIN_IDENTIFIER_VALID",
      "app-kit/APPKIT_CAPABILITY_SUPPORTED",
      "app-kit/APPKIT_CUSTOM_RPC_RECOMMENDED",
      "app-kit/UB_DELEGATE_REQUIRED",
      "app-kit/UB_FEE_EXPLANATION_PRESENT",
      "app-kit/APPKIT_BRIDGE_MIN_AMOUNT_NOTE"
    ]);
    expect(arcready.appKitCapabilitySupportedRule.id).toBe(
      "app-kit/APPKIT_CAPABILITY_SUPPORTED"
    );
    expect(arcready.appKitBridgeMinAmountNoteRule.id).toBe(
      "app-kit/APPKIT_BRIDGE_MIN_AMOUNT_NOTE"
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
