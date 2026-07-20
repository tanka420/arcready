import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  ARCREADY_CONTRACT_VERSION,
  ContractV2ValidationError,
  EXACT_LOCATION_FINGERPRINT_SCHEME,
  MAX_CONTRACT_V2_EXCERPT_LENGTH,
  MAX_DETECTOR_DISCRIMINATOR_LENGTH,
  PROJECT_LEVEL_FINGERPRINT_MARKER,
  createExactFindingFingerprint,
  defineLegacyRuleV2,
  normalizeRepositoryRelativePath,
  validateExactFindingFingerprintInput,
  validateFindingEvidenceV2,
  validateFindingV2,
  validateRuleCapabilitiesV2,
  validateRuleDefinitionV2,
  validateScanDiagnosticV2,
  validateSourceLocationV2,
  validateSourcePositionV2,
  validateSourceRegionV2
} from "../core/contracts/v2/index.js";
import type {
  ExactFindingFingerprintInputV1,
  FindingEvidenceV2,
  FindingV2,
  RuleCapabilitiesV2,
  ScanDiagnosticV2,
  SourceLocationV2
} from "../core/contracts/v2/index.js";
import { ruleTaxonomyCatalog } from "../core/rules/catalog.js";
import type { Rule } from "../core/rules/index.js";
import type { RuleMetadata } from "../core/rules/taxonomy.js";
import { appKitRules } from "../rules/app-kit/index.js";
import { arcChainMetadataRule } from "../rules/wallet/index.js";
import { jsonReporter } from "../reporters/json/index.js";
import * as publicApi from "../src/index.js";

describe("Contract v2 version and source locations", () => {
  it("uses the literal contract version 2.0", () => {
    expect(ARCREADY_CONTRACT_VERSION).toBe("2.0");
  });

  it("normalizes Windows and POSIX separators identically", () => {
    expect(normalizeRepositoryRelativePath("src\\wallet\\fee.ts")).toBe(
      normalizeRepositoryRelativePath("src/wallet/fee.ts")
    );
  });

  it("removes leading and embedded harmless dot segments", () => {
    expect(normalizeRepositoryRelativePath("./src/./wallet/fee.ts")).toBe(
      "src/wallet/fee.ts"
    );
  });

  it("preserves path case and Unicode", () => {
    expect(normalizeRepositoryRelativePath("Src/Arc-Δ/Phí.ts")).toBe(
      "Src/Arc-Δ/Phí.ts"
    );
  });

  it.each([
    ["empty", ""],
    ["dot-only", "././"],
    ["POSIX absolute", "/repo/src/a.ts"],
    ["Windows drive", "C:\\repo\\src\\a.ts"],
    ["UNC", "\\\\server\\share\\a.ts"],
    ["HTTP URL", "https://example.com/a.ts"],
    ["file URL", "file:///repo/a.ts"],
    ["NUL", "src/a\0.ts"],
    ["tab", "src/a\t.ts"],
    ["newline", "src/a\n.ts"],
    ["carriage return", "src/a\r.ts"],
    ["DEL", "src/a\u007f.ts"]
  ])("rejects %s paths", (_label, input) => {
    expect(() => normalizeRepositoryRelativePath(input)).toThrow(
      ContractV2ValidationError
    );
  });

  it.each(["../a.ts", "a/../b.ts", "a/..", "./../a.ts", "a\\..\\b.ts"])(
    "rejects every parent traversal segment in %s",
    (input) => {
      expect(() => normalizeRepositoryRelativePath(input)).toThrow(
        /parent traversal/
      );
    }
  );

  it("requires one-based positive lines and columns", () => {
    expect(() => validateSourcePositionV2({ line: 1, column: 1 })).not.toThrow();
    expect(() => validateSourcePositionV2({ line: 0, column: 1 })).toThrow(
      /one-based/
    );
    expect(() => validateSourcePositionV2({ line: 1, column: -1 })).toThrow(
      /one-based/
    );
  });

  it("accepts file-level locations without regions", () => {
    expect(() => validateSourceLocationV2({ path: "src/a.ts" })).not.toThrow();
  });

  it("accepts equal region bounds and a missing end", () => {
    expect(() =>
      validateSourceRegionV2({
        start: { line: 2, column: 3 },
        end: { line: 2, column: 3 }
      })
    ).not.toThrow();
    expect(() =>
      validateSourceRegionV2({ start: { line: 2, column: 3 } })
    ).not.toThrow();
  });

  it("rejects region ends before their starts", () => {
    expect(() =>
      validateSourceRegionV2({
        start: { line: 3, column: 4 },
        end: { line: 3, column: 3 }
      })
    ).toThrow(/must not precede/);
    expect(() =>
      validateSourceRegionV2({
        start: { line: 3, column: 1 },
        end: { line: 2, column: 99 }
      })
    ).toThrow(/must not precede/);
  });

  it("requires stored source locations to use normalized paths", () => {
    expect(() => validateSourceLocationV2({ path: "src\\a.ts" })).toThrow(
      /already be normalized/
    );
  });
});

describe("Contract v2 exact-location fingerprints", () => {
  const baseInput: ExactFindingFingerprintInputV1 = {
    ruleId: "wallet/ARC_CHAIN_METADATA",
    primaryLocation: {
      path: "src/wallet.ts",
      region: {
        start: { line: 4, column: 2 },
        end: { line: 4, column: 9 }
      }
    },
    detectorDiscriminator: "native-currency.symbol"
  };

  it("is deterministic and produces a lowercase SHA-256 digest", () => {
    const first = createExactFindingFingerprint(baseInput);
    const second = createExactFindingFingerprint(baseInput);

    expect(first).toEqual(second);
    expect(first).toMatchObject({
      scheme: EXACT_LOCATION_FINGERPRINT_SCHEME,
      algorithm: "sha256",
      stability: "exact"
    });
    expect(first.value).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(first.value).toBe(
      "sha256:3623827971a5e83b4d5366e0a23c6408b0f3d1fca1547ec778238f07e51a51f1"
    );
  });

  it("normalizes equivalent Windows and POSIX paths before hashing", () => {
    const windows = createExactFindingFingerprint({
      ...baseInput,
      primaryLocation: { ...baseInput.primaryLocation!, path: "src\\wallet.ts" }
    });
    const posix = createExactFindingFingerprint(baseInput);

    expect(windows).toEqual(posix);
  });

  it("does not accept message or title as fingerprint inputs", () => {
    expect(() =>
      validateExactFindingFingerprintInput({
        ...baseInput,
        message: "wording changed"
      })
    ).toThrow(/unsupported field "message"/);
    expect(createExactFindingFingerprint(baseInput)).toEqual(
      createExactFindingFingerprint({ ...baseInput })
    );
  });

  it.each([
    ["rule ID", { ruleId: "wallet/OTHER" }],
    [
      "path",
      { primaryLocation: { ...baseInput.primaryLocation!, path: "src/other.ts" } }
    ],
    [
      "region",
      {
        primaryLocation: {
          ...baseInput.primaryLocation!,
          region: {
            start: { line: 5, column: 2 },
            end: { line: 5, column: 9 }
          }
        }
      }
    ],
    ["discriminator", { detectorDiscriminator: "native-currency.name" }]
  ])("changes when the %s changes", (_label, change) => {
    expect(createExactFindingFingerprint({ ...baseInput, ...change })).not.toEqual(
      createExactFindingFingerprint(baseInput)
    );
  });

  it("uses the stable project-level marker in the canonical array", () => {
    const input = {
      ruleId: "project/CONFIGURATION",
      detectorDiscriminator: "missing-config"
    };
    const expectedDigest = createHash("sha256")
      .update(
        JSON.stringify([
          EXACT_LOCATION_FINGERPRINT_SCHEME,
          input.ruleId,
          PROJECT_LEVEL_FINGERPRINT_MARKER,
          0,
          0,
          0,
          0,
          input.detectorDiscriminator
        ]),
        "utf8"
      )
      .digest("hex");

    expect(createExactFindingFingerprint(input).value).toBe(
      `sha256:${expectedDigest}`
    );
  });

  it("does not expose source excerpts or absolute roots in its output", () => {
    const serialized = JSON.stringify(createExactFindingFingerprint(baseInput));

    expect(serialized).not.toContain("nativeCurrency");
    expect(serialized).not.toContain("C:\\repo");
    expect(serialized).not.toContain("src/wallet.ts");
  });

  it.each([
    ["empty", "   "],
    ["oversized", "x".repeat(MAX_DETECTOR_DISCRIMINATOR_LENGTH + 1)],
    ["control-character", "detector\ninstance"],
    ["trailing-control-character", "detector\n"]
  ])("rejects %s discriminators", (_label, detectorDiscriminator) => {
    expect(() =>
      createExactFindingFingerprint({ ...baseInput, detectorDiscriminator })
    ).toThrow(ContractV2ValidationError);
  });

  it.each([
    ["newline", "wallet/ARC_CHAIN\nMETADATA"],
    ["tab", "wallet/ARC_CHAIN\tMETADATA"],
    ["DEL", "wallet/ARC_CHAIN\u007fMETADATA"]
  ])("rejects fingerprint rule IDs containing %s", (_label, ruleId) => {
    expect(() =>
      createExactFindingFingerprint({ ...baseInput, ruleId })
    ).toThrow(/fingerprint ruleId must not contain control characters/);
  });
});

describe("FindingV2 validation", () => {
  it("accepts valid findings with at least one evidence item", () => {
    expect(() => validateFindingV2(createFinding(regionLocation))).not.toThrow();
    expect(() =>
      validateFindingV2(createFinding({ path: "src/wallet.ts" }))
    ).not.toThrow();
  });

  it("accepts project-level findings when they contain evidence", () => {
    expect(() => validateFindingV2(createFinding())).not.toThrow();
  });

  it("rejects findings with an empty evidence array", () => {
    expect(() =>
      validateFindingV2({ ...createFinding(), evidence: [] })
    ).toThrow(/FindingV2 evidence must contain at least one item/);
  });

  it("requires a confidence reason", () => {
    const finding = createFinding();
    expect(() =>
      validateFindingV2({
        ...finding,
        confidence: { ...finding.confidence, reason: "" }
      })
    ).toThrow(/confidence reason/);
  });

  it("enforces approved taxonomy and impact invariants", () => {
    const finding = createFinding();
    expect(() =>
      validateFindingV2({
        ...finding,
        classification: {
          ...finding.classification,
          taxonomy: "advice",
          impact: "blocker"
        }
      })
    ).toThrow(/advice findings require recommendation impact/);
  });

  it.each([
    [
      "stable compatibility",
      {
        taxonomy: "stable-compatibility",
        impact: "blocker",
        maturity: "validated"
      }
    ],
    [
      "experimental compatibility",
      {
        taxonomy: "experimental-compatibility",
        impact: "required-change",
        maturity: "prototype"
      }
    ],
    [
      "advice",
      { taxonomy: "advice", impact: "recommendation", maturity: "validated" }
    ]
  ])("accepts a valid %s classification", (_label, classification) => {
    const finding = createFinding();
    expect(() =>
      validateFindingV2({
        ...finding,
        classification: { ...finding.classification, ...classification }
      })
    ).not.toThrow();
  });

  it.each([
    [
      "needs-research",
      {
        taxonomy: "needs-research",
        impact: "not-applicable-until-researched",
        maturity: "prototype"
      }
    ],
    [
      "remove-or-replace",
      {
        taxonomy: "remove-or-replace",
        impact: "not-applicable-until-researched",
        maturity: "deprecated"
      }
    ]
  ])("rejects %s as a FindingV2 taxonomy", (_label, classification) => {
    const finding = createFinding();
    expect(() =>
      validateFindingV2({
        ...finding,
        classification: { ...finding.classification, ...classification }
      })
    ).toThrow(
      /FindingV2 classification taxonomy cannot produce compatibility findings/
    );
  });

  it.each<FindingEvidenceV2>([
    {
      kind: "observed-value",
      name: "chainId",
      observed: 1,
      expected: 5042002,
      location: regionLocation
    },
    {
      kind: "pattern-match",
      patternId: "arc-chain.invalid-id",
      excerpt: "chainId: 1",
      location: regionLocation
    },
    {
      kind: "configuration",
      key: "chain.id",
      observed: 1,
      expected: 5042002
    },
    {
      kind: "assumption",
      statement: "This object configures Arc.",
      basis: "The enclosing chain name is Arc."
    }
  ])("accepts evidence kind $kind", (evidence) => {
    expect(() => validateFindingEvidenceV2(evidence)).not.toThrow();
  });

  it("rejects arbitrary evidence kinds and debug properties", () => {
    expect(() =>
      validateFindingEvidenceV2({ kind: "debug-data", value: {} })
    ).toThrow(/kind is unsupported/);
    expect(() =>
      validateFindingEvidenceV2({
        kind: "pattern-match",
        patternId: "chain-id",
        debugData: { rawRegex: ".*" }
      })
    ).toThrow(/unsupported field/);
  });

  it("rejects oversized excerpts", () => {
    expect(() =>
      validateFindingEvidenceV2({
        kind: "pattern-match",
        patternId: "chain-id",
        excerpt: "x".repeat(MAX_CONTRACT_V2_EXCERPT_LENGTH + 1)
      })
    ).toThrow(/excerpt must not exceed/);
  });

  it("rejects legacy severity, score, and arbitrary finding fields", () => {
    expect(() =>
      validateFindingV2({ ...createFinding(), severity: "critical" })
    ).toThrow(/unsupported field "severity"/);
    expect(() => validateFindingV2({ ...createFinding(), score: 0 })).toThrow(
      /unsupported field "score"/
    );
  });
});

describe("ScanDiagnosticV2 validation", () => {
  it("accepts a valid rule-execution diagnostic", () => {
    expect(() => validateScanDiagnosticV2(createDiagnostic())).not.toThrow();
  });

  it.each([
    ["code", { code: "" }],
    ["message", { message: "" }],
    ["category", { category: "finding" }],
    ["phase", { phase: "execution" }],
    ["origin", { origin: "network" }]
  ])("rejects an invalid %s", (_label, change) => {
    expect(() => validateScanDiagnosticV2({ ...createDiagnostic(), ...change })).toThrow(
      ContractV2ValidationError
    );
  });

  it("validates diagnostic locations", () => {
    expect(() =>
      validateScanDiagnosticV2({
        ...createDiagnostic(),
        location: { path: "/absolute.ts" }
      })
    ).toThrow(/repository-relative/);
  });

  it("does not treat diagnostics as findings", () => {
    expect(() => validateFindingV2(createDiagnostic())).toThrow(
      ContractV2ValidationError
    );
  });
});

describe("RuleDefinitionV2", () => {
  const metadata = findMetadata(arcChainMetadataRule.id);
  const capabilities: RuleCapabilitiesV2 = {
    engines: ["text-pattern"],
    supportedExtensions: [".tsx", ".ts"],
    locationPrecision: "region",
    parserRequirements: ["typescript-source"]
  };

  it("wraps a matching legacy rule and normalizes capability order", () => {
    const definition = defineLegacyRuleV2(
      arcChainMetadataRule,
      metadata,
      capabilities
    );

    expect(definition.contractVersion).toBe("2.0");
    expect(definition.rule).toBe(arcChainMetadataRule);
    expect(definition.metadata).toBe(metadata);
    expect(definition.capabilities.supportedExtensions).toEqual([".ts", ".tsx"]);
    expect(() => validateRuleDefinitionV2(definition)).not.toThrow();
  });

  it("rejects rule and metadata ID mismatch", () => {
    const mismatchedRule: Rule = { ...arcChainMetadataRule, id: "wallet/OTHER" };
    expect(() => defineLegacyRuleV2(mismatchedRule, metadata, capabilities)).toThrow(
      /rule id must equal metadata id/
    );
  });

  it("rejects rule preset and metadata category mismatch", () => {
    const mismatchedRule: Rule = { ...arcChainMetadataRule, preset: "bridge" };
    expect(() => defineLegacyRuleV2(mismatchedRule, metadata, capabilities)).toThrow(
      /rule preset must equal metadata category/
    );
  });

  it("rejects an empty engine list", () => {
    expect(() =>
      defineLegacyRuleV2(arcChainMetadataRule, metadata, {
        ...capabilities,
        engines: []
      })
    ).toThrow(/at least one analysis engine/);
  });

  it.each([
    ["uppercase", [".TS"]],
    ["missing dot", ["ts"]],
    ["duplicate", [".ts", ".ts"]]
  ])("rejects %s extensions", (_label, supportedExtensions) => {
    expect(() =>
      defineLegacyRuleV2(arcChainMetadataRule, metadata, {
        ...capabilities,
        supportedExtensions
      })
    ).toThrow(ContractV2ValidationError);
  });

  it("does not mutate Rule, metadata, or capabilities inputs", () => {
    const ruleSnapshot = { ...arcChainMetadataRule, docs: [...arcChainMetadataRule.docs] };
    const metadataSnapshot = JSON.stringify(metadata);
    const capabilitiesSnapshot = JSON.stringify(capabilities);

    defineLegacyRuleV2(arcChainMetadataRule, metadata, capabilities);

    expect(arcChainMetadataRule).toEqual(ruleSnapshot);
    expect(JSON.stringify(metadata)).toBe(metadataSnapshot);
    expect(JSON.stringify(capabilities)).toBe(capabilitiesSnapshot);
  });

  it("accepts remove-or-replace metadata only with existing invariants intact", () => {
    const removedRule = appKitRules.find(
      (rule) => rule.id === "app-kit/APPKIT_CAPABILITY_SUPPORTED"
    );
    const removedMetadata = findMetadata(
      "app-kit/APPKIT_CAPABILITY_SUPPORTED"
    );
    if (!removedRule) {
      throw new Error("Missing deprecated App Kit rule");
    }

    expect(() =>
      defineLegacyRuleV2(removedRule, removedMetadata, capabilities)
    ).not.toThrow();
    expect(() =>
      defineLegacyRuleV2(
        removedRule,
        { ...removedMetadata, deprecated: false } as unknown as RuleMetadata,
        capabilities
      )
    ).toThrow(/removed rules must be deprecated/);
  });

  it("validates deterministic capabilities when used directly", () => {
    expect(() =>
      validateRuleCapabilitiesV2({
        ...capabilities,
        supportedExtensions: [".tsx", ".ts"]
      })
    ).toThrow(/deterministic lexical order/);
  });
});

describe("Contract v2 boundaries and legacy regression", () => {
  it("does not expose v2 contracts or helpers through the public package API", () => {
    for (const symbol of [
      "ARCREADY_CONTRACT_VERSION",
      "createExactFindingFingerprint",
      "defineLegacyRuleV2",
      "normalizeRepositoryRelativePath",
      "validateFindingV2",
      "validateScanDiagnosticV2"
    ]) {
      expect(symbol in publicApi).toBe(false);
    }
  });

  it("preserves the existing JSON reporter wire shape", () => {
    expect(
      jsonReporter.render({
        project: "fixed-contract-fixture",
        score: 100,
        status: "pass",
        summary: { critical: 0, warning: 0, info: 0 },
        findings: []
      })
    ).toBe(`{
  "project": "fixed-contract-fixture",
  "score": 100,
  "status": "pass",
  "summary": {
    "critical": 0,
    "warning": 0,
    "info": 0
  },
  "findings": []
}
`);
  });
});

const regionLocation: SourceLocationV2 = {
  path: "src/wallet.ts",
  region: {
    start: { line: 4, column: 2 },
    end: { line: 4, column: 9 }
  }
};

function createFinding(primaryLocation?: SourceLocationV2): FindingV2 {
  return {
    ruleId: "wallet/ARC_CHAIN_METADATA",
    title: "Arc chain metadata is incompatible",
    message: "The configured chain ID does not identify Arc Testnet.",
    classification: {
      taxonomy: "experimental-compatibility",
      impact: "blocker",
      category: "wallet",
      maturity: "prototype",
      rulePacks: ["wallet"]
    },
    confidence: {
      level: "medium",
      basis: "detector",
      reason: "The value appears inside the detected Arc chain object."
    },
    primaryLocation,
    relatedLocations: [],
    evidence: [
      {
        kind: "observed-value",
        name: "chainId",
        observed: 1,
        expected: 5042002,
        location: primaryLocation
      }
    ],
    remediation: { summary: "Use the Arc Testnet chain ID." },
    documentation: [
      { title: "Arc network information", url: "https://docs.arc.io/arc/references/network-information" }
    ],
    fingerprints: {
      exact: createExactFindingFingerprint({
        ruleId: "wallet/ARC_CHAIN_METADATA",
        primaryLocation,
        detectorDiscriminator: "chain-id"
      })
    }
  };
}

function createDiagnostic(): ScanDiagnosticV2 {
  return {
    code: "RULE_EXECUTION_FAILED",
    category: "rule-execution-error",
    level: "error",
    phase: "analysis",
    origin: "tool",
    message: "A rule could not complete.",
    recoverable: true,
    ruleId: "wallet/ARC_CHAIN_METADATA",
    location: { path: "src/wallet.ts" }
  };
}

function findMetadata(id: string): RuleMetadata {
  const metadata = ruleTaxonomyCatalog.find((entry) => entry.id === id);
  if (!metadata) {
    throw new Error(`Missing rule metadata for ${id}`);
  }
  return metadata;
}
