import type { Rule } from "../../rules/index.js";
import type {
  RuleCategory,
  RuleConfidence,
  RuleImpact,
  RuleMaturity,
  RuleMetadata,
  RulePack
} from "../../rules/taxonomy.js";

export const ARCREADY_CONTRACT_VERSION = "2.0" as const;

export type ArcReadyContractVersion = typeof ARCREADY_CONTRACT_VERSION;

export class ContractV2ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContractV2ValidationError";
  }
}

export interface SourcePositionV2 {
  line: number;
  column: number;
}

export interface SourceRegionV2 {
  start: SourcePositionV2;
  end?: SourcePositionV2;
}

export interface SourceLocationV2 {
  path: string;
  region?: SourceRegionV2;
}

export interface RelatedLocationV2 {
  label: string;
  location: SourceLocationV2;
}

export interface FindingFingerprintV1 {
  scheme: "arcready/exact-location/v1";
  algorithm: "sha256";
  value: `sha256:${string}`;
  stability: "exact";
}

export interface ExactFindingFingerprintInputV1 {
  ruleId: string;
  primaryLocation?: SourceLocationV2;
  detectorDiscriminator: string;
}

export type FindingTaxonomyV2 =
  | "stable-compatibility"
  | "experimental-compatibility"
  | "advice";

export interface FindingClassificationV2 {
  taxonomy: FindingTaxonomyV2;
  impact: RuleImpact;
  category: RuleCategory;
  maturity: RuleMaturity;
  rulePacks: readonly RulePack[];
}

export interface FindingConfidenceV2 {
  level: RuleConfidence;
  basis: "detector" | "rule-default" | "adapter";
  reason: string;
}

export interface FindingRemediationV2 {
  summary: string;
}

export interface FindingDocumentationLinkV2 {
  title: string;
  url: string;
}

export interface FindingFingerprintsV2 {
  exact: FindingFingerprintV1;
}

export type FindingEvidenceScalarV2 = string | number | boolean;

export type FindingEvidenceV2 =
  | {
      kind: "observed-value";
      name: string;
      observed: FindingEvidenceScalarV2;
      expected?: FindingEvidenceScalarV2;
      location?: SourceLocationV2;
    }
  | {
      kind: "pattern-match";
      patternId: string;
      location?: SourceLocationV2;
      excerpt?: string;
    }
  | {
      kind: "configuration";
      key: string;
      observed: FindingEvidenceScalarV2;
      expected?: FindingEvidenceScalarV2;
      location?: SourceLocationV2;
    }
  | {
      kind: "assumption";
      statement: string;
      basis: string;
      location?: SourceLocationV2;
    };

export interface FindingV2 {
  ruleId: string;
  title: string;
  message: string;
  classification: FindingClassificationV2;
  confidence: FindingConfidenceV2;
  primaryLocation?: SourceLocationV2;
  relatedLocations: readonly RelatedLocationV2[];
  evidence: readonly FindingEvidenceV2[];
  remediation?: FindingRemediationV2;
  documentation: readonly FindingDocumentationLinkV2[];
  fingerprints: FindingFingerprintsV2;
}

export type ScanDiagnosticCategoryV2 =
  | "configuration-error"
  | "discovery-error"
  | "read-error"
  | "parse-error"
  | "unsupported-language"
  | "rule-execution-error"
  | "internal-error";

export interface ScanDiagnosticV2 {
  code: string;
  category: ScanDiagnosticCategoryV2;
  level: "note" | "warning" | "error";
  phase: "configuration" | "discovery" | "analysis" | "reporting";
  origin: "user-input" | "repository" | "tool";
  message: string;
  recoverable: boolean;
  ruleId?: string;
  location?: SourceLocationV2;
}

export type AnalysisEngineV2 =
  | "text-pattern"
  | "structured-config"
  | "ast";

export interface RuleCapabilitiesV2 {
  engines: readonly AnalysisEngineV2[];
  supportedExtensions: readonly string[];
  locationPrecision: "repository" | "file" | "region";
  parserRequirements: readonly string[];
}

export interface RuleDefinitionV2 {
  contractVersion: ArcReadyContractVersion;
  rule: Rule;
  metadata: RuleMetadata;
  capabilities: RuleCapabilitiesV2;
}
