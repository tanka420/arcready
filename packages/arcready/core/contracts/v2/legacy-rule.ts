import type { Rule } from "../../rules/index.js";
import type { RuleMetadata } from "../../rules/taxonomy.js";
import {
  ARCREADY_CONTRACT_VERSION,
  ContractV2ValidationError,
  type AnalysisEngineV2,
  type RuleCapabilitiesV2,
  type RuleDefinitionV2
} from "./model.js";
import {
  validateRuleCapabilitiesV2,
  validateRuleDefinitionV2
} from "./validate.js";

export function defineLegacyRuleV2(
  rule: Rule,
  metadata: RuleMetadata,
  capabilities: RuleCapabilitiesV2
): RuleDefinitionV2 {
  const normalizedCapabilities = normalizeCapabilities(capabilities);
  const definition: RuleDefinitionV2 = {
    contractVersion: ARCREADY_CONTRACT_VERSION,
    rule,
    metadata,
    capabilities: normalizedCapabilities
  };

  validateRuleDefinitionV2(definition);
  return definition;
}

function normalizeCapabilities(
  capabilities: RuleCapabilitiesV2
): RuleCapabilitiesV2 {
  if (typeof capabilities !== "object" || capabilities === null) {
    fail("RuleCapabilitiesV2 must be an object");
  }
  const unknownKey = Object.keys(capabilities).find(
    (key) =>
      ![
        "engines",
        "supportedExtensions",
        "locationPrecision",
        "parserRequirements"
      ].includes(key)
  );
  if (unknownKey !== undefined) {
    fail(`RuleCapabilitiesV2 contains unsupported field "${unknownKey}"`);
  }
  if (
    !Array.isArray(capabilities.engines) ||
    !Array.isArray(capabilities.supportedExtensions) ||
    !Array.isArray(capabilities.parserRequirements)
  ) {
    fail("RuleCapabilitiesV2 list fields must be arrays");
  }

  rejectDuplicates(capabilities.engines, "RuleCapabilitiesV2 engines");
  rejectDuplicates(
    capabilities.supportedExtensions,
    "RuleCapabilitiesV2 supportedExtensions"
  );
  rejectDuplicates(
    capabilities.parserRequirements,
    "RuleCapabilitiesV2 parserRequirements"
  );

  const normalized: RuleCapabilitiesV2 = {
    engines: [...capabilities.engines].sort() as AnalysisEngineV2[],
    supportedExtensions: [...capabilities.supportedExtensions].sort(),
    locationPrecision: capabilities.locationPrecision,
    parserRequirements: [...capabilities.parserRequirements].sort()
  };
  validateRuleCapabilitiesV2(normalized);
  return normalized;
}

function rejectDuplicates(values: readonly unknown[], label: string): void {
  if (new Set(values).size !== values.length) {
    fail(`${label} must not contain duplicates`);
  }
}

function fail(message: string): never {
  throw new ContractV2ValidationError(message);
}
