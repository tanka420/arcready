import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = join(import.meta.dirname, "..", "..", "..");

describe("GitHub Action wrapper", () => {
  it("defines the local composite action with required inputs", () => {
    const actionPath = join(repoRoot, "actions", "github", "action.yml");
    const action = readFileSync(actionPath, "utf8");

    expect(existsSync(actionPath)).toBe(true);
    expect(action).toContain("using: composite");
    expect(action).toContain("working-directory:");
    expect(action).toContain("format:");
    expect(action).toContain("fail-on:");
    expect(action).toContain("config:");
    expect(action).toContain("upload-artifact:");
    expect(action).toContain("artifact-name:");
    expect(action).toContain("corepack pnpm install --frozen-lockfile");
    expect(action).toContain("corepack pnpm build");
    expect(action).toContain("ARC_READY_CLI=\"packages/arcready/dist/bin.js\"");
    expect(action).toContain(
      "node \"${ARC_READY_CLI}\" scan --format json --out .arcready/reports/arcready.json"
    );
    expect(action).toContain(
      "node \"${ARC_READY_CLI}\" scan --format markdown --out .arcready/reports/arcready.md"
    );
    expect(action).toContain(
      "node \"${ARC_READY_CLI}\" scan --format html --out .arcready/reports/arcready.html"
    );
    expect(action).toContain("GITHUB_STEP_SUMMARY");
    expect(action).toContain("actions/upload-artifact@v4");
    expect(action).toContain("path: ./.arcready/reports");
  });

  it("defines the example workflow using the local action", () => {
    const workflowPath = join(
      repoRoot,
      ".github",
      "workflows",
      "arcready-example.yml"
    );
    const workflow = readFileSync(workflowPath, "utf8");

    expect(existsSync(workflowPath)).toBe(true);
    expect(workflow).toContain("name: ArcReady Example");
    expect(workflow).toContain("pull_request:");
    expect(workflow).toContain("branches: [main]");
    expect(workflow).toContain("actions/checkout@v4");
    expect(workflow).toContain("uses: ./actions/github");
    expect(workflow).toContain("fail-on: critical");
    expect(workflow).toContain("upload-artifact: true");
  });
});
