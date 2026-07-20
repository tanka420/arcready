import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { validateScanDiagnosticV2 } from "../core/contracts/v2/validate.js";
import { discoverFiles, discoverFilesInstrumented } from "../core/fs/index.js";
import {
  representReadAttemptPath,
  representRuleIdentity,
  runRulesInstrumented
} from "../core/rules/instrumentation.js";
import {
  DEFAULT_CONFIG,
  jsonReporter,
  runRules,
  runScan
} from "../src/index.js";
import type { Finding, Rule, RuleContext } from "../src/index.js";
import * as publicApi from "../src/index.js";

describe("instrumented rule execution parity", () => {
  it("preserves findings, ordering, overrides, duplicates, failures, and continuation", async () => {
    const zeroRule = createRule("wallet/zero", () => []);
    const findingRule = createRule("wallet/finding", () => [createFinding()]);
    const rawError = new Error("private detector failure");
    const failureRule = createRule("wallet/failure", () => {
      throw rawError;
    });
    const laterRule = createRule("wallet/later", () => [
      createFinding({ ruleId: "wallet/later", message: "later finding" })
    ]);
    const disabledRule = createRule("wallet/disabled", () => {
      throw new Error("disabled rule must not execute");
    });
    const rules = [
      zeroRule,
      findingRule,
      failureRule,
      laterRule,
      findingRule,
      disabledRule
    ];
    const context = createContext({
      rules: {
        "wallet/finding": "critical",
        "wallet/failure": "critical",
        "wallet/disabled": "off"
      }
    });

    const legacy = await runRules(rules, context);
    const instrumented = await runRulesInstrumented(rules, context);

    expect(instrumented.findings).toEqual(legacy);
    expect(legacy.map((finding) => finding.ruleId)).toEqual([
      "wallet/finding",
      "wallet/failure",
      "wallet/later",
      "wallet/finding"
    ]);
    expect(legacy.map((finding) => finding.severity)).toEqual([
      "critical",
      "critical",
      "warning",
      "critical"
    ]);
    expect(legacy[1]?.message).toBe(
      'Rule "wallet/failure" failed: private detector failure'
    );
    expect(
      instrumented.instrumentation.rules.map((rule) => rule.selectionIndex)
    ).toEqual([0, 1, 2, 3, 4, 5]);
    expect(instrumented.instrumentation.rules[0]).toMatchObject({
      execution: "completed",
      findingEmission: "emitted-no-findings",
      normalizedFindingCount: 0,
      applicability: "unknown"
    });
    expect(instrumented.instrumentation.rules[1]).toMatchObject({
      execution: "completed",
      findingEmission: "emitted-findings",
      normalizedFindingCount: 1
    });
    expect(instrumented.instrumentation.rules[2]).toMatchObject({
      execution: "failed",
      findingEmission: "not-evaluated",
      normalizedFindingCount: 0
    });
    expect(instrumented.instrumentation.rules[5]).toEqual({
      selectionIndex: 5,
      rule: { kind: "rule-id", id: "wallet/disabled" },
      scheduling: "disabled",
      execution: "not-run",
      findingEmission: "not-evaluated",
      normalizedFindingCount: 0,
      applicability: "unknown",
      readAttempts: []
    });
  });

  it("executes every duplicate occurrence and preserves selection identity", async () => {
    let invocationCount = 0;
    const rule = createRule("wallet/duplicate", () => {
      invocationCount += 1;
      return [];
    });

    const result = await runRulesInstrumented(
      [rule, rule, rule],
      createContext()
    );

    expect(invocationCount).toBe(3);
    expect(result.instrumentation.rules).toHaveLength(3);
    expect(
      result.instrumentation.rules.map((outcome) => outcome.selectionIndex)
    ).toEqual([0, 1, 2]);
    expect(result.instrumentation.rules.map((outcome) => outcome.rule)).toEqual(
      [
        { kind: "rule-id", id: "wallet/duplicate" },
        { kind: "rule-id", id: "wallet/duplicate" },
        { kind: "rule-id", id: "wallet/duplicate" }
      ]
    );
  });

  it("passes the original RuleContext object through the legacy path", async () => {
    const context = createContext();
    let receivedContext: RuleContext | undefined;
    const rule = createRule("wallet/context", (received) => {
      receivedContext = received;
      return [];
    });

    await runRules([rule], context);

    expect(receivedContext).toBe(context);
  });

  it("preserves custom-rule normalization defaults", async () => {
    const customRule = createRule("custom/rule", () => [
      {
        ruleId: "",
        severity: "info",
        message: "custom result",
        files: []
      }
    ]);
    const context = createContext({ rules: { "custom/rule": "warning" } });

    const legacy = await runRules([customRule], context);
    const instrumented = await runRulesInstrumented([customRule], context);

    expect(instrumented.findings).toEqual(legacy);
    expect(legacy).toEqual([
      {
        ruleId: "custom/rule",
        severity: "warning",
        message: "custom result",
        files: [],
        docs: "https://example.com/custom/rule",
        preset: "wallet"
      }
    ]);
  });

  it("classifies finding-normalization failures as rule failures", async () => {
    const rawError = new Error("private normalization failure");
    const badFinding = Object.defineProperty({}, "ruleId", {
      enumerable: true,
      get() {
        throw rawError;
      }
    }) as Finding;
    const rule = createRule("wallet/normalization", () => [badFinding]);

    const result = await runRulesInstrumented([rule], createContext());

    expect(result.findings[0]?.message).toBe(
      'Rule "wallet/normalization" failed: private normalization failure'
    );
    expect(result.instrumentation.rules[0]).toMatchObject({
      execution: "failed",
      findingEmission: "not-evaluated",
      normalizedFindingCount: 0
    });
    expect(JSON.stringify(result.instrumentation)).not.toContain(
      rawError.message
    );
  });
});

describe("instrumented RuleContext reads", () => {
  it("records successful repeated reads in invocation order without extra reads", async () => {
    const projectRoot = resolve("rule-read-success");
    const firstPath = join(projectRoot, "src", "first.ts");
    const secondPath = join(projectRoot, "src", "second.ts");
    const calls: unknown[] = [];
    const context = createContext({}, projectRoot, async (filePath) => {
      calls.push(filePath);
      return filePath === firstPath ? "first content" : "second content";
    });
    let observedContent = "";
    let observedFiles: RuleContext["files"] | undefined;
    const rule = createRule("wallet/reads", async (ruleContext) => {
      observedFiles = ruleContext.files;
      observedContent += await ruleContext.readFile(firstPath);
      observedContent += await ruleContext.readFile(secondPath);
      observedContent += await ruleContext.readFile(firstPath);
      return [];
    });

    const result = await runRulesInstrumented([rule], context);
    const attempts = result.instrumentation.rules[0]?.readAttempts;

    expect(calls).toEqual([firstPath, secondPath, firstPath]);
    expect(observedContent).toBe("first contentsecond contentfirst content");
    expect(observedFiles).toBe(context.files);
    expect(attempts).toEqual([
      {
        attemptIndex: 0,
        path: { kind: "repository-relative", path: "src/first.ts" },
        outcome: "succeeded"
      },
      {
        attemptIndex: 1,
        path: { kind: "repository-relative", path: "src/second.ts" },
        outcome: "succeeded"
      },
      {
        attemptIndex: 2,
        path: { kind: "repository-relative", path: "src/first.ts" },
        outcome: "succeeded"
      }
    ]);
    expect(JSON.stringify(result.instrumentation)).not.toContain(projectRoot);
    expect(JSON.stringify(result.instrumentation)).not.toContain("content");
  });

  it("records failed reads and rethrows the exact original error to the rule", async () => {
    const projectRoot = resolve("rule-read-failure");
    const filePath = join(projectRoot, "src", "failure.ts");
    const rawError = new Error(`private read failure at ${filePath}`);
    const context = createContext({}, projectRoot, async () => {
      throw rawError;
    });
    let observedError: unknown;
    const rule = createRule("wallet/caught-read", async (ruleContext) => {
      try {
        await ruleContext.readFile(filePath);
      } catch (error) {
        observedError = error;
      }
      return [];
    });

    const result = await runRulesInstrumented([rule], context);

    expect(observedError).toBe(rawError);
    expect(result.instrumentation.rules[0]).toMatchObject({
      execution: "completed",
      readAttempts: [
        {
          attemptIndex: 0,
          path: { kind: "repository-relative", path: "src/failure.ts" },
          outcome: "failed"
        }
      ]
    });
    const serialized = JSON.stringify(result.instrumentation);
    expect(serialized).not.toContain(rawError.message);
    expect(serialized).not.toContain(projectRoot);
    expect(serialized).not.toContain("stack");
  });

  it("preserves read attempts made before an unhandled read failure", async () => {
    const projectRoot = resolve("rule-read-then-fail");
    const goodPath = join(projectRoot, "src", "good.ts");
    const badPath = join(projectRoot, "src", "bad.ts");
    const rawError = new Error("unhandled private read failure");
    const context = createContext({}, projectRoot, async (filePath) => {
      if (filePath === badPath) {
        throw rawError;
      }
      return "safe text";
    });
    const rule = createRule("wallet/read-failure", async (ruleContext) => {
      await ruleContext.readFile(goodPath);
      await ruleContext.readFile(badPath);
      return [];
    });

    const result = await runRulesInstrumented([rule], context);

    expect(result.instrumentation.rules[0]).toMatchObject({
      execution: "failed",
      findingEmission: "not-evaluated",
      readAttempts: [
        { attemptIndex: 0, outcome: "succeeded" },
        { attemptIndex: 1, outcome: "failed" }
      ]
    });
    expect(result.findings[0]?.message).toContain(rawError.message);
    expect(JSON.stringify(result.instrumentation)).not.toContain(
      rawError.message
    );
  });

  it("preserves synchronous read throws and the original argument", async () => {
    const rawError = new Error("synchronous private failure");
    const rawArgument = 42;
    let receivedArgument: unknown;
    const context = createContext({}, resolve("sync-read"), ((
      argument: unknown
    ) => {
      receivedArgument = argument;
      throw rawError;
    }) as RuleContext["readFile"]);
    let observedError: unknown;
    const rule = createRule("wallet/sync-read", async (ruleContext) => {
      try {
        await (
          ruleContext.readFile as unknown as (
            argument: unknown
          ) => Promise<string>
        )(rawArgument);
      } catch (error) {
        observedError = error;
      }
      return [];
    });

    const result = await runRulesInstrumented([rule], context);

    expect(receivedArgument).toBe(rawArgument);
    expect(observedError).toBe(rawError);
    expect(result.instrumentation.rules[0]?.readAttempts).toEqual([
      {
        attemptIndex: 0,
        path: { kind: "unrepresentable" },
        outcome: "failed"
      }
    ]);
  });

  it("does not wait for or later mutate a fire-and-forget read", async () => {
    const projectRoot = resolve("fire-and-forget-read");
    const filePath = join(projectRoot, "src", "pending.ts");
    let settleRead: ((content: string) => void) | undefined;
    const pendingRead = new Promise<string>((resolveRead) => {
      settleRead = resolveRead;
    });
    const context = createContext({}, projectRoot, () => pendingRead);
    const rule = createRule("wallet/fire-and-forget", (ruleContext) => {
      void ruleContext.readFile(filePath);
      return [];
    });

    const result = await runRulesInstrumented([rule], context);
    const snapshot = JSON.stringify(result.instrumentation);

    expect(result.instrumentation.rules[0]?.readAttempts).toEqual([
      {
        attemptIndex: 0,
        path: { kind: "repository-relative", path: "src/pending.ts" },
        outcome: "unsettled"
      }
    ]);

    settleRead?.("late private content");
    await pendingRead;
    await Promise.resolve();

    expect(JSON.stringify(result.instrumentation)).toBe(snapshot);
    expect(snapshot).not.toContain("late private content");
  });

  it("keeps disabled rules free of read attempts", async () => {
    let calls = 0;
    const context = createContext(
      { rules: { "wallet/disabled-read": "off" } },
      resolve("disabled-read"),
      async () => {
        calls += 1;
        return "content";
      }
    );
    const rule = createRule("wallet/disabled-read", async (ruleContext) => {
      await ruleContext.readFile(join(context.projectRoot, "src", "file.ts"));
      return [];
    });

    const result = await runRulesInstrumented([rule], context);

    expect(calls).toBe(0);
    expect(result.instrumentation.rules[0]?.readAttempts).toEqual([]);
  });

  it("attaches safe and unrepresentable attempts to the invoking rule", async () => {
    const projectRoot = resolve("read-attempt-ownership");
    const safePath = join(projectRoot, "src", "safe.ts");
    const outsidePath = resolve(projectRoot, "..", "outside.ts");
    const context = createContext({}, projectRoot, async () => "text");
    const safeRule = createRule("wallet/safe-read", async (ruleContext) => {
      await ruleContext.readFile(safePath);
      return [];
    });
    const unsafeRule = createRule(
      "wallet/unsafe-reads",
      async (ruleContext) => {
        await ruleContext.readFile("relative.ts");
        await ruleContext.readFile(outsidePath);
        return [];
      }
    );

    const result = await runRulesInstrumented([safeRule, unsafeRule], context);

    expect(result.instrumentation.rules[0]?.readAttempts).toEqual([
      {
        attemptIndex: 0,
        path: { kind: "repository-relative", path: "src/safe.ts" },
        outcome: "succeeded"
      }
    ]);
    expect(result.instrumentation.rules[1]?.readAttempts).toEqual([
      {
        attemptIndex: 0,
        path: { kind: "unrepresentable" },
        outcome: "succeeded"
      },
      {
        attemptIndex: 1,
        path: { kind: "unrepresentable" },
        outcome: "succeeded"
      }
    ]);
  });
});

describe("rule instrumentation safety and diagnostics", () => {
  it("represents safe, outside, relative, non-string, and native paths truthfully", () => {
    expect(representRuleIdentity("wallet/safe-rule")).toEqual({
      kind: "rule-id",
      id: "wallet/safe-rule"
    });
    expect(representRuleIdentity(" unsafe ")).toEqual({
      kind: "unrepresentable"
    });
    expect(representRuleIdentity("")).toEqual({ kind: "unrepresentable" });
    expect(representRuleIdentity("x".repeat(257))).toEqual({
      kind: "unrepresentable"
    });
    expect(representRuleIdentity(`unsafe${String.fromCodePoint(1)}`)).toEqual({
      kind: "unrepresentable"
    });

    expect(representReadAttemptPath("/repo", "/repo", "/")).toEqual({
      kind: "project-root"
    });
    expect(representReadAttemptPath("/repo", "/repo/src/file.ts", "/")).toEqual(
      {
        kind: "repository-relative",
        path: "src/file.ts"
      }
    );
    expect(representReadAttemptPath("/repo", "/repo/src/a\\b.ts", "/")).toEqual(
      { kind: "unrepresentable" }
    );
    expect(representReadAttemptPath("/repo", "/outside/file.ts", "/")).toEqual({
      kind: "unrepresentable"
    });
    expect(representReadAttemptPath("/repo", "src/file.ts", "/")).toEqual({
      kind: "unrepresentable"
    });
    expect(representReadAttemptPath("/repo", 42, "/")).toEqual({
      kind: "unrepresentable"
    });
    expect(
      representReadAttemptPath(
        "C:\\repo",
        "C:\\repo\\Src\\Unicode\\File.ts",
        "\\"
      )
    ).toEqual({
      kind: "repository-relative",
      path: "Src/Unicode/File.ts"
    });
  });

  it("emits ordered validated diagnostics without unsafe rule IDs or raw errors", async () => {
    const firstError = new Error("first private failure");
    const secondError = new Error("second private failure");
    const unsafeRuleId = `unsafe${String.fromCodePoint(1)}`;
    const safeRule = createRule("wallet/safe-failure", () => {
      throw firstError;
    });
    const unsafeRule = createRule(unsafeRuleId, () => {
      throw secondError;
    });

    const result = await runRulesInstrumented(
      [safeRule, unsafeRule],
      createContext()
    );

    expect(result.instrumentation.diagnostics).toEqual([
      {
        code: "RULE_EXECUTION_FAILED",
        category: "rule-execution-error",
        level: "error",
        phase: "analysis",
        origin: "tool",
        message: "Rule execution failed.",
        recoverable: true,
        ruleId: "wallet/safe-failure"
      },
      {
        code: "RULE_EXECUTION_FAILED",
        category: "rule-execution-error",
        level: "error",
        phase: "analysis",
        origin: "tool",
        message: "Rule execution failed.",
        recoverable: true
      }
    ]);
    for (const diagnostic of result.instrumentation.diagnostics) {
      expect(() => validateScanDiagnosticV2(diagnostic)).not.toThrow();
    }
    expect(result.instrumentation.rules[1]?.rule).toEqual({
      kind: "unrepresentable"
    });
    const serialized = JSON.stringify(result.instrumentation);
    expect(serialized).not.toContain(firstError.message);
    expect(serialized).not.toContain(secondError.message);
    expect(serialized).not.toContain(unsafeRuleId);
    expect(serialized).not.toContain("stack");
    expect(result.findings[0]?.message).toContain(firstError.message);
    expect(result.findings[1]?.message).toContain(secondError.message);
  });

  it("produces deterministic instrumentation for equivalent executions", async () => {
    const rule = createRule("wallet/deterministic", () => []);

    const first = await runRulesInstrumented([rule, rule], createContext());
    const second = await runRulesInstrumented([rule, rule], createContext());

    expect(first.instrumentation).toEqual(second.instrumentation);
    expect(JSON.stringify(first.instrumentation)).not.toMatch(
      /timestamp|duration/i
    );
  });
});

describe("rule instrumentation boundaries", () => {
  it("does not expose rule instrumentation from the public package API", () => {
    expect("runRulesInstrumented" in publicApi).toBe(false);
    expect("RuleExecutionInstrumentationV1" in publicApi).toBe(false);
  });

  it("preserves representative runScan JSON byte-for-byte", async () => {
    const repoRoot = join(import.meta.dirname, "..", "..", "..");
    const { report } = await runScan(join(repoRoot, "fixtures", "wallet-good"));

    expect(jsonReporter.render(report)).toBe(`{
  "project": "wallet-good",
  "score": 100,
  "status": "pass",
  "summary": {
    "critical": 0,
    "warning": 0,
    "info": 0
  },
  "findings": []
}\n`);
  });

  it("leaves discovery instrumentation parity unchanged", () => {
    const repoRoot = join(import.meta.dirname, "..", "..", "..");
    const projectRoot = join(repoRoot, "fixtures", "wallet-good");
    const options = { projectRoot, paths: ["src"], exclude: [] };

    expect(discoverFilesInstrumented(options).files).toEqual(
      discoverFiles(options)
    );
  });
});

function createRule(id: string, run: Rule["run"]): Rule {
  return {
    id,
    name: `Rule ${id}`,
    description: "Test rule.",
    preset: "wallet",
    defaultSeverity: "warning",
    docs: [`https://example.com/${id}`],
    run
  };
}

function createFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    ruleId: "wallet/finding",
    severity: "warning",
    message: "test finding",
    files: ["src/index.ts"],
    ...overrides
  };
}

function createContext(
  configOverrides: Partial<typeof DEFAULT_CONFIG> = {},
  projectRoot = resolve("rule-instrumentation-fixture"),
  readFile: RuleContext["readFile"] = async () => "fixture content"
): RuleContext {
  return {
    projectRoot,
    config: {
      ...DEFAULT_CONFIG,
      ...configOverrides,
      rules: configOverrides.rules ?? DEFAULT_CONFIG.rules
    },
    files: [join(projectRoot, "src", "index.ts")],
    detectedPresets: {
      detectedPresets: ["wallet"],
      confidence: "high",
      reasons: ["test"]
    },
    readFile
  };
}
