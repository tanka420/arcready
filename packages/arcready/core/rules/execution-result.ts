import type { Finding } from "../findings/index.js";

export type InstrumentedRuleIdentityV1 =
  | { kind: "rule-id"; id: string }
  | { kind: "unrepresentable" };

export interface DisabledRuleOccurrenceExecutionResult {
  selectionIndex: number;
  rule: InstrumentedRuleIdentityV1;
  scheduling: "disabled";
  execution: "not-run";
  detectorFindings: readonly [];
}

export interface CompletedRuleOccurrenceExecutionResult {
  selectionIndex: number;
  rule: InstrumentedRuleIdentityV1;
  scheduling: "scheduled";
  execution: "completed";
  detectorFindings: readonly Finding[];
}

export interface FailedRuleOccurrenceExecutionResult {
  selectionIndex: number;
  rule: InstrumentedRuleIdentityV1;
  scheduling: "scheduled";
  execution: "failed";
  detectorFindings: readonly [];
  fallbackFinding: Finding;
}

export type RuleOccurrenceExecutionResult =
  | DisabledRuleOccurrenceExecutionResult
  | CompletedRuleOccurrenceExecutionResult
  | FailedRuleOccurrenceExecutionResult;

export interface RuleExecutionResult {
  occurrences: readonly RuleOccurrenceExecutionResult[];
}

export function representRuleIdentity(
  ruleId: unknown
): InstrumentedRuleIdentityV1 {
  if (
    typeof ruleId !== "string" ||
    ruleId.length === 0 ||
    ruleId.length > 256 ||
    ruleId !== ruleId.trim() ||
    containsControlCharacter(ruleId)
  ) {
    return { kind: "unrepresentable" };
  }

  return { kind: "rule-id", id: ruleId };
}

export function validateRuleExecutionResult(
  value: unknown
): asserts value is RuleExecutionResult {
  assertPlainRecord(value, "RuleExecutionResult");
  assertOnlyKeys(value, ["occurrences"], "RuleExecutionResult");
  assertArray(value.occurrences, "RuleExecutionResult occurrences");

  for (const [occurrenceIndex, occurrence] of value.occurrences.entries()) {
    assertPlainRecord(occurrence, "RuleExecutionResult occurrence");
    assertNonNegativeSafeInteger(
      occurrence.selectionIndex,
      "RuleExecutionResult occurrence selectionIndex"
    );
    if (occurrence.selectionIndex !== occurrenceIndex) {
      fail(
        "RuleExecutionResult occurrence selectionIndex must match its array position"
      );
    }
    validateRuleIdentity(occurrence.rule);
    assertArray(
      occurrence.detectorFindings,
      "RuleExecutionResult occurrence detectorFindings"
    );
    for (const finding of occurrence.detectorFindings) {
      assertPlainRecord(
        finding,
        "RuleExecutionResult occurrence detector finding"
      );
    }

    if (occurrence.scheduling === "disabled") {
      assertOnlyKeys(
        occurrence,
        [
          "selectionIndex",
          "rule",
          "scheduling",
          "execution",
          "detectorFindings"
        ],
        "disabled RuleExecutionResult occurrence"
      );
      if (occurrence.execution !== "not-run") {
        fail("disabled RuleExecutionResult occurrence must be not-run");
      }
      if (occurrence.detectorFindings.length !== 0) {
        fail("disabled RuleExecutionResult occurrence cannot have findings");
      }
      continue;
    }

    if (occurrence.scheduling !== "scheduled") {
      fail("RuleExecutionResult occurrence scheduling is unsupported");
    }
    if (occurrence.execution === "completed") {
      assertOnlyKeys(
        occurrence,
        [
          "selectionIndex",
          "rule",
          "scheduling",
          "execution",
          "detectorFindings"
        ],
        "completed RuleExecutionResult occurrence"
      );
      continue;
    }
    if (occurrence.execution === "failed") {
      assertOnlyKeys(
        occurrence,
        [
          "selectionIndex",
          "rule",
          "scheduling",
          "execution",
          "detectorFindings",
          "fallbackFinding"
        ],
        "failed RuleExecutionResult occurrence"
      );
      if (occurrence.detectorFindings.length !== 0) {
        fail("failed RuleExecutionResult occurrence cannot have detector findings");
      }
      assertPlainRecord(
        occurrence.fallbackFinding,
        "failed RuleExecutionResult occurrence fallbackFinding"
      );
      continue;
    }
    fail("scheduled RuleExecutionResult occurrence execution is unsupported");
  }
}

export function projectLegacyFindings(result: RuleExecutionResult): Finding[] {
  const findings: Finding[] = [];
  for (const occurrence of result.occurrences) {
    if (occurrence.execution === "completed") {
      findings.push(...occurrence.detectorFindings);
    } else if (occurrence.execution === "failed") {
      findings.push(occurrence.fallbackFinding);
    }
  }
  return findings;
}

function validateRuleIdentity(value: unknown): void {
  assertPlainRecord(value, "RuleExecutionResult occurrence rule");
  if (value.kind === "rule-id") {
    assertOnlyKeys(
      value,
      ["kind", "id"],
      "RuleExecutionResult occurrence rule"
    );
    if (
      typeof value.id !== "string" ||
      !sameRuleIdentity(value, representRuleIdentity(value.id))
    ) {
      fail("RuleExecutionResult occurrence rule ID is unsafe");
    }
    return;
  }
  if (value.kind === "unrepresentable") {
    assertOnlyKeys(value, ["kind"], "RuleExecutionResult occurrence rule");
    return;
  }
  fail("RuleExecutionResult occurrence rule identity is unsupported");
}

function sameRuleIdentity(
  left: Record<string, unknown>,
  right: InstrumentedRuleIdentityV1
): boolean {
  return right.kind === "rule-id" && left.id === right.id;
}

function containsControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit <= 31 || codeUnit === 127) {
      return true;
    }
  }
  return false;
}

function assertPlainRecord(
  value: unknown,
  label: string
): asserts value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail(`${label} must be an object`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    fail(`${label} must be a plain object`);
  }
}

function assertArray(
  value: unknown,
  label: string
): asserts value is unknown[] {
  if (!Array.isArray(value)) {
    fail(`${label} must be an array`);
  }
}

function assertNonNegativeSafeInteger(value: unknown, label: string): void {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0
  ) {
    fail(`${label} must be a non-negative safe integer`);
  }
}

function assertOnlyKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  label: string
): void {
  const unknownKey = Object.keys(value).find((key) => !allowed.includes(key));
  if (unknownKey !== undefined) {
    fail(`${label} contains unsupported field "${unknownKey}"`);
  }
}

function fail(message: string): never {
  throw new TypeError(message);
}
