import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  attestation404NotFatalRule,
  bridgeRules,
  createPresetRegistry,
  getRulesForPresets,
  getRulesForScan,
  runScan
} from "../src/index.js";
import type {
  ArcReadyRuleLevel,
  ProjectDetection
} from "../src/index.js";

const ruleId = "bridge/ATTESTATION_404_NOT_FATAL";
const temporaryRoots: string[] = [];
const detection: ProjectDetection = {
  detectedPresets: ["bridge"],
  confidence: "high",
  reasons: ["test bridge project"]
};
const fatalAttestationSource = `Arc CCTP bridge
export async function pollAttestation(response: Response) {
  if (response.status === 404) {
    throw new Error("attestation failed");
  }
}
`;

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("C08A explicit advice selection", () => {
  it("keeps the rule in all-known bridge inventory but excludes it from the default preset", () => {
    expect(bridgeRules.map((rule) => rule.id)).toContain(ruleId);
    expect(getRulesForPresets(["bridge"]).map((rule) => rule.id)).not.toContain(
      ruleId
    );
  });

  it.each(["info", "warning", "critical"] as const)(
    "selects the known excluded rule exactly once for explicit %s",
    (level) => {
      const rules = getRulesForScan(["bridge"], detection, {
        [ruleId]: level
      });

      expect(rules.filter((rule) => rule.id === ruleId)).toEqual([
        attestation404NotFatalRule
      ]);
      expect(rules.at(-1)?.id).toBe(ruleId);
    }
  );

  it("does not select the rule when its level is missing or off", () => {
    expect(getRulesForScan(["bridge"], detection).map((rule) => rule.id)).not.toContain(
      ruleId
    );
    expect(
      getRulesForScan(["bridge"], detection, { [ruleId]: "off" }).map(
        (rule) => rule.id
      )
    ).not.toContain(ruleId);
  });

  it("does not select unknown configured rule IDs", () => {
    const defaultIds = getRulesForScan(["bridge"], detection).map(
      (rule) => rule.id
    );
    const configuredIds = getRulesForScan(["bridge"], detection, {
      "bridge/UNKNOWN_ADVICE": "critical"
    }).map((rule) => rule.id);

    expect(configuredIds).toEqual(defaultIds);
  });

  it("keeps custom registry instances isolated from built-in excluded rules", () => {
    const registry = createPresetRegistry({ bridge: [] });

    expect(registry.getRulesForScan(["bridge"], detection)).toEqual([]);
  });

  it.each(["info", "warning", "critical"] as const)(
    "runs an explicit %s opt-in with the configured severity",
    async (level) => {
      const { report } = await runScan(createProject({ [ruleId]: level }));
      const findings = report.findings.filter(
        (finding) => finding.ruleId === ruleId
      );

      expect(findings).toHaveLength(1);
      expect(findings[0]?.severity).toBe(level);
    }
  );

  it.each([
    ["missing", {}],
    ["off", { [ruleId]: "off" }],
    ["unknown", { "bridge/UNKNOWN_ADVICE": "critical" }]
  ] as const)("does not run the rule for %s configuration", async (_name, rules) => {
    const { report } = await runScan(createProject(rules));

    expect(report.findings.map((finding) => finding.ruleId)).not.toContain(ruleId);
  });
});

function createProject(
  rules: Readonly<Record<string, ArcReadyRuleLevel>>
): string {
  const projectRoot = mkdtempSync(join(tmpdir(), "arcready-c08a-e1-"));
  temporaryRoots.push(projectRoot);

  writeFixture(projectRoot, "package.json", JSON.stringify({ name: "c08a-e1" }));
  writeFixture(
    projectRoot,
    "arcready.config.json",
    JSON.stringify({
      presets: ["bridge"],
      paths: ["src"],
      rules
    })
  );
  writeFixture(projectRoot, "src/attestation.ts", fatalAttestationSource);

  return projectRoot;
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
