import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, createRuleContext, runRules } from "../src/index.js";
import type { Rule, RuleContext } from "../src/index.js";

describe("runRules", () => {
  it("returns findings from a test rule", async () => {
    const findings = await runRules([createTestRule()], createTestContext());

    expect(findings).toEqual([
      {
        ruleId: "wallet/test",
        severity: "warning",
        message: "test finding",
        files: ["src/index.ts"],
        docs: "https://example.com/rule",
        preset: "wallet"
      }
    ]);
  });

  it("applies severity overrides", async () => {
    const findings = await runRules(
      [createTestRule()],
      createTestContext({
        rules: {
          "wallet/test": "critical"
        }
      })
    );

    expect(findings[0]?.severity).toBe("critical");
  });

  it("disables rules with off", async () => {
    const findings = await runRules(
      [createTestRule()],
      createTestContext({
        rules: {
          "wallet/test": "off"
        }
      })
    );

    expect(findings).toEqual([]);
  });

  it("converts rule errors into warning findings", async () => {
    const findings = await runRules(
      [
        {
          ...createTestRule(),
          run: () => {
            throw new Error("boom");
          }
        }
      ],
      createTestContext()
    );

    expect(findings).toEqual([
      {
        ruleId: "wallet/test",
        severity: "warning",
        message: 'Rule "wallet/test" failed: boom',
        files: [],
        suggestedFix:
          "Check the rule implementation or disable this rule temporarily.",
        docs: "https://example.com/rule",
        preset: "wallet"
      }
    ]);
  });
});

function createTestRule(): Rule {
  return {
    id: "wallet/test",
    name: "Wallet test rule",
    description: "A test rule.",
    preset: "wallet",
    defaultSeverity: "warning",
    docs: ["https://example.com/rule"],
    run: () => [
      {
        ruleId: "wallet/test",
        severity: "warning",
        message: "test finding",
        files: ["src/index.ts"]
      }
    ]
  };
}

function createTestContext(
  configOverrides: Partial<typeof DEFAULT_CONFIG> = {}
): RuleContext {
  return createRuleContext({
    projectRoot: "/fixture",
    config: {
      ...DEFAULT_CONFIG,
      ...configOverrides,
      rules: configOverrides.rules ?? DEFAULT_CONFIG.rules
    },
    files: [],
    detectedPresets: {
      detectedPresets: ["wallet"],
      confidence: "high",
      reasons: ["test"]
    }
  });
}
