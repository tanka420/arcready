import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  ARCREADY_CONTRACT_VERSION,
  ContractV2ValidationError,
  type CoverageV2,
  type FindingV2,
  type ScanDiagnosticV2,
  type ScanResultV2
} from "../core/contracts/v2/model.js";
import { validateScanResultV2 } from "../core/contracts/v2/validate.js";
import {
  buildScanResultV2,
  type BuildScanResultV2Input
} from "../core/scan-result-v2/index.js";
import { jsonReporter } from "../reporters/json/index.js";
import * as publicApi from "../src/index.js";
import { runScan } from "../src/report.js";

describe("ScanResultV2 construction", () => {
  it("builds the minimal canonical result", () => {
    const coverage = createCoverage("insufficient");
    const result = buildScanResultV2({
      coverage,
      findings: [],
      diagnostics: []
    });

    expect(result).toEqual({
      contractVersion: ARCREADY_CONTRACT_VERSION,
      coverage,
      findings: [],
      diagnostics: []
    });
    expect(() => validateScanResultV2(result)).not.toThrow();
  });

  it.each(["complete", "partial", "failed", "insufficient"] as const)(
    "accepts %s coverage",
    (state) => {
      const result = buildScanResultV2({
        coverage: createCoverage(state),
        findings: [],
        diagnostics: []
      });

      expect(result.coverage.discovery.state).toBe(state);
      expect(() => validateScanResultV2(result)).not.toThrow();
    }
  );

  it("accepts multiple findings and diagnostics", () => {
    const result = buildScanResultV2({
      coverage: createCoverage("complete"),
      findings: [createFinding("b"), createFinding("a")],
      diagnostics: [createDiagnostic("SECOND"), createDiagnostic("FIRST")]
    });

    expect(result.findings).toHaveLength(2);
    expect(result.diagnostics).toHaveLength(2);
  });

  it("preserves explicitly unknown analysis and applicability coverage", () => {
    const result = buildScanResultV2({
      coverage: createCoverage("complete"),
      findings: [],
      diagnostics: []
    });

    expect(result.coverage.analysis).toEqual({
      state: "unknown",
      applicability: "unknown",
      reason: "analysis-acknowledgements-unavailable"
    });
  });

  it("uses the v2 contract version", () => {
    const result = buildScanResultV2({
      coverage: createCoverage("complete"),
      findings: [],
      diagnostics: []
    });
    expect(result.contractVersion).toBe("2.0");
    expect(result.coverage.contractVersion).toBe(result.contractVersion);
  });

  it("produces equivalent values for equivalent inputs", () => {
    const input = createInput();
    expect(buildScanResultV2(input)).toEqual(
      buildScanResultV2(structuredClone(input))
    );
  });
});

describe("ScanResultV2 snapshot ownership", () => {
  it("does not mutate its input and returns independent arrays and records", () => {
    const input = createInput();
    const before = structuredClone(input);
    const result = buildScanResultV2(input);

    expect(input).toEqual(before);
    expect(result.coverage).not.toBe(input.coverage);
    expect(result.findings).not.toBe(input.findings);
    expect(result.diagnostics).not.toBe(input.diagnostics);
    expect(result.coverage.scope).not.toBe(input.coverage.scope);
    expect(result.coverage.scope.roots).not.toBe(input.coverage.scope.roots);
    expect(result.findings[0]).not.toBe(input.findings[0]);
    expect(result.findings[0]!.classification).not.toBe(
      input.findings[0]!.classification
    );
    expect(result.findings[0]!.evidence[0]).not.toBe(
      input.findings[0]!.evidence[0]
    );
    expect(result.diagnostics[0]).not.toBe(input.diagnostics[0]);
    expect(result.diagnostics[0]!.location).not.toBe(
      input.diagnostics[0]!.location
    );
  });

  it("retains no references to later mutations of the complete input graph", () => {
    const coverage = createCoverage("complete");
    const finding = createFinding("a");
    const diagnostic = createDiagnostic("DIAGNOSTIC");
    const findings = [finding];
    const diagnostics = [diagnostic];
    const result = buildScanResultV2({ coverage, findings, diagnostics });
    const snapshot = structuredClone(result);

    coverage.scope.entries.candidateFiles = 0;
    coverage.evidence.ruleContextReads.attempts = 7;
    finding.message = "Changed after construction.";
    finding.primaryLocation!.path = "src/changed.ts";
    finding.relatedLocations[0]!.location.path = "src/related-changed.ts";
    const evidence = finding.evidence[0]!;
    if (evidence.kind === "pattern-match") {
      evidence.excerpt = "changed";
      evidence.location!.path = "src/evidence-changed.ts";
    }
    finding.documentation[0]!.title = "Changed documentation";
    finding.documentation[0]!.url = "https://example.com/changed";
    finding.fingerprints.exact.value = digest("b");
    diagnostic.message = "Changed diagnostic.";
    diagnostic.location!.path = "src/diagnostic-changed.ts";
    findings.push(createFinding("c"));
    diagnostics.push(createDiagnostic("LATER"));
    findings.pop();
    diagnostics.pop();

    expect(result).toEqual(snapshot);
  });

  it("does not deep-freeze the snapshot", () => {
    const result = buildScanResultV2(createInput());
    expect(Object.isFrozen(result)).toBe(false);
    expect(Object.isFrozen(result.coverage)).toBe(false);
    expect(Object.isFrozen(result.findings)).toBe(false);
  });
});

describe("ScanResultV2 finding order and uniqueness", () => {
  it("keeps empty and one-item finding arrays canonical", () => {
    expect(
      buildScanResultV2({ ...createInput(), findings: [] }).findings
    ).toEqual([]);
    expect(
      buildScanResultV2({ ...createInput(), findings: [createFinding("a")] })
        .findings[0]!.fingerprints.exact.value
    ).toBe(digest("a"));
  });

  it("sorts by exact fingerprint using code-unit order", () => {
    const result = buildScanResultV2({
      ...createInput(),
      findings: [createFinding("a"), createFinding("9"), createFinding("0")]
    });

    expect(result.findings.map(exactValue)).toEqual([
      digest("0"),
      digest("9"),
      digest("a")
    ]);
  });

  it("does not use locale-sensitive comparison", () => {
    const localeCompare = vi
      .spyOn(String.prototype, "localeCompare")
      .mockImplementation(() => {
        throw new Error("localeCompare must not be used");
      });
    try {
      expect(
        buildScanResultV2({
          ...createInput(),
          findings: [createFinding("b"), createFinding("a")]
        }).findings.map(exactValue)
      ).toEqual([digest("a"), digest("b")]);
    } finally {
      localeCompare.mockRestore();
    }
  });

  it("rejects directly supplied unsorted findings", () => {
    expectInvalidResult({
      contractVersion: ARCREADY_CONTRACT_VERSION,
      coverage: createCoverage("complete"),
      findings: [createFinding("b"), createFinding("a")],
      diagnostics: []
    });
  });

  it.each([
    ["adjacent identical records", [createFinding("a"), createFinding("a")]],
    [
      "adjacent distinct records",
      [createFinding("a"), { ...createFinding("a"), message: "Different." }]
    ],
    [
      "non-adjacent input records",
      [createFinding("a"), createFinding("b"), createFinding("a")]
    ]
  ])("rejects duplicate exact fingerprints in %s", (_label, findings) => {
    expect(() => buildScanResultV2({ ...createInput(), findings })).toThrow(
      /fingerprints must be unique/
    );
  });

  it("accepts distinct fingerprints for the same rule", () => {
    const findings = [createFinding("a"), createFinding("b")];
    expect(findings[0]!.ruleId).toBe(findings[1]!.ruleId);
    expect(
      buildScanResultV2({ ...createInput(), findings }).findings
    ).toHaveLength(2);
  });
});

describe("ScanResultV2 diagnostic order", () => {
  it("preserves supplied order instead of sorting diagnostics", () => {
    const diagnostics = [
      createDiagnostic("Z_LAST", "reporting"),
      createDiagnostic("A_FIRST", "configuration"),
      createDiagnostic("M_MIDDLE", "analysis")
    ];
    const result = buildScanResultV2({ ...createInput(), diagnostics });

    expect(result.diagnostics.map(({ code }) => code)).toEqual([
      "Z_LAST",
      "A_FIRST",
      "M_MIDDLE"
    ]);
  });

  it("allows duplicate diagnostic codes and identical diagnostic records", () => {
    const duplicate = createDiagnostic("REPEATED");
    const result = buildScanResultV2({
      ...createInput(),
      diagnostics: [duplicate, structuredClone(duplicate)]
    });

    expect(result.diagnostics).toEqual([duplicate, duplicate]);
  });
});

describe("ScanResultV2 strict validation", () => {
  it.each([null, [], "result", 3])(
    "rejects non-record top-level value %j",
    (value) => {
      expectInvalidResult(value);
    }
  );

  it("rejects a top-level class instance", () => {
    expectInvalidResult(classInstance(validResult()));
  });

  it.each([
    "extra",
    "legacyFindings",
    "instrumentation",
    "score",
    "status",
    "project",
    "timestamp",
    "duration"
  ])("rejects the unsupported top-level field %s", (field) => {
    expectInvalidResult({ ...validResult(), [field]: true });
  });

  it.each(["coverage", "findings", "diagnostics"])(
    "rejects a missing %s field",
    (field) => {
      const value = validResult() as unknown as Record<string, unknown>;
      delete value[field];
      expectInvalidResult(value);
    }
  );

  it("rejects the wrong result contract version", () => {
    expectInvalidResult({ ...validResult(), contractVersion: "1.0" });
  });

  it("rejects a coverage version mismatch", () => {
    const invalid = createCoverage("complete") as unknown as Record<
      string,
      unknown
    >;
    invalid.contractVersion = "1.0";
    expectInvalidResult({ ...validResult(), coverage: invalid });
  });

  it("rejects an invalid CoverageV2", () => {
    const invalid = createCoverage("complete");
    invalid.scope.entries.candidateFiles = 2;
    expectInvalidResult({ ...validResult(), coverage: invalid });
  });

  it.each([null, {}, "findings"])(
    "rejects non-array findings %j",
    (findings) => {
      expectInvalidResult({ ...validResult(), findings });
    }
  );

  it("rejects sparse and undefined finding elements", () => {
    expectInvalidResult({ ...validResult(), findings: Array(1) });
    expectInvalidResult({ ...validResult(), findings: [undefined] });
  });

  it("rejects a direct finding class instance", () => {
    expectInvalidResult({
      ...validResult(),
      findings: [classInstance(createFinding("a"))]
    });
  });

  it("rejects an invalid FindingV2", () => {
    expectInvalidResult({
      ...validResult(),
      findings: [{ ...createFinding("a"), message: "" }]
    });
  });

  it.each([null, {}, "diagnostics"])(
    "rejects non-array diagnostics %j",
    (diagnostics) => {
      expectInvalidResult({ ...validResult(), diagnostics });
    }
  );

  it("rejects sparse and undefined diagnostic elements", () => {
    expectInvalidResult({ ...validResult(), diagnostics: Array(1) });
    expectInvalidResult({ ...validResult(), diagnostics: [undefined] });
  });

  it("rejects a direct diagnostic class instance", () => {
    expectInvalidResult({
      ...validResult(),
      diagnostics: [classInstance(createDiagnostic("CLASS"))]
    });
  });

  it("rejects an invalid ScanDiagnosticV2", () => {
    expectInvalidResult({
      ...validResult(),
      diagnostics: [{ ...createDiagnostic("INVALID"), message: "" }]
    });
  });

  it("rejects duplicate fingerprints in a directly supplied result", () => {
    expectInvalidResult({
      ...validResult(),
      findings: [createFinding("a"), createFinding("a")]
    });
  });
});

describe("ScanResultV2 internal boundary and compatibility", () => {
  it("contains no legacy report or instrumentation fields", () => {
    const result = buildScanResultV2(createInput()) as unknown as Record<
      string,
      unknown
    >;
    for (const field of [
      "legacyFindings",
      "instrumentation",
      "score",
      "status",
      "project",
      "timestamp",
      "duration",
      "overallStatus",
      "compatibility"
    ]) {
      expect(field in result).toBe(false);
    }
  });

  it("does not expose the internal result contract from the public API", () => {
    expect("ScanResultV2" in publicApi).toBe(false);
    expect("buildScanResultV2" in publicApi).toBe(false);
    expect("validateScanResultV2" in publicApi).toBe(false);
  });

  it("preserves representative runScan JSON byte-for-byte", async () => {
    const repoRoot = join(import.meta.dirname, "..", "..", "..");
    const { report } = await runScan(join(repoRoot, "fixtures", "wallet-good"));

    expect(jsonReporter.render(report)).toBe(`{
  "project": "wallet-good",
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

function createInput(): BuildScanResultV2Input {
  return {
    coverage: createCoverage("complete"),
    findings: [createFinding("a")],
    diagnostics: [createDiagnostic("DIAGNOSTIC")]
  };
}

function validResult(): ScanResultV2 {
  return buildScanResultV2(createInput());
}

function createCoverage(state: CoverageV2["discovery"]["state"]): CoverageV2 {
  const roots =
    state === "complete"
      ? {
          requested: { state: "known" as const, count: 1 },
          observedRootOutcomes: 1,
          acceptedRootOutcomes: 1,
          unavailableRootOutcomes: 0,
          outsideProjectRootOutcomes: 0
        }
      : state === "partial"
        ? {
            requested: { state: "known" as const, count: 2 },
            observedRootOutcomes: 2,
            acceptedRootOutcomes: 1,
            unavailableRootOutcomes: 1,
            outsideProjectRootOutcomes: 0
          }
        : state === "failed"
          ? {
              requested: { state: "unknown" as const },
              observedRootOutcomes: 1,
              acceptedRootOutcomes: 0,
              unavailableRootOutcomes: 1,
              outsideProjectRootOutcomes: 0
            }
          : {
              requested: { state: "known" as const, count: 0 },
              observedRootOutcomes: 0,
              acceptedRootOutcomes: 0,
              unavailableRootOutcomes: 0,
              outsideProjectRootOutcomes: 0
            };
  const entries =
    state === "failed"
      ? {
          observation: "truncated" as const,
          uniqueEncounteredEntries: 0,
          excludedEntries: 0,
          extensionSupportedRegularFiles: 0,
          extensionUnsupportedRegularFiles: 0,
          candidateFiles: 0,
          unrepresentableEntries: 0
        }
      : state === "insufficient"
        ? {
            observation: "complete" as const,
            uniqueEncounteredEntries: 0,
            excludedEntries: 0,
            extensionSupportedRegularFiles: 0,
            extensionUnsupportedRegularFiles: 0,
            candidateFiles: 0,
            unrepresentableEntries: 0
          }
        : {
            observation: "complete" as const,
            uniqueEncounteredEntries: 1,
            excludedEntries: 0,
            extensionSupportedRegularFiles: 1,
            extensionUnsupportedRegularFiles: 0,
            candidateFiles: 1,
            unrepresentableEntries: 0
          };
  const counts =
    state === "complete"
      ? {
          selectedOccurrences: 1,
          disabledOccurrences: 0,
          scheduledOccurrences: 1,
          completedOccurrences: 1,
          failedOccurrences: 0,
          completedWithFindingsOccurrences: 0,
          completedWithNoFindingsOccurrences: 1,
          normalizedDetectorFindings: 0,
          unrepresentableRuleOccurrences: 0
        }
      : state === "partial"
        ? {
            selectedOccurrences: 2,
            disabledOccurrences: 0,
            scheduledOccurrences: 2,
            completedOccurrences: 1,
            failedOccurrences: 1,
            completedWithFindingsOccurrences: 0,
            completedWithNoFindingsOccurrences: 1,
            normalizedDetectorFindings: 0,
            unrepresentableRuleOccurrences: 0
          }
        : state === "failed"
          ? {
              selectedOccurrences: 1,
              disabledOccurrences: 0,
              scheduledOccurrences: 1,
              completedOccurrences: 0,
              failedOccurrences: 1,
              completedWithFindingsOccurrences: 0,
              completedWithNoFindingsOccurrences: 0,
              normalizedDetectorFindings: 0,
              unrepresentableRuleOccurrences: 0
            }
          : {
              selectedOccurrences: 0,
              disabledOccurrences: 0,
              scheduledOccurrences: 0,
              completedOccurrences: 0,
              failedOccurrences: 0,
              completedWithFindingsOccurrences: 0,
              completedWithNoFindingsOccurrences: 0,
              normalizedDetectorFindings: 0,
              unrepresentableRuleOccurrences: 0
            };

  return {
    contractVersion: ARCREADY_CONTRACT_VERSION,
    scope: { roots, entries },
    discovery: { state },
    ruleExecution: { state, counts },
    analysis: {
      state: "unknown",
      applicability: "unknown",
      reason: "analysis-acknowledgements-unavailable"
    },
    evidence: {
      ruleContextReads: {
        attempts: 0,
        succeeded: 0,
        failed: 0,
        unsettled: 0,
        representablePaths: 0,
        unrepresentablePaths: 0
      }
    }
  };
}

function createFinding(fingerprintCharacter: string): FindingV2 {
  return {
    ruleId: "wallet/ARC_CHAIN_METADATA",
    title: "Arc chain metadata should be reviewed",
    message: "The detected integration should be reviewed for Arc portability.",
    classification: {
      taxonomy: "advice",
      impact: "recommendation",
      category: "wallet",
      maturity: "prototype",
      rulePacks: ["wallet"]
    },
    confidence: {
      level: "low",
      basis: "adapter",
      reason: "The internal adapter preserved the detector result."
    },
    primaryLocation: {
      path: "src/wallet.ts",
      region: {
        start: { line: 4, column: 2 },
        end: { line: 4, column: 9 }
      }
    },
    relatedLocations: [
      { label: "configuration", location: { path: "src/config.ts" } }
    ],
    evidence: [
      {
        kind: "pattern-match",
        patternId: "arc-chain-metadata",
        location: { path: "src/wallet.ts" },
        excerpt: "chainId"
      }
    ],
    remediation: { summary: "Review the Arc chain metadata." },
    documentation: [
      { title: "Arc documentation", url: "https://example.com/arc" }
    ],
    fingerprints: {
      exact: {
        scheme: "arcready/exact-location/v1",
        algorithm: "sha256",
        value: digest(fingerprintCharacter),
        stability: "exact"
      }
    }
  };
}

function createDiagnostic(
  code: string,
  phase: ScanDiagnosticV2["phase"] = "analysis"
): ScanDiagnosticV2 {
  return {
    code,
    category: "rule-execution-error",
    level: "warning",
    phase,
    origin: "tool",
    message: `Diagnostic ${code}.`,
    recoverable: true,
    ruleId: "wallet/ARC_CHAIN_METADATA",
    location: { path: "src/wallet.ts" }
  };
}

function digest(character: string): `sha256:${string}` {
  return `sha256:${character.repeat(64)}`;
}

function exactValue(finding: FindingV2): string {
  return finding.fingerprints.exact.value;
}

function expectInvalidResult(value: unknown): void {
  expect(() => validateScanResultV2(value)).toThrow(ContractV2ValidationError);
}

class DirectRecord {}

function classInstance<Value extends object>(value: Value): Value {
  return Object.assign(new DirectRecord(), value) as Value;
}
