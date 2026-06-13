import { describe, expect, it } from "vitest";
import { createPresetRegistry } from "../src/index.js";
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
