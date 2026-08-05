import { describe, expect, it } from "vitest";
import { ruleTaxonomyCatalog } from "../core/rules/catalog.js";
import {
  RULE_TAXONOMIES,
  validateRuleMetadata,
  validateRuleMetadataCatalog
} from "../core/rules/taxonomy.js";
import type {
  DocumentationReference,
  RuleMetadata,
  RuleMetadataInput
} from "../core/rules/taxonomy.js";
import * as publicApi from "../src/index.js";
import { appKitRules } from "../rules/app-kit/index.js";
import { bridgeRules } from "../rules/bridge/index.js";
import { walletRules } from "../rules/wallet/index.js";

const knownRules = [...walletRules, ...bridgeRules, ...appKitRules];

describe("internal rule taxonomy catalog", () => {
  it("matches all 19 known rule inventory IDs exactly once", () => {
    const catalogIds = ruleTaxonomyCatalog.map((metadata) => metadata.id);
    const knownIds = knownRules.map((rule) => rule.id);

    expect(catalogIds).toHaveLength(19);
    expect(new Set(catalogIds).size).toBe(19);
    expect([...catalogIds].sort()).toEqual([...knownIds].sort());
  });

  it("uses deterministic rule-ID order", () => {
    const catalogIds = ruleTaxonomyCatalog.map((metadata) => metadata.id);

    expect(catalogIds).toEqual([...catalogIds].sort());
  });

  it("has the approved classification totals", () => {
    const totals = Object.fromEntries(
      RULE_TAXONOMIES.map((taxonomy) => [taxonomy, 0])
    );

    for (const metadata of ruleTaxonomyCatalog) {
      totals[metadata.taxonomy] += 1;
    }

    expect(totals).toEqual({
      "stable-compatibility": 0,
      "experimental-compatibility": 12,
      advice: 5,
      "needs-research": 0,
      "remove-or-replace": 2
    });
  });

  it("recommends no current rule for CI-failure eligibility", () => {
    expect(
      ruleTaxonomyCatalog.every(
        (metadata) => !metadata.recommendedCiFailureEligible
      )
    ).toBe(true);
  });

  it("deprecates both remove-or-replace rules with replacement direction", () => {
    const removedRules = ruleTaxonomyCatalog.filter(
      (metadata) => metadata.taxonomy === "remove-or-replace"
    );

    expect(removedRules.map((metadata) => metadata.id)).toEqual([
      "app-kit/APPKIT_BRIDGE_MIN_AMOUNT_NOTE",
      "app-kit/APPKIT_CAPABILITY_SUPPORTED"
    ]);
    expect(
      removedRules.every(
        (metadata) =>
          metadata.deprecated &&
          metadata.maturity === "deprecated" &&
          metadata.replacement.trim().length > 0
      )
    ).toBe(true);
  });

  it("satisfies all metadata and provenance invariants", () => {
    expect(validateRuleMetadataCatalog(ruleTaxonomyCatalog)).toEqual([]);
  });

  it("rejects invalid taxonomy combinations", () => {
    const experimental = findMetadata("wallet/ARC_CHAIN_METADATA");
    const advice = findMetadata("wallet/ONE_CONFIRMATION_FINAL");
    const removed = findMetadata("app-kit/APPKIT_CAPABILITY_SUPPORTED");

    expect(
      validateRuleMetadata({
        ...experimental,
        recommendedCiFailureEligible: true
      } as unknown as RuleMetadataInput)
    ).toEqual([
      "wallet/ARC_CHAIN_METADATA: only stable compatibility rules may be recommended for CI failure"
    ]);

    expect(
      validateRuleMetadata({
        ...advice,
        impact: "required-change"
      } as unknown as RuleMetadataInput)
    ).toContain(
      "wallet/ONE_CONFIRMATION_FINAL: advice must use recommendation impact"
    );

    expect(
      validateRuleMetadata({
        ...advice,
        recommendedDefaultEnabled: true
      } as unknown as RuleMetadataInput)
    ).toContain(
      "wallet/ONE_CONFIRMATION_FINAL: advice rules must be recommended disabled"
    );

    expect(
      validateRuleMetadata({
        ...experimental,
        replacement: "Replace this experimental detector."
      } as unknown as RuleMetadataInput)
    ).toContain(
      "wallet/ARC_CHAIN_METADATA: replacement metadata is only valid for remove-or-replace rules"
    );

    expect(
      validateRuleMetadata({
        ...experimental,
        taxonomy: "stable-compatibility",
        defaultConfidence: "medium",
        maturity: "prototype"
      } as unknown as RuleMetadataInput)
    ).toEqual(
      expect.arrayContaining([
        "wallet/ARC_CHAIN_METADATA: stable compatibility requires high confidence",
        "wallet/ARC_CHAIN_METADATA: stable compatibility requires validated maturity"
      ])
    );

    expect(
      validateRuleMetadata({
        ...removed,
        replacement: undefined
      } as unknown as RuleMetadataInput)
    ).toContain(
      "app-kit/APPKIT_CAPABILITY_SUPPORTED: removed rules require replacement direction or a no-replacement reason"
    );
  });

  it("requires advice deprecation and maturity to agree", () => {
    const activeAdvice = findMetadata("wallet/ONE_CONFIRMATION_FINAL");
    const deprecatedAdvice = findMetadata("bridge/ATTESTATION_404_NOT_FATAL");

    expect(
      validateRuleMetadata({
        ...activeAdvice,
        maturity: "deprecated"
      } as unknown as RuleMetadataInput)
    ).toContain(
      "wallet/ONE_CONFIRMATION_FINAL: advice deprecation and maturity must agree"
    );

    expect(
      validateRuleMetadata({
        ...deprecatedAdvice,
        maturity: "prototype"
      } as unknown as RuleMetadataInput)
    ).toContain(
      "bridge/ATTESTATION_404_NOT_FATAL: advice deprecation and maturity must agree"
    );
  });
  it("uses only official, dated documentation references", () => {
    const references: DocumentationReference[] = [];
    for (const metadata of ruleTaxonomyCatalog) {
      references.push(...metadata.documentation);
    }

    expect(references.length).toBeGreaterThanOrEqual(
      ruleTaxonomyCatalog.length
    );
    for (const reference of references) {
      expect(reference.verifiedAt).toBe("2026-07-20");
      expect(["Arc", "Circle"]).toContain(reference.publisher);
      expect(
        reference.url.startsWith("https://docs.arc.io/") ||
          reference.url.startsWith("https://developers.circle.com/")
      ).toBe(true);
    }
  });

  it("locks the reviewed deprecated-advice attestation classification", () => {
    const attestation = findMetadata("bridge/ATTESTATION_404_NOT_FATAL");

    expect(attestation).toMatchObject({
      taxonomy: "advice",
      impact: "recommendation",
      defaultConfidence: "low",
      maturity: "deprecated",
      recommendedDefaultEnabled: false,
      recommendedCiFailureEligible: false,
      deprecated: true
    });
    expect(attestation.rulePacks).toEqual(
      expect.arrayContaining(["bridge-cctp", "indexer-infrastructure"])
    );
  });
  it("does not expose taxonomy metadata through the public package API", () => {
    expect("ruleTaxonomyCatalog" in publicApi).toBe(false);
    expect("validateRuleMetadata" in publicApi).toBe(false);
    expect("validateRuleMetadataCatalog" in publicApi).toBe(false);
  });
});

function findMetadata(id: string): RuleMetadata {
  const metadata = ruleTaxonomyCatalog.find((entry) => entry.id === id);

  if (!metadata) {
    throw new Error(`Missing rule metadata for ${id}`);
  }

  return metadata;
}
