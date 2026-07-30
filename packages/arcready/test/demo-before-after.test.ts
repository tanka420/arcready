import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ESSENTIAL_RULE_IDS,
  evaluateBeforeAfterDemo,
  renderBeforeAfterDemo,
  runBeforeAfterDemo
} from "../../../scripts/demo-before-after.js";
import type { FixtureValidationResult } from "../../../scripts/demo-fixtures.js";

const REPO_ROOT = resolve(import.meta.dirname, "../../..");

type NumericField = "score" | "critical" | "warning" | "info" | "findings";

interface MalformedNumericCase {
  project: "broken" | "fixed";
  resultIndex: 0 | 1;
  field: NumericField;
  valueName: string;
  value: unknown;
}

const NUMERIC_FIELDS: readonly NumericField[] = [
  "score",
  "critical",
  "warning",
  "info",
  "findings"
];
const MALFORMED_NUMERIC_VALUES: readonly (readonly [string, unknown])[] = [
  ["NaN", Number.NaN],
  ["Infinity", Number.POSITIVE_INFINITY],
  ["negative", -1],
  ["fractional", 1.5],
  ["numeric string", "1"],
  ["undefined", undefined]
];
const MALFORMED_NUMERIC_CASES: readonly MalformedNumericCase[] =
  NUMERIC_FIELDS.flatMap((field) =>
    MALFORMED_NUMERIC_VALUES.flatMap(([valueName, value]) => [
      { project: "broken", resultIndex: 0, field, valueName, value },
      { project: "fixed", resultIndex: 1, field, valueName, value }
    ])
  );

describe("before/after demo helpers", () => {
  it("accepts the exact passing before/after pair", () => {
    expect(evaluateBeforeAfterDemo(createPassingPair())).toEqual({
      passed: true,
      errors: []
    });
  });

  it("renders deterministic output with stable rule ordering", () => {
    const output = renderBeforeAfterDemo(createPassingPair());

    expect(output).toBe(`ArcReady Before/After Demo

BEFORE  broken-arc-integration  FAIL  0  4 findings
  required findings: 4/4
  app-kit/APPKIT_CHAIN_IDENTIFIER_VALID
  bridge/CCTP_DOMAIN_26
  wallet/ARC_CHAIN_METADATA
  wallet/NO_BLOB_TX_ON_ARC
AFTER  fixed-arc-integration  PASS  100  0 findings

Result: PASS`);
  });

  it("rejects reversed input order", () => {
    const results = createPassingPair().reverse();

    expectFailure(results, "Demo result order must be");
  });

  it("rejects a missing project", () => {
    expectFailure(
      [createBrokenResult()],
      "Missing demo project: fixed-arc-integration."
    );
  });

  it("rejects a duplicate project", () => {
    expectFailure(
      [createBrokenResult(), createBrokenResult()],
      "Duplicate demo project: broken-arc-integration."
    );
  });

  it("rejects an unexpected third result", () => {
    expectFailure(
      [
        ...createPassingPair(),
        createResult({
          fixture: "unexpected-project",
          status: "pass",
          score: 100
        })
      ],
      "Unexpected demo project: unexpected-project."
    );
  });

  it("rejects a broken project that does not fail", () => {
    expectFailure(
      [createBrokenResult({ status: "pass" }), createFixedResult()],
      "broken-arc-integration must have status fail."
    );
  });

  it("rejects a broken project without a critical finding", () => {
    expectFailure(
      [createBrokenResult({ critical: 0 }), createFixedResult()],
      "broken-arc-integration must have a critical finding."
    );
  });

  it.each(MALFORMED_NUMERIC_CASES)(
    "rejects malformed $project $field value $valueName",
    ({ resultIndex, field, value }) => {
      expectMalformedResult(
        replaceResultField(resultIndex, field, value),
        field
      );
    }
  );

  it.each([
    ["string containing every required ID", 0, ESSENTIAL_RULE_IDS.join("|")],
    ["array-like object", 1, { length: 0 }],
    ["non-string member", 0, [...ESSENTIAL_RULE_IDS, 7]],
    ["duplicate member", 0, [...ESSENTIAL_RULE_IDS, ESSENTIAL_RULE_IDS[0]]],
    ["unsorted members", 0, [...ESSENTIAL_RULE_IDS].reverse()]
  ] as const)(
    "rejects malformed rule IDs: %s",
    (_name, resultIndex, ruleIds) => {
      expectMalformedResult(
        replaceResultField(resultIndex, "ruleIds", ruleIds),
        "ruleIds"
      );
    }
  );

  it.each([
    ["null record", () => null, "record"],
    ["array record", () => [], "record"],
    [
      "missing required field",
      () =>
        Object.fromEntries(
          Object.entries(createBrokenResult()).filter(
            ([field]) => field !== "critical"
          )
        ),
      "critical"
    ],
    [
      "invalid status",
      () => ({ ...createBrokenResult(), status: "warning" }),
      "status"
    ],
    [
      "non-boolean matched",
      () => ({ ...createBrokenResult(), matched: "true" }),
      "matched"
    ],
    ["non-string error", () => ({ ...createBrokenResult(), error: 7 }), "error"]
  ] as const)(
    "rejects malformed record: %s",
    (_name, createMalformedResult, malformedField) => {
      expectMalformedResult(
        [createMalformedResult(), createFixedResult()],
        malformedField
      );
    }
  );

  it.each(ESSENTIAL_RULE_IDS)(
    "rejects a broken project missing %s",
    (missingRuleId) => {
      expectFailure(
        [
          createBrokenResult({
            ruleIds: ESSENTIAL_RULE_IDS.filter(
              (ruleId) => ruleId !== missingRuleId
            )
          }),
          createFixedResult()
        ],
        missingRuleId
      );
    }
  );

  it("rejects a broken scan error", () => {
    expectFailure(
      [
        createBrokenResult({
          status: "error",
          error: "broken scan failed"
        }),
        createFixedResult()
      ],
      "broken-arc-integration scan errored."
    );
  });

  it("rejects a fixed project that does not pass", () => {
    expectFailure(
      [createBrokenResult(), createFixedResult({ status: "fail" })],
      "fixed-arc-integration must have status pass."
    );
  });

  it("rejects a fixed project without score 100", () => {
    expectFailure(
      [createBrokenResult(), createFixedResult({ score: 99 })],
      "fixed-arc-integration must have score 100."
    );
  });

  it.each([
    ["critical", { critical: 1 }],
    ["warning", { warning: 1 }],
    ["info", { info: 1 }],
    ["total", { findings: 1 }]
  ] as const)("rejects a fixed project with a %s finding", (_label, counts) => {
    expectFailure(
      [createBrokenResult(), createFixedResult(counts)],
      "fixed-arc-integration must have zero findings."
    );
  });

  it("rejects fixed-project rule IDs", () => {
    expectFailure(
      [
        createBrokenResult(),
        createFixedResult({ ruleIds: ["wallet/ARC_CHAIN_METADATA"] })
      ],
      "fixed-arc-integration must have an empty rule-ID list."
    );
  });

  it("rejects a fixed scan error", () => {
    expectFailure(
      [
        createBrokenResult(),
        createFixedResult({
          status: "error",
          error: "fixed scan failed"
        })
      ],
      "fixed-arc-integration scan errored."
    );
  });

  it("does not mutate input arrays or records", () => {
    const results = createPassingPair();
    const original = structuredClone(results);

    evaluateBeforeAfterDemo(results);
    renderBeforeAfterDemo(results);

    expect(results).toEqual(original);
  });

  it("accepts the full in-process scan of both checked-in demos", async () => {
    const run = await runBeforeAfterDemo(REPO_ROOT);

    expect(run.exitCode).toBe(0);
    expect(run.evaluation).toEqual({ passed: true, errors: [] });
    expect(run.results.map(({ fixture }) => fixture)).toEqual([
      "broken-arc-integration",
      "fixed-arc-integration"
    ]);
    expect(run.results[0].ruleIds).toEqual([...run.results[0].ruleIds].sort());
    expect(run.results[0].ruleIds).toEqual(
      expect.arrayContaining([...ESSENTIAL_RULE_IDS])
    );
    expect(run.results[1]).toMatchObject({
      status: "pass",
      score: 100,
      critical: 0,
      warning: 0,
      info: 0,
      findings: 0,
      ruleIds: []
    });
  });
});

function expectFailure(
  results: readonly FixtureValidationResult[],
  expectedError: string
): void {
  const evaluation = evaluateBeforeAfterDemo(results);

  expect(evaluation.passed).toBe(false);
  expect(evaluation.errors.join("\n")).toContain(expectedError);
}

function expectMalformedResult(
  results: readonly unknown[],
  malformedField: string
): void {
  const original = structuredClone(results);
  const evaluation = evaluateBeforeAfterDemo(results);

  expect(evaluation.passed).toBe(false);
  expect(evaluation.errors.join("\n")).toContain(malformedField);
  expect(results).toEqual(original);
}

function replaceResultField(
  resultIndex: number,
  field: string,
  value: unknown
): unknown[] {
  return createPassingPair().map((result, index) =>
    index === resultIndex ? { ...result, [field]: value } : result
  );
}

function createPassingPair(): FixtureValidationResult[] {
  return [createBrokenResult(), createFixedResult()];
}

function createBrokenResult(
  overrides: Partial<FixtureValidationResult> = {}
): FixtureValidationResult {
  return createResult({
    fixture: "broken-arc-integration",
    status: "fail",
    score: 0,
    critical: 4,
    findings: 4,
    ruleIds: [...ESSENTIAL_RULE_IDS],
    expected: "findings",
    matched: true,
    ...overrides
  });
}

function createFixedResult(
  overrides: Partial<FixtureValidationResult> = {}
): FixtureValidationResult {
  return createResult({
    fixture: "fixed-arc-integration",
    status: "pass",
    score: 100,
    expected: "pass",
    matched: true,
    ...overrides
  });
}

function createResult(
  overrides: Partial<FixtureValidationResult> & {
    fixture: string;
    status: FixtureValidationResult["status"];
    score: number;
  }
): FixtureValidationResult {
  return {
    fixture: overrides.fixture,
    status: overrides.status,
    score: overrides.score,
    critical: 0,
    warning: 0,
    info: 0,
    findings: 0,
    ruleIds: [],
    expected: "pass",
    matched: false,
    ...overrides
  };
}
