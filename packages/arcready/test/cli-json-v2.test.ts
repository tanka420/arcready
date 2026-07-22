import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { validateScanResultV2 } from "../core/contracts/v2/validate.js";
import * as scanV2Runtime from "../core/scan-v2/index.js";
import { jsonReporter } from "../reporters/json/index.js";
import {
  inspectScanOptionPresence,
  runCli,
  type CliIo,
  type ScanOptionPresence
} from "../src/cli.js";
import { runScan } from "../src/report.js";
import * as publicApi from "../src/index.js";

const CCTP_RULE_ID = "bridge/CCTP_DOMAIN_26";
const WRAPPED_RULE_ID = "bridge/NO_WRAPPED_USDC_ON_ARC";
const RELAYER_RULE_ID = "bridge/RELAYER_USES_USDC_FOR_GAS";
const WALLET_RULE_ID = "wallet/ARC_CHAIN_METADATA";
const CCTP_SOURCE = "Arc CCTP bridge\nconst ARC_CCTP_DOMAIN = 7;\n";
const WRAPPED_SOURCE =
  'export const route = { chain: "Arc Testnet", bridge: true, token: "USDC.e" };\n';
const RELAYER_BAD_SOURCE = 'const arcRelayer = { relayerGasToken: "ETH" };\n';
const RELAYER_SAFE_SOURCE = 'const arcRelayer = { relayerGasToken: "USDC" };\n';
const WALLET_BAD_SOURCE =
  "const arcTestnet = { id: 1, name: 'Arc Testnet' };\n";
const SAFE_SOURCE = `Arc CCTP bridge\nconst ARC_CCTP_DOMAIN = 26;\nconst asset = 'USDC';\n${RELAYER_SAFE_SOURCE}`;
const ALL_BAD_SOURCE = `${CCTP_SOURCE}${WRAPPED_SOURCE}${RELAYER_BAD_SOURCE}${WALLET_BAD_SOURCE}`;
const CONFLICT_MESSAGE =
  "--json-v2 cannot be combined with --format, --out, or --fail-on\n";
const temporaryRoots: string[] = [];
const repoRoot = join(import.meta.dirname, "..", "..", "..");

afterEach(() => {
  vi.restoreAllMocks();
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("json-v2 option-role inspection", () => {
  const none: ScanOptionPresence = {
    jsonV2: false,
    format: false,
    out: false,
    failOn: false
  };

  it("recognizes an actual and repeated json-v2 option", () => {
    expect(inspectScanOptionPresence(["--json-v2"])).toEqual({
      ...none,
      jsonV2: true
    });
    expect(inspectScanOptionPresence(["--json-v2", "--json-v2"])).toEqual({
      ...none,
      jsonV2: true
    });
  });

  it.each([
    ["format after", ["--json-v2", "--format", "json"], "format"],
    ["format before", ["--format", "json", "--json-v2"], "format"],
    ["out after", ["--json-v2", "--out", "report.json"], "out"],
    ["out before", ["--out", "report.json", "--json-v2"], "out"],
    ["fail-on after", ["--json-v2", "--fail-on", "critical"], "failOn"],
    ["fail-on before", ["--fail-on", "critical", "--json-v2"], "failOn"]
  ])("recognizes json-v2 with %s", (_name, argv, conflictKey) => {
    expect(inspectScanOptionPresence(argv)).toEqual({
      ...none,
      jsonV2: true,
      [conflictKey]: true
    });
  });

  it.each([
    ["out", ["--out", "--json-v2"], "out"],
    ["format", ["--format", "--json-v2"], "format"],
    ["fail-on", ["--fail-on", "--json-v2"], "failOn"]
  ])(
    "does not double-count a %s value as json-v2",
    (_name, argv, optionKey) => {
      expect(inspectScanOptionPresence(argv)).toEqual({
        ...none,
        [optionKey]: true
      });
    }
  );
});

describe("json-v2 CLI interface", () => {
  it.each([
    [
      "C01/C08 structured relayer-only ETH",
      RELAYER_BAD_SOURCE,
      [RELAYER_RULE_ID],
      1,
      3
    ],
    ["C02 structured relayer USDC", RELAYER_SAFE_SOURCE, [], 0, 4],
    ["C03 prose-only ETH funding", "fund the Arc relayer with ETH\n", [], 0, 4],
    [
      "C04 isolated Ethereum ETH and Arc USDC siblings",
      'const relayers = { ethereum: { relayerGasToken: "ETH" }, arc: { relayerGasToken: "USDC" } };\n',
      [],
      0,
      4
    ],
    [
      "C05 ambiguous duplicate Arc owner",
      'const config = { arc: { relayerGasToken: "ETH" }, arc: { relayerGasToken: "USDC" } };\n',
      [],
      0,
      4
    ],
    ["C06 CCTP-only bad project", CCTP_SOURCE, [CCTP_RULE_ID], 1, 3],
    [
      "C07 wrapped-USDC-only bad project",
      WRAPPED_SOURCE,
      [WRAPPED_RULE_ID],
      1,
      3
    ],
    ["wallet-only bad project", WALLET_BAD_SOURCE, [WALLET_RULE_ID], 1, 3],
    [
      "all four bad patterns",
      ALL_BAD_SOURCE,
      [CCTP_RULE_ID, WRAPPED_RULE_ID, RELAYER_RULE_ID, WALLET_RULE_ID],
      4,
      0
    ],
    ["negative", SAFE_SOURCE, [], 0, 4]
  ] as const)(
    "emits a validated result for a %s repository",
    async (
      _name,
      source,
      ruleIds,
      normalizedFindings,
      completedWithNoFindings
    ) => {
      assertJsonV2Execution(
        await executeJsonV2({ "src/bridge.ts": source }),
        ruleIds,
        [
          0,
          4,
          4,
          normalizedFindings,
          completedWithNoFindings,
          normalizedFindings,
          4
        ]
      );
    }
  );

  it("C10 returns only the relayer finding for the real bridge-bad fixture", async () => {
    const execution = await executeAtRoot(
      ["scan", "--json-v2"],
      join(repoRoot, "fixtures", "bridge-bad")
    );
    assertJsonV2Execution(execution, [RELAYER_RULE_ID], [0, 4, 4, 1, 3, 1, 4]);
  });

  it("preserves the exact JSON document boundary and deterministic bytes", async () => {
    const files = {
      "src/z-cctp.ts": CCTP_SOURCE,
      "src/a-route.ts": WRAPPED_SOURCE,
      "src/m-relayer.ts": RELAYER_BAD_SOURCE
    };
    const first = await executeJsonV2(files);
    const second = await executeJsonV2(files);
    const result = JSON.parse(first.stdout);
    const fingerprints = result.findings.map(
      (finding: { fingerprints: { exact: { value: string } } }) =>
        finding.fingerprints.exact.value
    );

    expect(Object.keys(result)).toEqual([
      "contractVersion",
      "coverage",
      "findings",
      "diagnostics"
    ]);
    expect(result.contractVersion).toBe("2.0");
    expect(first.stdout).toBe(second.stdout);
    expect(first.cwd).not.toBe(second.cwd);
    expect(first.stdout).toMatch(/^\{\n {2}"contractVersion": "2\.0",/);
    expect(first.stdout).toMatch(/\n$/);
    expect(first.stdout).not.toMatch(/\n\n$/);
    expect(first.stdout).not.toContain("\r\n");
    expect(first.stdout.charCodeAt(0)).not.toBe(0xfeff);
    expect(fingerprints).toEqual([...fingerprints].sort(compareCodeUnits));
    expect(result.diagnostics).toEqual(JSON.parse(second.stdout).diagnostics);
  });

  it("does not expose private canonical internals from the public package API", () => {
    expect("runInternalScanV2" in publicApi).toBe(false);
    expect("adaptDetectorOccurrenceV2" in publicApi).toBe(false);
    expect("getFindingV2AdapterSpecification" in publicApi).toBe(false);
  });

  it("does not serialize legacy or sensitive fields", async () => {
    const execution = await executeJsonV2({ "src/cctp.ts": CCTP_SOURCE });
    const forbidden = [
      execution.cwd,
      CCTP_SOURCE.trim(),
      "stack",
      "fallback",
      '"projectRoot"',
      '"timestamp"',
      '"duration"',
      '"instrumentation"',
      '"legacyFindings"'
    ];

    for (const value of forbidden) {
      expect(execution.stdout).not.toContain(value);
    }
    expect(execution.stdout).not.toMatch(/^ {2}"(?:score|status|summary)":/m);
  });

  it("documents the opt-in without changing existing help lines", async () => {
    const execution = await execute(["--help"], {});

    expect(execution.code).toBe(0);
    expect(execution.stdout).toContain(
      "--json-v2           Emit experimental canonical ScanResultV2 JSON to stdout"
    );
    expect(execution.stdout).toContain(
      "arcready scan        Run ArcReady scan"
    );
    expect(execution.stdout).toContain(
      "--format <format>    Render scan as terminal, json, markdown, or html"
    );
    expect(execution.stdout).not.toContain("default json-v2");
  });
});

describe("json-v2 configuration", () => {
  it("respects configured paths and exclusions", async () => {
    const included = await executeJsonV2(
      { "custom/cctp.ts": CCTP_SOURCE },
      { paths: ["custom"], exclude: [] }
    );
    const excluded = await executeJsonV2(
      { "custom/cctp.ts": CCTP_SOURCE },
      { paths: ["custom"], exclude: ["custom/**"] }
    );

    expect(JSON.parse(included.stdout).findings).toHaveLength(1);
    expect(JSON.parse(excluded.stdout).findings).toEqual([]);
    expect(
      JSON.parse(excluded.stdout).coverage.scope.entries.excludedEntries
    ).toBeGreaterThan(0);
  });

  it("C11 disables a bad relayer rule independently", async () => {
    const execution = await executeJsonV2(
      { "src/relayer.ts": RELAYER_BAD_SOURCE },
      { rules: { [RELAYER_RULE_ID]: "off" } }
    );
    assertJsonV2Execution(execution, [], [1, 3, 3, 0, 3, 0, 3]);
  });

  it("preserves the existing two-rule off combination inside the four-rule slice", async () => {
    const execution = await executeJsonV2(
      { "src/bridge.ts": ALL_BAD_SOURCE },
      {
        rules: { [CCTP_RULE_ID]: "off", [WRAPPED_RULE_ID]: "off" }
      }
    );
    assertJsonV2Execution(
      execution,
      [RELAYER_RULE_ID, WALLET_RULE_ID],
      [2, 2, 2, 2, 0, 2, 2]
    );
  });

  it("C12 disables all four canonical rules", async () => {
    const execution = await executeJsonV2(
      { "src/bridge.ts": ALL_BAD_SOURCE },
      {
        rules: {
          [CCTP_RULE_ID]: "off",
          [WRAPPED_RULE_ID]: "off",
          [RELAYER_RULE_ID]: "off",
          [WALLET_RULE_ID]: "off"
        }
      }
    );
    assertJsonV2Execution(execution, [], [4, 0, 0, 0, 0, 0, 0]);
  });

  it("keeps canonical classification and fingerprint independent of severity", async () => {
    const files = { "src/cctp.ts": CCTP_SOURCE };
    const baseline = JSON.parse((await executeJsonV2(files)).stdout)
      .findings[0];
    const overridden = JSON.parse(
      (await executeJsonV2(files, { rules: { [CCTP_RULE_ID]: "info" } })).stdout
    ).findings[0];

    expect(overridden.classification).toEqual(baseline.classification);
    expect(overridden.confidence).toEqual(baseline.confidence);
    expect(overridden.fingerprints).toEqual(baseline.fingerprints);
  });

  it("ignores configured reporters, failOn, presets, and unsupported rules", async () => {
    const execution = await executeJsonV2(
      { "src/cctp.ts": CCTP_SOURCE },
      {
        presets: ["wallet", "app-kit", "bridge"],
        reporters: ["terminal", "json", "markdown", "html"],
        failOn: "critical",
        rules: { "wallet/NO_BLOB_TX_ON_ARC": "critical" }
      }
    );
    const result = JSON.parse(execution.stdout);

    expect(execution.code).toBe(0);
    expect(execution.stderr).toBe("");
    expect(result.coverage.ruleExecution.counts.selectedOccurrences).toBe(4);
    expect(
      result.findings.map(({ ruleId }: { ruleId: string }) => ruleId)
    ).toEqual([CCTP_RULE_ID]);
    expect(execution.stdout).not.toContain("ArcReady v");
    expect(execution.stdout).not.toContain("# ArcReady Report");
    expect(execution.stdout).not.toContain("<!doctype html>");
  });
});

describe("json-v2 conflicts and fatal errors", () => {
  it.each([
    ["json-v2 before valid format", ["--json-v2", "--format", "json"]],
    ["json-v2 before invalid format", ["--json-v2", "--format", "invalid"]],
    ["valid format before json-v2", ["--format", "json", "--json-v2"]],
    ["invalid format before json-v2", ["--format", "invalid", "--json-v2"]],
    ["json-v2 before out", ["--json-v2", "--out", "report.json"]],
    ["out before json-v2", ["--out", "report.json", "--json-v2"]],
    ["json-v2 before valid fail-on", ["--json-v2", "--fail-on", "critical"]],
    ["json-v2 before invalid fail-on", ["--json-v2", "--fail-on", "invalid"]],
    ["valid fail-on before json-v2", ["--fail-on", "critical", "--json-v2"]],
    ["invalid fail-on before json-v2", ["--fail-on", "invalid", "--json-v2"]]
  ])("rejects %s before detailed value validation", async (_name, scanArgs) => {
    const execution = await execute(["scan", ...scanArgs], {
      "arcready.config.json": "not valid json"
    });

    expect(execution.code).toBe(1);
    expect(execution.stdout).toBe("");
    expect(execution.stderr).toBe(CONFLICT_MESSAGE);
    expect(existsSync(join(execution.cwd, "report.json"))).toBe(false);
  });

  it("uses one fixed error for combined conflicts", async () => {
    const execution = await execute(
      [
        "scan",
        "--json-v2",
        "--format",
        "json",
        "--out",
        "report.json",
        "--fail-on",
        "critical"
      ],
      {}
    );

    expect(execution.code).toBe(1);
    expect(execution.stdout).toBe("");
    expect(execution.stderr).toBe(CONFLICT_MESSAGE);
    expect(existsSync(join(execution.cwd, "report.json"))).toBe(false);
  });

  it.each([
    ["out", ["--out", "--json-v2"], "ArcReady error:"],
    [
      "format",
      ["--format", "--json-v2"],
      "--format must be terminal, json, markdown, or html"
    ],
    [
      "fail-on",
      ["--fail-on", "--json-v2"],
      "--fail-on must be critical, warning, info, or none"
    ]
  ])(
    "retains legacy parsing when json-v2 is the %s value",
    async (_name, scanArgs, expectedError) => {
      const execution = await execute(["scan", ...scanArgs], {
        "arcready.config.json": "not valid json"
      });

      expect(execution.code).not.toBe(0);
      expect(execution.stdout).toBe("");
      expect(execution.stderr).toContain(expectedError);
      expect(execution.stderr).not.toContain("ArcReady json-v2 error:");
      expect(execution.stderr).not.toBe(CONFLICT_MESSAGE);
    }
  );

  it("sanitizes invalid configuration failures", async () => {
    const execution = await execute(["scan", "--json-v2"], {
      "arcready.config.json": "private invalid JSON"
    });

    expect(execution.code).toBe(2);
    expect(execution.stdout).toBe("");
    expect(execution.stderr).toBe(
      "ArcReady json-v2 error: invalid configuration.\n"
    );
    expect(execution.stderr).not.toContain(execution.cwd);
    expect(execution.stderr).not.toContain("private invalid JSON");
    expect(execution.stderr).not.toMatch(/\n\s+at /);
  });

  it("sanitizes unexpected canonical runtime failures", async () => {
    vi.spyOn(scanV2Runtime, "runInternalScanV2").mockRejectedValueOnce(
      new Error("private runtime detail")
    );
    const execution = await execute(["scan", "--json-v2"], {});

    expect(execution.code).toBe(2);
    expect(execution.stdout).toBe("");
    expect(execution.stderr).toBe(
      "ArcReady json-v2 error: unable to produce canonical scan output.\n"
    );
    expect(execution.stderr).not.toContain("private runtime detail");
  });

  it("maps a synchronous stdout failure without a second write", async () => {
    const stderr: string[] = [];
    let stdoutWrites = 0;
    const cwd = createProject({ "src/cctp.ts": CCTP_SOURCE });
    const code = await runCli(["scan", "--json-v2"], {
      cwd,
      stdout: {
        write() {
          stdoutWrites += 1;
          throw new Error("private stdout detail");
        }
      },
      stderr: {
        write(chunk) {
          stderr.push(String(chunk));
          return true;
        }
      }
    });

    expect(code).toBe(2);
    expect(stdoutWrites).toBe(1);
    expect(stderr.join("")).toBe(
      "ArcReady json-v2 error: unable to write canonical scan output.\n"
    );
  });
});

describe("legacy CLI regression", () => {
  it("keeps default terminal routing and legacy JSON bytes unchanged", async () => {
    const terminal = await execute(["scan"], {});
    const legacyJson = await execute(["scan", "--format", "json"], {});
    const { report } = await runScan(legacyJson.cwd);

    expect(terminal.code).toBe(0);
    expect(terminal.stdout).toContain("ArcReady v0.3.0");
    expect(terminal.stdout).not.toContain('"contractVersion"');
    expect(terminal.stdout).not.toContain('"selectedOccurrences"');
    expect(legacyJson.stdout).toBe(jsonReporter.render(report));
  });
});

interface Execution {
  code: number;
  cwd: string;
  stdout: string;
  stderr: string;
}

async function executeJsonV2(
  files: Record<string, string>,
  config?: Record<string, unknown>
): Promise<Execution> {
  return execute(["scan", "--json-v2"], files, config);
}

async function execute(
  argv: string[],
  files: Record<string, string>,
  config?: Record<string, unknown>
): Promise<Execution> {
  const cwd = createProject(files);
  if (config !== undefined) {
    writeFileSync(
      join(cwd, "arcready.config.json"),
      `${JSON.stringify(config, null, 2)}\n`
    );
  }
  return executeAtRoot(argv, cwd);
}

async function executeAtRoot(argv: string[], cwd: string): Promise<Execution> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const code = await runCli(argv, createIo(cwd, stdout, stderr));
  return { code, cwd, stdout: stdout.join(""), stderr: stderr.join("") };
}

function assertJsonV2Execution(
  execution: Execution,
  ruleIds: readonly string[],
  expected: readonly [number, number, number, number, number, number, number]
): void {
  const result = JSON.parse(execution.stdout);
  const [
    disabled,
    scheduled,
    completed,
    withFindings,
    withoutFindings,
    normalized,
    reads
  ] = expected;
  expect(execution.code).toBe(0);
  expect(execution.stderr).toBe("");
  expect(
    new Set(result.findings.map(({ ruleId }: { ruleId: string }) => ruleId))
  ).toEqual(new Set(ruleIds));
  expect(result.coverage.ruleExecution.counts).toMatchObject({
    selectedOccurrences: 4,
    disabledOccurrences: disabled,
    scheduledOccurrences: scheduled,
    completedOccurrences: completed,
    failedOccurrences: 0,
    completedWithFindingsOccurrences: withFindings,
    completedWithNoFindingsOccurrences: withoutFindings,
    normalizedDetectorFindings: normalized
  });
  expect(result.coverage.evidence.ruleContextReads.attempts).toBe(reads);
  expect(result.coverage.analysis).toEqual({
    state: "unknown",
    applicability: "unknown",
    reason: "analysis-acknowledgements-unavailable"
  });
  expect(result.diagnostics).toEqual([]);
  validateScanResultV2(result);
}

function createProject(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "arcready-json-v2-"));
  temporaryRoots.push(root);

  for (const [relativePath, content] of Object.entries(files)) {
    const filePath = join(root, relativePath);
    mkdirSync(join(filePath, ".."), { recursive: true });
    writeFileSync(filePath, content);
  }

  return root;
}

function createIo(cwd: string, stdout: string[], stderr: string[]): CliIo {
  return {
    cwd,
    stdout: {
      write(chunk) {
        stdout.push(String(chunk));
        return true;
      }
    },
    stderr: {
      write(chunk) {
        stderr.push(String(chunk));
        return true;
      }
    }
  };
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
