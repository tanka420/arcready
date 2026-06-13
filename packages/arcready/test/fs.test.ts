import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { discoverFiles } from "../src/index.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("discoverFiles", () => {
  it("skips node_modules and dist", () => {
    const projectRoot = createTempProject();
    writeFixture(projectRoot, "src/index.ts", "export const ok = true;");
    writeFixture(
      projectRoot,
      "node_modules/pkg/index.ts",
      "export const bad = true;"
    );
    writeFixture(projectRoot, "dist/index.js", "export const bad = true;");

    const files = discoverRelativeFiles(projectRoot);

    expect(files).toEqual(["src/index.ts"]);
  });

  it("includes supported extensions", () => {
    const projectRoot = createTempProject();
    const supportedFiles = [
      "src/a.ts",
      "src/a.tsx",
      "src/a.js",
      "src/a.jsx",
      "src/a.json",
      "src/a.md",
      "src/a.mdx",
      "src/a.sol",
      "src/a.yaml",
      "src/a.yml"
    ];

    for (const file of supportedFiles) {
      writeFixture(projectRoot, file, "text");
    }

    expect(discoverRelativeFiles(projectRoot)).toEqual(
      [...supportedFiles].sort()
    );
  });

  it("excludes unsupported and binary-like extensions", () => {
    const projectRoot = createTempProject();
    writeFixture(projectRoot, "src/index.ts", "export const ok = true;");
    writeFixture(projectRoot, "src/image.png", "not scanned");
    writeFixture(projectRoot, "src/archive.zip", "not scanned");
    writeFixture(projectRoot, "src/binary.exe", "not scanned");

    const files = discoverFiles({
      projectRoot,
      paths: ["src"],
      exclude: []
    });

    expect(files.map((file) => basename(file))).toEqual(["index.ts"]);
  });

  it("does not follow symlinked directories (symlink loop safety)", () => {
    const projectRoot = createTempProject();
    writeFixture(projectRoot, "src/index.ts", "export const ok = true;");

    let symlinkCreated = false;
    try {
      symlinkSync(projectRoot, join(projectRoot, "src", "loop"));
      symlinkCreated = true;
    } catch {
      // Windows may require elevated privileges for symlinks — skip assertion
    }

    // Whether or not the symlink was created, discovery must not throw or hang
    const files = discoverRelativeFiles(projectRoot);

    if (symlinkCreated) {
      // The symlinked directory must not appear in results
      expect(files).not.toContain("src/loop");
      expect(files.some((f) => f.startsWith("src/loop/"))).toBe(false);
    }

    expect(files).toContain("src/index.ts");
  });
});

function discoverRelativeFiles(projectRoot: string): string[] {
  return discoverFiles({
    projectRoot,
    paths: ["."],
    exclude: ["dist/**"]
  }).map((file) => relative(projectRoot, file).replaceAll("\\", "/"));
}

function createTempProject(): string {
  const projectRoot = mkdtempSync(join(tmpdir(), "arcready-fs-"));
  tempDirs.push(projectRoot);
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
