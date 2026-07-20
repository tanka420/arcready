import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  projectLegacyFindings,
  validateRuleExecutionResult,
  type CompletedRuleOccurrenceExecutionResult,
  type DisabledRuleOccurrenceExecutionResult,
  type FailedRuleOccurrenceExecutionResult,
  type RuleExecutionResult
} from "../core/rules/execution-result.js";
import {
  executeRulesStructured,
  runRulesInstrumented
} from "../core/rules/instrumentation.js";
import {
  DEFAULT_CONFIG,
  jsonReporter,
  runRules,
  runScan,
  type Finding,
  type Rule,
  type RuleContext
} from "../src/index.js";
import * as publicApi from "../src/index.js";

describe("structured rule execution provenance", () => {
  it("represents an empty selection", async () => {
    const result = await executeRulesStructured([], createContext());
    expect(result).toEqual({ occurrences: [] });
    expect(() => validateRuleExecutionResult(result)).not.toThrow();
  });

  it("represents a disabled occurrence without findings", async () => {
    const rule = createRule("wallet/disabled", () => {
      throw new Error("disabled rule executed");
    });
    const result = await executeRulesStructured(
      [rule],
      createContext({ rules: { [rule.id]: "off" } })
    );

    expect(result.occurrences).toEqual([
      {
        selectionIndex: 0,
        rule: { kind: "rule-id", id: rule.id },
        scheduling: "disabled",
        execution: "not-run",
        detectorFindings: []
      }
    ]);
  });

  it.each([0, 1, 3])(
    "represents a completed occurrence with %i detector findings",
    async (findingCount) => {
      const findings = Array.from({ length: findingCount }, (_, index) =>
        createFinding({ message: `finding ${index}` })
      );
      const result = await executeRulesStructured(
        [createRule("wallet/completed", () => findings)],
        createContext()
      );
      const occurrence = result.occurrences[0];

      expect(occurrence).toMatchObject({
        selectionIndex: 0,
        scheduling: "scheduled",
        execution: "completed"
      });
      expect(occurrence?.detectorFindings).toHaveLength(findingCount);
      expect(occurrence?.detectorFindings.map(({ message }) => message)).toEqual(
        findings.map(({ message }) => message)
      );
    }
  );

  it("preserves duplicate selected Rule objects as separate occurrences", async () => {
    const rule = createRule("wallet/duplicate-object", () => []);
    const result = await executeRulesStructured(
      [rule, rule, rule],
      createContext()
    );

    expect(result.occurrences.map(({ selectionIndex }) => selectionIndex)).toEqual([
      0,
      1,
      2
    ]);
    expect(result.occurrences.map(({ rule: identity }) => identity)).toEqual([
      { kind: "rule-id", id: rule.id },
      { kind: "rule-id", id: rule.id },
      { kind: "rule-id", id: rule.id }
    ]);
  });

  it("preserves distinct Rule objects with duplicate IDs", async () => {
    const first = createRule("wallet/duplicate-id", () => []);
    const second = createRule("wallet/duplicate-id", () => [createFinding()]);
    const result = await executeRulesStructured([first, second], createContext());

    expect(result.occurrences).toHaveLength(2);
    expect(result.occurrences[0]?.detectorFindings).toHaveLength(0);
    expect(result.occurrences[1]?.detectorFindings).toHaveLength(1);
  });

  it("uses safe and unrepresentable rule identities", async () => {
    const unsafeId = `unsafe${String.fromCodePoint(1)}`;
    const result = await executeRulesStructured(
      [
        createRule("wallet/safe", () => []),
        createRule(unsafeId, () => [])
      ],
      createContext()
    );

    expect(result.occurrences.map(({ rule }) => rule)).toEqual([
      { kind: "rule-id", id: "wallet/safe" },
      { kind: "unrepresentable" }
    ]);
  });

  it("uses exact mutually exclusive branch keys", () => {
    expect(Object.keys(disabledOccurrence()).sort()).toEqual(
      ["detectorFindings", "execution", "rule", "scheduling", "selectionIndex"].sort()
    );
    expect(Object.keys(completedOccurrence()).sort()).toEqual(
      ["detectorFindings", "execution", "rule", "scheduling", "selectionIndex"].sort()
    );
    expect(Object.keys(failedOccurrence()).sort()).toEqual(
      [
        "detectorFindings",
        "execution",
        "fallbackFinding",
        "rule",
        "scheduling",
        "selectionIndex"
      ].sort()
    );
  });
});

describe("RuleExecutionResult validation", () => {
  it.each([null, [], "result", 1])("rejects non-result value %j", (value) => {
    expectInvalid(value);
  });

  it("rejects unknown result fields and class instances", () => {
    expectInvalid({ occurrences: [], extra: true });
    expectInvalid(Object.assign(new DirectRecord(), { occurrences: [] }));
  });

  it("rejects sparse and undefined occurrences", () => {
    expectInvalid({ occurrences: Array(1) });
    expectInvalid({ occurrences: [undefined] });
  });

  it.each([-1, 1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid selectionIndex %s",
    (selectionIndex) => {
      expectInvalid({
        occurrences: [{ ...disabledOccurrence(), selectionIndex }]
      });
    }
  );

  it("rejects unsafe represented IDs and malformed unrepresentable identities", () => {
    expectInvalid({
      occurrences: [
        { ...disabledOccurrence(), rule: { kind: "rule-id", id: " unsafe " } }
      ]
    });
    expectInvalid({
      occurrences: [
        {
          ...disabledOccurrence(),
          rule: { kind: "unrepresentable", rawId: "private" }
        }
      ]
    });
  });

  it.each([
    [
      "disabled/completed",
      { ...disabledOccurrence(), execution: "completed" }
    ],
    [
      "scheduled/not-run",
      { ...completedOccurrence(), execution: "not-run" }
    ],
    [
      "unsupported scheduling",
      { ...completedOccurrence(), scheduling: "queued" }
    ]
  ])("rejects invalid lifecycle combination %s", (_label, occurrence) => {
    expectInvalid({ occurrences: [occurrence] });
  });

  it("rejects a failed occurrence with detector findings", () => {
    expectInvalid({
      occurrences: [
        { ...failedOccurrence(), detectorFindings: [createFinding()] }
      ]
    });
  });

  it("rejects a failed occurrence without one scalar fallback", () => {
    const occurrence = failedOccurrence() as unknown as Record<string, unknown>;
    delete occurrence.fallbackFinding;
    expectInvalid({ occurrences: [occurrence] });
    expectInvalid({
      occurrences: [{ ...failedOccurrence(), fallbackFinding: [createFinding()] }]
    });
  });

  it("rejects completed and disabled occurrences with fallback fields", () => {
    expectInvalid({
      occurrences: [
        { ...completedOccurrence(), fallbackFinding: createFinding() }
      ]
    });
    expectInvalid({
      occurrences: [
        { ...disabledOccurrence(), fallbackFinding: createFinding() }
      ]
    });
  });

  it("rejects non-array detector findings and non-plain finding records", () => {
    expectInvalid({
      occurrences: [{ ...completedOccurrence(), detectorFindings: {} }]
    });
    expectInvalid({
      occurrences: [
        {
          ...completedOccurrence(),
          detectorFindings: [Object.assign(new DirectRecord(), createFinding())]
        }
      ]
    });
  });

  it("does not add stricter semantic validation to legacy finding payloads", () => {
    const structurallyNormalized = {
      ruleId: 42,
      severity: "custom",
      message: false,
      files: "legacy",
      extraDetectorField: true
    };
    expect(() =>
      validateRuleExecutionResult({
        occurrences: [
          {
            ...completedOccurrence(),
            detectorFindings: [structurallyNormalized]
          }
        ]
      })
    ).not.toThrow();
  });
});

describe("legacy finding projection", () => {
  it("projects an empty result to a new empty array", () => {
    const result: RuleExecutionResult = { occurrences: [] };
    const projected = projectLegacyFindings(result);
    expect(projected).toEqual([]);
    expect(projected).not.toBe(result.occurrences);
  });

  it("preserves occurrence order, detector order, fallback position, and duplicates", () => {
    const first = createFinding({ message: "first" });
    const duplicate = createFinding({ message: "duplicate" });
    const fallback = createFinding({ message: "fallback" });
    const last = createFinding({ message: "last" });
    const result: RuleExecutionResult = {
      occurrences: [
        completedOccurrence(0, [first, duplicate, duplicate]),
        disabledOccurrence(1),
        failedOccurrence(2, fallback),
        completedOccurrence(3, [last])
      ]
    };

    expect(projectLegacyFindings(result)).toEqual([
      first,
      duplicate,
      duplicate,
      fallback,
      last
    ]);
  });

  it("preserves finding and nested identities without mutating the result", () => {
    const files = ["src/identity.ts"];
    const finding = createFinding({ files });
    const result: RuleExecutionResult = {
      occurrences: [completedOccurrence(0, [finding])]
    };
    const before = structuredClone(result);
    const projected = projectLegacyFindings(result);

    expect(projected).not.toBe(result.occurrences[0]!.detectorFindings);
    expect(projected[0]).toBe(finding);
    expect(projected[0]!.files).toBe(files);
    expect(result).toEqual(before);
  });
});

describe("shared executor legacy parity", () => {
  it("keeps the public runRules arity and exact RuleContext identity", async () => {
    const context = createContext();
    let received: RuleContext | undefined;
    const rule = createRule("wallet/context", (value) => {
      received = value;
      return [];
    });

    expect(runRules).toHaveLength(2);
    await runRules([rule], context);
    expect(received).toBe(context);
  });

  it("preserves normalized detector values and nested references", async () => {
    const files = ["src/custom.ts"];
    const raw = createFinding({
      ruleId: "",
      severity: "info",
      files,
      docs: undefined,
      preset: undefined
    });
    const rule = createRule("wallet/normalization", () => [raw]);
    const result = await executeRulesStructured(
      [rule],
      createContext({ rules: { [rule.id]: "critical" } })
    );
    const occurrence = result.occurrences[0];
    const normalized = occurrence?.detectorFindings[0];

    expect(normalized).toEqual({
      ruleId: rule.id,
      severity: "critical",
      message: raw.message,
      files,
      docs: rule.docs[0],
      preset: rule.preset
    });
    expect(normalized).not.toBe(raw);
    expect(normalized?.files).toBe(files);
    expect(projectLegacyFindings(result)[0]).toBe(normalized);
  });

  it("preserves fallback value, position, and severity behavior", async () => {
    const warningFailure = createRule("wallet/warning-failure", () => {
      throw new Error("warning failure");
    });
    const criticalFailure = createRule("wallet/critical-failure", () => {
      throw new Error("critical failure");
    });
    const rules = [
      createRule("wallet/before", () => [createFinding({ message: "before" })]),
      warningFailure,
      createRule("wallet/after", () => [createFinding({ message: "after" })]),
      criticalFailure
    ];
    const findings = await runRules(
      rules,
      createContext({ rules: { [criticalFailure.id]: "critical" } })
    );

    expect(findings.map(({ message }) => message)).toEqual([
      "before",
      'Rule "wallet/warning-failure" failed: warning failure',
      "after",
      'Rule "wallet/critical-failure" failed: critical failure'
    ]);
    expect(findings[1]).toEqual({
      ruleId: warningFailure.id,
      severity: "warning",
      message: 'Rule "wallet/warning-failure" failed: warning failure',
      files: [],
      suggestedFix:
        "Check the rule implementation or disable this rule temporarily.",
      docs: warningFailure.docs[0],
      preset: "wallet"
    });
    expect(findings[3]?.severity).toBe("critical");
  });

  it("executes duplicate selected occurrences sequentially", async () => {
    const invocationOrder: number[] = [];
    const rule = createRule("wallet/repeated", () => {
      invocationOrder.push(invocationOrder.length);
      return [createFinding({ message: `call ${invocationOrder.length}` })];
    });
    const result = await executeRulesStructured(
      [rule, rule, rule],
      createContext()
    );

    expect(invocationOrder).toEqual([0, 1, 2]);
    expect(projectLegacyFindings(result).map(({ message }) => message)).toEqual([
      "call 1",
      "call 2",
      "call 3"
    ]);
  });
});

describe("rule failure and normalization atomicity", () => {
  it.each([
    ["synchronous throw", () => { throw new Error("sync failure"); }],
    ["asynchronous rejection", async () => { throw new Error("async failure"); }],
    ["malformed return", (() => ({ malformed: true })) as Rule["run"]]
  ])("creates one failed occurrence for %s", async (_label, run) => {
    const result = await executeRulesStructured(
      [createRule("wallet/failure", run)],
      createContext()
    );
    const occurrence = result.occurrences[0];

    expect(occurrence?.execution).toBe("failed");
    expect(occurrence?.detectorFindings).toEqual([]);
    expect(
      occurrence && "fallbackFinding" in occurrence
        ? occurrence.fallbackFinding
        : undefined
    ).toBeDefined();
    expect(projectLegacyFindings(result)).toHaveLength(1);
  });

  it.each([0, 1])(
    "commits no detector output when finding %i fails normalization",
    async (badIndex) => {
      const rawError = new Error(`normalization failure ${badIndex}`);
      const badFinding = Object.defineProperty({}, "ruleId", {
        enumerable: true,
        get() {
          throw rawError;
        }
      }) as Finding;
      const returned =
        badIndex === 0
          ? [badFinding, createFinding({ message: "later" })]
          : [createFinding({ message: "temporary" }), badFinding];
      const result = await executeRulesStructured(
        [createRule("wallet/normalization-failure", () => returned)],
        createContext()
      );
      const occurrence = result.occurrences[0];

      expect(occurrence?.execution).toBe("failed");
      expect(occurrence?.detectorFindings).toEqual([]);
      expect(projectLegacyFindings(result)).toHaveLength(1);
      expect(projectLegacyFindings(result)[0]?.message).toContain(rawError.message);
      expect(projectLegacyFindings(result).some(({ message }) => message === "temporary"))
        .toBe(false);
    }
  );
});

describe("instrumentation projection parity", () => {
  it("preserves disabled, completed, finding, and failed outcomes", async () => {
    const disabled = createRule("wallet/disabled", () => []);
    const failure = createRule("wallet/failure", () => {
      throw new Error("private failure");
    });
    const result = await runRulesInstrumented(
      [
        disabled,
        createRule("wallet/zero", () => []),
        createRule("wallet/finding", () => [createFinding()]),
        failure
      ],
      createContext({ rules: { [disabled.id]: "off" } })
    );

    expect(result.instrumentation.rules).toEqual([
      {
        selectionIndex: 0,
        rule: { kind: "rule-id", id: disabled.id },
        scheduling: "disabled",
        execution: "not-run",
        findingEmission: "not-evaluated",
        normalizedFindingCount: 0,
        applicability: "unknown",
        readAttempts: []
      },
      expect.objectContaining({
        selectionIndex: 1,
        execution: "completed",
        findingEmission: "emitted-no-findings",
        normalizedFindingCount: 0
      }),
      expect.objectContaining({
        selectionIndex: 2,
        execution: "completed",
        findingEmission: "emitted-findings",
        normalizedFindingCount: 1
      }),
      expect.objectContaining({
        selectionIndex: 3,
        execution: "failed",
        findingEmission: "not-evaluated",
        normalizedFindingCount: 0
      })
    ]);
    expect(result.instrumentation.diagnostics).toEqual([
      {
        code: "RULE_EXECUTION_FAILED",
        category: "rule-execution-error",
        level: "error",
        phase: "analysis",
        origin: "tool",
        message: "Rule execution failed.",
        recoverable: true,
        ruleId: failure.id
      }
    ]);
  });

  it("keeps fallback findings out of normalized detector counts", async () => {
    const result = await runRulesInstrumented(
      [createRule("wallet/failure", () => { throw new Error("failure"); })],
      createContext()
    );
    expect(result.findings).toHaveLength(1);
    expect(result.instrumentation.rules[0]?.normalizedFindingCount).toBe(0);
  });

  it("preserves sanitized diagnostic failure order", async () => {
    const unsafeId = `unsafe${String.fromCodePoint(1)}`;
    const result = await runRulesInstrumented(
      [
        createRule("wallet/first", () => { throw new Error("first private"); }),
        createRule(unsafeId, () => { throw new Error("second private"); })
      ],
      createContext()
    );

    expect(result.instrumentation.diagnostics.map(({ ruleId }) => ruleId)).toEqual([
      "wallet/first",
      undefined
    ]);
    const serialized = JSON.stringify(result.instrumentation);
    expect(serialized).not.toContain("first private");
    expect(serialized).not.toContain("second private");
    expect(serialized).not.toContain(unsafeId);
  });

  it("keeps a caught read failure on a completed occurrence", async () => {
    const projectRoot = resolve("provenance-caught-read");
    const filePath = join(projectRoot, "src", "file.ts");
    const context = createContext({}, projectRoot, async () => {
      throw new Error("caught read");
    });
    const rule = createRule("wallet/caught-read", async (ruleContext) => {
      try {
        await ruleContext.readFile(filePath);
      } catch {
        // The rule intentionally handles this read failure.
      }
      return [];
    });
    const result = await runRulesInstrumented([rule], context);

    expect(result.instrumentation.rules[0]).toMatchObject({
      execution: "completed",
      readAttempts: [{ attemptIndex: 0, outcome: "failed" }]
    });
    expect(result.instrumentation.diagnostics).toEqual([]);
  });

  it("keeps an unhandled read failure on a failed occurrence", async () => {
    const projectRoot = resolve("provenance-unhandled-read");
    const filePath = join(projectRoot, "src", "file.ts");
    const context = createContext({}, projectRoot, async () => {
      throw new Error("unhandled read");
    });
    const rule = createRule("wallet/unhandled-read", async (ruleContext) => {
      await ruleContext.readFile(filePath);
      return [];
    });
    const result = await runRulesInstrumented([rule], context);

    expect(result.instrumentation.rules[0]).toMatchObject({
      execution: "failed",
      readAttempts: [{ attemptIndex: 0, outcome: "failed" }]
    });
    expect(result.instrumentation.diagnostics).toHaveLength(1);
  });

  it("snapshots an unsettled read without awaiting or late mutation", async () => {
    const projectRoot = resolve("provenance-unsettled-read");
    const filePath = join(projectRoot, "src", "file.ts");
    let settle: ((value: string) => void) | undefined;
    const pending = new Promise<string>((resolveRead) => {
      settle = resolveRead;
    });
    const context = createContext({}, projectRoot, () => pending);
    const rule = createRule("wallet/unsettled-read", (ruleContext) => {
      void ruleContext.readFile(filePath);
      return [];
    });
    const result = await runRulesInstrumented([rule], context);
    const snapshot = JSON.stringify(result.instrumentation);

    expect(result.instrumentation.rules[0]?.readAttempts).toEqual([
      {
        attemptIndex: 0,
        path: { kind: "repository-relative", path: "src/file.ts" },
        outcome: "unsettled"
      }
    ]);
    settle?.("late content");
    await pending;
    await Promise.resolve();
    expect(JSON.stringify(result.instrumentation)).toBe(snapshot);
  });
});

describe("provenance security and boundaries", () => {
  it("keeps diagnostics, reads, errors, stacks, timing, and origin markers out", async () => {
    const rawError = new Error("legacy private message");
    const result = await executeRulesStructured(
      [createRule("wallet/failure", () => { throw rawError; })],
      createContext()
    );
    const occurrence = result.occurrences[0] as unknown as Record<string, unknown>;

    for (const field of [
      "diagnostic",
      "diagnostics",
      "readAttempts",
      "rawError",
      "errorMessage",
      "stack",
      "timestamp",
      "duration",
      "origin"
    ]) {
      expect(field in occurrence).toBe(false);
    }
    expect(JSON.stringify(result)).not.toContain(rawError.stack);
  });

  it("does not create instrumentation records in legacy structured mode", async () => {
    const context = createContext({}, resolve("legacy-no-instrumentation"), async () => {
      throw new Error("read failure");
    });
    const rule = createRule("wallet/legacy", async (ruleContext) => {
      try {
        await ruleContext.readFile("unchanged-relative-path");
      } catch {
        // Legacy execution intentionally handles this read failure.
      }
      return [];
    });
    const result = await executeRulesStructured([rule], context);
    expect(result.occurrences[0]).not.toHaveProperty("readAttempts");
    expect(result.occurrences[0]).not.toHaveProperty("diagnostic");
  });

  it("does not publicly expose provenance or canonical adapters", () => {
    expect("RuleExecutionResult" in publicApi).toBe(false);
    expect("executeRulesStructured" in publicApi).toBe(false);
    expect("projectLegacyFindings" in publicApi).toBe(false);
    expect("validateRuleExecutionResult" in publicApi).toBe(false);
    expect("adaptDetectorFindingsV2" in publicApi).toBe(false);
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
}
`);
  });
});

function disabledOccurrence(
  selectionIndex = 0
): DisabledRuleOccurrenceExecutionResult {
  return {
    selectionIndex,
    rule: { kind: "rule-id", id: "wallet/test" },
    scheduling: "disabled",
    execution: "not-run",
    detectorFindings: []
  };
}

function completedOccurrence(
  selectionIndex = 0,
  detectorFindings: readonly Finding[] = [createFinding()]
): CompletedRuleOccurrenceExecutionResult {
  return {
    selectionIndex,
    rule: { kind: "rule-id", id: "wallet/test" },
    scheduling: "scheduled",
    execution: "completed",
    detectorFindings
  };
}

function failedOccurrence(
  selectionIndex = 0,
  fallbackFinding = createFinding({ message: "fallback" })
): FailedRuleOccurrenceExecutionResult {
  return {
    selectionIndex,
    rule: { kind: "rule-id", id: "wallet/test" },
    scheduling: "scheduled",
    execution: "failed",
    detectorFindings: [],
    fallbackFinding
  };
}

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
  projectRoot = resolve("rule-provenance-fixture"),
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

function expectInvalid(value: unknown): void {
  expect(() => validateRuleExecutionResult(value)).toThrow(TypeError);
}

class DirectRecord {}
