import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  appKitRules,
  attestation404NotFatalRule,
  bridgeRules,
  createPresetRegistry,
  getRulesForPresets,
  getRulesForScan,
  noEthGasLabelRule,
  runCli,
  runScan,
  walletRules
} from "../src/index.js";
import type {
  ArcReadyRuleLevel,
  CliIo,
  ProjectDetection
} from "../src/index.js";

const ruleId = "wallet/NO_ETH_GAS_LABEL";
const temporaryRoots: string[] = [];
const walletDetection: ProjectDetection = {
  detectedPresets: ["wallet"],
  confidence: "high",
  reasons: ["test wallet project"]
};
const matchingSource =
  'const chainId = 5042002;\nexport const label = "Network fee: 0.01 ETH";';
const siblingSource =
  'export const arcTestnet = { id: 5042002 };\nexport const ethereumGasFee = "Ethereum network fee: 0.01 ETH";';
const expectedMessage =
  "Gas or fee text mentioning ETH/Gwei is co-located in a file with Arc evidence; review whether the text is a user-facing Arc fee label.";
const expectedFix =
  "If this text is rendered to Arc wallet users, display the fee in USDC or USD. Gwei remains valid for internal gas-price units and calculations; correct contrasts, documentation, and non-Arc content may not require changes.";

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("C12 NO_ETH_GAS_LABEL Advice-only migration", () => {
  it("keeps the public known rule but excludes it from the default wallet preset", () => {
    const defaultWalletIds = getRulesForPresets(["wallet"]).map(
      (rule) => rule.id
    );

    expect([...walletRules, ...bridgeRules, ...appKitRules]).toHaveLength(19);
    expect(walletRules).toHaveLength(7);
    expect(walletRules.map((rule) => rule.id)).toContain(ruleId);
    expect(defaultWalletIds).toHaveLength(6);
    expect(defaultWalletIds).not.toContain(ruleId);
    expect(getRulesForPresets(["wallet", "bridge", "app-kit"])).toHaveLength(
      15
    );
    expect(noEthGasLabelRule.defaultSeverity).toBe("info");
  });

  it.each(["info", "warning", "critical"] as const)(
    "selects the known excluded rule exactly once for explicit %s",
    (level) => {
      const rules = getRulesForScan(["wallet"], walletDetection, {
        [ruleId]: level
      });

      expect(rules.filter((rule) => rule.id === ruleId)).toEqual([
        noEthGasLabelRule
      ]);
      expect(rules.at(-1)?.id).toBe(ruleId);
    }
  );

  it("keeps missing, off, and unknown configuration non-selecting", () => {
    const defaultIds = getRulesForScan(["wallet"], walletDetection).map(
      (rule) => rule.id
    );

    expect(defaultIds).not.toContain(ruleId);
    expect(
      getRulesForScan(["wallet"], walletDetection, { [ruleId]: "off" }).map(
        (rule) => rule.id
      )
    ).toEqual(defaultIds);
    expect(
      getRulesForScan(["wallet"], walletDetection, {
        "wallet/UNKNOWN_ADVICE": "critical"
      }).map((rule) => rule.id)
    ).toEqual(defaultIds);
  });

  it("allows explicit selection independently of the configured preset", () => {
    const rules = getRulesForScan(
      ["app-kit"],
      {
        detectedPresets: ["app-kit"],
        confidence: "high",
        reasons: ["test App Kit project"]
      },
      { [ruleId]: "info" }
    );

    expect(rules.filter((rule) => rule.id === ruleId)).toEqual([
      noEthGasLabelRule
    ]);
  });

  it("preserves private excluded-rule order when both advice IDs are enabled", () => {
    const rules = getRulesForScan(
      ["wallet", "bridge"],
      {
        detectedPresets: ["wallet", "bridge"],
        confidence: "high",
        reasons: ["test cross-preset project"]
      },
      {
        [attestation404NotFatalRule.id]: "info",
        [ruleId]: "info"
      }
    );

    expect(
      rules
        .map((rule) => rule.id)
        .filter((id) => id === attestation404NotFatalRule.id || id === ruleId)
    ).toEqual([attestation404NotFatalRule.id, ruleId]);
  });

  it("keeps custom registry instances isolated from built-in advice", () => {
    const registry = createPresetRegistry({ wallet: [] });

    expect(registry.getRulesForScan(["wallet"], walletDetection)).toEqual([]);
  });

  it("removes default finding, score, status, and exit impact", async () => {
    const projectRoot = createProject({}, matchingSource);
    const { report } = await runScan(projectRoot);
    const { exitCode } = await runProjectCli(projectRoot);

    expect(report).toMatchObject({
      score: 100,
      status: "pass",
      summary: { critical: 0, warning: 0, info: 0 },
      findings: []
    });
    expect(exitCode).toBe(0);
  });

  it.each([
    ["info", 98, "pass", 0],
    ["warning", 90, "warn", 0],
    ["critical", 75, "fail", 1]
  ] as const)(
    "runs explicit %s with configured score, status, and exit behavior",
    async (level, score, status, exitCode) => {
      const projectRoot = createProject({ [ruleId]: level }, matchingSource);
      const { report } = await runScan(projectRoot);
      const cliResult = await runProjectCli(projectRoot);

      expect(report).toMatchObject({
        score,
        status,
        summary: {
          critical: level === "critical" ? 1 : 0,
          warning: level === "warning" ? 1 : 0,
          info: level === "info" ? 1 : 0
        }
      });
      expect(report.findings).toHaveLength(1);
      expect(report.findings[0]).toMatchObject({
        ruleId,
        severity: level,
        message: expectedMessage,
        suggestedFix: expectedFix
      });
      expect(cliResult.exitCode).toBe(exitCode);
      expect(cliResult.report).toMatchObject({ score, status });
    }
  );

  it("preserves non-Arc sibling uncertainty in opted-in copy", async () => {
    const projectRoot = createProject({ [ruleId]: "info" }, siblingSource);
    const { report } = await runScan(projectRoot);

    expect(report.findings).toEqual([
      expect.objectContaining({
        ruleId,
        severity: "info",
        message: expectedMessage,
        suggestedFix: expectedFix
      })
    ]);
    expect(report.findings[0]?.message).not.toMatch(/Arc-related (?:gas|fee)/i);
  });
});

function createProject(
  rules: Readonly<Record<string, ArcReadyRuleLevel>>,
  source: string
): string {
  const projectRoot = mkdtempSync(join(tmpdir(), "arcready-c12-"));
  temporaryRoots.push(projectRoot);

  writeFixture(
    projectRoot,
    "package.json",
    JSON.stringify({ name: "c12-advice-fixture" })
  );
  writeFixture(
    projectRoot,
    "arcready.config.json",
    JSON.stringify({ presets: ["wallet"], paths: ["src"], rules })
  );
  writeFixture(projectRoot, "src/fees.ts", source);

  return projectRoot;
}

async function runProjectCli(projectRoot: string) {
  const output: string[] = [];
  const io: CliIo = {
    cwd: projectRoot,
    stdout: {
      write: (chunk: string | Uint8Array) => {
        output.push(String(chunk));
        return true;
      }
    },
    stderr: {
      write: (chunk: string | Uint8Array) => {
        output.push(String(chunk));
        return true;
      }
    }
  };
  const exitCode = await runCli(["scan", "--format", "json"], io);

  return { exitCode, report: JSON.parse(output.join("")) };
}

function writeFixture(
  projectRoot: string,
  filePath: string,
  content: string
): void {
  const absolutePath = join(projectRoot, filePath);
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, content);
}
