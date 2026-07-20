import {
  DOCUMENTATION_PUBLISHERS,
  DOCUMENTATION_STABILITY_VALUES,
  DOCUMENTATION_SUPPORT_VALUES,
  RULE_APPLICABILITY,
  RULE_CATEGORIES,
  RULE_CONFIDENCE_LEVELS,
  RULE_IMPACTS,
  RULE_MATURITY_LEVELS,
  RULE_PACKS,
  RULE_TAXONOMIES,
  validateRuleMetadata
} from "../../rules/taxonomy.js";
import type { RuleMetadataInput } from "../../rules/taxonomy.js";
import {
  ARCREADY_CONTRACT_VERSION,
  ContractV2ValidationError,
  type FindingEvidenceV2,
  type FindingFingerprintV1,
  type FindingV2,
  type RuleCapabilitiesV2,
  type RuleDefinitionV2,
  type ScanDiagnosticV2
} from "./model.js";
import { validateSourceLocationV2 } from "./source-location.js";

export const MAX_CONTRACT_V2_EXCERPT_LENGTH = 1_000;
export const MAX_CONTRACT_V2_EVIDENCE_STRING_LENGTH = 2_048;

const MAX_IDENTIFIER_LENGTH = 256;
const MAX_TITLE_LENGTH = 256;
const MAX_MESSAGE_LENGTH = 8_192;
const MAX_REASON_LENGTH = 2_048;
const MAX_SUMMARY_LENGTH = 4_096;
const MAX_URL_LENGTH = 2_048;
const MAX_COLLECTION_ITEMS = 1_000;
const FINGERPRINT_VALUE_PATTERN = /^sha256:[a-f0-9]{64}$/;
const EXTENSION_PATTERN = /^\.[a-z0-9][a-z0-9.+-]*$/;

const EVIDENCE_KINDS = [
  "observed-value",
  "pattern-match",
  "configuration",
  "assumption"
] as const;
const FINDING_TAXONOMIES = [
  "stable-compatibility",
  "experimental-compatibility",
  "advice"
] as const;
const DIAGNOSTIC_CATEGORIES = [
  "configuration-error",
  "discovery-error",
  "read-error",
  "parse-error",
  "unsupported-language",
  "rule-execution-error",
  "internal-error"
] as const;
const DIAGNOSTIC_LEVELS = ["note", "warning", "error"] as const;
const DIAGNOSTIC_PHASES = [
  "configuration",
  "discovery",
  "analysis",
  "reporting"
] as const;
const DIAGNOSTIC_ORIGINS = ["user-input", "repository", "tool"] as const;
const ANALYSIS_ENGINES = ["ast", "structured-config", "text-pattern"] as const;
const LOCATION_PRECISIONS = ["repository", "file", "region"] as const;

export function validateFindingEvidenceV2(
  value: unknown
): asserts value is FindingEvidenceV2 {
  assertRecord(value, "finding evidence");
  if (!includesValue(EVIDENCE_KINDS, value.kind)) {
    fail("finding evidence kind is unsupported");
  }

  switch (value.kind) {
    case "observed-value":
      assertOnlyKeys(
        value,
        ["kind", "name", "observed", "expected", "location"],
        "observed-value evidence"
      );
      assertBoundedString(value.name, "observed-value evidence name", MAX_IDENTIFIER_LENGTH);
      validateEvidenceScalar(value.observed, "observed-value evidence observed");
      if (value.expected !== undefined) {
        validateEvidenceScalar(value.expected, "observed-value evidence expected");
      }
      validateOptionalLocation(value.location);
      return;
    case "pattern-match":
      assertOnlyKeys(
        value,
        ["kind", "patternId", "location", "excerpt"],
        "pattern-match evidence"
      );
      assertStableIdentifier(value.patternId, "pattern-match evidence patternId");
      validateOptionalLocation(value.location);
      if (value.excerpt !== undefined) {
        if (typeof value.excerpt !== "string") {
          fail("pattern-match evidence excerpt must be a string");
        }
        if (value.excerpt.length > MAX_CONTRACT_V2_EXCERPT_LENGTH) {
          fail(
            `pattern-match evidence excerpt must not exceed ${MAX_CONTRACT_V2_EXCERPT_LENGTH} characters`
          );
        }
      }
      return;
    case "configuration":
      assertOnlyKeys(
        value,
        ["kind", "key", "observed", "expected", "location"],
        "configuration evidence"
      );
      assertBoundedString(value.key, "configuration evidence key", MAX_IDENTIFIER_LENGTH);
      validateEvidenceScalar(value.observed, "configuration evidence observed");
      if (value.expected !== undefined) {
        validateEvidenceScalar(value.expected, "configuration evidence expected");
      }
      validateOptionalLocation(value.location);
      return;
    case "assumption":
      assertOnlyKeys(
        value,
        ["kind", "statement", "basis", "location"],
        "assumption evidence"
      );
      assertBoundedString(
        value.statement,
        "assumption evidence statement",
        MAX_CONTRACT_V2_EVIDENCE_STRING_LENGTH
      );
      assertBoundedString(
        value.basis,
        "assumption evidence basis",
        MAX_CONTRACT_V2_EVIDENCE_STRING_LENGTH
      );
      validateOptionalLocation(value.location);
  }
}

export function validateFindingV2(value: unknown): asserts value is FindingV2 {
  assertRecord(value, "FindingV2");
  assertOnlyKeys(
    value,
    [
      "ruleId",
      "title",
      "message",
      "classification",
      "confidence",
      "primaryLocation",
      "relatedLocations",
      "evidence",
      "remediation",
      "documentation",
      "fingerprints"
    ],
    "FindingV2"
  );
  assertStableIdentifier(value.ruleId, "FindingV2 ruleId");
  assertBoundedString(value.title, "FindingV2 title", MAX_TITLE_LENGTH);
  assertBoundedString(value.message, "FindingV2 message", MAX_MESSAGE_LENGTH);
  validateClassification(value.classification);
  validateConfidence(value.confidence);
  validateOptionalLocation(value.primaryLocation);

  assertArray(value.relatedLocations, "FindingV2 relatedLocations");
  assertCollectionSize(value.relatedLocations, "FindingV2 relatedLocations");
  for (const relatedLocation of value.relatedLocations) {
    assertRecord(relatedLocation, "related location");
    assertOnlyKeys(relatedLocation, ["label", "location"], "related location");
    assertBoundedString(relatedLocation.label, "related location label", MAX_TITLE_LENGTH);
    validateSourceLocationV2(relatedLocation.location);
  }

  assertArray(value.evidence, "FindingV2 evidence");
  assertCollectionSize(value.evidence, "FindingV2 evidence");
  if (value.evidence.length === 0) {
    fail("FindingV2 evidence must contain at least one item");
  }
  for (const evidence of value.evidence) {
    validateFindingEvidenceV2(evidence);
  }

  if (value.remediation !== undefined) {
    assertRecord(value.remediation, "FindingV2 remediation");
    assertOnlyKeys(value.remediation, ["summary"], "FindingV2 remediation");
    assertBoundedString(
      value.remediation.summary,
      "FindingV2 remediation summary",
      MAX_SUMMARY_LENGTH
    );
  }

  assertArray(value.documentation, "FindingV2 documentation");
  assertCollectionSize(value.documentation, "FindingV2 documentation");
  for (const link of value.documentation) {
    validateDocumentationLink(link);
  }

  assertRecord(value.fingerprints, "FindingV2 fingerprints");
  assertOnlyKeys(value.fingerprints, ["exact"], "FindingV2 fingerprints");
  validateFindingFingerprintV1(value.fingerprints.exact);
}

export function validateScanDiagnosticV2(
  value: unknown
): asserts value is ScanDiagnosticV2 {
  assertRecord(value, "ScanDiagnosticV2");
  assertOnlyKeys(
    value,
    [
      "code",
      "category",
      "level",
      "phase",
      "origin",
      "message",
      "recoverable",
      "ruleId",
      "location"
    ],
    "ScanDiagnosticV2"
  );
  assertStableIdentifier(value.code, "ScanDiagnosticV2 code");
  if (!includesValue(DIAGNOSTIC_CATEGORIES, value.category)) {
    fail("ScanDiagnosticV2 category is unsupported");
  }
  if (!includesValue(DIAGNOSTIC_LEVELS, value.level)) {
    fail("ScanDiagnosticV2 level is unsupported");
  }
  if (!includesValue(DIAGNOSTIC_PHASES, value.phase)) {
    fail("ScanDiagnosticV2 phase is unsupported");
  }
  if (!includesValue(DIAGNOSTIC_ORIGINS, value.origin)) {
    fail("ScanDiagnosticV2 origin is unsupported");
  }
  assertBoundedString(value.message, "ScanDiagnosticV2 message", MAX_MESSAGE_LENGTH);
  if (typeof value.recoverable !== "boolean") {
    fail("ScanDiagnosticV2 recoverable must be a boolean");
  }
  if (value.ruleId !== undefined) {
    assertStableIdentifier(value.ruleId, "ScanDiagnosticV2 ruleId");
  }
  validateOptionalLocation(value.location);
}

export function validateRuleCapabilitiesV2(
  value: unknown
): asserts value is RuleCapabilitiesV2 {
  assertRecord(value, "RuleCapabilitiesV2");
  assertOnlyKeys(
    value,
    ["engines", "supportedExtensions", "locationPrecision", "parserRequirements"],
    "RuleCapabilitiesV2"
  );

  assertArray(value.engines, "RuleCapabilitiesV2 engines");
  if (value.engines.length === 0) {
    fail("RuleCapabilitiesV2 must declare at least one analysis engine");
  }
  for (const engine of value.engines) {
    if (!includesValue(ANALYSIS_ENGINES, engine)) {
      fail("RuleCapabilitiesV2 analysis engine is unsupported");
    }
  }
  assertUniqueStrings(value.engines, "RuleCapabilitiesV2 engines");
  assertDeterministicOrder(value.engines, "RuleCapabilitiesV2 engines");

  assertArray(value.supportedExtensions, "RuleCapabilitiesV2 supportedExtensions");
  for (const extension of value.supportedExtensions) {
    if (typeof extension !== "string" || !EXTENSION_PATTERN.test(extension)) {
      fail(
        "RuleCapabilitiesV2 extensions must be lowercase and begin with a dot"
      );
    }
  }
  assertUniqueStrings(
    value.supportedExtensions,
    "RuleCapabilitiesV2 supportedExtensions"
  );
  assertDeterministicOrder(
    value.supportedExtensions,
    "RuleCapabilitiesV2 supportedExtensions"
  );

  if (!includesValue(LOCATION_PRECISIONS, value.locationPrecision)) {
    fail("RuleCapabilitiesV2 locationPrecision is unsupported");
  }

  assertArray(value.parserRequirements, "RuleCapabilitiesV2 parserRequirements");
  for (const requirement of value.parserRequirements) {
    assertStableIdentifier(
      requirement,
      "RuleCapabilitiesV2 parser requirement"
    );
  }
  assertUniqueStrings(
    value.parserRequirements,
    "RuleCapabilitiesV2 parserRequirements"
  );
  assertDeterministicOrder(
    value.parserRequirements,
    "RuleCapabilitiesV2 parserRequirements"
  );
}

export function validateRuleDefinitionV2(
  value: unknown
): asserts value is RuleDefinitionV2 {
  assertRecord(value, "RuleDefinitionV2");
  assertOnlyKeys(
    value,
    ["contractVersion", "rule", "metadata", "capabilities"],
    "RuleDefinitionV2"
  );
  if (value.contractVersion !== ARCREADY_CONTRACT_VERSION) {
    fail(`RuleDefinitionV2 contractVersion must be "${ARCREADY_CONTRACT_VERSION}"`);
  }

  assertRecord(value.rule, "RuleDefinitionV2 rule");
  assertStableIdentifier(value.rule.id, "RuleDefinitionV2 rule id");
  assertBoundedString(value.rule.name, "RuleDefinitionV2 rule name", MAX_TITLE_LENGTH);
  assertBoundedString(
    value.rule.description,
    "RuleDefinitionV2 rule description",
    MAX_SUMMARY_LENGTH
  );
  if (!includesValue(RULE_CATEGORIES, value.rule.preset)) {
    fail("RuleDefinitionV2 rule preset is unsupported");
  }
  if (!includesValue(["info", "warning", "critical"] as const, value.rule.defaultSeverity)) {
    fail("RuleDefinitionV2 rule defaultSeverity is unsupported");
  }
  assertArray(value.rule.docs, "RuleDefinitionV2 rule docs");
  for (const documentation of value.rule.docs) {
    assertBoundedString(
      documentation,
      "RuleDefinitionV2 rule documentation reference",
      MAX_URL_LENGTH
    );
  }
  if (typeof value.rule.run !== "function") {
    fail("RuleDefinitionV2 rule run must be a function");
  }

  assertRuleMetadataShape(value.metadata);
  if (value.rule.id !== value.metadata.id) {
    fail("RuleDefinitionV2 rule id must equal metadata id");
  }
  if (value.rule.preset !== value.metadata.category) {
    fail("RuleDefinitionV2 rule preset must equal metadata category");
  }

  const metadataErrors = validateRuleMetadata(
    value.metadata as unknown as RuleMetadataInput
  );
  if (metadataErrors.length > 0) {
    fail(`RuleDefinitionV2 metadata is invalid: ${metadataErrors.join("; ")}`);
  }
  validateRuleCapabilitiesV2(value.capabilities);
}

export function validateFindingFingerprintV1(
  value: unknown
): asserts value is FindingFingerprintV1 {
  assertRecord(value, "FindingFingerprintV1");
  assertOnlyKeys(
    value,
    ["scheme", "algorithm", "value", "stability"],
    "FindingFingerprintV1"
  );
  if (value.scheme !== "arcready/exact-location/v1") {
    fail("FindingFingerprintV1 scheme is unsupported");
  }
  if (value.algorithm !== "sha256") {
    fail("FindingFingerprintV1 algorithm must be sha256");
  }
  if (typeof value.value !== "string" || !FINGERPRINT_VALUE_PATTERN.test(value.value)) {
    fail("FindingFingerprintV1 value must be a lowercase SHA-256 digest");
  }
  if (value.stability !== "exact") {
    fail("FindingFingerprintV1 stability must be exact");
  }
}

function validateClassification(value: unknown): void {
  assertRecord(value, "FindingV2 classification");
  assertOnlyKeys(
    value,
    ["taxonomy", "impact", "category", "maturity", "rulePacks"],
    "FindingV2 classification"
  );
  if (!includesValue(RULE_TAXONOMIES, value.taxonomy)) {
    fail("FindingV2 classification taxonomy is unsupported");
  }
  if (!includesValue(FINDING_TAXONOMIES, value.taxonomy)) {
    fail(
      "FindingV2 classification taxonomy cannot produce compatibility findings"
    );
  }
  if (!includesValue(RULE_IMPACTS, value.impact)) {
    fail("FindingV2 classification impact is unsupported");
  }
  if (!includesValue(RULE_CATEGORIES, value.category)) {
    fail("FindingV2 classification category is unsupported");
  }
  if (!includesValue(RULE_MATURITY_LEVELS, value.maturity)) {
    fail("FindingV2 classification maturity is unsupported");
  }
  assertArray(value.rulePacks, "FindingV2 classification rulePacks");
  if (value.rulePacks.length === 0) {
    fail("FindingV2 classification must declare at least one rule pack");
  }
  for (const rulePack of value.rulePacks) {
    if (!includesValue(RULE_PACKS, rulePack)) {
      fail("FindingV2 classification rule pack is unsupported");
    }
  }
  assertUniqueStrings(value.rulePacks, "FindingV2 classification rulePacks");
  assertDeterministicOrder(value.rulePacks, "FindingV2 classification rulePacks");

  switch (value.taxonomy) {
    case "stable-compatibility":
      if (value.impact !== "blocker" && value.impact !== "required-change") {
        fail("stable compatibility findings require blocker or required-change impact");
      }
      if (value.maturity !== "validated") {
        fail("stable compatibility findings require validated maturity");
      }
      break;
    case "experimental-compatibility":
      if (value.impact !== "blocker" && value.impact !== "required-change") {
        fail(
          "experimental compatibility findings require blocker or required-change impact"
        );
      }
      if (value.maturity === "deprecated") {
        fail("experimental compatibility findings must not be deprecated");
      }
      break;
    case "advice":
      if (value.impact !== "recommendation") {
        fail("advice findings require recommendation impact");
      }
      if (value.maturity === "deprecated") {
        fail("advice findings must not be deprecated");
      }
      break;
  }
}

function validateConfidence(value: unknown): void {
  assertRecord(value, "FindingV2 confidence");
  assertOnlyKeys(value, ["level", "basis", "reason"], "FindingV2 confidence");
  if (!includesValue(RULE_CONFIDENCE_LEVELS, value.level)) {
    fail("FindingV2 confidence level is unsupported");
  }
  if (!includesValue(["detector", "rule-default", "adapter"] as const, value.basis)) {
    fail("FindingV2 confidence basis is unsupported");
  }
  assertBoundedString(value.reason, "FindingV2 confidence reason", MAX_REASON_LENGTH);
}

function validateDocumentationLink(value: unknown): void {
  assertRecord(value, "FindingV2 documentation link");
  assertOnlyKeys(value, ["title", "url"], "FindingV2 documentation link");
  assertBoundedString(value.title, "FindingV2 documentation title", MAX_TITLE_LENGTH);
  assertBoundedString(value.url, "FindingV2 documentation URL", MAX_URL_LENGTH);
  let parsed: URL;
  try {
    parsed = new URL(value.url as string);
  } catch {
    fail("FindingV2 documentation URL must be absolute");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    fail("FindingV2 documentation URL must use HTTP or HTTPS");
  }
}

function validateEvidenceScalar(value: unknown, label: string): void {
  if (typeof value === "string") {
    if (value.length > MAX_CONTRACT_V2_EVIDENCE_STRING_LENGTH) {
      fail(
        `${label} must not exceed ${MAX_CONTRACT_V2_EVIDENCE_STRING_LENGTH} characters`
      );
    }
    return;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      fail(`${label} number must be finite`);
    }
    return;
  }
  if (typeof value !== "boolean") {
    fail(`${label} must be a string, finite number, or boolean`);
  }
}

function validateOptionalLocation(value: unknown): void {
  if (value !== undefined) {
    validateSourceLocationV2(value);
  }
}

function assertRuleMetadataShape(
  value: unknown
): asserts value is Record<string, unknown> {
  assertRecord(value, "RuleDefinitionV2 metadata");
  assertOnlyKeys(
    value,
    [
      "id",
      "category",
      "rulePacks",
      "taxonomy",
      "impact",
      "defaultConfidence",
      "maturity",
      "recommendedDefaultEnabled",
      "recommendedCiFailureEligible",
      "appliesTo",
      "documentation",
      "researchGap",
      "rationale",
      "detectorLimitations",
      "deprecated",
      "replacement",
      "noReplacementPlannedReason"
    ],
    "RuleDefinitionV2 metadata"
  );
  assertStableIdentifier(value.id, "RuleDefinitionV2 metadata id");
  if (!includesValue(RULE_CATEGORIES, value.category)) {
    fail("RuleDefinitionV2 metadata category is unsupported");
  }
  if (!includesValue(RULE_TAXONOMIES, value.taxonomy)) {
    fail("RuleDefinitionV2 metadata taxonomy is unsupported");
  }
  if (!includesValue(RULE_IMPACTS, value.impact)) {
    fail("RuleDefinitionV2 metadata impact is unsupported");
  }
  if (!includesValue(RULE_CONFIDENCE_LEVELS, value.defaultConfidence)) {
    fail("RuleDefinitionV2 metadata confidence is unsupported");
  }
  if (!includesValue(RULE_MATURITY_LEVELS, value.maturity)) {
    fail("RuleDefinitionV2 metadata maturity is unsupported");
  }
  for (const field of [
    "rulePacks",
    "appliesTo",
    "documentation",
    "detectorLimitations"
  ]) {
    assertArray(value[field], `RuleDefinitionV2 metadata ${field}`);
  }
  for (const rulePack of value.rulePacks as unknown[]) {
    if (!includesValue(RULE_PACKS, rulePack)) {
      fail("RuleDefinitionV2 metadata rule pack is unsupported");
    }
  }
  for (const applicability of value.appliesTo as unknown[]) {
    if (!includesValue(RULE_APPLICABILITY, applicability)) {
      fail("RuleDefinitionV2 metadata applicability is unsupported");
    }
  }
  assertBoundedString(value.rationale, "RuleDefinitionV2 metadata rationale", MAX_MESSAGE_LENGTH);
  if (
    typeof value.recommendedDefaultEnabled !== "boolean" ||
    typeof value.recommendedCiFailureEligible !== "boolean" ||
    typeof value.deprecated !== "boolean"
  ) {
    fail("RuleDefinitionV2 metadata policy flags must be boolean");
  }
  for (const reference of value.documentation as unknown[]) {
    validateMetadataDocumentationReference(reference);
  }
  for (const limitation of value.detectorLimitations as unknown[]) {
    assertBoundedString(
      limitation,
      "RuleDefinitionV2 metadata detector limitation",
      MAX_MESSAGE_LENGTH
    );
  }
  for (const optionalString of [
    "researchGap",
    "replacement",
    "noReplacementPlannedReason"
  ]) {
    const fieldValue = value[optionalString];
    if (fieldValue !== undefined && typeof fieldValue !== "string") {
      fail(`RuleDefinitionV2 metadata ${optionalString} must be a string`);
    }
  }
}

function validateMetadataDocumentationReference(value: unknown): void {
  assertRecord(value, "RuleDefinitionV2 metadata documentation entry");
  assertOnlyKeys(
    value,
    [
      "url",
      "title",
      "publisher",
      "claim",
      "support",
      "verifiedAt",
      "network",
      "version",
      "stability",
      "notes"
    ],
    "RuleDefinitionV2 metadata documentation entry"
  );
  assertBoundedString(value.url, "metadata documentation URL", MAX_URL_LENGTH);
  assertBoundedString(value.title, "metadata documentation title", MAX_TITLE_LENGTH);
  assertBoundedString(value.claim, "metadata documentation claim", MAX_MESSAGE_LENGTH);
  assertBoundedString(value.verifiedAt, "metadata documentation verifiedAt", 10);
  if (!includesValue(DOCUMENTATION_PUBLISHERS, value.publisher)) {
    fail("RuleDefinitionV2 metadata documentation publisher is unsupported");
  }
  if (!includesValue(DOCUMENTATION_SUPPORT_VALUES, value.support)) {
    fail("RuleDefinitionV2 metadata documentation support is unsupported");
  }
  if (!includesValue(DOCUMENTATION_STABILITY_VALUES, value.stability)) {
    fail("RuleDefinitionV2 metadata documentation stability is unsupported");
  }
  for (const optionalString of ["network", "version", "notes"]) {
    const fieldValue = value[optionalString];
    if (fieldValue !== undefined) {
      assertBoundedString(
        fieldValue,
        `metadata documentation ${optionalString}`,
        MAX_MESSAGE_LENGTH
      );
    }
  }
}

function assertStableIdentifier(value: unknown, label: string): void {
  assertBoundedString(value, label, MAX_IDENTIFIER_LENGTH);
  if (containsControlCharacter(value as string)) {
    fail(`${label} must not contain control characters`);
  }
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

function assertBoundedString(
  value: unknown,
  label: string,
  maximumLength: number
): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    fail(`${label} must be a non-empty string`);
  }
  if (value.length > maximumLength) {
    fail(`${label} must not exceed ${maximumLength} characters`);
  }
  if (value !== value.trim()) {
    fail(`${label} must not contain surrounding whitespace`);
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

function assertCollectionSize(value: readonly unknown[], label: string): void {
  if (value.length > MAX_COLLECTION_ITEMS) {
    fail(`${label} must not contain more than ${MAX_COLLECTION_ITEMS} items`);
  }
}

function assertUniqueStrings(value: readonly unknown[], label: string): void {
  if (!value.every((entry) => typeof entry === "string")) {
    fail(`${label} must contain only strings`);
  }
  if (new Set(value).size !== value.length) {
    fail(`${label} must not contain duplicates`);
  }
}

function assertDeterministicOrder(value: readonly unknown[], label: string): void {
  const strings = value as readonly string[];
  for (let index = 1; index < strings.length; index += 1) {
    if (strings[index - 1]! > strings[index]!) {
      fail(`${label} must use deterministic lexical order`);
    }
  }
}

function includesValue(values: readonly string[], value: unknown): value is string {
  return typeof value === "string" && values.includes(value);
}

function assertRecord(
  value: unknown,
  label: string
): asserts value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail(`${label} must be an object`);
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
  throw new ContractV2ValidationError(message);
}
