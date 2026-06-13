import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { detectProject, discoverFiles } from "../src/index.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("detectProject", () => {
  it("detects App Kit from package.json", () => {
    const projectRoot = createTempProject();
    writePackage(projectRoot, {
      dependencies: {
        "@circle-fin/app-kit": "1.0.0"
      }
    });

    expect(detectFixtureProject(projectRoot)).toEqual({
      detectedPresets: ["app-kit"],
      confidence: "high",
      reasons: ["package.json contains @circle-fin/app-kit"]
    });
  });

  it("detects wallet projects from source content", () => {
    const projectRoot = createTempProject();
    writeFixture(
      projectRoot,
      "src/chains.ts",
      "export const arc = { chainId: 123, rpcUrls: {}, nativeCurrency: {} };"
    );

    const detection = detectFixtureProject(projectRoot);

    expect(detection.detectedPresets).toEqual(["wallet"]);
    expect(detection.confidence).toBe("medium");
    expect(detection.reasons.join(" ")).toContain("wallet markers");
  });

  it("detects bridge projects from source content", () => {
    const projectRoot = createTempProject();
    writeFixture(
      projectRoot,
      "src/bridge.ts",
      "export async function relay() { return depositForBurn(); }"
    );

    const detection = detectFixtureProject(projectRoot);

    expect(detection.detectedPresets).toEqual(["bridge"]);
    expect(detection.confidence).toBe("high");
    expect(detection.reasons.join(" ")).toContain("depositForBurn");
  });

  it("returns unknown when no markers are detected", () => {
    const projectRoot = createTempProject();
    writeFixture(projectRoot, "src/index.ts", "export const plain = true;");

    expect(detectFixtureProject(projectRoot)).toEqual({
      detectedPresets: [],
      confidence: "low",
      reasons: ["No wallet, App Kit, or bridge markers detected"]
    });
  });
});

function detectFixtureProject(projectRoot: string) {
  const files = discoverFiles({
    projectRoot,
    paths: ["src", "package.json"],
    exclude: []
  });

  return detectProject({ projectRoot, files });
}

function createTempProject(): string {
  const projectRoot = mkdtempSync(join(tmpdir(), "arcready-project-"));
  tempDirs.push(projectRoot);
  return projectRoot;
}

function writePackage(projectRoot: string, packageJson: unknown): void {
  writeFixture(
    projectRoot,
    "package.json",
    JSON.stringify(packageJson, null, 2)
  );
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
