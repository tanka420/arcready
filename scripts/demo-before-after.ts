import { pathToFileURL } from "node:url";
import { DEMO_FIXTURES, runFixtureDemo } from "./demo-fixtures.js";
import type { FixtureValidationResult } from "./demo-fixtures.js";

const BROKEN_PROJECT = "broken-arc-integration";
const FIXED_PROJECT = "fixed-arc-integration";

export const ESSENTIAL_RULE_IDS = [
  "app-kit/APPKIT_CHAIN_IDENTIFIER_VALID",
  "bridge/CCTP_DOMAIN_26",
  "bridge/NO_PREVRANDAO_RELAY_SELECTION",
  "wallet/ARC_CHAIN_METADATA",
  "wallet/NO_BLOB_TX_ON_ARC",
  "wallet/PREVRANDAO_NOT_SUPPORTED"
] as const;

export interface BeforeAfterDemoEvaluation {
  passed: boolean;
  errors: string[];
}

export interface BeforeAfterDemoRun {
  results: FixtureValidationResult[];
  evaluation: BeforeAfterDemoEvaluation;
  output: string;
  exitCode: 0 | 1;
}

export function evaluateBeforeAfterDemo(
  results: readonly unknown[]
): BeforeAfterDemoEvaluation {
  const errors: string[] = [];
  const validatedResults: FixtureValidationResult[] = [];

  for (const [index, value] of results.entries()) {
    const validation = validateFixtureResult(value, index);
    if (validation.error !== undefined) {
      errors.push(validation.error);
    } else {
      validatedResults.push(validation.result);
    }
  }

  if (errors.length > 0) {
    return { passed: false, errors };
  }

  const fixtureNames = validatedResults.map(({ fixture }) => fixture);
  const expectedNames = DEMO_FIXTURES.map(({ name }) => name);

  if (validatedResults.length !== DEMO_FIXTURES.length) {
    errors.push(
      `Expected exactly ${DEMO_FIXTURES.length} demo results, received ${validatedResults.length}.`
    );
  }

  const duplicateNames = Array.from(
    new Set(
      fixtureNames.filter(
        (fixture, index) => fixtureNames.indexOf(fixture) !== index
      )
    )
  ).sort();
  if (duplicateNames.length > 0) {
    errors.push(`Duplicate demo project: ${duplicateNames.join(", ")}.`);
  }

  const missingNames = expectedNames.filter(
    (expectedName) => !fixtureNames.includes(expectedName)
  );
  if (missingNames.length > 0) {
    errors.push(`Missing demo project: ${missingNames.join(", ")}.`);
  }

  const unexpectedNames = fixtureNames.filter(
    (fixtureName) => !expectedNames.includes(fixtureName)
  );
  if (unexpectedNames.length > 0) {
    errors.push(
      `Unexpected demo project: ${Array.from(new Set(unexpectedNames))
        .sort()
        .join(", ")}.`
    );
  }

  if (
    fixtureNames.length !== expectedNames.length ||
    fixtureNames.some(
      (fixtureName, index) => fixtureName !== expectedNames[index]
    )
  ) {
    errors.push(`Demo result order must be: ${expectedNames.join(", ")}.`);
  }

  const broken = validatedResults.find(
    ({ fixture }) => fixture === BROKEN_PROJECT
  );
  const fixed = validatedResults.find(
    ({ fixture }) => fixture === FIXED_PROJECT
  );

  if (broken) {
    if (broken.status === "error") {
      errors.push(`${BROKEN_PROJECT} scan errored.`);
    } else {
      if (broken.status !== "fail") {
        errors.push(`${BROKEN_PROJECT} must have status fail.`);
      }
      if (broken.critical < 1) {
        errors.push(`${BROKEN_PROJECT} must have a critical finding.`);
      }

      const missingRuleIds = ESSENTIAL_RULE_IDS.filter(
        (ruleId) => !broken.ruleIds.includes(ruleId)
      );
      if (missingRuleIds.length > 0) {
        errors.push(
          `${BROKEN_PROJECT} is missing required findings: ${missingRuleIds.join(", ")}.`
        );
      }
    }
  }

  if (fixed) {
    if (fixed.status === "error") {
      errors.push(`${FIXED_PROJECT} scan errored.`);
    } else {
      if (fixed.status !== "pass") {
        errors.push(`${FIXED_PROJECT} must have status pass.`);
      }
      if (fixed.score !== 100) {
        errors.push(`${FIXED_PROJECT} must have score 100.`);
      }
      if (
        fixed.critical !== 0 ||
        fixed.warning !== 0 ||
        fixed.info !== 0 ||
        fixed.findings !== 0
      ) {
        errors.push(`${FIXED_PROJECT} must have zero findings.`);
      }
      if (fixed.ruleIds.length !== 0) {
        errors.push(`${FIXED_PROJECT} must have an empty rule-ID list.`);
      }
    }
  }

  return {
    passed: errors.length === 0,
    errors
  };
}

type FixtureResultValidation =
  | { result: FixtureValidationResult; error?: never }
  | { result?: never; error: string };

function validateFixtureResult(
  value: unknown,
  index: number
): FixtureResultValidation {
  const position = `Demo result ${index + 1}`;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return malformedResult(position, "record", "a non-null, non-array object");
  }

  const fixture = Reflect.get(value, "fixture");
  if (typeof fixture !== "string") {
    return malformedResult(position, "fixture", "a string");
  }
  const label = `${position} (${fixture})`;

  const status = Reflect.get(value, "status");
  if (status !== "pass" && status !== "fail" && status !== "error") {
    return malformedResult(label, "status", "pass, fail, or error");
  }

  const score = Reflect.get(value, "score");
  if (!isFiniteNonNegativeInteger(score)) {
    return malformedResult(label, "score", "a finite non-negative integer");
  }
  const critical = Reflect.get(value, "critical");
  if (!isFiniteNonNegativeInteger(critical)) {
    return malformedResult(label, "critical", "a finite non-negative integer");
  }
  const warning = Reflect.get(value, "warning");
  if (!isFiniteNonNegativeInteger(warning)) {
    return malformedResult(label, "warning", "a finite non-negative integer");
  }
  const info = Reflect.get(value, "info");
  if (!isFiniteNonNegativeInteger(info)) {
    return malformedResult(label, "info", "a finite non-negative integer");
  }
  const findings = Reflect.get(value, "findings");
  if (!isFiniteNonNegativeInteger(findings)) {
    return malformedResult(label, "findings", "a finite non-negative integer");
  }

  const expected = Reflect.get(value, "expected");
  if (expected !== "pass" && expected !== "findings") {
    return malformedResult(label, "expected", "pass or findings");
  }
  const matched = Reflect.get(value, "matched");
  if (typeof matched !== "boolean") {
    return malformedResult(label, "matched", "a boolean");
  }

  const ruleIds = Reflect.get(value, "ruleIds");
  if (!Array.isArray(ruleIds)) {
    return malformedResult(label, "ruleIds", "an array of strings");
  }
  if (
    !ruleIds.every((ruleId): ruleId is string => typeof ruleId === "string")
  ) {
    return malformedResult(
      label,
      "ruleIds",
      "an array containing only strings"
    );
  }
  if (new Set(ruleIds).size !== ruleIds.length) {
    return malformedResult(label, "ruleIds", "a unique array");
  }
  const sortedRuleIds = [...ruleIds].sort();
  if (
    ruleIds.some((ruleId, ruleIndex) => ruleId !== sortedRuleIds[ruleIndex])
  ) {
    return malformedResult(label, "ruleIds", "an ascending sorted array");
  }

  const hasError = Object.prototype.hasOwnProperty.call(value, "error");
  const error = Reflect.get(value, "error");
  if (hasError && typeof error !== "string") {
    return malformedResult(label, "error", "a string when present");
  }

  return {
    result: {
      fixture,
      status,
      score,
      critical,
      warning,
      info,
      findings,
      ruleIds,
      expected,
      matched,
      ...(typeof error === "string" ? { error } : {})
    }
  };
}

function malformedResult(
  label: string,
  field: string,
  expected: string
): FixtureResultValidation {
  return {
    error: `${label} has malformed ${field}; expected ${expected}.`
  };
}

function isFiniteNonNegativeInteger(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    Number.isInteger(value) &&
    value >= 0
  );
}

export function renderBeforeAfterDemo(
  results: readonly FixtureValidationResult[]
): string {
  const evaluation = evaluateBeforeAfterDemo(results);
  const broken = results.find(({ fixture }) => fixture === BROKEN_PROJECT);
  const fixed = results.find(({ fixture }) => fixture === FIXED_PROJECT);
  const requiredRuleIds = ESSENTIAL_RULE_IDS.filter((ruleId) =>
    broken?.ruleIds.includes(ruleId)
  );
  const lines = [
    "ArcReady Before/After Demo",
    "",
    renderProjectLine("BEFORE", BROKEN_PROJECT, broken),
    `  required findings: ${requiredRuleIds.length}/${ESSENTIAL_RULE_IDS.length}`,
    ...requiredRuleIds.map((ruleId) => `  ${ruleId}`),
    renderProjectLine("AFTER", FIXED_PROJECT, fixed),
    "",
    `Result: ${evaluation.passed ? "PASS" : "FAIL"}`
  ];

  if (!evaluation.passed) {
    lines.push(...evaluation.errors.map((error) => `  ${error}`));
  }

  return lines.join("\n");
}

export async function runBeforeAfterDemo(
  repoRoot = process.cwd()
): Promise<BeforeAfterDemoRun> {
  const results = await runFixtureDemo(repoRoot, DEMO_FIXTURES);
  const evaluation = evaluateBeforeAfterDemo(results);

  return {
    results,
    evaluation,
    output: renderBeforeAfterDemo(results),
    exitCode: evaluation.passed ? 0 : 1
  };
}

function renderProjectLine(
  label: "BEFORE" | "AFTER",
  project: string,
  result: FixtureValidationResult | undefined
): string {
  if (!result) {
    return `${label}  ${project}  MISSING`;
  }

  return `${label}  ${project}  ${result.status.toUpperCase()}  ${result.score}  ${result.findings} findings`;
}

async function main(): Promise<number> {
  try {
    const run = await runBeforeAfterDemo();
    console.log(run.output);
    return run.exitCode;
  } catch (error) {
    console.error(
      `ArcReady Before/After Demo setup error: ${error instanceof Error ? error.message : String(error)}`
    );
    return 2;
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main()
    .then((exitCode) => {
      process.exitCode = exitCode;
    })
    .catch((error: unknown) => {
      console.error(
        `ArcReady Before/After Demo setup error: ${error instanceof Error ? error.message : String(error)}`
      );
      process.exitCode = 2;
    });
}
