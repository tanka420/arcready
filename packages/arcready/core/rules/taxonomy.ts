export const RULE_TAXONOMIES = [
  "stable-compatibility",
  "experimental-compatibility",
  "advice",
  "needs-research",
  "remove-or-replace"
] as const;

export type RuleTaxonomy = (typeof RULE_TAXONOMIES)[number];

export const RULE_IMPACTS = [
  "blocker",
  "required-change",
  "recommendation",
  "not-applicable-until-researched"
] as const;

export type RuleImpact = (typeof RULE_IMPACTS)[number];

export const RULE_CONFIDENCE_LEVELS = ["low", "medium", "high"] as const;

export type RuleConfidence = (typeof RULE_CONFIDENCE_LEVELS)[number];

export const RULE_MATURITY_LEVELS = [
  "prototype",
  "validated",
  "deprecated"
] as const;

export type RuleMaturity = (typeof RULE_MATURITY_LEVELS)[number];

export const RULE_PACKS = [
  "core-compatibility",
  "wallet",
  "bridge-cctp",
  "solidity",
  "indexer-infrastructure",
  "app-kit-compatibility",
  "app-kit-advice"
] as const;

export type RulePack = (typeof RULE_PACKS)[number];

export const RULE_CATEGORIES = ["wallet", "bridge", "app-kit"] as const;

export type RuleCategory = (typeof RULE_CATEGORIES)[number];

export const RULE_APPLICABILITY = [
  "chain-configuration",
  "wallet-ui",
  "transaction-confirmation",
  "transaction-submission",
  "smart-contract",
  "bridge-configuration",
  "relayer",
  "attestation-poller",
  "app-kit-sdk",
  "unified-balance"
] as const;

export type RuleApplicability = (typeof RULE_APPLICABILITY)[number];

export const DOCUMENTATION_PUBLISHERS = ["Arc", "Circle"] as const;

export type DocumentationPublisher = (typeof DOCUMENTATION_PUBLISHERS)[number];

export const DOCUMENTATION_SUPPORT_VALUES = [
  "direct",
  "partial",
  "contradicts"
] as const;

export type DocumentationSupport =
  (typeof DOCUMENTATION_SUPPORT_VALUES)[number];

export const DOCUMENTATION_STABILITY_VALUES = [
  "stable",
  "versioned",
  "ambiguous",
  "potentially-outdated"
] as const;

export type DocumentationStability =
  (typeof DOCUMENTATION_STABILITY_VALUES)[number];

export interface DocumentationReference {
  url: string;
  title: string;
  publisher: DocumentationPublisher;
  claim: string;
  support: DocumentationSupport;
  verifiedAt: string;
  network?: string;
  version?: string;
  stability: DocumentationStability;
  notes?: string;
}

interface RuleMetadataBase {
  id: string;
  category: RuleCategory;
  rulePacks: readonly RulePack[];
  defaultConfidence: RuleConfidence;
  maturity: RuleMaturity;
  /**
   * Future policy recommendation only. This does not affect the current
   * registry, presets, severity, scoring, reports, CLI, or exit behavior.
   */
  recommendedDefaultEnabled: boolean;
  /**
   * Future policy recommendation only. This does not affect current CI
   * failures, severity, scoring, reports, CLI, or exit behavior.
   */
  recommendedCiFailureEligible: boolean;
  appliesTo: readonly RuleApplicability[];
  documentation: readonly DocumentationReference[];
  researchGap?: string;
  rationale: string;
  detectorLimitations: readonly string[];
  deprecated: boolean;
}

interface StableCompatibilityMetadata extends RuleMetadataBase {
  taxonomy: "stable-compatibility";
  impact: "blocker" | "required-change";
  defaultConfidence: "high";
  maturity: "validated";
  deprecated: false;
}

interface ExperimentalCompatibilityMetadata extends RuleMetadataBase {
  taxonomy: "experimental-compatibility";
  impact: "blocker" | "required-change";
  recommendedCiFailureEligible: false;
  deprecated: false;
}

interface ActiveAdviceMetadata extends RuleMetadataBase {
  taxonomy: "advice";
  impact: "recommendation";
  maturity: "prototype" | "validated";
  recommendedDefaultEnabled: false;
  recommendedCiFailureEligible: false;
  deprecated: false;
}

interface DeprecatedAdviceMetadata extends RuleMetadataBase {
  taxonomy: "advice";
  impact: "recommendation";
  maturity: "deprecated";
  recommendedDefaultEnabled: false;
  recommendedCiFailureEligible: false;
  deprecated: true;
}

type AdviceMetadata = ActiveAdviceMetadata | DeprecatedAdviceMetadata;
interface NeedsResearchMetadata extends RuleMetadataBase {
  taxonomy: "needs-research";
  impact: "not-applicable-until-researched";
  recommendedDefaultEnabled: false;
  recommendedCiFailureEligible: false;
  deprecated: false;
  researchGap: string;
}

interface RemoveOrReplaceMetadataBase extends RuleMetadataBase {
  taxonomy: "remove-or-replace";
  impact: "not-applicable-until-researched";
  maturity: "deprecated";
  recommendedDefaultEnabled: false;
  recommendedCiFailureEligible: false;
  deprecated: true;
}

type RemoveOrReplaceMetadata = RemoveOrReplaceMetadataBase &
  (
    | {
        replacement: string;
        noReplacementPlannedReason?: never;
      }
    | {
        replacement?: never;
        noReplacementPlannedReason: string;
      }
  );

export type RuleMetadata =
  | StableCompatibilityMetadata
  | ExperimentalCompatibilityMetadata
  | AdviceMetadata
  | NeedsResearchMetadata
  | RemoveOrReplaceMetadata;

export type RuleMetadataInput = RuleMetadataBase & {
  taxonomy: RuleTaxonomy;
  impact: RuleImpact;
  replacement?: string;
  noReplacementPlannedReason?: string;
};

export function validateRuleMetadata(metadata: RuleMetadataInput): string[] {
  const errors: string[] = [];

  if (metadata.rationale.trim().length === 0) {
    errors.push(`${metadata.id}: rationale is required`);
  }

  if (metadata.rulePacks.length === 0) {
    errors.push(`${metadata.id}: at least one rule pack is required`);
  }

  if (metadata.appliesTo.length === 0) {
    errors.push(
      `${metadata.id}: at least one applicability target is required`
    );
  }

  if (
    metadata.documentation.length === 0 &&
    (metadata.researchGap?.trim().length ?? 0) === 0
  ) {
    errors.push(`${metadata.id}: documentation or a research gap is required`);
  }

  if (
    metadata.taxonomy !== "stable-compatibility" &&
    metadata.detectorLimitations.length === 0
  ) {
    errors.push(`${metadata.id}: detector limitations are required`);
  }

  if (
    metadata.recommendedCiFailureEligible &&
    metadata.taxonomy !== "stable-compatibility"
  ) {
    errors.push(
      `${metadata.id}: only stable compatibility rules may be recommended for CI failure`
    );
  }

  if (
    metadata.taxonomy !== "remove-or-replace" &&
    (metadata.replacement !== undefined ||
      metadata.noReplacementPlannedReason !== undefined)
  ) {
    errors.push(
      `${metadata.id}: replacement metadata is only valid for remove-or-replace rules`
    );
  }

  switch (metadata.taxonomy) {
    case "stable-compatibility":
      if (
        metadata.impact !== "blocker" &&
        metadata.impact !== "required-change"
      ) {
        errors.push(`${metadata.id}: stable compatibility impact is invalid`);
      }
      if (metadata.defaultConfidence !== "high") {
        errors.push(
          `${metadata.id}: stable compatibility requires high confidence`
        );
      }
      if (metadata.maturity !== "validated") {
        errors.push(
          `${metadata.id}: stable compatibility requires validated maturity`
        );
      }
      if (
        !metadata.documentation.some(
          (reference) => reference.support === "direct"
        )
      ) {
        errors.push(
          `${metadata.id}: stable compatibility requires direct evidence`
        );
      }
      break;
    case "experimental-compatibility":
      if (
        metadata.impact !== "blocker" &&
        metadata.impact !== "required-change"
      ) {
        errors.push(
          `${metadata.id}: experimental compatibility impact is invalid`
        );
      }
      break;
    case "advice":
      if (metadata.impact !== "recommendation") {
        errors.push(`${metadata.id}: advice must use recommendation impact`);
      }
      if (metadata.recommendedDefaultEnabled) {
        errors.push(
          `${metadata.id}: advice rules must be recommended disabled`
        );
      }
      if (metadata.deprecated !== (metadata.maturity === "deprecated")) {
        errors.push(
          `${metadata.id}: advice deprecation and maturity must agree`
        );
      }
      break;
    case "needs-research":
      if (metadata.impact !== "not-applicable-until-researched") {
        errors.push(
          `${metadata.id}: research rules require the research impact`
        );
      }
      if (metadata.recommendedDefaultEnabled) {
        errors.push(
          `${metadata.id}: research rules must be recommended disabled`
        );
      }
      if ((metadata.researchGap?.trim().length ?? 0) === 0) {
        errors.push(`${metadata.id}: research rules require a research gap`);
      }
      break;
    case "remove-or-replace":
      if (metadata.impact !== "not-applicable-until-researched") {
        errors.push(
          `${metadata.id}: removed rules require the research impact`
        );
      }
      if (metadata.recommendedDefaultEnabled) {
        errors.push(
          `${metadata.id}: removed rules must be recommended disabled`
        );
      }
      if (!metadata.deprecated || metadata.maturity !== "deprecated") {
        errors.push(`${metadata.id}: removed rules must be deprecated`);
      }
      if (
        (metadata.replacement?.trim().length ?? 0) === 0 &&
        (metadata.noReplacementPlannedReason?.trim().length ?? 0) === 0
      ) {
        errors.push(
          `${metadata.id}: removed rules require replacement direction or a no-replacement reason`
        );
      }
      break;
  }

  for (const reference of metadata.documentation) {
    validateDocumentationReference(metadata.id, reference, errors);
  }

  return errors;
}

export function validateRuleMetadataCatalog(
  catalog: readonly RuleMetadataInput[]
): string[] {
  const errors = catalog.flatMap((metadata) => validateRuleMetadata(metadata));
  const ids = catalog.map((metadata) => metadata.id);
  const seenIds = new Set<string>();

  for (const id of ids) {
    if (seenIds.has(id)) {
      errors.push(`${id}: duplicate catalog entry`);
    }
    seenIds.add(id);
  }

  const sortedIds = [...ids].sort();
  if (ids.some((id, index) => id !== sortedIds[index])) {
    errors.push("Catalog entries must be sorted by rule ID");
  }

  return errors;
}

function validateDocumentationReference(
  ruleId: string,
  reference: DocumentationReference,
  errors: string[]
): void {
  if (!DOCUMENTATION_PUBLISHERS.includes(reference.publisher)) {
    errors.push(`${ruleId}: documentation publisher is not allowed`);
  }

  if (!DOCUMENTATION_SUPPORT_VALUES.includes(reference.support)) {
    errors.push(`${ruleId}: documentation support value is not allowed`);
  }

  const expectedPrefix =
    reference.publisher === "Arc"
      ? "https://docs.arc.io/"
      : "https://developers.circle.com/";

  if (!reference.url.startsWith(expectedPrefix)) {
    errors.push(`${ruleId}: documentation URL does not match its publisher`);
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(reference.verifiedAt)) {
    errors.push(`${ruleId}: documentation verification date is invalid`);
  }

  if (
    reference.title.trim().length === 0 ||
    reference.claim.trim().length === 0
  ) {
    errors.push(`${ruleId}: documentation title and claim are required`);
  }
}
