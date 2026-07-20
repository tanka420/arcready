import { posix, sep, win32 } from "node:path";
import type { ArcReadyConfig } from "../config/index.js";
import type { ScanDiagnosticV2 } from "../contracts/v2/model.js";
import { validateScanDiagnosticV2 } from "../contracts/v2/validate.js";
import type { DiscoveryPathV1 } from "../fs/instrumentation.js";
import { representNativeDiscoveryPath } from "../fs/instrumentation.js";
import type { Finding, Severity } from "../findings/index.js";
import type { Rule, RuleContext } from "./index.js";
import {
  projectLegacyFindings,
  representRuleIdentity,
  validateRuleExecutionResult,
  type CompletedRuleOccurrenceExecutionResult,
  type DisabledRuleOccurrenceExecutionResult,
  type FailedRuleOccurrenceExecutionResult,
  type InstrumentedRuleIdentityV1,
  type RuleExecutionResult
} from "./execution-result.js";

export { representRuleIdentity } from "./execution-result.js";
export type { InstrumentedRuleIdentityV1 } from "./execution-result.js";

export type RuleSchedulingStateV1 = "disabled" | "scheduled";

export type RuleExecutionStateV1 = "not-run" | "completed" | "failed";

export type RuleFindingEmissionV1 =
  | "not-evaluated"
  | "emitted-findings"
  | "emitted-no-findings";

export type RuleReadAttemptOutcomeV1 = "succeeded" | "failed" | "unsettled";

export interface RuleReadAttemptV1 {
  attemptIndex: number;
  path: DiscoveryPathV1;
  outcome: RuleReadAttemptOutcomeV1;
}

export interface RuleExecutionOutcomeV1 {
  selectionIndex: number;
  rule: InstrumentedRuleIdentityV1;
  scheduling: RuleSchedulingStateV1;
  execution: RuleExecutionStateV1;
  findingEmission: RuleFindingEmissionV1;
  normalizedFindingCount: number;
  applicability: "unknown";
  readAttempts: readonly RuleReadAttemptV1[];
}

export interface RuleExecutionInstrumentationV1 {
  rules: readonly RuleExecutionOutcomeV1[];
  diagnostics: readonly ScanDiagnosticV2[];
}

export interface InstrumentedRuleRunResult {
  /**
   * Legacy operational findings. They may include raw fallback exception
   * messages and must not be serialized as canonical v2 diagnostics.
   */
  findings: readonly Finding[];
  /** Canonical sanitized rule-execution and read-attempt facts. */
  instrumentation: RuleExecutionInstrumentationV1;
}

export interface StructuredInstrumentedRuleRunResult {
  readonly execution: RuleExecutionResult;
  readonly instrumentation: RuleExecutionInstrumentationV1;
}

interface MutableReadAttempt {
  attemptIndex: number;
  path: DiscoveryPathV1;
  outcome: RuleReadAttemptOutcomeV1;
}

class ScheduledRuleRecorder {
  private readonly attempts: MutableReadAttempt[] = [];

  constructor(
    private readonly projectRoot: string,
    private readonly nativeSeparator: "/" | "\\" = sep === "\\" ? "\\" : "/"
  ) {}

  createContext(context: RuleContext): RuleContext {
    return {
      ...context,
      readFile: (filePath) => this.readFile(context, filePath)
    };
  }

  snapshot(): readonly RuleReadAttemptV1[] {
    return this.attempts.map((attempt) => ({ ...attempt }));
  }

  private readFile(context: RuleContext, filePath: string): Promise<string> {
    const attempt: MutableReadAttempt = {
      attemptIndex: this.attempts.length,
      path: representReadAttemptPath(
        this.projectRoot,
        filePath,
        this.nativeSeparator
      ),
      outcome: "unsettled"
    };
    this.attempts.push(attempt);

    try {
      return context.readFile(filePath).then(
        (content) => {
          attempt.outcome = "succeeded";
          return content;
        },
        (error: unknown) => {
          attempt.outcome = "failed";
          throw error;
        }
      );
    } catch (error) {
      attempt.outcome = "failed";
      throw error;
    }
  }
}

class RuleExecutionInstrumentationRecorder {
  private readonly outcomes: RuleExecutionOutcomeV1[] = [];
  private readonly diagnostics: ScanDiagnosticV2[] = [];

  recordDisabled(
    occurrence: DisabledRuleOccurrenceExecutionResult
  ): void {
    this.outcomes.push({
      selectionIndex: occurrence.selectionIndex,
      rule: occurrence.rule,
      scheduling: "disabled",
      execution: "not-run",
      findingEmission: "not-evaluated",
      normalizedFindingCount: 0,
      applicability: "unknown",
      readAttempts: []
    });
  }

  startScheduled(
    context: RuleContext
  ): ScheduledRuleExecution {
    return {
      reads: new ScheduledRuleRecorder(context.projectRoot)
    };
  }

  recordCompleted(
    execution: ScheduledRuleExecution,
    occurrence: CompletedRuleOccurrenceExecutionResult
  ): void {
    const normalizedFindingCount = occurrence.detectorFindings.length;
    this.outcomes.push({
      selectionIndex: occurrence.selectionIndex,
      rule: occurrence.rule,
      scheduling: "scheduled",
      execution: "completed",
      findingEmission:
        normalizedFindingCount > 0 ? "emitted-findings" : "emitted-no-findings",
      normalizedFindingCount,
      applicability: "unknown",
      readAttempts: execution.reads.snapshot()
    });
  }

  recordFailed(
    execution: ScheduledRuleExecution,
    occurrence: FailedRuleOccurrenceExecutionResult
  ): void {
    this.outcomes.push({
      selectionIndex: occurrence.selectionIndex,
      rule: occurrence.rule,
      scheduling: "scheduled",
      execution: "failed",
      findingEmission: "not-evaluated",
      normalizedFindingCount: 0,
      applicability: "unknown",
      readAttempts: execution.reads.snapshot()
    });

    const diagnostic: ScanDiagnosticV2 = {
      code: "RULE_EXECUTION_FAILED",
      category: "rule-execution-error",
      level: "error",
      phase: "analysis",
      origin: "tool",
      message: "Rule execution failed.",
      recoverable: true,
      ...(occurrence.rule.kind === "rule-id"
        ? { ruleId: occurrence.rule.id }
        : {})
    };
    validateScanDiagnosticV2(diagnostic);
    this.diagnostics.push(diagnostic);
  }

  build(): RuleExecutionInstrumentationV1 {
    return {
      rules: [...this.outcomes].sort(
        (left, right) => left.selectionIndex - right.selectionIndex
      ),
      diagnostics: [...this.diagnostics]
    };
  }
}

interface ScheduledRuleExecution {
  reads: ScheduledRuleRecorder;
}

export async function runRulesInstrumented(
  rules: Rule[],
  context: RuleContext
): Promise<InstrumentedRuleRunResult> {
  const { execution, instrumentation } =
    await runRulesStructuredInstrumented(rules, context);

  return {
    findings: projectLegacyFindings(execution),
    instrumentation
  };
}

export async function runRulesStructuredInstrumented(
  rules: Rule[],
  context: RuleContext
): Promise<StructuredInstrumentedRuleRunResult> {
  const recorder = new RuleExecutionInstrumentationRecorder();
  const execution = await executeRulesStructured(rules, context, recorder);

  return {
    execution,
    instrumentation: recorder.build()
  };
}

export async function executeRules(
  rules: Rule[],
  context: RuleContext,
  recorder?: RuleExecutionInstrumentationRecorder
): Promise<Finding[]> {
  return projectLegacyFindings(
    await executeRulesStructured(rules, context, recorder)
  );
}

export async function executeRulesStructured(
  rules: Rule[],
  context: RuleContext,
  recorder?: RuleExecutionInstrumentationRecorder
): Promise<RuleExecutionResult> {
  const occurrences: RuleExecutionResult["occurrences"][number][] = [];

  for (const [selectionIndex, rule] of rules.entries()) {
    const ruleId = rule.id;
    const identity = representRuleIdentity(ruleId);
    const severityOverride = context.config.rules[ruleId];

    if (severityOverride === "off") {
      const occurrence: DisabledRuleOccurrenceExecutionResult = {
        selectionIndex,
        rule: identity,
        scheduling: "disabled",
        execution: "not-run",
        detectorFindings: []
      };
      occurrences.push(occurrence);
      recorder?.recordDisabled(occurrence);
      continue;
    }

    const execution = recorder?.startScheduled(context);
    const ruleContext = execution
      ? execution.reads.createContext(context)
      : context;

    let completedOccurrence: CompletedRuleOccurrenceExecutionResult;
    try {
      const ruleFindings = await rule.run(ruleContext);
      const normalizedFindings = normalizeFindings(
        rule,
        ruleFindings,
        severityOverride
      );
      completedOccurrence = {
        selectionIndex,
        rule: identity,
        scheduling: "scheduled",
        execution: "completed",
        detectorFindings: normalizedFindings
      };
    } catch (error) {
      const occurrence: FailedRuleOccurrenceExecutionResult = {
        selectionIndex,
        rule: identity,
        scheduling: "scheduled",
        execution: "failed",
        detectorFindings: [],
        fallbackFinding: createRuleErrorFinding(rule, error, severityOverride)
      };
      occurrences.push(occurrence);
      if (execution) {
        recorder?.recordFailed(execution, occurrence);
      }
      continue;
    }

    occurrences.push(completedOccurrence);
    if (execution) {
      recorder?.recordCompleted(execution, completedOccurrence);
    }
  }

  const result: RuleExecutionResult = { occurrences };
  validateRuleExecutionResult(result);
  return result;
}

export function representReadAttemptPath(
  projectRoot: string,
  readPath: unknown,
  nativeSeparator: "/" | "\\" = sep === "\\" ? "\\" : "/"
): DiscoveryPathV1 {
  if (typeof readPath !== "string") {
    return { kind: "unrepresentable" };
  }

  const pathApi = nativeSeparator === "\\" ? win32 : posix;
  if (!pathApi.isAbsolute(readPath)) {
    return { kind: "unrepresentable" };
  }

  const resolvedRoot = pathApi.resolve(projectRoot);
  const nativeRelativePath = pathApi.relative(resolvedRoot, readPath);
  if (
    nativeRelativePath === ".." ||
    nativeRelativePath.startsWith(`..${nativeSeparator}`) ||
    pathApi.isAbsolute(nativeRelativePath)
  ) {
    return { kind: "unrepresentable" };
  }

  return representNativeDiscoveryPath(nativeRelativePath, nativeSeparator);
}

function normalizeFindings(
  rule: Rule,
  findings: Finding[],
  severityOverride: ArcReadyConfig["rules"][string] | undefined
): Finding[] {
  return findings.map((finding) => ({
    ...finding,
    ruleId: finding.ruleId || rule.id,
    severity: resolveFindingSeverity(
      severityOverride,
      finding.severity ?? rule.defaultSeverity
    ),
    files: finding.files ?? [],
    docs: finding.docs ?? rule.docs[0],
    preset: finding.preset ?? rule.preset
  }));
}

function createRuleErrorFinding(
  rule: Rule,
  error: unknown,
  severityOverride: ArcReadyConfig["rules"][string] | undefined
): Finding {
  const message = error instanceof Error ? error.message : String(error);
  const severity = severityOverride === "critical" ? "critical" : "warning";

  return {
    ruleId: rule.id,
    severity,
    message: `Rule "${rule.id}" failed: ${message}`,
    files: [],
    suggestedFix:
      "Check the rule implementation or disable this rule temporarily.",
    docs: rule.docs[0],
    preset: rule.preset
  };
}

function resolveFindingSeverity(
  severityOverride: ArcReadyConfig["rules"][string] | undefined,
  defaultSeverity: Severity
): Severity {
  if (
    severityOverride === "info" ||
    severityOverride === "warning" ||
    severityOverride === "critical"
  ) {
    return severityOverride;
  }

  return defaultSeverity;
}
