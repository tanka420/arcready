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

const CCTP_RULE_ID = "bridge/CCTP_DOMAIN_26";
const WRAPPED_RULE_ID = "bridge/NO_WRAPPED_USDC_ON_ARC";
const CCTP_SOURCE = "Arc CCTP bridge\nconst ARC_CCTP_DOMAIN = 7;\n";
const WRAPPED_SOURCE =
  "Arc bridge route uses USDC.e as its destination asset.\n";
const SAFE_SOURCE =
  "Arc CCTP bridge\nconst ARC_CCTP_DOMAIN = 26;\nconst asset = 'USDC';\n";
const CONFLICT_MESSAGE =
  "--json-v2 cannot be combined with --format, --out, or --fail-on\n";
const temporaryRoots: string[] = [];

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
    expect(
      inspectScanOptionPresence(["--json-v2", "--json-v2"])
    ).toEqual({ ...none, jsonV2: true });
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
  ])("does not double-count a %s value as json-v2", (_name, argv, optionKey) => {
    expect(inspectScanOptionPresence(argv)).toEqual({
      ...none,
      [optionKey]: true
    });
  });
});

describe("json-v2 CLI interface", () => {
  it.each([
    ["CCTP", { "src/cctp.ts": CCTP_SOURCE }, [CCTP_RULE_ID]],
    ["wrapped USDC", { "src/route.ts": WRAPPED_SOURCE }, [WRAPPED_RULE_ID]],
    [
      "both canonical rules",
      { "src/bridge.ts": `${CCTP_SOURCE}${WRAPPED_SOURCE}` },
      [CCTP_RULE_ID, WRAPPED_RULE_ID]
    ],
    ["negative", { "src/bridge.ts": SAFE_SOURCE }, []]
  ])("emits a validated result for a %s repository", async (_name, files, ruleIds) => {
    const execution = await executeJsonV2(files);
    const result = JSON.parse(execution.stdout);

    expect(execution.code).toBe(0);
    expect(execution.stderr).toBe("");
    expect(new Set(result.findings.map(({ ruleId }: { ruleId: string }) => ruleId))).toEqual(
      new Set(ruleIds)
    );
    expect(result.coverage.ruleExecution.counts.selectedOccurrences).toBe(2);
    expect(result.coverage.analysis).toEqual({
      state: "unknown",
      applicability: "unknown",
      reason: "analysis-acknowledgements-unavailable"
    });
    validateScanResultV2(result);
  });

  it("preserves the exact JSON document boundary and deterministic bytes", async () => {
    const files = {
      "src/z-cctp.ts": CCTP_SOURCE,
      "src/a-route.ts": WRAPPED_SOURCE
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
    expect(first.stdout).toMatch(/^\{\n {2}"contractVersion": "2\.0",/);
    expect(first.stdout).toMatch(/\n$/);
    expect(first.stdout).not.toMatch(/\n\n$/);
    expect(first.stdout).not.toContain("\r\n");
    expect(first.stdout.charCodeAt(0)).not.toBe(0xfeff);
    expect(fingerprints).toEqual([...fingerprints].sort(compareCodeUnits));
    expect(result.diagnostics).toEqual(JSON.parse(second.stdout).diagnostics);
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
    expect(execution.stdout).toContain("arcready scan        Run ArcReady scan");
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

  it("respects one and two supported off overrides", async () => {
    const files = { "src/bridge.ts": `${CCTP_SOURCE}${WRAPPED_SOURCE}` };
    const oneOff = await executeJsonV2(files, {
      rules: { [CCTP_RULE_ID]: "off" }
    });
    const bothOff = await executeJsonV2(files, {
      rules: { [CCTP_RULE_ID]: "off", [WRAPPED_RULE_ID]: "off" }
    });

    expect(JSON.parse(oneOff.stdout).findings.map(({ ruleId }: { ruleId: string }) => ruleId)).toEqual([
      WRAPPED_RULE_ID
    ]);
    expect(JSON.parse(bothOff.stdout).findings).toEqual([]);
    expect(
      JSON.parse(bothOff.stdout).coverage.ruleExecution.counts.disabledOccurrences
    ).toBe(2);
  });

  it("keeps canonical classification and fingerprint independent of severity", async () => {
    const files = { "src/cctp.ts": CCTP_SOURCE };
    const baseline = JSON.parse((await executeJsonV2(files)).stdout).findings[0];
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
        rules: { "wallet/ARC_CHAIN_METADATA": "critical" }
      }
    );
    const result = JSON.parse(execution.stdout);

    expect(execution.code).toBe(0);
    expect(execution.stderr).toBe("");
    expect(result.coverage.ruleExecution.counts.selectedOccurrences).toBe(2);
    expect(result.findings.map(({ ruleId }: { ruleId: string }) => ruleId)).toEqual([
      CCTP_RULE_ID
    ]);
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
    [
      "json-v2 before valid fail-on",
      ["--json-v2", "--fail-on", "critical"]
    ],
    [
      "json-v2 before invalid fail-on",
      ["--json-v2", "--fail-on", "invalid"]
    ],
    [
      "valid fail-on before json-v2",
      ["--fail-on", "critical", "--json-v2"]
    ],
    [
      "invalid fail-on before json-v2",
      ["--fail-on", "invalid", "--json-v2"]
    ]
  ])("rejects %s before detailed value validation", async (_name, scanArgs) => {
    const execution = await execute(
      ["scan", ...scanArgs],
      { "arcready.config.json": "not valid json" }
    );

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
      const execution = await execute(
        ["scan", ...scanArgs],
        { "arcready.config.json": "not valid json" }
      );

      expect(execution.code).not.toBe(0);
      expect(execution.stdout).toBe("");
      expect(execution.stderr).toContain(expectedError);
      expect(execution.stderr).not.toContain("ArcReady json-v2 error:");
      expect(execution.stderr).not.toBe(CONFLICT_MESSAGE);
    }
  );

  it("sanitizes invalid configuration failures", async () => {
    const execution = await execute(
      ["scan", "--json-v2"],
      { "arcready.config.json": "private invalid JSON" }
    );

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
  const stdout: string[] = [];
  const stderr: string[] = [];
  const code = await runCli(argv, createIo(cwd, stdout, stderr));
  return { code, cwd, stdout: stdout.join(""), stderr: stderr.join("") };
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

function createIo(
  cwd: string,
  stdout: string[],
  stderr: string[]
): CliIo {
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
