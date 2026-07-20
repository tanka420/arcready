import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, expectTypeOf, it } from "vitest";
import {
  createExactFindingFingerprint,
  validateFindingV2,
  validateRuleDefinitionV2,
  validateScanDiagnosticV2,
  type FindingV2,
  type RuleDefinitionV2
} from "../core/contracts/v2/index.js";
import {
  adaptDetectorOccurrenceV2,
  type AdaptableCompletedRuleOccurrenceV2,
  type AdaptDetectorOccurrenceV2Input
} from "../core/findings-v2/adapter.js";
import {
  createRepositoryLocationResolver,
  type SourceLocationResolutionV2
} from "../core/findings-v2/location.js";
import {
  getFindingV2AdapterSpecification,
  validatePatternFindingV2AdapterSpecification,
  type PatternFindingV2AdapterSpecification,
  type SupportedFindingV2AdapterRuleId
} from "../core/findings-v2/specifications.js";
import type { Finding } from "../core/findings/index.js";
import type { FailedRuleOccurrenceExecutionResult } from "../core/rules/execution-result.js";
import {
  executeRulesStructured
} from "../core/rules/instrumentation.js";
import { createRuleContext, type Rule } from "../core/rules/index.js";
import {
  cctpDomain26Rule,
  noWrappedUsdcOnArcRule
} from "../rules/bridge/index.js";
import { DEFAULT_CONFIG } from "../src/index.js";
import * as publicApi from "../src/index.js";

const tempDirs: string[] = [];

const cases = [
  {
    rule: cctpDomain26Rule,
    ruleId: "bridge/CCTP_DOMAIN_26" as const,
    positive:
      "export const ARC_DOMAIN = 6; // Arc CCTP depositForBurn attestation",
    negative:
      "export const ARC_DOMAIN = 26; // Arc CCTP depositForBurn attestation",
    title: "CCTP domain 26",
    taxonomy: "experimental-compatibility",
    impact: "blocker",
    rulePacks: ["bridge-cctp", "core-compatibility"],
    patternId: "bridge.cctp-domain.non-26",
    discriminator: "cctp-domain-non-26",
    confidenceReason:
      "Text-pattern detection finds an Arc-associated non-26 domain candidate in a CCTP-related file but does not resolve computed maps or distinguish every Arc numeric property.",
    remediation:
      "Check the CCTP domain map and set the Arc domain value to 26 wherever Arc routes are configured.",
    documentation: {
      title: "Supported blockchains and domains",
      url: "https://developers.circle.com/cctp/concepts/supported-chains-and-domains"
    }
  },
  {
    rule: noWrappedUsdcOnArcRule,
    ruleId: "bridge/NO_WRAPPED_USDC_ON_ARC" as const,
    positive:
      "export const route = { chain: 'Arc Testnet', bridge: true, token: 'USDC.e' };",
    negative:
      "export const route = { chain: 'Arc Testnet', bridge: true, token: 'USDC' };",
    title: "No wrapped USDC on Arc",
    taxonomy: "experimental-compatibility",
    impact: "required-change",
    rulePacks: ["bridge-cctp"],
    patternId: "bridge.wrapped-usdc.arc-route",
    discriminator: "wrapped-usdc-arc-route",
    confidenceReason:
      "Text-pattern detection finds wrapped-USDC terminology in an Arc bridge-related file but cannot prove destination-chain deployment or exclude multichain source context.",
    remediation:
      "Use canonical Arc USDC through the intended bridge route, and remove Arc-side USDC.e, wUSDC, or bridged-USDC asset mappings.",
    documentation: {
      title: "How to: Add Arc to Your Bridge Protocol",
      url: "https://docs.arc.io/integrate/infrastructure/bridges"
    }
  }
] as const;

afterEach(() => {
  for (const directory of tempDirs.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("FindingV2 adapter specifications", () => {
  it.each(cases)("builds the approved $ruleId specification from catalog metadata", (entry) => {
    const specification = getFindingV2AdapterSpecification(entry.ruleId);

    expect(specification.ruleId).toBe(entry.ruleId);
    expect(specification.definition.rule).toBe(entry.rule);
    expect(specification.definition.rule.name).toBe(entry.title);
    expect(specification.definition.metadata).toMatchObject({
      id: entry.ruleId,
      taxonomy: entry.taxonomy,
      impact: entry.impact,
      category: "bridge",
      maturity: "prototype",
      defaultConfidence: "medium",
      rulePacks: entry.rulePacks
    });
    expect(specification.patternId).toBe(entry.patternId);
    expect(specification.detectorDiscriminator).toBe(entry.discriminator);
    expect(specification.confidenceReason).toBe(entry.confidenceReason);
    expect(specification.remediationSummary).toBe(entry.remediation);
    expect(() => validateRuleDefinitionV2(specification.definition)).not.toThrow();
    expect(() =>
      validatePatternFindingV2AdapterSpecification(specification)
    ).not.toThrow();
  });

  it("rejects every unsupported rule ID", () => {
    expect(() =>
      getFindingV2AdapterSpecification(
        "bridge/BRIDGE_CONFIRMATIONS_ONE" as SupportedFindingV2AdapterRuleId
      )
    ).toThrow(/unsupported/);
  });

  it.each([
    ["patternId", "changed.pattern"],
    ["detectorDiscriminator", "changed-discriminator"],
    ["confidenceReason", "Changed reason"],
    ["remediationSummary", "Changed remediation"]
  ] as const)("rejects an unapproved %s", (field, value) => {
    const specification = getFindingV2AdapterSpecification(
      "bridge/CCTP_DOMAIN_26"
    );

    expect(() =>
      validatePatternFindingV2AdapterSpecification({
        ...specification,
        [field]: value
      })
    ).toThrow(/not approved/);
  });

  it("rejects unsafe specification strings before approval comparison", () => {
    const specification = getFindingV2AdapterSpecification(
      "bridge/CCTP_DOMAIN_26"
    );
    expect(() =>
      validatePatternFindingV2AdapterSpecification({
        ...specification,
        patternId: " bridge.cctp-domain.non-26"
      })
    ).toThrow(/safe non-empty bounded string/);
  });

  it.each([
    {
      name: "FindingV2-compatible taxonomy",
      alter: (definition: RuleDefinitionV2): RuleDefinitionV2 => ({
        ...definition,
        metadata: {
          ...definition.metadata,
          taxonomy: "advice",
          impact: "recommendation",
          recommendedDefaultEnabled: false
        } as unknown as RuleDefinitionV2["metadata"]
      })
    },
    {
      name: "impact",
      alter: (definition: RuleDefinitionV2): RuleDefinitionV2 => ({
        ...definition,
        metadata: {
          ...definition.metadata,
          impact: "required-change"
        } as unknown as RuleDefinitionV2["metadata"]
      })
    },
    {
      name: "rule packs",
      alter: (definition: RuleDefinitionV2): RuleDefinitionV2 => ({
        ...definition,
        metadata: {
          ...definition.metadata,
          rulePacks: ["bridge-cctp"]
        }
      })
    },
    {
      name: "documentation title and URL",
      alter: (definition: RuleDefinitionV2): RuleDefinitionV2 => ({
        ...definition,
        metadata: {
          ...definition.metadata,
          documentation: definition.metadata.documentation.map(
            (reference, index) =>
              index === 0
                ? {
                    ...reference,
                    title: "Different supported domains page",
                    url: "https://developers.circle.com/cctp/concepts/different-page"
                  }
                : reference
          )
        }
      })
    },
    {
      name: "execution capabilities",
      alter: (definition: RuleDefinitionV2): RuleDefinitionV2 => ({
        ...definition,
        capabilities: {
          ...definition.capabilities,
          engines: ["structured-config"]
        }
      })
    }
  ])("rejects structurally valid altered $name", ({ alter }) => {
    const specification = getFindingV2AdapterSpecification(
      "bridge/CCTP_DOMAIN_26"
    );
    const alteredDefinition = alter(specification.definition);
    const alteredSpecification: PatternFindingV2AdapterSpecification = {
      ...specification,
      definition: alteredDefinition
    };

    expect(alteredDefinition.rule).toBe(specification.definition.rule);
    expect(() => validateRuleDefinitionV2(alteredDefinition)).not.toThrow();
    expect(() =>
      validatePatternFindingV2AdapterSpecification(alteredSpecification)
    ).toThrow(/not approved/);
  });

  it("rejects altered valid metadata before adapter location resolution", () => {
    const specification = getFindingV2AdapterSpecification(
      "bridge/CCTP_DOMAIN_26"
    );
    const alteredSpecification: PatternFindingV2AdapterSpecification = {
      ...specification,
      definition: {
        ...specification.definition,
        metadata: {
          ...specification.definition.metadata,
          impact: "required-change"
        } as unknown as RuleDefinitionV2["metadata"]
      }
    };
    let resolverCalled = false;

    expect(() =>
      adaptDetectorOccurrenceV2({
        occurrence: createOccurrence("bridge/CCTP_DOMAIN_26", [
          createLegacyFinding("bridge/CCTP_DOMAIN_26", "src/bridge.ts")
        ]),
        specification: alteredSpecification,
        resolveLocation: () => {
          resolverCalled = true;
          return { status: "resolved", location: { path: "src/bridge.ts" } };
        }
      })
    ).toThrow(/not approved/);
    expect(resolverCalled).toBe(false);
  });
});

describe("cross-platform repository location resolver", () => {
  it.each([
    ["src/bridge.ts", "src/bridge.ts"],
    ["src\\bridge.ts", "src/bridge.ts"],
    ["src//nested///bridge.ts", "src/nested/bridge.ts"],
    ["./src/./bridge.ts", "src/bridge.ts"],
    ["missing/does-not-exist.ts", "missing/does-not-exist.ts"]
  ])("normalizes POSIX-root relative path %s", (input, expected) => {
    expect(createRepositoryLocationResolver("/repo")(input)).toEqual({
      status: "resolved",
      location: { path: expected }
    });
  });

  it.each([
    ["src/bridge.ts", "src/bridge.ts"],
    ["src\\bridge.ts", "src/bridge.ts"],
    ["src\\.\\bridge.ts", "src/bridge.ts"],
    ["C:\\repo\\src\\bridge.ts", "src/bridge.ts"],
    ["c:/repo/src/bridge.ts", "src/bridge.ts"]
  ])("normalizes Windows-root path %s independent of the host", (input, expected) => {
    expect(createRepositoryLocationResolver("C:\\repo")(input)).toEqual({
      status: "resolved",
      location: { path: expected }
    });
  });

  it("normalizes a native absolute path inside a temporary project", () => {
    const projectRoot = createTempProject();
    const absolutePath = join(projectRoot, "src", "bridge.ts");

    expect(createRepositoryLocationResolver(projectRoot)(absolutePath)).toEqual({
      status: "resolved",
      location: { path: "src/bridge.ts" }
    });
  });

  it("rejects a POSIX project-root prefix collision", () => {
    expect(
      createRepositoryLocationResolver("/repo")("/repository/file.ts")
    ).toEqual({
      status: "rejected",
      reason: "outside-project-root"
    });
  });

  it("rejects a Windows project-root prefix collision", () => {
    expect(
      createRepositoryLocationResolver("C:\\repo")(
        "C:\\repository\\file.ts"
      )
    ).toEqual({
      status: "rejected",
      reason: "outside-project-root"
    });
  });

  it("uses case-insensitive Windows containment", () => {
    expect(
      createRepositoryLocationResolver("C:\\Repo")("c:\\repo\\src\\file.ts")
    ).toEqual({
      status: "resolved",
      location: { path: "src/file.ts" }
    });
  });

  it("rejects a Windows project-root-only candidate", () => {
    expect(createRepositoryLocationResolver("C:\\repo")("C:\\repo")).toEqual({
      status: "rejected",
      reason: "unrepresentable"
    });
  });

  it.each([
    ["/outside/file.ts", "outside-project-root"],
    ["C:\\outside\\file.ts", "drive-mismatch"],
    ["D:\\repo\\file.ts", "drive-mismatch"],
    ["C:relative\\file.ts", "drive-mismatch"],
    ["\\relative-to-drive\\file.ts", "drive-mismatch"],
    ["\\\\server\\share\\file.ts", "unrepresentable"],
    ["//server/share/file.ts", "unrepresentable"],
    ["https://example.com/file.ts", "url-like"],
    ["file:///repo/file.ts", "url-like"],
    ["../outside.ts", "parent-traversal"],
    ["..\\outside.ts", "parent-traversal"],
    ["src/../src/file.ts", "parent-traversal"],
    ["", "empty"],
    ["   ", "empty"],
    ["src/\u0000secret.ts", "control-character"],
    ["/repo", "unrepresentable"]
  ] as const)("rejects unsafe POSIX-root input %s as %s", (input, reason) => {
    expect(createRepositoryLocationResolver("/repo")(input)).toEqual({
      status: "rejected",
      reason
    });
  });

  it("rejects POSIX absolute input under a Windows root", () => {
    expect(createRepositoryLocationResolver("C:\\repo")("/repo/file.ts")).toEqual({
      status: "rejected",
      reason: "drive-mismatch"
    });
  });

  it.each(["repo", "C:repo", "https://example.com/repo", "\\\\server\\repo"])(
    "rejects invalid trusted root %s",
    (projectRoot) => {
      expect(() => createRepositoryLocationResolver(projectRoot)).toThrow(
        /projectRoot/
      );
    }
  );

  it("emits a file-level canonical location without a region", () => {
    const resolution = createRepositoryLocationResolver("/repo")(
      "src/bridge.ts"
    );
    expect(resolution.status).toBe("resolved");
    if (resolution.status === "resolved") {
      expect(resolution.location).toEqual({ path: "src/bridge.ts" });
      expect(resolution.location.region).toBeUndefined();
    }
  });
});

describe("real detector FindingV2 adaptation", () => {
  it.each(cases)("adapts a real positive $ruleId detector occurrence", async (entry) => {
    const { projectRoot, occurrence } = await executeRealDetector(
      entry.rule,
      entry.positive
    );
    const result = adaptDetectorOccurrenceV2({
      occurrence,
      specification: getFindingV2AdapterSpecification(entry.ruleId),
      resolveLocation: createRepositoryLocationResolver(projectRoot)
    });

    expect(result.diagnostics).toEqual([]);
    expect(result.findings).toHaveLength(1);
    const finding = result.findings[0];
    expect(finding).toMatchObject({
      ruleId: entry.ruleId,
      title: entry.title,
      classification: {
        taxonomy: entry.taxonomy,
        impact: entry.impact,
        category: "bridge",
        maturity: "prototype",
        rulePacks: entry.rulePacks
      },
      confidence: {
        level: "medium",
        basis: "adapter",
        reason: entry.confidenceReason
      },
      primaryLocation: { path: "src/fixture.ts" },
      relatedLocations: [],
      evidence: [
        {
          kind: "pattern-match",
          patternId: entry.patternId,
          location: { path: "src/fixture.ts" }
        }
      ],
      remediation: { summary: entry.remediation },
      documentation: [entry.documentation]
    });
    expect(finding?.evidence[0]).not.toHaveProperty("excerpt");
    expect(JSON.stringify(finding)).not.toContain(entry.positive);
    expect(() => validateFindingV2(finding)).not.toThrow();
  });

  it.each(cases)("preserves a real negative $ruleId completed occurrence", async (entry) => {
    const { projectRoot, occurrence } = await executeRealDetector(
      entry.rule,
      entry.negative
    );
    const result = adaptDetectorOccurrenceV2({
      occurrence,
      specification: getFindingV2AdapterSpecification(entry.ruleId),
      resolveLocation: createRepositoryLocationResolver(projectRoot)
    });

    expect(occurrence.detectorFindings).toEqual([]);
    expect(result).toEqual({ findings: [], diagnostics: [] });
  });

  it("makes failed fallback occurrences structurally incompatible", () => {
    expectTypeOf<FailedRuleOccurrenceExecutionResult>().not.toMatchTypeOf<
      AdaptableCompletedRuleOccurrenceV2
    >();
  });

  it("does not expose the adapter from the public API", () => {
    expect("adaptDetectorOccurrenceV2" in publicApi).toBe(false);
    expect("getFindingV2AdapterSpecification" in publicApi).toBe(false);
    expect("createRepositoryLocationResolver" in publicApi).toBe(false);
  });
});

describe("fingerprint stability and duplicate handling", () => {
  it("is deterministic across repeated adaptation", () => {
    const first = adaptManual("bridge/CCTP_DOMAIN_26", [
      createLegacyFinding("bridge/CCTP_DOMAIN_26", "src/bridge.ts")
    ]);
    const second = adaptManual("bridge/CCTP_DOMAIN_26", [
      createLegacyFinding("bridge/CCTP_DOMAIN_26", "src/bridge.ts")
    ]);

    expect(first).toEqual(second);
  });

  it("normalizes equivalent path syntax to the same fingerprint", () => {
    const slash = adaptManual("bridge/CCTP_DOMAIN_26", [
      createLegacyFinding("bridge/CCTP_DOMAIN_26", "src/./bridge.ts")
    ]);
    const backslash = adaptManual("bridge/CCTP_DOMAIN_26", [
      createLegacyFinding("bridge/CCTP_DOMAIN_26", "src\\bridge.ts")
    ]);

    expect(exactFingerprint(slash.findings[0])).toBe(
      exactFingerprint(backslash.findings[0])
    );
  });

  it("uses different fingerprints for different files", () => {
    const first = adaptManual("bridge/CCTP_DOMAIN_26", [
      createLegacyFinding("bridge/CCTP_DOMAIN_26", "src/first.ts")
    ]);
    const second = adaptManual("bridge/CCTP_DOMAIN_26", [
      createLegacyFinding("bridge/CCTP_DOMAIN_26", "src/second.ts")
    ]);

    expect(exactFingerprint(first.findings[0])).not.toBe(
      exactFingerprint(second.findings[0])
    );
  });

  it("uses different fingerprints for selected rules on the same file", () => {
    const cctp = adaptManual("bridge/CCTP_DOMAIN_26", [
      createLegacyFinding("bridge/CCTP_DOMAIN_26", "src/bridge.ts")
    ]);
    const wrapped = adaptManual("bridge/NO_WRAPPED_USDC_ON_ARC", [
      createLegacyFinding("bridge/NO_WRAPPED_USDC_ON_ARC", "src/bridge.ts")
    ]);

    expect(exactFingerprint(cctp.findings[0])).not.toBe(
      exactFingerprint(wrapped.findings[0])
    );
  });

  it("does not use legacy message or severity in the fingerprint", () => {
    const original = createLegacyFinding(
      "bridge/CCTP_DOMAIN_26",
      "src/bridge.ts"
    );
    const changed = { ...original, message: "Changed display text", severity: "info" as const };
    const first = adaptManual("bridge/CCTP_DOMAIN_26", [original]);
    const second = adaptManual("bridge/CCTP_DOMAIN_26", [changed]);

    expect(exactFingerprint(first.findings[0])).toBe(
      exactFingerprint(second.findings[0])
    );
    expect(second.findings[0]?.message).toBe("Changed display text");
    expect(second.findings[0]?.classification).toEqual(
      first.findings[0]?.classification
    );
  });

  it("ignores a runtime severity override for classification and fingerprint", async () => {
    const normal = await executeRealDetector(
      cctpDomain26Rule,
      cases[0].positive
    );
    const overridden = await executeRealDetector(
      cctpDomain26Rule,
      cases[0].positive,
      "warning"
    );
    const specification = getFindingV2AdapterSpecification(
      "bridge/CCTP_DOMAIN_26"
    );
    const first = adaptDetectorOccurrenceV2({
      occurrence: normal.occurrence,
      specification,
      resolveLocation: createRepositoryLocationResolver(normal.projectRoot)
    });
    const second = adaptDetectorOccurrenceV2({
      occurrence: overridden.occurrence,
      specification,
      resolveLocation: createRepositoryLocationResolver(overridden.projectRoot)
    });

    expect(overridden.occurrence.detectorFindings[0]?.severity).toBe("warning");
    expect(second.findings[0]?.classification).toEqual(
      first.findings[0]?.classification
    );
    expect(exactFingerprint(second.findings[0])).toBe(
      exactFingerprint(first.findings[0])
    );
  });

  it("gives duplicate selected occurrences identical fingerprints", async () => {
    const projectRoot = createTempProject();
    const filePath = writeFixture(projectRoot, "src/fixture.ts", cases[0].positive);
    const context = createBridgeContext(projectRoot, filePath);
    const result = await executeRulesStructured(
      [cctpDomain26Rule, cctpDomain26Rule],
      context
    );
    const specification = getFindingV2AdapterSpecification(
      "bridge/CCTP_DOMAIN_26"
    );
    const resolver = createRepositoryLocationResolver(projectRoot);
    const adapted = result.occurrences.map((occurrence) =>
      adaptDetectorOccurrenceV2({
        occurrence: asAdaptableOccurrence(occurrence),
        specification,
        resolveLocation: resolver
      })
    );

    expect(exactFingerprint(adapted[0]?.findings[0])).toBe(
      exactFingerprint(adapted[1]?.findings[0])
    );
  });

  it("rejects every member of an intra-occurrence duplicate group", () => {
    const duplicate = createLegacyFinding(
      "bridge/CCTP_DOMAIN_26",
      "src/bridge.ts"
    );
    const result = adaptManual("bridge/CCTP_DOMAIN_26", [
      duplicate,
      { ...duplicate }
    ]);

    expect(result.findings).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]).toMatchObject({
      code: "FINDING_V2_DUPLICATE_FINGERPRINT",
      level: "error",
      location: { path: "src/bridge.ts" }
    });
  });

  it("changes a direct exact fingerprint when the stable discriminator changes", () => {
    const input = {
      ruleId: "bridge/CCTP_DOMAIN_26",
      primaryLocation: { path: "src/bridge.ts" }
    };
    const first = createExactFindingFingerprint({
      ...input,
      detectorDiscriminator: "cctp-domain-non-26"
    });
    const second = createExactFindingFingerprint({
      ...input,
      detectorDiscriminator: "another-approved-branch"
    });

    expect(first.value).not.toBe(second.value);
  });
});

describe("adaptation diagnostics and partial outcomes", () => {
  it.each([
    {
      name: "missing",
      files: [],
      code: "FINDING_V2_LOCATION_MISSING",
      message: "Detector finding cannot be adapted because it has no source file."
    },
    {
      name: "ambiguous",
      files: ["src/one.ts", "src/two.ts"],
      code: "FINDING_V2_LOCATION_AMBIGUOUS",
      message:
        "Detector finding cannot be adapted because its source files are ambiguous."
    },
    {
      name: "duplicate paths are ambiguous",
      files: ["src/one.ts", "src/one.ts"],
      code: "FINDING_V2_LOCATION_AMBIGUOUS",
      message:
        "Detector finding cannot be adapted because its source files are ambiguous."
    },
    {
      name: "unrepresentable",
      files: ["C:\\secret\\outside.ts"],
      code: "FINDING_V2_LOCATION_UNREPRESENTABLE",
      message:
        "Detector finding cannot be adapted because its source location is not safely representable."
    }
  ])("returns a sanitized $name diagnostic", ({ files, code, message }) => {
    const finding = {
      ...createLegacyFinding("bridge/CCTP_DOMAIN_26", "src/bridge.ts"),
      files,
      message: "secret source content"
    };
    const result = adaptManual("bridge/CCTP_DOMAIN_26", [finding]);

    expect(result.findings).toEqual([]);
    expect(result.diagnostics).toEqual([
      {
        code,
        category: "internal-error",
        level: "warning",
        phase: "analysis",
        origin: "tool",
        message,
        recoverable: true,
        ruleId: "bridge/CCTP_DOMAIN_26"
      }
    ]);
    expect(() => validateScanDiagnosticV2(result.diagnostics[0])).not.toThrow();
    expect(JSON.stringify(result.diagnostics)).not.toContain("C:\\secret");
    expect(JSON.stringify(result.diagnostics)).not.toContain("secret source content");
    expect(JSON.stringify(result.diagnostics)).not.toContain("stack");
    expect(JSON.stringify(result.diagnostics)).not.toContain("fallback");
  });

  it("preserves valid findings and detector-relative diagnostic order", () => {
    const result = adaptManual("bridge/CCTP_DOMAIN_26", [
      createLegacyFinding("bridge/CCTP_DOMAIN_26", "src/first.ts"),
      { ...createLegacyFinding("bridge/CCTP_DOMAIN_26", "ignored"), files: [] },
      createLegacyFinding("bridge/CCTP_DOMAIN_26", "../outside.ts"),
      createLegacyFinding("bridge/CCTP_DOMAIN_26", "src/last.ts")
    ]);

    expect(result.findings.map((finding) => finding.primaryLocation?.path)).toEqual([
      "src/first.ts",
      "src/last.ts"
    ]);
    expect(result.diagnostics.map(({ code }) => code)).toEqual([
      "FINDING_V2_LOCATION_MISSING",
      "FINDING_V2_LOCATION_UNREPRESENTABLE"
    ]);
  });

  it("preserves unrelated findings while rejecting a duplicate group", () => {
    const duplicate = createLegacyFinding(
      "bridge/CCTP_DOMAIN_26",
      "src/duplicate.ts"
    );
    const result = adaptManual("bridge/CCTP_DOMAIN_26", [
      createLegacyFinding("bridge/CCTP_DOMAIN_26", "src/first.ts"),
      duplicate,
      { ...duplicate },
      createLegacyFinding("bridge/CCTP_DOMAIN_26", "src/last.ts")
    ]);

    expect(result.findings.map((finding) => finding.primaryLocation?.path)).toEqual([
      "src/first.ts",
      "src/last.ts"
    ]);
    expect(result.diagnostics.map(({ code }) => code)).toEqual([
      "FINDING_V2_DUPLICATE_FINGERPRINT"
    ]);
  });
});

describe("adapter invariant failures", () => {
  const specification = getFindingV2AdapterSpecification(
    "bridge/CCTP_DOMAIN_26"
  );

  it.each([
    {
      name: "disabled occurrence",
      occurrence: {
        selectionIndex: 0,
        rule: { kind: "rule-id", id: "bridge/CCTP_DOMAIN_26" },
        scheduling: "disabled",
        execution: "not-run",
        detectorFindings: []
      }
    },
    {
      name: "failed occurrence with fallback",
      occurrence: {
        selectionIndex: 0,
        rule: { kind: "rule-id", id: "bridge/CCTP_DOMAIN_26" },
        scheduling: "scheduled",
        execution: "failed",
        detectorFindings: [],
        fallbackFinding: createLegacyFinding("bridge/CCTP_DOMAIN_26", "ignored")
      }
    },
    {
      name: "unrepresentable identity",
      occurrence: {
        selectionIndex: 0,
        rule: { kind: "unrepresentable" },
        scheduling: "scheduled",
        execution: "completed",
        detectorFindings: []
      }
    },
    {
      name: "unsupported identity",
      occurrence: {
        selectionIndex: 0,
        rule: { kind: "rule-id", id: "wallet/ARC_CHAIN_METADATA" },
        scheduling: "scheduled",
        execution: "completed",
        detectorFindings: []
      }
    }
  ])("throws for $name", ({ occurrence }) => {
    expect(() =>
      adaptDetectorOccurrenceV2({
        occurrence,
        specification,
        resolveLocation: createRepositoryLocationResolver("/repo")
      } as unknown as AdaptDetectorOccurrenceV2Input)
    ).toThrow();
  });

  it("throws when occurrence and specification IDs differ", () => {
    expect(() =>
      adaptDetectorOccurrenceV2({
        occurrence: createOccurrence("bridge/NO_WRAPPED_USDC_ON_ARC", []),
        specification,
        resolveLocation: createRepositoryLocationResolver("/repo")
      })
    ).toThrow(/IDs must match/);
  });

  it("throws when a detector finding ID differs", () => {
    expect(() =>
      adaptManual("bridge/CCTP_DOMAIN_26", [
        createLegacyFinding("bridge/NO_WRAPPED_USDC_ON_ARC", "src/bridge.ts")
      ])
    ).toThrow(/Detector finding rule ID/);
  });

  it("throws when detector files are not an array", () => {
    const finding = createLegacyFinding(
      "bridge/CCTP_DOMAIN_26",
      "src/bridge.ts"
    );
    expect(() =>
      adaptManual("bridge/CCTP_DOMAIN_26", [
        { ...finding, files: "src/bridge.ts" } as unknown as Finding
      ])
    ).toThrow(/files must be an array/);
  });

  it.each([
    { status: "resolved", location: { path: "/absolute/secret.ts" } },
    { status: "rejected", reason: "unknown" },
    { status: "unexpected" }
  ])("throws when the resolver violates its result contract", (resolution) => {
    expect(() =>
      adaptDetectorOccurrenceV2({
        occurrence: createOccurrence("bridge/CCTP_DOMAIN_26", [
          createLegacyFinding("bridge/CCTP_DOMAIN_26", "src/bridge.ts")
        ]),
        specification,
        resolveLocation: () => resolution as SourceLocationResolutionV2
      })
    ).toThrow();
  });

  it("does not mutate the occurrence or specification", () => {
    const occurrence = createOccurrence("bridge/CCTP_DOMAIN_26", [
      createLegacyFinding("bridge/CCTP_DOMAIN_26", "src/bridge.ts")
    ]);
    const occurrenceSnapshot = JSON.stringify(occurrence);
    const specificationSnapshot = JSON.stringify(specification, (_key, value) =>
      typeof value === "function" ? "[function]" : value
    );

    adaptDetectorOccurrenceV2({
      occurrence,
      specification,
      resolveLocation: createRepositoryLocationResolver("/repo")
    });

    expect(JSON.stringify(occurrence)).toBe(occurrenceSnapshot);
    expect(
      JSON.stringify(specification, (_key, value) =>
        typeof value === "function" ? "[function]" : value
      )
    ).toBe(specificationSnapshot);
  });
});

async function executeRealDetector(
  rule: Rule,
  content: string,
  severityOverride?: "warning"
): Promise<{
  projectRoot: string;
  occurrence: AdaptableCompletedRuleOccurrenceV2;
}> {
  const projectRoot = createTempProject();
  const filePath = writeFixture(projectRoot, "src/fixture.ts", content);
  const context = createBridgeContext(
    projectRoot,
    filePath,
    severityOverride === undefined ? {} : { [rule.id]: severityOverride }
  );
  const result = await executeRulesStructured([rule], context);
  const occurrence = result.occurrences[0];
  return {
    projectRoot,
    occurrence: asAdaptableOccurrence(occurrence)
  };
}

function asAdaptableOccurrence(
  occurrence: Awaited<ReturnType<typeof executeRulesStructured>>["occurrences"][number]
): AdaptableCompletedRuleOccurrenceV2 {
  const ruleId = occurrence.rule.kind === "rule-id" ? occurrence.rule.id : undefined;
  if (
    occurrence.execution !== "completed" ||
    occurrence.scheduling !== "scheduled" ||
    (ruleId !== "bridge/CCTP_DOMAIN_26" &&
      ruleId !== "bridge/NO_WRAPPED_USDC_ON_ARC")
  ) {
    throw new TypeError("Expected a completed selected-rule occurrence");
  }
  return {
    selectionIndex: occurrence.selectionIndex,
    rule: { kind: "rule-id", id: ruleId },
    scheduling: occurrence.scheduling,
    execution: occurrence.execution,
    detectorFindings: occurrence.detectorFindings
  };
}

function createBridgeContext(
  projectRoot: string,
  filePath: string,
  rules: Record<string, "warning"> = {}
) {
  return createRuleContext({
    projectRoot,
    config: {
      ...DEFAULT_CONFIG,
      presets: ["bridge"],
      rules
    },
    files: [filePath],
    detectedPresets: {
      detectedPresets: ["bridge"],
      confidence: "high",
      reasons: ["test fixture"]
    }
  });
}

function adaptManual(
  ruleId: SupportedFindingV2AdapterRuleId,
  findings: Finding[]
) {
  return adaptDetectorOccurrenceV2({
    occurrence: createOccurrence(ruleId, findings),
    specification: getFindingV2AdapterSpecification(ruleId),
    resolveLocation: createRepositoryLocationResolver("/repo")
  });
}

function createOccurrence(
  ruleId: SupportedFindingV2AdapterRuleId,
  detectorFindings: Finding[]
): AdaptableCompletedRuleOccurrenceV2 {
  return {
    selectionIndex: 0,
    rule: { kind: "rule-id", id: ruleId },
    scheduling: "scheduled",
    execution: "completed",
    detectorFindings
  };
}

function createLegacyFinding(
  ruleId: SupportedFindingV2AdapterRuleId,
  filePath: string
): Finding {
  return {
    ruleId,
    severity: "critical",
    message: `Deterministic message for ${ruleId}`,
    files: [filePath],
    suggestedFix: "legacy remediation",
    docs: "legacy-doc-slug",
    preset: "bridge"
  };
}

function exactFingerprint(finding: FindingV2 | undefined): string {
  if (finding === undefined) {
    throw new TypeError("Expected an adapted finding");
  }
  return finding.fingerprints.exact.value;
}

function createTempProject(): string {
  const projectRoot = mkdtempSync(join(tmpdir(), "arcready-finding-v2-"));
  tempDirs.push(projectRoot);
  return projectRoot;
}

function writeFixture(
  projectRoot: string,
  relativePath: string,
  content: string
): string {
  const absolutePath = join(projectRoot, relativePath);
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, content);
  return absolutePath;
}
