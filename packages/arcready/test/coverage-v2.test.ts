import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ContractV2ValidationError,
  type ArcReadyContractVersion,
  type CoverageV2,
  type ScanDiagnosticV2
} from "../core/contracts/v2/model.js";
import { validateCoverageV2 } from "../core/contracts/v2/validate.js";
import { deriveCoverageV2 } from "../core/coverage-v2/index.js";
import type {
  DiscoveryEntryOutcomeV1,
  DiscoveryInstrumentationV1,
  DiscoveryRootDispositionV1,
  DiscoveryRootOutcomeV1
} from "../core/fs/instrumentation.js";
import type {
  RuleExecutionInstrumentationV1,
  RuleExecutionOutcomeV1,
  RuleReadAttemptV1
} from "../core/rules/instrumentation.js";
import { jsonReporter } from "../reporters/json/index.js";
import * as publicApi from "../src/index.js";
import { runScan } from "../src/index.js";

describe("CoverageV2 discovery and scope derivation", () => {
  const cases: readonly {
    name: string;
    discovery: DiscoveryInstrumentationV1;
    expectedState: CoverageV2["discovery"]["state"];
    expectedRequested: CoverageV2["scope"]["roots"]["requested"];
    expectedAccepted: number;
  }[] = [
    {
      name: "complete accepted traversal",
      discovery: discovery({ roots: [root("accepted")] }),
      expectedState: "complete",
      expectedRequested: { state: "known", count: 1 },
      expectedAccepted: 1
    },
    {
      name: "multiple accepted roots",
      discovery: discovery({
        roots: [root("accepted", 0), root("accepted", 1)]
      }),
      expectedState: "complete",
      expectedRequested: { state: "known", count: 2 },
      expectedAccepted: 2
    },
    {
      name: "accepted plus unavailable root",
      discovery: discovery({
        roots: [root("accepted", 0), root("unavailable", 1)]
      }),
      expectedState: "partial",
      expectedRequested: { state: "known", count: 2 },
      expectedAccepted: 1
    },
    {
      name: "accepted plus outside root",
      discovery: discovery({
        roots: [root("accepted", 0), root("outside-project-root", 1)]
      }),
      expectedState: "partial",
      expectedRequested: { state: "known", count: 2 },
      expectedAccepted: 1
    },
    {
      name: "all unavailable",
      discovery: discovery({
        roots: [root("unavailable", 0), root("unavailable", 1)]
      }),
      expectedState: "insufficient",
      expectedRequested: { state: "known", count: 2 },
      expectedAccepted: 0
    },
    {
      name: "all outside",
      discovery: discovery({
        roots: [
          root("outside-project-root", 0),
          root("outside-project-root", 1)
        ]
      }),
      expectedState: "insufficient",
      expectedRequested: { state: "known", count: 2 },
      expectedAccepted: 0
    },
    {
      name: "mixed unavailable and outside with no accepted roots",
      discovery: discovery({
        roots: [
          root("unavailable", 0),
          root("outside-project-root", 1)
        ]
      }),
      expectedState: "insufficient",
      expectedRequested: { state: "known", count: 2 },
      expectedAccepted: 0
    },
    {
      name: "no requested roots",
      discovery: discovery(),
      expectedState: "insufficient",
      expectedRequested: { state: "known", count: 0 },
      expectedAccepted: 0
    },
    {
      name: "fatal lstat-equivalent instrumentation",
      discovery: discovery({
        complete: false,
        diagnostics: [fatalDiagnostic("DISCOVERY_LSTAT_FAILED")]
      }),
      expectedState: "failed",
      expectedRequested: { state: "unknown" },
      expectedAccepted: 0
    },
    {
      name: "fatal readdir-equivalent instrumentation",
      discovery: discovery({
        complete: false,
        diagnostics: [fatalDiagnostic("DISCOVERY_READ_DIRECTORY_FAILED")]
      }),
      expectedState: "failed",
      expectedRequested: { state: "unknown" },
      expectedAccepted: 0
    },
    {
      name: "fatal after observed accepted roots",
      discovery: discovery({
        complete: false,
        roots: [root("accepted")],
        entries: [entry()]
      }),
      expectedState: "failed",
      expectedRequested: { state: "unknown" },
      expectedAccepted: 1
    }
  ];

  for (const testCase of cases) {
    it(testCase.name, () => {
      const coverage = derive(testCase.discovery);

      expect(coverage.discovery.state).toBe(testCase.expectedState);
      expect(coverage.scope.roots.requested).toEqual(
        testCase.expectedRequested
      );
      expect(coverage.scope.roots.observedRootOutcomes).toBe(
        testCase.discovery.roots.length
      );
      expect(coverage.scope.roots.acceptedRootOutcomes).toBe(
        testCase.expectedAccepted
      );
      expect(coverage.scope.entries.observation).toBe(
        testCase.discovery.complete ? "complete" : "truncated"
      );
    });
  }

  it("counts accepted roots with no candidates without claiming analysis", () => {
    const coverage = derive(
      discovery({ roots: [root("accepted")], entries: [] })
    );

    expect(coverage.scope.entries.candidateFiles).toBe(0);
    expect(coverage.discovery.state).toBe("complete");
    expect(coverage.analysis.state).toBe("unknown");
  });

  it("counts unsupported regular files separately from exclusions", () => {
    const coverage = derive(
      discovery({
        roots: [root("accepted")],
        entries: [
          entry({ extensionSupport: "unsupported", candidate: false }),
          entry({
            path: { kind: "repository-relative", path: "src/second.txt" },
            extensionSupport: "unsupported",
            candidate: false
          })
        ]
      })
    );

    expect(coverage.scope.entries).toMatchObject({
      uniqueEncounteredEntries: 2,
      excludedEntries: 0,
      extensionSupportedRegularFiles: 0,
      extensionUnsupportedRegularFiles: 2,
      candidateFiles: 0
    });
  });

  it("counts content exclusions across entry types", () => {
    const coverage = derive(
      discovery({
        roots: [root("accepted")],
        entries: [
          entry({
            entryType: "directory",
            exclusionReason: "scanner-directory",
            extensionSupport: "not-evaluated",
            candidate: false
          }),
          entry({
            path: { kind: "repository-relative", path: "src/excluded.ts" },
            exclusionReason: "configured-pattern",
            extensionSupport: "not-evaluated",
            candidate: false
          })
        ]
      })
    );

    expect(coverage.scope.entries).toMatchObject({
      excludedEntries: 2,
      extensionSupportedRegularFiles: 0,
      extensionUnsupportedRegularFiles: 0,
      candidateFiles: 0
    });
  });

  it("uses count-only treatment for unrepresentable entries", () => {
    const coverage = derive(
      discovery({
        roots: [root("accepted")],
        entries: [entry({ path: { kind: "unrepresentable" } })]
      })
    );

    expect(coverage.scope.entries.unrepresentableEntries).toBe(1);
    expect(JSON.stringify(coverage)).not.toContain("src/index.ts");
  });

  it("preserves duplicate root occurrences", () => {
    const duplicate = root("accepted", 0);
    const coverage = derive(
      discovery({ roots: [duplicate, { ...duplicate, requestIndex: 1 }] })
    );

    expect(coverage.scope.roots).toMatchObject({
      requested: { state: "known", count: 2 },
      observedRootOutcomes: 2,
      acceptedRootOutcomes: 2
    });
  });

  it("does not inflate unique entries from overlapping encounter counts", () => {
    const coverage = derive(
      discovery({
        roots: [root("accepted", 0), root("accepted", 1)],
        entries: [entry({ encounterCount: 7 })]
      })
    );

    expect(coverage.scope.entries.uniqueEncounteredEntries).toBe(1);
    expect(JSON.stringify(coverage)).not.toContain("encounterCount");
  });

  it("keeps requested-root count unknown after fatal traversal", () => {
    const coverage = derive(
      discovery({
        complete: false,
        roots: [root("accepted", 0), root("unavailable", 1)]
      })
    );

    expect(coverage.scope.roots.requested).toEqual({ state: "unknown" });
    expect(coverage.scope.roots.observedRootOutcomes).toBe(2);
  });
});

describe("CoverageV2 rule execution derivation", () => {
  const cases: readonly {
    name: string;
    rules: readonly RuleExecutionOutcomeV1[];
    state: CoverageV2["ruleExecution"]["state"];
    counts: Partial<CoverageV2["ruleExecution"]["counts"]>;
  }[] = [
    {
      name: "every scheduled occurrence completed",
      rules: [completedRule(), completedRule({ selectionIndex: 1 })],
      state: "complete",
      counts: { scheduledOccurrences: 2, completedOccurrences: 2 }
    },
    {
      name: "completed with findings",
      rules: [
        completedRule({
          findingEmission: "emitted-findings",
          normalizedFindingCount: 3
        })
      ],
      state: "complete",
      counts: {
        completedWithFindingsOccurrences: 1,
        normalizedDetectorFindings: 3
      }
    },
    {
      name: "completed with no findings",
      rules: [completedRule()],
      state: "complete",
      counts: { completedWithNoFindingsOccurrences: 1 }
    },
    {
      name: "mixed completed and failed",
      rules: [completedRule(), failedRule({ selectionIndex: 1 })],
      state: "partial",
      counts: { completedOccurrences: 1, failedOccurrences: 1 }
    },
    {
      name: "every scheduled occurrence failed",
      rules: [failedRule(), failedRule({ selectionIndex: 1 })],
      state: "failed",
      counts: { scheduledOccurrences: 2, failedOccurrences: 2 }
    },
    {
      name: "disabled plus completed",
      rules: [disabledRule(), completedRule({ selectionIndex: 1 })],
      state: "complete",
      counts: { disabledOccurrences: 1, scheduledOccurrences: 1 }
    },
    {
      name: "all disabled",
      rules: [disabledRule(), disabledRule({ selectionIndex: 1 })],
      state: "insufficient",
      counts: { disabledOccurrences: 2, scheduledOccurrences: 0 }
    },
    {
      name: "no supplied rules",
      rules: [],
      state: "insufficient",
      counts: { selectedOccurrences: 0 }
    },
    {
      name: "normalization failure represented as failed",
      rules: [failedRule()],
      state: "failed",
      counts: { normalizedDetectorFindings: 0 }
    },
    {
      name: "completed rule with unsettled read",
      rules: [
        completedRule({ readAttempts: [readAttempt("unsettled")] })
      ],
      state: "complete",
      counts: { completedOccurrences: 1 }
    },
    {
      name: "completed rule with caught failed read",
      rules: [completedRule({ readAttempts: [readAttempt("failed")] })],
      state: "complete",
      counts: { completedOccurrences: 1 }
    },
    {
      name: "failed rule with unhandled failed read",
      rules: [failedRule({ readAttempts: [readAttempt("failed")] })],
      state: "failed",
      counts: { failedOccurrences: 1 }
    }
  ];

  for (const testCase of cases) {
    it(testCase.name, () => {
      const coverage = derive(undefined, rules(testCase.rules));

      expect(coverage.ruleExecution.state).toBe(testCase.state);
      expect(coverage.ruleExecution.counts).toMatchObject(testCase.counts);
    });
  }

  it("preserves duplicate selected rule occurrences", () => {
    const duplicate = completedRule();
    const coverage = derive(undefined, rules([duplicate, duplicate, duplicate]));

    expect(coverage.ruleExecution.counts).toMatchObject({
      selectedOccurrences: 3,
      scheduledOccurrences: 3,
      completedOccurrences: 3
    });
  });

  it("uses count-only treatment for unsafe rule identities", () => {
    const coverage = derive(
      undefined,
      rules([
        completedRule({ rule: { kind: "unrepresentable" } }),
        disabledRule({
          selectionIndex: 1,
          rule: { kind: "unrepresentable" }
        })
      ])
    );

    expect(
      coverage.ruleExecution.counts.unrepresentableRuleOccurrences
    ).toBe(2);
    expect(JSON.stringify(coverage)).not.toContain("rule-id");
  });

  it("does not count legacy fallback findings as detector findings", () => {
    const instrumented = {
      ...rules([failedRule()]),
      findings: [
        {
          ruleId: "wallet/failure",
          message: "private legacy fallback finding"
        }
      ]
    };
    const coverage = derive(undefined, instrumented);

    expect(coverage.ruleExecution.counts.normalizedDetectorFindings).toBe(0);
    expect(JSON.stringify(coverage)).not.toContain("private legacy fallback");
  });
});

describe("CoverageV2 RuleContext read evidence", () => {
  it("derives zeroes when no attempts were observed", () => {
    expect(derive().evidence.ruleContextReads).toEqual({
      attempts: 0,
      succeeded: 0,
      failed: 0,
      unsettled: 0,
      representablePaths: 0,
      unrepresentablePaths: 0
    });
  });

  it("counts outcomes, path representation, and repeated attempts", () => {
    const repeated = readAttempt("succeeded", {
      kind: "repository-relative",
      path: "src/private.ts"
    });
    const coverage = derive(
      undefined,
      rules([
        completedRule({
          readAttempts: [
            repeated,
            repeated,
            readAttempt("failed", { kind: "project-root" }, 2),
            readAttempt("unsettled", { kind: "unrepresentable" }, 3)
          ]
        })
      ])
    );

    expect(coverage.evidence.ruleContextReads).toEqual({
      attempts: 4,
      succeeded: 2,
      failed: 1,
      unsettled: 1,
      representablePaths: 3,
      unrepresentablePaths: 1
    });
    const serialized = JSON.stringify(coverage);
    expect(serialized).not.toContain("src/private.ts");
    expect(serialized).not.toContain("attemptIndex");
  });

  it("does not copy content or raw errors from extended input records", () => {
    const unsafeAttempt = {
      ...readAttempt("failed"),
      content: "private source content",
      error: "private raw error"
    };
    const coverage = derive(
      undefined,
      rules([completedRule({ readAttempts: [unsafeAttempt] })])
    );
    const serialized = JSON.stringify(coverage);

    expect(serialized).not.toContain("private source content");
    expect(serialized).not.toContain("private raw error");
  });
});

describe("CoverageV2 validation", () => {
  it("accepts a valid derived object without changing it", () => {
    const coverage = validCoverage();
    const snapshot = structuredClone(coverage);

    expect(() => validateCoverageV2(coverage)).not.toThrow();
    expect(coverage).toEqual(snapshot);
  });

  it.each([
    ["null", null],
    ["array", []],
    ["non-plain object", new (class Coverage {})()]
  ])("rejects %s as a top-level value", (_name, value) => {
    expect(() => validateCoverageV2(value)).toThrow(
      ContractV2ValidationError
    );
  });

  const nestedClassCases: readonly [
    string,
    (coverage: CoverageV2) => void
  ][] = [
    ["scope", (value) => (value.scope = classInstance(value.scope))],
    [
      "scope roots",
      (value) => (value.scope.roots = classInstance(value.scope.roots))
    ],
    [
      "requested roots",
      (value) =>
        (value.scope.roots.requested = classInstance(
          value.scope.roots.requested
        ))
    ],
    [
      "rule execution counts",
      (value) =>
        (value.ruleExecution.counts = classInstance(
          value.ruleExecution.counts
        ))
    ],
    [
      "RuleContext read evidence",
      (value) =>
        (value.evidence.ruleContextReads = classInstance(
          value.evidence.ruleContextReads
        ))
    ]
  ];

  it.each(nestedClassCases)(
    "rejects a class instance at nested %s",
    (_name, mutate) => {
      const coverage = validCoverage();
      mutate(coverage);

      expect(() => validateCoverageV2(coverage)).toThrow(/plain object/);
    }
  );

  const unknownFieldCases: readonly [
    string,
    (coverage: CoverageV2) => void
  ][] = [
    ["top level", (value) => Object.assign(value, { extra: true })],
    ["scope", (value) => Object.assign(value.scope, { extra: true })],
    ["roots", (value) => Object.assign(value.scope.roots, { extra: true })],
    [
      "requested roots",
      (value) => Object.assign(value.scope.roots.requested, { extra: true })
    ],
    ["entries", (value) => Object.assign(value.scope.entries, { extra: true })],
    [
      "discovery",
      (value) => Object.assign(value.discovery, { extra: true })
    ],
    [
      "rule execution",
      (value) => Object.assign(value.ruleExecution, { extra: true })
    ],
    [
      "rule counts",
      (value) => Object.assign(value.ruleExecution.counts, { extra: true })
    ],
    ["analysis", (value) => Object.assign(value.analysis, { extra: true })],
    ["evidence", (value) => Object.assign(value.evidence, { extra: true })],
    [
      "read evidence",
      (value) => Object.assign(value.evidence.ruleContextReads, { extra: true })
    ]
  ];

  it.each(unknownFieldCases)("rejects unknown fields at %s", (_name, mutate) => {
    const coverage = validCoverage();
    mutate(coverage);

    expect(() => validateCoverageV2(coverage)).toThrow(
      ContractV2ValidationError
    );
  });

  it("rejects a wrong contract version", () => {
    const coverage = validCoverage();
    coverage.contractVersion = "3.0" as ArcReadyContractVersion;

    expectInvalid(coverage);
  });

  it("rejects invalid literal states", () => {
    const values = [
      invalidCoverage((value) => {
        value.discovery.state = "invalid" as CoverageV2["discovery"]["state"];
      }),
      invalidCoverage((value) => {
        value.ruleExecution.state =
          "invalid" as CoverageV2["ruleExecution"]["state"];
      }),
      invalidCoverage((value) => {
        value.scope.entries.observation = "invalid" as "complete";
      })
    ];

    for (const value of values) {
      expectInvalid(value);
    }
  });

  it.each([
    ["negative", -1],
    ["fraction", 0.5],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["unsafe integer", Number.MAX_SAFE_INTEGER + 1]
  ])("rejects a %s count", (_name, count) => {
    const coverage = invalidCoverage((value) => {
      value.scope.entries.uniqueEncounteredEntries = count;
    });

    expectInvalid(coverage);
  });

  it("rejects a root disposition equation violation", () => {
    expectInvalid(
      invalidCoverage((value) => {
        value.scope.roots.unavailableRootOutcomes = 1;
      })
    );
  });

  it("rejects safe-integer overflow in a root equation", () => {
    expectInvalid(
      invalidCoverage((value) => {
        value.scope.roots.observedRootOutcomes = Number.MAX_SAFE_INTEGER;
        value.scope.roots.acceptedRootOutcomes = Number.MAX_SAFE_INTEGER;
        value.scope.roots.unavailableRootOutcomes = 1;
        if (value.scope.roots.requested.state === "known") {
          value.scope.roots.requested.count = Number.MAX_SAFE_INTEGER;
        }
      })
    );
  });

  it("rejects a known requested-root mismatch", () => {
    expectInvalid(
      invalidCoverage((value) => {
        if (value.scope.roots.requested.state === "known") {
          value.scope.roots.requested.count = 2;
        }
      })
    );
  });

  it("rejects unknown requested roots with nonfailed discovery", () => {
    expectInvalid(
      invalidCoverage((value) => {
        value.scope.roots.requested = { state: "unknown" };
      })
    );
  });

  it.each([
    ["complete", (value: CoverageV2) => (value.scope.roots.acceptedRootOutcomes = 0)],
    [
      "partial",
      (value: CoverageV2) => {
        value.discovery.state = "partial";
      }
    ],
    [
      "insufficient",
      (value: CoverageV2) => {
        value.discovery.state = "insufficient";
      }
    ],
    [
      "failed",
      (value: CoverageV2) => {
        value.discovery.state = "failed";
      }
    ]
  ])("rejects a discovery %s invariant violation", (_name, mutate) => {
    const coverage = validCoverage();
    mutate(coverage);
    expectInvalid(coverage);
  });

  it("rejects entry counts beyond encountered entries", () => {
    expectInvalid(
      invalidCoverage((value) => {
        value.scope.entries.excludedEntries = 2;
      })
    );
  });

  it("rejects mutually exclusive extension counts beyond encountered entries", () => {
    expectInvalid(
      invalidCoverage((value) => {
        value.scope.entries.extensionUnsupportedRegularFiles = 1;
      })
    );
  });

  it("accepts extension counts equal to encountered entries with overlapping dimensions", () => {
    const coverage = derive(
      discovery({
        roots: [root("accepted")],
        entries: [
          entry(),
          entry({
            path: { kind: "unrepresentable" },
            exclusionReason: "configured-pattern",
            extensionSupport: "unsupported",
            candidate: false
          })
        ]
      })
    );

    expect(coverage.scope.entries).toMatchObject({
      uniqueEncounteredEntries: 2,
      excludedEntries: 1,
      extensionSupportedRegularFiles: 1,
      extensionUnsupportedRegularFiles: 1,
      candidateFiles: 1,
      unrepresentableEntries: 1
    });
    expect(() => validateCoverageV2(coverage)).not.toThrow();
  });

  it("rejects candidate counts beyond supported regular files", () => {
    expectInvalid(
      invalidCoverage((value) => {
        value.scope.entries.extensionSupportedRegularFiles = 0;
      })
    );
  });

  it.each([
    [
      "selected rule",
      (value: CoverageV2) => (value.ruleExecution.counts.selectedOccurrences = 2)
    ],
    [
      "scheduled rule",
      (value: CoverageV2) => (value.ruleExecution.counts.scheduledOccurrences = 2)
    ],
    [
      "completed emission",
      (value: CoverageV2) =>
        (value.ruleExecution.counts.completedWithNoFindingsOccurrences = 0)
    ]
  ])("rejects a %s equation violation", (_name, mutate) => {
    const coverage = validCoverage();
    mutate(coverage);
    expectInvalid(coverage);
  });

  it.each([
    [
      "findings without emitting occurrences",
      (value: CoverageV2) =>
        (value.ruleExecution.counts.normalizedDetectorFindings = 1)
    ],
    [
      "too few findings for emitting occurrences",
      (value: CoverageV2) => {
        value.ruleExecution.counts.completedWithNoFindingsOccurrences = 0;
        value.ruleExecution.counts.completedWithFindingsOccurrences = 1;
        value.ruleExecution.counts.normalizedDetectorFindings = 0;
      }
    ]
  ])("rejects %s", (_name, mutate) => {
    const coverage = validCoverage();
    mutate(coverage);
    expectInvalid(coverage);
  });

  it.each([
    [
      "complete",
      (value: CoverageV2) => {
        value.ruleExecution.counts.completedOccurrences = 0;
        value.ruleExecution.counts.failedOccurrences = 1;
        value.ruleExecution.counts.completedWithNoFindingsOccurrences = 0;
      }
    ],
    [
      "partial",
      (value: CoverageV2) => {
        value.ruleExecution.state = "partial";
      }
    ],
    [
      "failed",
      (value: CoverageV2) => {
        value.ruleExecution.state = "failed";
      }
    ],
    [
      "insufficient",
      (value: CoverageV2) => {
        value.ruleExecution.state = "insufficient";
      }
    ]
  ])("rejects a rule execution %s invariant violation", (_name, mutate) => {
    const coverage = validCoverage();
    mutate(coverage);
    expectInvalid(coverage);
  });

  it("rejects an invalid read outcome equation", () => {
    expectInvalid(
      invalidCoverage((value) => {
        value.evidence.ruleContextReads.succeeded = 0;
      })
    );
  });

  it("rejects an invalid read path equation", () => {
    expectInvalid(
      invalidCoverage((value) => {
        value.evidence.ruleContextReads.representablePaths = 0;
      })
    );
  });

  it.each([
    ["analysis state", (value: CoverageV2) => (value.analysis.state = "complete" as "unknown")],
    [
      "applicability",
      (value: CoverageV2) =>
        (value.analysis.applicability = "applicable" as "unknown")
    ],
    [
      "analysis reason",
      (value: CoverageV2) =>
        (value.analysis.reason = "other" as CoverageV2["analysis"]["reason"])
    ]
  ])("rejects a nonconstant %s", (_name, mutate) => {
    const coverage = validCoverage();
    mutate(coverage);
    expectInvalid(coverage);
  });
});

describe("CoverageV2 determinism and boundaries", () => {
  it("is deterministic and does not mutate its inputs", () => {
    const input = {
      discovery: discovery({
        roots: [root("accepted")],
        entries: [entry({ encounterCount: 3 })]
      }),
      ruleExecution: rules([
        completedRule({ readAttempts: [readAttempt("succeeded")] })
      ])
    };
    const snapshot = structuredClone(input);

    expect(deriveCoverageV2(input)).toEqual(deriveCoverageV2(input));
    expect(input).toEqual(snapshot);
  });

  it("excludes sensitive, diagnostic, legacy, and nondeterministic data", () => {
    const input = {
      discovery: {
        ...discovery({
          complete: false,
          diagnostics: [fatalDiagnostic("PRIVATE_ABSOLUTE_C_PATH")]
        }),
        absolutePath: "C:\\private\\source.ts",
        sourceContent: "private source content"
      },
      ruleExecution: {
        ...rules([failedRule()]),
        legacyFindings: [{ message: "private legacy finding" }],
        timestamp: "2026-07-20T00:00:00Z",
        duration: 42
      }
    };
    const serialized = JSON.stringify(deriveCoverageV2(input));

    expect(serialized).not.toContain("C:\\private");
    expect(serialized).not.toContain("private source content");
    expect(serialized).not.toContain("PRIVATE_ABSOLUTE_C_PATH");
    expect(serialized).not.toContain("private legacy finding");
    expect(serialized).not.toMatch(/timestamp|duration|percentage|ratio|score/i);
    expect(serialized).not.toMatch(/overallStatus|compatible|passed/i);
  });

  it("always leaves analysis and applicability unknown", () => {
    const coverage = derive(
      discovery({ roots: [root("accepted")], entries: [entry()] }),
      rules([
        completedRule({
          findingEmission: "emitted-findings",
          normalizedFindingCount: 2,
          readAttempts: [readAttempt("succeeded")]
        })
      ])
    );

    expect(coverage.analysis).toEqual({
      state: "unknown",
      applicability: "unknown",
      reason: "analysis-acknowledgements-unavailable"
    });
  });

  it("does not expose CoverageV2 or derivation from the public package API", () => {
    expect("CoverageV2" in publicApi).toBe(false);
    expect("deriveCoverageV2" in publicApi).toBe(false);
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
}\n`);
  });
});

function derive(
  discoveryInstrumentation = discovery({ roots: [root("accepted")], entries: [entry()] }),
  ruleExecutionInstrumentation = rules([completedRule()])
): CoverageV2 {
  return deriveCoverageV2({
    discovery: discoveryInstrumentation,
    ruleExecution: ruleExecutionInstrumentation
  });
}

function discovery(
  overrides: Partial<DiscoveryInstrumentationV1> = {}
): DiscoveryInstrumentationV1 {
  return {
    roots: [],
    entries: [],
    diagnostics: [],
    complete: true,
    ...overrides
  };
}

function root(
  disposition: DiscoveryRootDispositionV1,
  requestIndex = 0
): DiscoveryRootOutcomeV1 {
  return {
    requestIndex,
    path:
      requestIndex === 0
        ? { kind: "project-root" }
        : { kind: "repository-relative", path: `root-${requestIndex}` },
    disposition
  };
}

function entry(
  overrides: Partial<DiscoveryEntryOutcomeV1> = {}
): DiscoveryEntryOutcomeV1 {
  return {
    path: { kind: "repository-relative", path: "src/index.ts" },
    entryType: "file",
    extensionSupport: "supported",
    candidate: true,
    encounterCount: 1,
    ...overrides
  };
}

function fatalDiagnostic(code: string): ScanDiagnosticV2 {
  return {
    code,
    category: "discovery-error",
    level: "error",
    phase: "discovery",
    origin: "repository",
    message: "Private diagnostic message.",
    recoverable: false
  };
}

function rules(
  ruleOutcomes: readonly RuleExecutionOutcomeV1[] = []
): RuleExecutionInstrumentationV1 {
  return { rules: ruleOutcomes, diagnostics: [] };
}

function completedRule(
  overrides: Partial<RuleExecutionOutcomeV1> = {}
): RuleExecutionOutcomeV1 {
  return {
    selectionIndex: 0,
    rule: { kind: "rule-id", id: "wallet/test" },
    scheduling: "scheduled",
    execution: "completed",
    findingEmission: "emitted-no-findings",
    normalizedFindingCount: 0,
    applicability: "unknown",
    readAttempts: [],
    ...overrides
  };
}

function failedRule(
  overrides: Partial<RuleExecutionOutcomeV1> = {}
): RuleExecutionOutcomeV1 {
  return {
    selectionIndex: 0,
    rule: { kind: "rule-id", id: "wallet/failed" },
    scheduling: "scheduled",
    execution: "failed",
    findingEmission: "not-evaluated",
    normalizedFindingCount: 0,
    applicability: "unknown",
    readAttempts: [],
    ...overrides
  };
}

function disabledRule(
  overrides: Partial<RuleExecutionOutcomeV1> = {}
): RuleExecutionOutcomeV1 {
  return {
    selectionIndex: 0,
    rule: { kind: "rule-id", id: "wallet/disabled" },
    scheduling: "disabled",
    execution: "not-run",
    findingEmission: "not-evaluated",
    normalizedFindingCount: 0,
    applicability: "unknown",
    readAttempts: [],
    ...overrides
  };
}

function readAttempt(
  outcome: RuleReadAttemptV1["outcome"],
  path: RuleReadAttemptV1["path"] = {
    kind: "repository-relative",
    path: "src/read.ts"
  },
  attemptIndex = 0
): RuleReadAttemptV1 {
  return { attemptIndex, path, outcome };
}

function validCoverage(): CoverageV2 {
  return derive(
    discovery({ roots: [root("accepted")], entries: [entry()] }),
    rules([
      completedRule({ readAttempts: [readAttempt("succeeded")] })
    ])
  );
}

function invalidCoverage(mutate: (value: CoverageV2) => void): CoverageV2 {
  const coverage = validCoverage();
  mutate(coverage);
  return coverage;
}

function expectInvalid(value: unknown): void {
  expect(() => validateCoverageV2(value)).toThrow(ContractV2ValidationError);
}

class NestedCoverageValue {}

function classInstance<Value extends object>(value: Value): Value {
  return Object.assign(new NestedCoverageValue(), value) as Value;
}
