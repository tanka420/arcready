import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ArcReadyConfig } from "../core/config/index.js";
import type { FindingV2 } from "../core/contracts/v2/model.js";
import {
  validateCoverageV2,
  validateFindingV2,
  validateScanDiagnosticV2,
  validateScanResultV2
} from "../core/contracts/v2/validate.js";
import {
  adaptDetectorOccurrenceV2,
  type AdaptableCompletedRuleOccurrenceV2
} from "../core/findings-v2/adapter.js";
import { createRepositoryLocationResolver } from "../core/findings-v2/location.js";
import { getFindingV2AdapterSpecification } from "../core/findings-v2/specifications.js";
import type { Finding } from "../core/findings/index.js";
import { discoverFilesInstrumented } from "../core/fs/index.js";
import { projectLegacyFindings } from "../core/rules/execution-result.js";
import { createRuleContext, type Rule } from "../core/rules/index.js";
import {
  runRulesInstrumented,
  runRulesStructuredInstrumented
} from "../core/rules/instrumentation.js";
import {
  assembleInternalScanV2Diagnostics,
  resolveCrossOccurrenceFindingCollisions,
  runInternalScanV2,
  type InternalCanonicalFindingCandidateV2
} from "../core/scan-v2/index.js";
import { DEFAULT_CONFIG, runScan } from "../src/index.js";

const repoRoot = join(import.meta.dirname, "..", "..", "..");
const temporaryRoots: string[] = [];
const cctpSource = "Arc CCTP bridge\nconst ARC_CCTP_DOMAIN = 7;\n";
const wrappedSource = "Arc bridge route uses USDC.e as its destination asset.\n";
const safeSource =
  "Arc CCTP bridge\nconst ARC_CCTP_DOMAIN = 26;\nconst asset = 'USDC';\n";

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("structured and instrumented rule execution seam", () => {
  it("returns structured execution and existing instrumentation from one detector run", async () => {
    const projectRoot = createProject({ "src/input.ts": "content" });
    let executions = 0;
    const rule = createRule("bridge/test", async (context) => {
      executions += 1;
      await context.readFile(join(projectRoot, "src", "input.ts"));
      return [legacyFinding("bridge/test", join(projectRoot, "src", "input.ts"))];
    });

    const result = await runRulesStructuredInstrumented(
      [rule],
      createContext(projectRoot, [join(projectRoot, "src", "input.ts")])
    );

    expect(executions).toBe(1);
    expect(result.execution.occurrences).toHaveLength(1);
    expect(result.instrumentation.rules).toHaveLength(1);
    expect(result.instrumentation.rules[0]?.readAttempts).toHaveLength(1);
    const projected = projectLegacyFindings(result.execution);
    const occurrence = result.execution.occurrences[0];
    expect(occurrence?.execution).toBe("completed");
    if (occurrence?.execution !== "completed") {
      throw new Error("Expected completed occurrence");
    }
    expect(projected[0]).toBe(occurrence.detectorFindings[0]);
  });

  it("keeps runRulesInstrumented value-equivalent to structured projection", async () => {
    const projectRoot = createProject({ "src/input.ts": "content" });
    const file = join(projectRoot, "src", "input.ts");
    const rule = createRule("bridge/test", async (context) => {
      await context.readFile(file);
      return [legacyFinding("bridge/test", file)];
    });

    const structured = await runRulesStructuredInstrumented(
      [rule],
      createContext(projectRoot, [file])
    );
    const legacy = await runRulesInstrumented(
      [rule],
      createContext(projectRoot, [file])
    );

    expect(legacy.findings).toEqual(projectLegacyFindings(structured.execution));
    expect(legacy.instrumentation).toEqual(structured.instrumentation);
  });

  it("creates one sanitized execution diagnostic and keeps fallback text private", async () => {
    const projectRoot = createProject({});
    const result = await runRulesStructuredInstrumented(
      [
        createRule("bridge/failure", () => {
          throw new Error("private fallback payload");
        })
      ],
      createContext(projectRoot, [])
    );

    expect(result.instrumentation.diagnostics).toEqual([
      {
        code: "RULE_EXECUTION_FAILED",
        category: "rule-execution-error",
        level: "error",
        phase: "analysis",
        origin: "tool",
        message: "Rule execution failed.",
        recoverable: true,
        ruleId: "bridge/failure"
      }
    ]);
    expect(JSON.stringify(result.instrumentation)).not.toContain(
      "private fallback payload"
    );
    expect(result.execution.occurrences[0]?.execution).toBe("failed");
  });
});

describe("private ScanResultV2 runtime", () => {
  it("returns one validated CCTP FindingV2", async () => {
    const result = await scanProject({ "src/cctp.ts": cctpSource });

    expect(result.findings.map(({ ruleId }) => ruleId)).toEqual([
      "bridge/CCTP_DOMAIN_26"
    ]);
    validateCompleteResult(result);
  });

  it("returns one validated wrapped-USDC FindingV2", async () => {
    const result = await scanProject({ "src/route.ts": wrappedSource });

    expect(result.findings.map(({ ruleId }) => ruleId)).toEqual([
      "bridge/NO_WRAPPED_USDC_ON_ARC"
    ]);
    validateCompleteResult(result);
  });

  it("adapts both supported rules from one file", async () => {
    const result = await scanProject({
      "src/bridge.ts": `${cctpSource}${wrappedSource}`
    });

    expect(new Set(result.findings.map(({ ruleId }) => ruleId))).toEqual(
      new Set([
        "bridge/CCTP_DOMAIN_26",
        "bridge/NO_WRAPPED_USDC_ON_ARC"
      ])
    );
    expect(result.coverage.ruleExecution.counts.normalizedDetectorFindings).toBe(
      2
    );
  });

  it("adapts both supported rules from separate files", async () => {
    const result = await scanProject({
      "src/z-cctp.ts": cctpSource,
      "src/a-route.ts": wrappedSource
    });

    expect(result.findings).toHaveLength(2);
    expect(result.findings.map(exactFingerprint)).toEqual(
      [...result.findings.map(exactFingerprint)].sort(compareCodeUnits)
    );
  });

  it("returns zero findings without claiming analysis for a negative repository", async () => {
    const result = await scanProject({ "src/bridge.ts": safeSource });

    expect(result.findings).toEqual([]);
    expect(result.coverage.analysis).toEqual({
      state: "unknown",
      applicability: "unknown",
      reason: "analysis-acknowledgements-unavailable"
    });
    expect(result.coverage.ruleExecution.counts).toMatchObject({
      selectedOccurrences: 2,
      scheduledOccurrences: 2,
      completedOccurrences: 2,
      completedWithNoFindingsOccurrences: 2
    });
  });

  it("does not adapt an unrelated Arc chain ID beside the correct CCTP domain", async () => {
    const result = await scanProject({
      "src/bridge.ts":
        "Arc CCTP bridge\nconst cctpDomains = { arc: 26 };\nconst chainIds = { arc: 5042002 };\n"
    });

    expect(
      result.findings.some(
        ({ ruleId }) => ruleId === "bridge/CCTP_DOMAIN_26"
      )
    ).toBe(false);
    expect(result.coverage.ruleExecution.counts).toMatchObject({
      selectedOccurrences: 2,
      disabledOccurrences: 0,
      scheduledOccurrences: 2,
      completedOccurrences: 2,
      failedOccurrences: 0,
      completedWithNoFindingsOccurrences: 2
    });
    validateCompleteResult(result);
  });

  it("truthfully scans the existing bridge-bad fixture with the fixed slice", async () => {
    const result = await runInternalScanV2({
      projectRoot: join(repoRoot, "fixtures", "bridge-bad"),
      config: createConfig({ paths: [...DEFAULT_CONFIG.paths] })
    });

    expect(result.coverage.ruleExecution.counts.selectedOccurrences).toBe(2);
    expect(result.findings).toEqual([]);
    validateScanResultV2(result);
  });

  it("always selects two rules regardless of configured and detected presets", async () => {
    const result = await scanProject(
      {
        "src/mixed.ts":
          "AppKit Arc_Testnet wagmi viem wallet bridge content without a selected finding"
      },
      {
        presets: ["wallet", "app-kit", "bridge"],
        rules: { "wallet/ARC_CHAIN_METADATA": "critical" }
      }
    );

    expect(result.coverage.ruleExecution.counts.selectedOccurrences).toBe(2);
    expect(result.coverage.ruleExecution.counts.completedOccurrences).toBe(2);
    expect(result.findings).toEqual([]);
  });

  it("allows an off override to disable one selected rule", async () => {
    const result = await scanProject(
      { "src/bridge.ts": `${cctpSource}${wrappedSource}` },
      { rules: { "bridge/CCTP_DOMAIN_26": "off" } }
    );

    expect(result.findings.map(({ ruleId }) => ruleId)).toEqual([
      "bridge/NO_WRAPPED_USDC_ON_ARC"
    ]);
    expect(result.coverage.ruleExecution.counts).toMatchObject({
      selectedOccurrences: 2,
      disabledOccurrences: 1,
      scheduledOccurrences: 1,
      completedOccurrences: 1
    });
  });

  it("allows off overrides to disable both selected rules", async () => {
    const result = await scanProject(
      { "src/bridge.ts": `${cctpSource}${wrappedSource}` },
      {
        rules: {
          "bridge/CCTP_DOMAIN_26": "off",
          "bridge/NO_WRAPPED_USDC_ON_ARC": "off"
        }
      }
    );

    expect(result.findings).toEqual([]);
    expect(result.coverage.ruleExecution.counts).toMatchObject({
      selectedOccurrences: 2,
      disabledOccurrences: 2,
      scheduledOccurrences: 0,
      completedOccurrences: 0
    });
  });

  it("keeps canonical classification and fingerprint independent of severity override", async () => {
    const projectRoot = createProject({ "src/cctp.ts": cctpSource });
    const baseline = await runInternalScanV2({
      projectRoot,
      config: createConfig()
    });
    const overridden = await runInternalScanV2({
      projectRoot,
      config: createConfig({ rules: { "bridge/CCTP_DOMAIN_26": "info" } })
    });

    expect(overridden.findings[0]?.classification).toEqual(
      baseline.findings[0]?.classification
    );
    expect(overridden.findings[0]?.confidence).toEqual(
      baseline.findings[0]?.confidence
    );
    expect(exactFingerprint(overridden.findings[0])).toBe(
      exactFingerprint(baseline.findings[0])
    );
  });

  it("returns a valid unknown-analysis result when no requested root is available", async () => {
    const projectRoot = createProject({});
    const result = await runInternalScanV2({
      projectRoot,
      config: createConfig({ paths: ["missing"] })
    });

    expect(result.findings).toEqual([]);
    expect(result.coverage.discovery.state).toBe("insufficient");
    expect(result.coverage.scope.roots).toMatchObject({
      unavailableRootOutcomes: 1,
      acceptedRootOutcomes: 0
    });
    expect(result.coverage.analysis.state).toBe("unknown");
  });

  it("records exactly the rule reads and exposes no instrumentation or absolute path", async () => {
    const projectRoot = createProject({ "src/cctp.ts": cctpSource });
    const result = await runInternalScanV2({
      projectRoot,
      config: createConfig()
    });
    const serialized = JSON.stringify(result);

    expect(result.coverage.evidence.ruleContextReads.attempts).toBe(2);
    expect(serialized).not.toContain(projectRoot);
    expect(serialized).not.toContain("instrumentation");
  });

  it("produces deeply equal output for repeated equivalent scans", async () => {
    const projectRoot = createProject({
      "src/z-cctp.ts": cctpSource,
      "src/a-route.ts": wrappedSource
    });
    const config = createConfig();

    expect(
      await runInternalScanV2({ projectRoot, config })
    ).toEqual(await runInternalScanV2({ projectRoot, config }));
  });

  it("uses canonical file order independently of file creation order", async () => {
    const first = createProject({
      "src/z-cctp.ts": cctpSource,
      "src/a-route.ts": wrappedSource
    });
    const second = createProject({
      "src/a-route.ts": wrappedSource,
      "src/z-cctp.ts": cctpSource
    });

    const firstResult = await runInternalScanV2({
      projectRoot: first,
      config: createConfig()
    });
    const secondResult = await runInternalScanV2({
      projectRoot: second,
      config: createConfig()
    });
    expect(secondResult).toEqual(firstResult);
  });

  it("snapshots nested normalized config before asynchronous rule execution", async () => {
    const projectRoot = createProject({
      "src/bridge.ts": `${cctpSource}${wrappedSource}`
    });
    const config = createConfig({
      rpc: { arcTestnetHttp: "https://rpc.example" }
    });
    const pending = runInternalScanV2({ projectRoot, config });
    config.presets.splice(0, config.presets.length, "wallet");
    config.paths.splice(0, config.paths.length, "missing");
    config.exclude.push("src/**");
    config.reporters.push("json");
    config.rpc.arcTestnetHttp = "https://mutated.example";
    config.rules["bridge/NO_WRAPPED_USDC_ON_ARC"] = "off";
    const result = await pending;

    expect(new Set(result.findings.map(({ ruleId }) => ruleId))).toEqual(
      new Set([
        "bridge/CCTP_DOMAIN_26",
        "bridge/NO_WRAPPED_USDC_ON_ARC"
      ])
    );
    expect(result.coverage.ruleExecution.counts.disabledOccurrences).toBe(0);
  });

  it("does not mutate the caller's normalized config", async () => {
    const projectRoot = createProject({ "src/cctp.ts": cctpSource });
    const config = createConfig({
      presets: ["bridge", "wallet"],
      exclude: ["dist/**"],
      rpc: { arcTestnetWs: "wss://rpc.example" },
      rules: { "wallet/ARC_CHAIN_METADATA": "warning" }
    });
    const before = structuredClone(config);

    await runInternalScanV2({ projectRoot, config });

    expect(config).toEqual(before);
  });

  it("does not maintain local config enum or field policy", async () => {
    const projectRoot = createProject({ "src/cctp.ts": cctpSource });
    const config = {
      ...createConfig(),
      presets: ["future-preset"],
      reporters: ["future-reporter"],
      failOn: "future-level",
      rules: { "future/RULE": "future-rule-level" },
      futureNormalizedField: { nested: ["preserved"] }
    } as unknown as ArcReadyConfig;

    const result = await runInternalScanV2({ projectRoot, config });

    expect(result.findings).toHaveLength(1);
    expect(result.coverage.ruleExecution.counts.selectedOccurrences).toBe(2);
    expect(JSON.stringify(result)).not.toContain("futureNormalizedField");
    expect(JSON.stringify(result)).not.toContain("future-reporter");
  });

  it("respects normalized exclude patterns", async () => {
    const result = await scanProject(
      { "src/cctp.ts": cctpSource },
      { exclude: ["src/**"] }
    );

    expect(result.findings).toEqual([]);
    expect(result.coverage.scope.entries.excludedEntries).toBeGreaterThan(0);
  });

  it.each([
    ["missing options", undefined],
    ["empty root", { projectRoot: "", config: createConfig() }],
    ["missing config", { projectRoot: resolve("fixture") }],
    ["non-object config", { projectRoot: resolve("fixture"), config: null }],
    [
      "non-cloneable config",
      {
        projectRoot: resolve("fixture"),
        config: { ...createConfig(), futureValue: () => undefined }
      }
    ]
  ])("rejects %s as a programmer error", async (_name, options) => {
    await expect(
      runInternalScanV2(
        options as unknown as Parameters<typeof runInternalScanV2>[0]
      )
    ).rejects.toBeInstanceOf(TypeError);
  });
});

describe("FindingV2 adaptation boundaries", () => {
  it.each([
    ["missing", []],
    ["ambiguous", ["src/one.ts", "src/two.ts"]],
    ["unsafe", ["../secret.ts"]]
  ])("preserves the %s location diagnostic", (_name, files) => {
    const projectRoot = createProject({ "src/valid.ts": cctpSource });
    const result = adaptDetectorOccurrenceV2({
      occurrence: completedOccurrence([
        legacyFinding("bridge/CCTP_DOMAIN_26", files)
      ]),
      specification: getFindingV2AdapterSpecification(
        "bridge/CCTP_DOMAIN_26"
      ),
      resolveLocation: createRepositoryLocationResolver(projectRoot)
    });

    expect(result.findings).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    validateScanDiagnosticV2(result.diagnostics[0]);
  });

  it("keeps a valid finding when an unrelated adaptation is rejected", () => {
    const projectRoot = createProject({ "src/valid.ts": cctpSource });
    const result = adaptDetectorOccurrenceV2({
      occurrence: completedOccurrence([
        legacyFinding("bridge/CCTP_DOMAIN_26", []),
        legacyFinding(
          "bridge/CCTP_DOMAIN_26",
          join(projectRoot, "src", "valid.ts")
        )
      ]),
      specification: getFindingV2AdapterSpecification(
        "bridge/CCTP_DOMAIN_26"
      ),
      resolveLocation: createRepositoryLocationResolver(projectRoot)
    });

    expect(result.findings).toHaveLength(1);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("throws for malformed detector output instead of creating a warning", () => {
    const projectRoot = createProject({});
    const finding = legacyFinding("bridge/CCTP_DOMAIN_26", []);
    const malformed = { ...finding, files: null };

    expect(() =>
      adaptDetectorOccurrenceV2({
        occurrence: completedOccurrence([
          malformed as unknown as Finding
        ]),
        specification: getFindingV2AdapterSpecification(
          "bridge/CCTP_DOMAIN_26"
        ),
        resolveLocation: createRepositoryLocationResolver(projectRoot)
      })
    ).toThrow(TypeError);
  });

  it("rejects malformed and unrepresentable occurrence identities", async () => {
    const projectRoot = createProject({});
    const structured = await runRulesStructuredInstrumented(
      [createRule("bad\u0000rule", () => [])],
      createContext(projectRoot, [])
    );
    expect(structured.execution.occurrences[0]?.rule).toEqual({
      kind: "unrepresentable"
    });

    const malformed = {
      ...completedOccurrence([]),
      rule: { kind: "unrepresentable" }
    };
    expect(() =>
      adaptDetectorOccurrenceV2({
        occurrence: malformed as unknown as AdaptableCompletedRuleOccurrenceV2,
        specification: getFindingV2AdapterSpecification(
          "bridge/CCTP_DOMAIN_26"
        ),
        resolveLocation: createRepositoryLocationResolver(projectRoot)
      })
    ).toThrow(TypeError);
  });
});

describe("cross-occurrence fingerprint collisions", () => {
  it("rejects every member and emits one deterministic diagnostic", async () => {
    const finding = await oneCanonicalFinding();
    const result = resolveCrossOccurrenceFindingCollisions([
      candidate(finding, 0, 0, 0),
      candidate(structuredClone(finding), 1, 0, 1)
    ]);

    expect(result.findings).toEqual([]);
    expect(result.diagnostics).toEqual([
      {
        code: "FINDING_V2_CROSS_OCCURRENCE_DUPLICATE_FINGERPRINT",
        category: "internal-error",
        level: "error",
        phase: "analysis",
        origin: "tool",
        message:
          "Canonical findings were rejected because multiple rule occurrences produced the same exact fingerprint.",
        recoverable: true,
        ruleId: finding.ruleId,
        location: finding.primaryLocation
      }
    ]);
  });

  it("preserves unrelated findings and orders groups by first global candidate", async () => {
    const findings = await canonicalFindings();
    const [first, second] = findings;
    if (first === undefined || second === undefined) {
      throw new Error("Expected two canonical findings");
    }
    const unrelated: FindingV2 = {
      ...second,
      fingerprints: {
        exact: {
          ...second.fingerprints.exact,
          value: `sha256:${"a".repeat(63)}b`
        }
      }
    };
    const result = resolveCrossOccurrenceFindingCollisions([
      candidate(structuredClone(second), 2, 0, 4),
      candidate(first, 0, 0, 0),
      candidate(unrelated, 1, 0, 2),
      candidate(structuredClone(first), 3, 0, 3),
      candidate(second, 0, 1, 1)
    ]);

    expect(result.findings).toEqual([unrelated]);
    expect(result.diagnostics).toHaveLength(2);
    expect(result.diagnostics.map(({ ruleId }) => ruleId)).toEqual([
      first.ruleId,
      second.ruleId
    ]);
  });

  it("omits rule and location unless every collision member agrees", async () => {
    const finding = await oneCanonicalFinding();
    const changed = structuredClone(finding);
    changed.ruleId = "bridge/NO_WRAPPED_USDC_ON_ARC";
    changed.primaryLocation = { path: "src/other.ts" };
    const result = resolveCrossOccurrenceFindingCollisions([
      candidate(finding, 0, 0, 0),
      candidate(changed, 1, 0, 1)
    ]);

    expect(result.diagnostics[0]).not.toHaveProperty("ruleId");
    expect(result.diagnostics[0]).not.toHaveProperty("location");
  });

  it("does not leak fingerprint values or source messages", async () => {
    const finding = await oneCanonicalFinding();
    const result = resolveCrossOccurrenceFindingCollisions([
      candidate(finding, 0, 0, 0),
      candidate(structuredClone(finding), 1, 0, 1)
    ]);
    const serialized = JSON.stringify(result.diagnostics);

    expect(serialized).not.toContain(exactFingerprint(finding));
    expect(serialized).not.toContain(finding.message);
    expect(serialized).not.toContain("selectionIndex");
  });

  it("rejects duplicate global-order metadata", async () => {
    const finding = await oneCanonicalFinding();
    expect(() =>
      resolveCrossOccurrenceFindingCollisions([
        candidate(finding, 0, 0, 0),
        candidate(structuredClone(finding), 1, 0, 0)
      ])
    ).toThrow(TypeError);
  });
});

describe("runtime boundaries and diagnostic ordering", () => {
  it("assembles real diagnostics by bucket while preserving references and intra-bucket order", async () => {
    const projectRoot = createProject({});
    const discoveryResult = discoverFilesInstrumented(
      { projectRoot, paths: ["src"], exclude: [] },
      {
        exists: () => true,
        lstat: () => {
          throw new Error("private discovery failure");
        },
        readDirectory: () => []
      }
    );
    const ruleResult = await runRulesStructuredInstrumented(
      [
        createRule("bridge/failure", () => {
          throw new Error("private rule failure");
        })
      ],
      createContext(projectRoot, [])
    );
    const adaptationResult = adaptDetectorOccurrenceV2({
      occurrence: completedOccurrence([
        legacyFinding("bridge/CCTP_DOMAIN_26", []),
        legacyFinding("bridge/CCTP_DOMAIN_26", [
          "src/one.ts",
          "src/two.ts"
        ])
      ]),
      specification: getFindingV2AdapterSpecification(
        "bridge/CCTP_DOMAIN_26"
      ),
      resolveLocation: createRepositoryLocationResolver(projectRoot)
    });
    const finding = await oneCanonicalFinding();
    const collisionResult = resolveCrossOccurrenceFindingCollisions([
      candidate(finding, 0, 0, 0),
      candidate(structuredClone(finding), 1, 0, 1)
    ]);
    const buckets = {
      discovery: [...discoveryResult.instrumentation.diagnostics],
      ruleExecution: [...ruleResult.instrumentation.diagnostics],
      adaptation: [...adaptationResult.diagnostics],
      collisions: [...collisionResult.diagnostics]
    };
    const before = structuredClone(buckets);

    const assembled = assembleInternalScanV2Diagnostics(buckets);

    expect(assembled.map(({ code }) => code)).toEqual([
      "DISCOVERY_LSTAT_FAILED",
      "RULE_EXECUTION_FAILED",
      "FINDING_V2_LOCATION_MISSING",
      "FINDING_V2_LOCATION_AMBIGUOUS",
      "FINDING_V2_CROSS_OCCURRENCE_DUPLICATE_FINGERPRINT"
    ]);
    expect(assembled).not.toBe(buckets.discovery);
    expect(assembled).not.toBe(buckets.ruleExecution);
    expect(assembled).not.toBe(buckets.adaptation);
    expect(assembled).not.toBe(buckets.collisions);
    expect(assembled[0]).toBe(buckets.discovery[0]);
    expect(assembled[1]).toBe(buckets.ruleExecution[0]);
    expect(assembled[2]).toBe(buckets.adaptation[0]);
    expect(assembled[3]).toBe(buckets.adaptation[1]);
    expect(assembled[4]).toBe(buckets.collisions[0]);
    expect(buckets).toEqual(before);
    for (const diagnostic of assembled) {
      validateScanDiagnosticV2(diagnostic);
    }

    const reversedAdaptation = [...buckets.adaptation].reverse();
    const reversed = assembleInternalScanV2Diagnostics({
      ...buckets,
      adaptation: reversedAdaptation
    });
    expect(reversed.slice(2, 4)).toEqual(reversedAdaptation);
    expect(reversed[2]).toBe(reversedAdaptation[0]);
    expect(reversed[3]).toBe(reversedAdaptation[1]);
  });

  it("rejects malformed diagnostic bucket boundaries", () => {
    const valid = {
      discovery: [],
      ruleExecution: [],
      adaptation: [],
      collisions: []
    };
    expect(() =>
      assembleInternalScanV2Diagnostics({
        ...valid,
        extra: []
      } as unknown as Parameters<typeof assembleInternalScanV2Diagnostics>[0])
    ).toThrow(TypeError);
    expect(() =>
      assembleInternalScanV2Diagnostics({
        discovery: [],
        ruleExecution: [],
        adaptation: []
      } as unknown as Parameters<typeof assembleInternalScanV2Diagnostics>[0])
    ).toThrow(TypeError);
    expect(() =>
      assembleInternalScanV2Diagnostics({
        ...valid,
        discovery: null
      } as unknown as Parameters<typeof assembleInternalScanV2Diagnostics>[0])
    ).toThrow(TypeError);
  });

  it("contains one discovery call and no prohibited runtime coupling", () => {
    const source = readFileSync(
      join(import.meta.dirname, "..", "core", "scan-v2", "index.ts"),
      "utf8"
    );
    expect(source.match(/discoverFilesInstrumented\(/g)).toHaveLength(1);
    expect(source).not.toContain("localeCompare");
    expect(source).not.toContain("getRulesForScan");
    expect(source).not.toContain("projectLegacyFindings");
    expect(source).not.toMatch(
      /const (PRESETS|REPORTERS|FAIL_LEVELS|RULE_LEVELS)/
    );
    expect(source).toContain("structuredClone(value)");
  });

  it("does not expose the private runtime from the public entrypoint", () => {
    const publicSource = readFileSync(
      join(import.meta.dirname, "..", "src", "index.ts"),
      "utf8"
    );
    expect(publicSource).not.toContain("scan-v2");
    expect(publicSource).not.toContain("runInternalScanV2");
  });

  it("retains legacy demo finding counts", async () => {
    const broken = await runScan(
      join(repoRoot, "examples", "demo-projects", "broken-arc-integration")
    );
    const fixed = await runScan(
      join(repoRoot, "examples", "demo-projects", "fixed-arc-integration")
    );

    expect(broken.report.findings).toHaveLength(17);
    expect(fixed.report.findings).toHaveLength(0);
  });

  it("returns only the four ScanResultV2 fields and excludes sensitive legacy fields", async () => {
    const result = await scanProject({ "src/cctp.ts": cctpSource });
    expect(Object.keys(result)).toEqual([
      "contractVersion",
      "coverage",
      "findings",
      "diagnostics"
    ]);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(cctpSource.trim());
    for (const forbidden of [
      "timestamp",
      "duration",
      "randomId",
      "projectRoot",
      "stack",
      "fallback",
      "score",
      "status",
      '"config"',
      "legacyFindings",
      "instrumentation"
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });
});

async function scanProject(
  files: Record<string, string>,
  overrides: Partial<ArcReadyConfig> = {}
) {
  const projectRoot = createProject(files);
  return runInternalScanV2({
    projectRoot,
    config: createConfig(overrides)
  });
}

function createProject(files: Record<string, string>): string {
  const projectRoot = mkdtempSync(join(tmpdir(), "arcready-scan-v2-"));
  temporaryRoots.push(projectRoot);
  for (const [relativePath, content] of Object.entries(files)) {
    const absolutePath = join(projectRoot, relativePath);
    mkdirSync(dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, content);
  }
  return projectRoot;
}

function createConfig(
  overrides: Partial<ArcReadyConfig> = {}
): ArcReadyConfig {
  return {
    presets: [...(overrides.presets ?? ["bridge"])],
    paths: [...(overrides.paths ?? ["src"])],
    exclude: [...(overrides.exclude ?? [])],
    reporters: [...(overrides.reporters ?? DEFAULT_CONFIG.reporters)],
    failOn: overrides.failOn ?? DEFAULT_CONFIG.failOn,
    rpc: { ...(overrides.rpc ?? DEFAULT_CONFIG.rpc) },
    rules: { ...(overrides.rules ?? {}) }
  };
}

function createContext(projectRoot: string, files: string[]) {
  return createRuleContext({
    projectRoot,
    config: createConfig(),
    files,
    detectedPresets: {
      detectedPresets: ["bridge"],
      confidence: "high",
      reasons: ["test"]
    }
  });
}

function createRule(
  id: string,
  run: Rule["run"]
): Rule {
  return {
    id,
    name: id,
    description: id,
    preset: "bridge",
    defaultSeverity: "critical",
    docs: ["test"],
    run
  };
}

function legacyFinding(ruleId: string, fileOrFiles: string | string[]): Finding {
  return {
    ruleId,
    severity: "critical",
    message: `Finding for ${ruleId}`,
    files: Array.isArray(fileOrFiles) ? fileOrFiles : [fileOrFiles],
    suggestedFix: "Fix it.",
    docs: "test",
    preset: "bridge"
  };
}

function completedOccurrence(
  detectorFindings: Finding[]
): AdaptableCompletedRuleOccurrenceV2 {
  return {
    selectionIndex: 0,
    rule: { kind: "rule-id", id: "bridge/CCTP_DOMAIN_26" },
    scheduling: "scheduled",
    execution: "completed",
    detectorFindings
  };
}

function validateCompleteResult(
  result: Awaited<ReturnType<typeof runInternalScanV2>>
): void {
  for (const finding of result.findings) {
    validateFindingV2(finding);
  }
  validateCoverageV2(result.coverage);
  for (const diagnostic of result.diagnostics) {
    validateScanDiagnosticV2(diagnostic);
  }
  validateScanResultV2(result);
}

function exactFingerprint(finding: FindingV2 | undefined): string {
  if (finding === undefined) {
    throw new Error("Expected canonical finding");
  }
  return finding.fingerprints.exact.value;
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function candidate(
  finding: FindingV2,
  selectionIndex: number,
  adapterFindingIndex: number,
  globalOrder: number
): InternalCanonicalFindingCandidateV2 {
  return { finding, selectionIndex, adapterFindingIndex, globalOrder };
}

async function oneCanonicalFinding(): Promise<FindingV2> {
  const result = await scanProject({ "src/cctp.ts": cctpSource });
  const finding = result.findings[0];
  if (finding === undefined) {
    throw new Error("Expected canonical finding");
  }
  return finding;
}

async function canonicalFindings(): Promise<readonly FindingV2[]> {
  const result = await scanProject({
    "src/cctp.ts": cctpSource,
    "src/route.ts": wrappedSource
  });
  return result.findings;
}
