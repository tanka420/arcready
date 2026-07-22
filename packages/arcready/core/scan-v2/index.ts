import { isDeepStrictEqual } from "node:util";
import { resolve } from "node:path";
import type { ArcReadyConfig } from "../config/index.js";
import type {
  FindingV2,
  ScanDiagnosticV2,
  ScanResultV2
} from "../contracts/v2/model.js";
import {
  validateFindingV2,
  validateScanDiagnosticV2
} from "../contracts/v2/validate.js";
import { deriveCoverageV2 } from "../coverage-v2/index.js";
import {
  adaptDetectorOccurrenceV2,
  type AdaptableCompletedRuleOccurrenceV2
} from "../findings-v2/adapter.js";
import {
  createRepositoryLocationResolver,
  type SourceLocationResolutionV2
} from "../findings-v2/location.js";
import {
  getFindingV2AdapterSpecification,
  type PatternFindingV2AdapterSpecification,
  type SupportedFindingV2AdapterRuleId
} from "../findings-v2/specifications.js";
import { discoverFilesInstrumented } from "../fs/index.js";
import { detectProject } from "../project/index.js";
import { createRuleContext } from "../rules/index.js";
import {
  runRulesStructuredInstrumented,
  type StructuredInstrumentedRuleRunResult
} from "../rules/instrumentation.js";
import { buildScanResultV2 } from "../scan-result-v2/index.js";

const CANONICAL_RULE_IDS = [
  "bridge/CCTP_DOMAIN_26",
  "bridge/NO_WRAPPED_USDC_ON_ARC",
  "bridge/RELAYER_USES_USDC_FOR_GAS"
] as const;

export interface RunInternalScanV2Options {
  readonly projectRoot: string;
  readonly config: ArcReadyConfig;
}

export interface InternalCanonicalFindingCandidateV2 {
  readonly finding: FindingV2;
  readonly selectionIndex: number;
  readonly adapterFindingIndex: number;
  readonly globalOrder: number;
}

export interface CrossOccurrenceCollisionResultV2 {
  readonly findings: readonly FindingV2[];
  readonly diagnostics: readonly ScanDiagnosticV2[];
}

export interface InternalScanV2DiagnosticBuckets {
  readonly discovery: readonly ScanDiagnosticV2[];
  readonly ruleExecution: readonly ScanDiagnosticV2[];
  readonly adaptation: readonly ScanDiagnosticV2[];
  readonly collisions: readonly ScanDiagnosticV2[];
}

export async function runInternalScanV2(
  options: RunInternalScanV2Options
): Promise<ScanResultV2> {
  validateInternalOptions(options);
  const projectRoot = resolve(options.projectRoot);
  const config = snapshotNormalizedConfig(options.config);
  const resolveLocation = createRepositoryLocationResolver(projectRoot);
  const specifications = buildCanonicalSpecifications();

  const discovery = discoverFilesInstrumented({
    projectRoot,
    paths: config.paths,
    exclude: config.exclude
  });
  const files = orderOperationalFiles(discovery.files, resolveLocation);
  const detectedPresets = detectProject({ projectRoot, files });
  const context = createRuleContext({
    projectRoot,
    config,
    files,
    detectedPresets
  });
  const structuredRun = await runRulesStructuredInstrumented(
    specifications.map(({ definition }) => definition.rule),
    context
  );

  validateStructuredRunAlignment(structuredRun, specifications);

  const candidates: InternalCanonicalFindingCandidateV2[] = [];
  const adapterDiagnostics: ScanDiagnosticV2[] = [];
  let globalOrder = 0;

  for (const [selectionIndex, occurrence] of structuredRun.execution.occurrences.entries()) {
    if (occurrence.scheduling === "disabled") {
      continue;
    }
    if (occurrence.execution === "failed") {
      continue;
    }

    const specification = specifications[selectionIndex];
    if (specification === undefined) {
      throw new TypeError("Canonical rule specification alignment failed");
    }
    const adaptableOccurrence: AdaptableCompletedRuleOccurrenceV2 = {
      selectionIndex: occurrence.selectionIndex,
      rule: { kind: "rule-id", id: specification.ruleId },
      scheduling: "scheduled",
      execution: "completed",
      detectorFindings: occurrence.detectorFindings
    };
    const adapted = adaptDetectorOccurrenceV2({
      occurrence: adaptableOccurrence,
      specification,
      resolveLocation
    });

    for (const [adapterFindingIndex, finding] of adapted.findings.entries()) {
      candidates.push({
        finding,
        selectionIndex,
        adapterFindingIndex,
        globalOrder
      });
      globalOrder += 1;
    }
    adapterDiagnostics.push(...adapted.diagnostics);
  }

  const collisionResult = resolveCrossOccurrenceFindingCollisions(candidates);
  const coverage = deriveCoverageV2({
    discovery: discovery.instrumentation,
    ruleExecution: structuredRun.instrumentation
  });
  const diagnostics = assembleInternalScanV2Diagnostics({
    discovery: discovery.instrumentation.diagnostics,
    ruleExecution: structuredRun.instrumentation.diagnostics,
    adaptation: adapterDiagnostics,
    collisions: collisionResult.diagnostics
  });

  return buildScanResultV2({
    coverage,
    findings: collisionResult.findings,
    diagnostics
  });
}

export function assembleInternalScanV2Diagnostics(
  buckets: InternalScanV2DiagnosticBuckets
): readonly ScanDiagnosticV2[] {
  assertPlainRecord(buckets, "Internal ScanResultV2 diagnostic buckets");
  assertOnlyKeys(
    buckets,
    ["discovery", "ruleExecution", "adaptation", "collisions"],
    "Internal ScanResultV2 diagnostic buckets"
  );
  if (
    !Array.isArray(buckets.discovery) ||
    !Array.isArray(buckets.ruleExecution) ||
    !Array.isArray(buckets.adaptation) ||
    !Array.isArray(buckets.collisions)
  ) {
    throw new TypeError("Internal ScanResultV2 diagnostic buckets must be arrays");
  }

  return [
    ...buckets.discovery,
    ...buckets.ruleExecution,
    ...buckets.adaptation,
    ...buckets.collisions
  ];
}

export function resolveCrossOccurrenceFindingCollisions(
  candidates: readonly InternalCanonicalFindingCandidateV2[]
): CrossOccurrenceCollisionResultV2 {
  if (!Array.isArray(candidates)) {
    throw new TypeError("Canonical finding candidates must be an array");
  }

  const ordered = candidates.map((candidate) => {
    validateCandidate(candidate);
    return candidate;
  });
  ordered.sort((left, right) => left.globalOrder - right.globalOrder);

  for (let index = 1; index < ordered.length; index += 1) {
    if (ordered[index - 1]?.globalOrder === ordered[index]?.globalOrder) {
      throw new TypeError("Canonical finding candidate order must be unique");
    }
  }

  const groups = new Map<string, InternalCanonicalFindingCandidateV2[]>();
  for (const candidate of ordered) {
    const fingerprint = candidate.finding.fingerprints.exact.value;
    const group = groups.get(fingerprint);
    if (group === undefined) {
      groups.set(fingerprint, [candidate]);
    } else {
      group.push(candidate);
    }
  }

  const collidingFingerprints = new Set<string>();
  const diagnostics: ScanDiagnosticV2[] = [];
  for (const [fingerprint, group] of groups) {
    if (group.length < 2) {
      continue;
    }
    collidingFingerprints.add(fingerprint);
    diagnostics.push(createCollisionDiagnostic(group));
  }

  return {
    findings: ordered
      .filter(
        ({ finding }) =>
          !collidingFingerprints.has(finding.fingerprints.exact.value)
      )
      .map(({ finding }) => finding),
    diagnostics
  };
}

function buildCanonicalSpecifications(): readonly PatternFindingV2AdapterSpecification[] {
  const seen = new Set<SupportedFindingV2AdapterRuleId>();
  return CANONICAL_RULE_IDS.map((ruleId) => {
    if (seen.has(ruleId)) {
      throw new TypeError("Canonical rule IDs must be unique");
    }
    seen.add(ruleId);

    const specification = getFindingV2AdapterSpecification(ruleId);
    if (
      specification.ruleId !== ruleId ||
      specification.definition.rule.id !== ruleId
    ) {
      throw new TypeError("Canonical rule specification alignment failed");
    }
    return specification;
  });
}

function orderOperationalFiles(
  files: readonly string[],
  resolveLocation: (legacyPath: string) => SourceLocationResolutionV2
): string[] {
  const ordered = files.map((file) => {
    const resolution = resolveLocation(file);
    if (resolution.status === "rejected") {
      throw new TypeError(
        "Discovered file path must be safely representable relative to the project root"
      );
    }
    return { file, canonicalPath: resolution.location.path };
  });

  ordered.sort(
    (left, right) =>
      compareCodeUnits(left.canonicalPath, right.canonicalPath) ||
      compareCodeUnits(left.file, right.file)
  );
  return ordered.map(({ file }) => file);
}

function validateStructuredRunAlignment(
  structuredRun: StructuredInstrumentedRuleRunResult,
  specifications: readonly PatternFindingV2AdapterSpecification[]
): void {
  if (
    structuredRun.execution.occurrences.length !== CANONICAL_RULE_IDS.length ||
    structuredRun.instrumentation.rules.length !== CANONICAL_RULE_IDS.length
  ) {
    throw new TypeError("Canonical rule occurrence count is invalid");
  }

  for (const [selectionIndex, expectedRuleId] of CANONICAL_RULE_IDS.entries()) {
    const specification = specifications[selectionIndex];
    const occurrence = structuredRun.execution.occurrences[selectionIndex];
    const outcome = structuredRun.instrumentation.rules[selectionIndex];
    if (
      specification === undefined ||
      occurrence === undefined ||
      outcome === undefined ||
      specification.ruleId !== expectedRuleId ||
      occurrence.selectionIndex !== selectionIndex ||
      outcome.selectionIndex !== selectionIndex ||
      occurrence.rule.kind !== "rule-id" ||
      occurrence.rule.id !== expectedRuleId ||
      outcome.rule.kind !== "rule-id" ||
      outcome.rule.id !== expectedRuleId
    ) {
      throw new TypeError("Canonical rule occurrence alignment failed");
    }

    if (occurrence.scheduling === "disabled") {
      if (outcome.scheduling !== "disabled" || outcome.execution !== "not-run") {
        throw new TypeError("Canonical disabled rule lifecycle alignment failed");
      }
      continue;
    }

    if (
      outcome.scheduling !== "scheduled" ||
      outcome.execution !== occurrence.execution ||
      (occurrence.execution === "completed" &&
        outcome.normalizedFindingCount !== occurrence.detectorFindings.length) ||
      (occurrence.execution === "failed" && outcome.normalizedFindingCount !== 0)
    ) {
      throw new TypeError("Canonical scheduled rule lifecycle alignment failed");
    }
  }
}

function createCollisionDiagnostic(
  group: readonly InternalCanonicalFindingCandidateV2[]
): ScanDiagnosticV2 {
  const first = group[0];
  if (first === undefined) {
    throw new TypeError("Canonical collision group must not be empty");
  }

  const sharedRuleId = group.every(
    ({ finding }) => finding.ruleId === first.finding.ruleId
  )
    ? first.finding.ruleId
    : undefined;
  const sharedLocation = group.every(({ finding }) =>
    isDeepStrictEqual(finding.primaryLocation, first.finding.primaryLocation)
  )
    ? first.finding.primaryLocation
    : undefined;
  const diagnostic: ScanDiagnosticV2 = {
    code: "FINDING_V2_CROSS_OCCURRENCE_DUPLICATE_FINGERPRINT",
    category: "internal-error",
    level: "error",
    phase: "analysis",
    origin: "tool",
    message:
      "Canonical findings were rejected because multiple rule occurrences produced the same exact fingerprint.",
    recoverable: true,
    ...(sharedRuleId === undefined ? {} : { ruleId: sharedRuleId }),
    ...(sharedLocation === undefined ? {} : { location: sharedLocation })
  };

  validateScanDiagnosticV2(diagnostic);
  return diagnostic;
}

function validateCandidate(value: unknown): asserts value is InternalCanonicalFindingCandidateV2 {
  assertPlainRecord(value, "Canonical finding candidate");
  assertOnlyKeys(
    value,
    ["finding", "selectionIndex", "adapterFindingIndex", "globalOrder"],
    "Canonical finding candidate"
  );
  validateFindingV2(value.finding);
  assertNonNegativeSafeInteger(value.selectionIndex, "Canonical selection index");
  assertNonNegativeSafeInteger(
    value.adapterFindingIndex,
    "Canonical adapter finding index"
  );
  assertNonNegativeSafeInteger(value.globalOrder, "Canonical global order");
}

function validateInternalOptions(
  value: unknown
): asserts value is RunInternalScanV2Options {
  assertPlainRecord(value, "Internal ScanResultV2 options");
  assertOnlyKeys(
    value,
    ["projectRoot", "config"],
    "Internal ScanResultV2 options"
  );
  if (typeof value.projectRoot !== "string" || value.projectRoot.trim().length === 0) {
    throw new TypeError("Internal ScanResultV2 projectRoot must be a non-empty string");
  }
  if (!("config" in value)) {
    throw new TypeError("Internal ScanResultV2 config is required");
  }
}

function snapshotNormalizedConfig(value: ArcReadyConfig): ArcReadyConfig {
  assertPlainRecord(value, "Internal ScanResultV2 config");
  try {
    return structuredClone(value);
  } catch {
    throw new TypeError(
      "Internal ScanResultV2 config must be structured-cloneable"
    );
  }
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function assertNonNegativeSafeInteger(value: unknown, label: string): void {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new TypeError(`${label} must be a non-negative safe integer`);
  }
}

function assertPlainRecord(
  value: unknown,
  label: string
): asserts value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${label} must be a plain object`);
  }
}

function assertOnlyKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
  label: string
): void {
  const allowed = new Set(keys);
  const actual = Object.keys(value);
  if (
    actual.some((key) => !allowed.has(key)) ||
    keys.some((key) => !(key in value))
  ) {
    throw new TypeError(`${label} has an invalid shape`);
  }
}
