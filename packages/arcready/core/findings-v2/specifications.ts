import { isDeepStrictEqual } from "node:util";
import {
  defineLegacyRuleV2,
  type RuleDefinitionV2
} from "../contracts/v2/index.js";
import { validateRuleDefinitionV2 } from "../contracts/v2/validate.js";
import { ruleTaxonomyCatalog } from "../rules/catalog.js";
import type { RuleMetadata } from "../rules/taxonomy.js";
import {
  cctpDomain26Rule,
  noWrappedUsdcOnArcRule
} from "../../rules/bridge/index.js";
import type { Rule } from "../rules/index.js";

export type SupportedFindingV2AdapterRuleId =
  | "bridge/CCTP_DOMAIN_26"
  | "bridge/NO_WRAPPED_USDC_ON_ARC";

export interface PatternFindingV2AdapterSpecification {
  readonly ruleId: SupportedFindingV2AdapterRuleId;
  readonly definition: Readonly<RuleDefinitionV2>;
  readonly confidenceReason: string;
  readonly patternId: string;
  readonly detectorDiscriminator: string;
  readonly remediationSummary: string;
}

interface AdapterSemantics {
  readonly rule: Rule;
  readonly confidenceReason: string;
  readonly patternId: string;
  readonly detectorDiscriminator: string;
  readonly remediationSummary: string;
}

const MAX_IDENTIFIER_LENGTH = 256;
const MAX_CONFIDENCE_REASON_LENGTH = 2_048;
const MAX_REMEDIATION_SUMMARY_LENGTH = 4_096;

export function getFindingV2AdapterSpecification(
  ruleId: SupportedFindingV2AdapterRuleId
): PatternFindingV2AdapterSpecification {
  const specification = buildApprovedSpecification(ruleId);

  validatePatternFindingV2AdapterSpecification(specification);
  return specification;
}

function buildApprovedSpecification(
  ruleId: SupportedFindingV2AdapterRuleId
): PatternFindingV2AdapterSpecification {
  const semantics = getAdapterSemantics(ruleId);
  const metadata = findCatalogMetadata(ruleId);
  return {
    ruleId,
    definition: defineLegacyRuleV2(semantics.rule, metadata, {
      engines: ["text-pattern"],
      supportedExtensions: [
        ".js",
        ".json",
        ".jsx",
        ".md",
        ".mdx",
        ".sol",
        ".ts",
        ".tsx",
        ".yaml",
        ".yml"
      ],
      locationPrecision: "file",
      parserRequirements: []
    }),
    confidenceReason: semantics.confidenceReason,
    patternId: semantics.patternId,
    detectorDiscriminator: semantics.detectorDiscriminator,
    remediationSummary: semantics.remediationSummary
  };
}

export function validatePatternFindingV2AdapterSpecification(
  value: unknown
): asserts value is PatternFindingV2AdapterSpecification {
  assertPlainRecord(value, "FindingV2 adapter specification");
  assertOnlyKeys(
    value,
    [
      "ruleId",
      "definition",
      "confidenceReason",
      "patternId",
      "detectorDiscriminator",
      "remediationSummary"
    ],
    "FindingV2 adapter specification"
  );
  if (!isSupportedRuleId(value.ruleId)) {
    throw new TypeError("FindingV2 adapter rule ID is unsupported");
  }

  validateRuleDefinitionV2(value.definition);
  if (
    value.definition.rule.id !== value.ruleId ||
    value.definition.metadata.id !== value.ruleId
  ) {
    throw new TypeError("FindingV2 adapter rule ID must match its definition");
  }
  if (
    value.definition.metadata.taxonomy === "needs-research" ||
    value.definition.metadata.taxonomy === "remove-or-replace"
  ) {
    throw new TypeError("FindingV2 adapter taxonomy is unsupported");
  }
  if (value.definition.metadata.defaultConfidence !== "medium") {
    throw new TypeError("Selected FindingV2 adapter rules require medium confidence");
  }
  if (value.definition.metadata.documentation.length === 0) {
    throw new TypeError("FindingV2 adapter documentation is required");
  }
  for (const reference of value.definition.metadata.documentation) {
    let url: URL;
    try {
      url = new URL(reference.url);
    } catch {
      throw new TypeError("FindingV2 adapter documentation URL must be absolute");
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new TypeError("FindingV2 adapter documentation URL must use HTTP or HTTPS");
    }
  }

  assertTrimmedBoundedString(
    value.patternId,
    "FindingV2 adapter pattern ID",
    MAX_IDENTIFIER_LENGTH
  );
  assertTrimmedBoundedString(
    value.detectorDiscriminator,
    "FindingV2 adapter detector discriminator",
    MAX_IDENTIFIER_LENGTH
  );
  assertTrimmedBoundedString(
    value.confidenceReason,
    "FindingV2 adapter confidence reason",
    MAX_CONFIDENCE_REASON_LENGTH
  );
  assertTrimmedBoundedString(
    value.remediationSummary,
    "FindingV2 adapter remediation summary",
    MAX_REMEDIATION_SUMMARY_LENGTH
  );

  const approved = buildApprovedSpecification(value.ruleId);
  if (
    value.definition.rule !== approved.definition.rule ||
    !isDeepStrictEqual(
      createComparableDefinition(value.definition),
      createComparableDefinition(approved.definition)
    ) ||
    value.patternId !== approved.patternId ||
    value.detectorDiscriminator !== approved.detectorDiscriminator ||
    value.confidenceReason !== approved.confidenceReason ||
    value.remediationSummary !== approved.remediationSummary
  ) {
    throw new TypeError("FindingV2 adapter specification is not approved");
  }
}

function createComparableDefinition(definition: Readonly<RuleDefinitionV2>) {
  return {
    contractVersion: definition.contractVersion,
    rule: {
      id: definition.rule.id,
      name: definition.rule.name,
      description: definition.rule.description,
      preset: definition.rule.preset,
      defaultSeverity: definition.rule.defaultSeverity,
      docs: definition.rule.docs
    },
    metadata: definition.metadata,
    capabilities: definition.capabilities
  };
}

function getAdapterSemantics(
  ruleId: SupportedFindingV2AdapterRuleId
): AdapterSemantics {
  switch (ruleId) {
    case "bridge/CCTP_DOMAIN_26":
      return {
        rule: cctpDomain26Rule,
        patternId: "bridge.cctp-domain.non-26",
        detectorDiscriminator: "cctp-domain-non-26",
        confidenceReason:
          "Text-pattern detection finds an Arc-associated non-26 domain candidate in a CCTP-related file but does not resolve computed maps or distinguish every Arc numeric property.",
        remediationSummary:
          "Check the CCTP domain map and set the Arc domain value to 26 wherever Arc routes are configured."
      };
    case "bridge/NO_WRAPPED_USDC_ON_ARC":
      return {
        rule: noWrappedUsdcOnArcRule,
        patternId: "bridge.wrapped-usdc.arc-route",
        detectorDiscriminator: "wrapped-usdc-arc-route",
        confidenceReason:
          "Text-pattern detection finds wrapped-USDC terminology in an Arc bridge-related file but cannot prove destination-chain deployment or exclude multichain source context.",
        remediationSummary:
          "Use canonical Arc USDC through the intended bridge route, and remove Arc-side USDC.e, wUSDC, or bridged-USDC asset mappings."
      };
    default:
      throw new TypeError("FindingV2 adapter rule ID is unsupported");
  }
}

function findCatalogMetadata(ruleId: SupportedFindingV2AdapterRuleId): RuleMetadata {
  const metadata = ruleTaxonomyCatalog.find((entry) => entry.id === ruleId);
  if (metadata === undefined) {
    throw new TypeError(`Missing approved catalog metadata for ${ruleId}`);
  }
  return metadata;
}

function isSupportedRuleId(
  value: unknown
): value is SupportedFindingV2AdapterRuleId {
  return (
    value === "bridge/CCTP_DOMAIN_26" ||
    value === "bridge/NO_WRAPPED_USDC_ON_ARC"
  );
}

function assertTrimmedBoundedString(
  value: unknown,
  label: string,
  maximumLength: number
): asserts value is string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value !== value.trim() ||
    value.length > maximumLength ||
    containsControlCharacter(value)
  ) {
    throw new TypeError(`${label} must be a safe non-empty bounded string`);
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
