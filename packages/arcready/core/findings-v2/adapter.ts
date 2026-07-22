import type { Finding } from "../findings/index.js";
import type { CompletedRuleOccurrenceExecutionResult } from "../rules/execution-result.js";
import {
  createExactFindingFingerprint,
  type FindingClassificationV2,
  type FindingV2,
  type ScanDiagnosticV2,
  type SourceLocationV2
} from "../contracts/v2/index.js";
import {
  validateFindingV2,
  validateScanDiagnosticV2
} from "../contracts/v2/validate.js";
import { validateSourceLocationV2 } from "../contracts/v2/source-location.js";
import type {
  SourceLocationResolutionRejectionReasonV2,
  SourceLocationResolutionV2
} from "./location.js";
import {
  validatePatternFindingV2AdapterSpecification,
  type PatternFindingV2AdapterSpecification,
  type SupportedFindingV2AdapterRuleId
} from "./specifications.js";

export type AdaptableCompletedRuleOccurrenceV2 = Omit<
  CompletedRuleOccurrenceExecutionResult,
  "rule"
> & {
  readonly rule: {
    readonly kind: "rule-id";
    readonly id: SupportedFindingV2AdapterRuleId;
  };
};

export interface AdaptDetectorOccurrenceV2Input {
  readonly occurrence: AdaptableCompletedRuleOccurrenceV2;
  readonly specification: PatternFindingV2AdapterSpecification;
  readonly resolveLocation: (
    legacyPath: string
  ) => SourceLocationResolutionV2;
}

export interface AdaptDetectorOccurrenceV2Result {
  readonly findings: readonly FindingV2[];
  readonly diagnostics: readonly ScanDiagnosticV2[];
}

type AdaptationDiagnosticCode =
  | "FINDING_V2_LOCATION_MISSING"
  | "FINDING_V2_LOCATION_AMBIGUOUS"
  | "FINDING_V2_LOCATION_UNREPRESENTABLE"
  | "FINDING_V2_DUPLICATE_FINGERPRINT";

interface AdaptedCandidate {
  readonly detectorIndex: number;
  readonly finding: FindingV2;
}

interface OrderedDiagnostic {
  readonly detectorIndex: number;
  readonly diagnostic: ScanDiagnosticV2;
}

const REJECTION_REASONS: readonly SourceLocationResolutionRejectionReasonV2[] = [
  "empty",
  "outside-project-root",
  "parent-traversal",
  "drive-mismatch",
  "url-like",
  "control-character",
  "unrepresentable"
];

export function adaptDetectorOccurrenceV2(
  input: AdaptDetectorOccurrenceV2Input
): AdaptDetectorOccurrenceV2Result {
  validateInput(input);

  const { occurrence, specification } = input;
  const candidates: AdaptedCandidate[] = [];
  const orderedDiagnostics: OrderedDiagnostic[] = [];

  for (const [detectorIndex, legacyFinding] of occurrence.detectorFindings.entries()) {
    validateLegacyFindingIdentity(legacyFinding, specification.ruleId);

    if (!Array.isArray(legacyFinding.files)) {
      throw new TypeError("Detector finding files must be an array");
    }
    if (legacyFinding.files.length === 0) {
      orderedDiagnostics.push({
        detectorIndex,
        diagnostic: createDiagnostic(
          "FINDING_V2_LOCATION_MISSING",
          specification.ruleId
        )
      });
      continue;
    }
    if (legacyFinding.files.length > 1) {
      orderedDiagnostics.push({
        detectorIndex,
        diagnostic: createDiagnostic(
          "FINDING_V2_LOCATION_AMBIGUOUS",
          specification.ruleId
        )
      });
      continue;
    }

    const legacyPath = legacyFinding.files[0];
    if (typeof legacyPath !== "string") {
      orderedDiagnostics.push({
        detectorIndex,
        diagnostic: createDiagnostic(
          "FINDING_V2_LOCATION_UNREPRESENTABLE",
          specification.ruleId
        )
      });
      continue;
    }
    const resolution = input.resolveLocation(legacyPath);
    validateResolution(resolution);
    if (resolution.status === "rejected") {
      orderedDiagnostics.push({
        detectorIndex,
        diagnostic: createDiagnostic(
          "FINDING_V2_LOCATION_UNREPRESENTABLE",
          specification.ruleId
        )
      });
      continue;
    }

    candidates.push({
      detectorIndex,
      finding: createFindingV2(legacyFinding, resolution.location, specification)
    });
  }

  const duplicateValues = new Set<string>();
  const candidatesByFingerprint = new Map<string, AdaptedCandidate[]>();
  for (const candidate of candidates) {
    const value = candidate.finding.fingerprints.exact.value;
    const group = candidatesByFingerprint.get(value);
    if (group === undefined) {
      candidatesByFingerprint.set(value, [candidate]);
    } else {
      group.push(candidate);
    }
  }
  for (const [value, group] of candidatesByFingerprint) {
    if (group.length < 2) {
      continue;
    }
    duplicateValues.add(value);
    const first = group[0];
    if (first === undefined) {
      throw new TypeError("Duplicate fingerprint group must not be empty");
    }
    orderedDiagnostics.push({
      detectorIndex: first.detectorIndex,
      diagnostic: createDiagnostic(
        "FINDING_V2_DUPLICATE_FINGERPRINT",
        specification.ruleId,
        first.finding.primaryLocation
      )
    });
  }

  const findings = candidates
    .filter(
      ({ finding }) => !duplicateValues.has(finding.fingerprints.exact.value)
    )
    .map(({ finding }) => finding);
  const diagnostics = orderedDiagnostics
    .sort((left, right) => left.detectorIndex - right.detectorIndex)
    .map(({ diagnostic }) => diagnostic);

  return { findings, diagnostics };
}

function createFindingV2(
  legacyFinding: Finding,
  primaryLocation: SourceLocationV2,
  specification: PatternFindingV2AdapterSpecification
): FindingV2 {
  const metadata = specification.definition.metadata;
  if (
    metadata.taxonomy === "needs-research" ||
    metadata.taxonomy === "remove-or-replace"
  ) {
    throw new TypeError("FindingV2 adapter taxonomy is unsupported");
  }
  const classification: FindingClassificationV2 = {
    taxonomy: metadata.taxonomy,
    impact: metadata.impact,
    category: metadata.category,
    maturity: metadata.maturity,
    rulePacks: [...metadata.rulePacks]
  };
  const finding: FindingV2 = {
    ruleId: specification.ruleId,
    title: specification.definition.rule.name,
    message: legacyFinding.message,
    classification,
    confidence: {
      level: metadata.defaultConfidence,
      basis: "adapter",
      reason: specification.confidenceReason
    },
    primaryLocation,
    relatedLocations: [],
    evidence: [
      {
        kind: "pattern-match",
        patternId: specification.patternId,
        location: primaryLocation
      }
    ],
    remediation: { summary: specification.remediationSummary },
    documentation: metadata.documentation.map(({ title, url }) => ({ title, url })),
    fingerprints: {
      exact: createExactFindingFingerprint({
        ruleId: specification.ruleId,
        primaryLocation,
        detectorDiscriminator: specification.detectorDiscriminator
      })
    }
  };

  validateFindingV2(finding);
  return finding;
}

function createDiagnostic(
  code: AdaptationDiagnosticCode,
  ruleId: SupportedFindingV2AdapterRuleId,
  location?: SourceLocationV2
): ScanDiagnosticV2 {
  const messages: Record<AdaptationDiagnosticCode, string> = {
    FINDING_V2_LOCATION_MISSING:
      "Detector finding cannot be adapted because it has no source file.",
    FINDING_V2_LOCATION_AMBIGUOUS:
      "Detector finding cannot be adapted because its source files are ambiguous.",
    FINDING_V2_LOCATION_UNREPRESENTABLE:
      "Detector finding cannot be adapted because its source location is not safely representable.",
    FINDING_V2_DUPLICATE_FINGERPRINT:
      "Detector findings cannot be adapted because they produce the same exact fingerprint."
  };
  const diagnostic: ScanDiagnosticV2 = {
    code,
    category: "internal-error",
    level: code === "FINDING_V2_DUPLICATE_FINGERPRINT" ? "error" : "warning",
    phase: "analysis",
    origin: "tool",
    message: messages[code],
    recoverable: true,
    ruleId,
    ...(location === undefined ? {} : { location })
  };

  validateScanDiagnosticV2(diagnostic);
  return diagnostic;
}

function validateInput(input: unknown): asserts input is AdaptDetectorOccurrenceV2Input {
  assertPlainRecord(input, "FindingV2 adapter input");
  assertOnlyKeys(
    input,
    ["occurrence", "specification", "resolveLocation"],
    "FindingV2 adapter input"
  );
  if (typeof input.resolveLocation !== "function") {
    throw new TypeError("FindingV2 adapter location resolver must be a function");
  }
  validatePatternFindingV2AdapterSpecification(input.specification);

  assertPlainRecord(input.occurrence, "FindingV2 adapter occurrence");
  assertOnlyKeys(
    input.occurrence,
    ["selectionIndex", "rule", "scheduling", "execution", "detectorFindings"],
    "FindingV2 adapter occurrence"
  );
  if (
    !Number.isSafeInteger(input.occurrence.selectionIndex) ||
    (input.occurrence.selectionIndex as number) < 0
  ) {
    throw new TypeError("FindingV2 adapter selectionIndex must be non-negative");
  }
  if (
    input.occurrence.scheduling !== "scheduled" ||
    input.occurrence.execution !== "completed"
  ) {
    throw new TypeError("FindingV2 adapter requires a completed scheduled occurrence");
  }
  if (!Array.isArray(input.occurrence.detectorFindings)) {
    throw new TypeError("FindingV2 adapter detectorFindings must be an array");
  }
  assertPlainRecord(input.occurrence.rule, "FindingV2 adapter rule identity");
  assertOnlyKeys(
    input.occurrence.rule,
    ["kind", "id"],
    "FindingV2 adapter rule identity"
  );
  if (input.occurrence.rule.kind !== "rule-id") {
    throw new TypeError("FindingV2 adapter rule identity is unsupported");
  }
  if (input.occurrence.rule.id !== input.specification.ruleId) {
    throw new TypeError("FindingV2 adapter occurrence and specification IDs must match");
  }
}

function validateLegacyFindingIdentity(
  finding: Finding,
  expectedRuleId: SupportedFindingV2AdapterRuleId
): void {
  assertPlainRecord(finding, "FindingV2 adapter detector finding");
  if (finding.ruleId !== expectedRuleId) {
    throw new TypeError("Detector finding rule ID must match its occurrence");
  }
}

function validateResolution(
  value: unknown
): asserts value is SourceLocationResolutionV2 {
  assertPlainRecord(value, "Source location resolution");
  if (value.status === "resolved") {
    assertOnlyKeys(value, ["status", "location"], "Resolved source location");
    validateSourceLocationV2(value.location);
    return;
  }
  if (value.status === "rejected") {
    assertOnlyKeys(value, ["status", "reason"], "Rejected source location");
    if (!REJECTION_REASONS.includes(value.reason as SourceLocationResolutionRejectionReasonV2)) {
      throw new TypeError("Source location rejection reason is unsupported");
    }
    return;
  }
  throw new TypeError("Source location resolution status is unsupported");
}

function assertPlainRecord(
  value: unknown,
  label: string
): asserts value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be a plain object`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${label} must be a plain object`);
  }
}

function assertOnlyKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  label: string
): void {
  const unknownKey = Object.keys(value).find((key) => !allowed.includes(key));
  if (unknownKey !== undefined) {
    throw new TypeError(`${label} contains unsupported field "${unknownKey}"`);
  }
}
