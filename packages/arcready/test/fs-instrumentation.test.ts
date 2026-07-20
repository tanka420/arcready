import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { validateScanDiagnosticV2 } from "../core/contracts/v2/validate.js";
import { discoverFiles, discoverFilesInstrumented } from "../core/fs/index.js";
import {
  defaultDiscoveryFileSystem,
  DiscoveryInstrumentationRecorder,
  representNativeDiscoveryPath,
  type DiscoveryEntryOutcomeV1,
  type DiscoveryFileSystem
} from "../core/fs/instrumentation.js";
import { jsonReporter, runScan } from "../src/index.js";
import * as publicApi from "../src/index.js";

const tempDirs: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();

  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("instrumented discovery parity", () => {
  it("preserves legacy candidates, sorting, exclusions, and overlapping-root deduplication", () => {
    const projectRoot = createTempProject();
    writeFixture(projectRoot, "src/index.ts", "export const ok = true;");
    writeFixture(projectRoot, "src/image.png", "unsupported");
    writeFixture(projectRoot, "src/.hidden.ts", "export {};");
    writeFixture(projectRoot, "src/MixedCase.ts", "export {};");
    writeFixture(projectRoot, "src/Ünicode.ts", "export {};");
    writeFixture(projectRoot, "build/output.ts", "export {};");
    writeFixture(projectRoot, "node_modules/pkg/index.ts", "export {};");
    writeFixture(projectRoot, "dist/index.js", "export {};");
    writeFixture(projectRoot, "ignored/secret.ts", "export {};");

    const options = {
      projectRoot,
      paths: [".", "src", "src", "missing", join(projectRoot, "..")],
      exclude: ["ignored/**", "dist/**"]
    };
    const legacyFiles = discoverFiles(options);
    const instrumented = discoverFilesInstrumented(options);

    expect(instrumented.files).toEqual(legacyFiles);
    expect(instrumented.files.every((file) => resolve(file) === file)).toBe(
      true
    );
    expect(relativeFiles(projectRoot, instrumented.files)).toEqual(
      [
        "build/output.ts",
        "src/.hidden.ts",
        "src/index.ts",
        "src/MixedCase.ts",
        "src/Ünicode.ts"
      ].sort((left, right) =>
        join(projectRoot, left).localeCompare(join(projectRoot, right))
      )
    );
    expect(instrumented.instrumentation.complete).toBe(true);
    expect(instrumented.instrumentation.diagnostics).toEqual([]);

    expect(instrumented.instrumentation.roots).toEqual([
      {
        requestIndex: 0,
        path: { kind: "project-root" },
        disposition: "accepted"
      },
      {
        requestIndex: 1,
        path: { kind: "repository-relative", path: "src" },
        disposition: "accepted"
      },
      {
        requestIndex: 2,
        path: { kind: "repository-relative", path: "src" },
        disposition: "accepted"
      },
      {
        requestIndex: 3,
        path: { kind: "repository-relative", path: "missing" },
        disposition: "unavailable"
      },
      {
        requestIndex: 4,
        path: { kind: "unrepresentable" },
        disposition: "outside-project-root"
      }
    ]);

    expect(entryAt(instrumented.instrumentation.entries, "src")).toMatchObject({
      entryType: "directory",
      extensionSupport: "not-evaluated",
      candidate: false,
      encounterCount: 3
    });
    expect(
      entryAt(instrumented.instrumentation.entries, "src/index.ts")
    ).toMatchObject({
      entryType: "file",
      extensionSupport: "supported",
      candidate: true,
      encounterCount: 3
    });
    expect(
      entryAt(instrumented.instrumentation.entries, "src/image.png")
    ).toMatchObject({
      entryType: "file",
      extensionSupport: "unsupported",
      candidate: false,
      encounterCount: 3
    });
    expect(
      entryAt(instrumented.instrumentation.entries, "ignored")
    ).toMatchObject({
      exclusionReason: "configured-pattern",
      configuredPatternIndex: 0,
      extensionSupport: "not-evaluated",
      candidate: false
    });
    expect(entryAt(instrumented.instrumentation.entries, "dist")).toMatchObject(
      {
        exclusionReason: "configured-pattern",
        configuredPatternIndex: 1
      }
    );
    expect(
      entryAt(instrumented.instrumentation.entries, "node_modules")
    ).toMatchObject({
      exclusionReason: "scanner-directory",
      entryType: "directory"
    });
    expect(
      instrumented.instrumentation.entries.some(
        (entry) =>
          entry.path.kind === "repository-relative" &&
          (entry.path.path === "ignored/secret.ts" ||
            entry.path.path === "node_modules/pkg/index.ts")
      )
    ).toBe(false);
  });

  it("uses deterministic canonical ordering without changing legacy ordering", () => {
    const projectRoot = createTempProject();
    writeFixture(projectRoot, "z.ts", "export {};");
    writeFixture(projectRoot, "A.ts", "export {};");
    writeFixture(projectRoot, "ä.ts", "export {};");
    const options = { projectRoot, paths: ["."], exclude: [] };

    const first = discoverFilesInstrumented(options);
    const second = discoverFilesInstrumented(options);
    const safePaths = first.instrumentation.entries.map((entry) =>
      entry.path.kind === "project-root"
        ? ""
        : entry.path.kind === "repository-relative"
          ? entry.path.path
          : "unrepresentable"
    );

    expect(first).toEqual(second);
    expect(first.files).toEqual(discoverFiles(options));
    expect(safePaths).toEqual(["", "A.ts", "z.ts", "ä.ts"]);
    expect(JSON.stringify(first.instrumentation)).not.toContain(projectRoot);
    expect(JSON.stringify(first.instrumentation)).not.toMatch(
      /timestamp|duration/i
    );
  });
});

describe("instrumented discovery entry facts", () => {
  it("separates Windows-native separators from POSIX literal backslashes", () => {
    const windowsPath = representNativeDiscoveryPath(
      "Src\\Unicode\\File.ts",
      "\\"
    );
    const posixLiteralBackslash = representNativeDiscoveryPath(
      "src/a\\b.ts",
      "/"
    );
    const posixNestedPath = representNativeDiscoveryPath("src/a/b.ts", "/");

    expect(windowsPath).toEqual({
      kind: "repository-relative",
      path: "Src/Unicode/File.ts"
    });
    expect(posixLiteralBackslash).toEqual({ kind: "unrepresentable" });
    expect(posixNestedPath).toEqual({
      kind: "repository-relative",
      path: "src/a/b.ts"
    });
    expect(posixLiteralBackslash).not.toEqual(posixNestedPath);
    expect(representNativeDiscoveryPath("")).toEqual({
      kind: "project-root"
    });
  });

  it("keeps unrelated POSIX literal-backslash entries distinct and private", () => {
    const recorder = new DiscoveryInstrumentationRecorder();
    const firstPath = representNativeDiscoveryPath("src/a\\b.ts", "/");
    const secondPath = representNativeDiscoveryPath("src/c\\d.ts", "/");

    recorder.recordEntry("private:first", {
      path: firstPath,
      entryType: "file",
      extensionSupport: "supported",
      candidate: true
    });
    recorder.recordEntry("private:second", {
      path: secondPath,
      entryType: "file",
      extensionSupport: "supported",
      candidate: true
    });

    const instrumentation = recorder.build(true);
    expect(instrumentation.entries).toHaveLength(2);
    expect(
      instrumentation.entries.every(
        (entry) => entry.path.kind === "unrepresentable" && entry.candidate
      )
    ).toBe(true);
    expect(JSON.stringify(instrumentation)).not.toContain("private:");
    expect(JSON.stringify(instrumentation)).not.toContain("a\\\\b.ts");
    expect(JSON.stringify(instrumentation)).not.toContain("c\\\\d.ts");
  });

  it("omits a diagnostic location for a POSIX literal-backslash path", () => {
    const recorder = new DiscoveryInstrumentationRecorder();
    recorder.recordFatalDiagnostic(
      "lstat",
      representNativeDiscoveryPath("src/a\\b.ts", "/")
    );

    expect(recorder.build(false).diagnostics).toEqual([
      {
        code: "DISCOVERY_LSTAT_FAILED",
        category: "discovery-error",
        level: "error",
        phase: "discovery",
        origin: "repository",
        message: "Filesystem entry metadata could not be read.",
        recoverable: false
      }
    ]);
  });

  it("records symlinks without traversing their targets", () => {
    const projectRoot = createTempProject();
    const root = resolve(projectRoot);
    const link = join(root, "link");
    const visitedDirectories: string[] = [];
    const fileSystem: DiscoveryFileSystem = {
      exists: () => true,
      lstat: (path) => fakeStat(path === link ? "symlink" : "directory"),
      readDirectory: (path) => {
        visitedDirectories.push(path);
        return path === root ? ["link"] : [];
      }
    };

    const result = discoverFilesInstrumented(
      { projectRoot, paths: ["."], exclude: [] },
      fileSystem
    );

    expect(entryAt(result.instrumentation.entries, "link")).toMatchObject({
      entryType: "symlink",
      exclusionReason: "symlink-not-followed",
      extensionSupport: "not-evaluated",
      candidate: false
    });
    expect(visitedDirectories).toEqual([root]);
  });

  it("records other entry types through the narrow filesystem adapter", () => {
    const projectRoot = createTempProject();
    const root = resolve(projectRoot);
    const socket = join(root, "service.sock");
    const fileSystem: DiscoveryFileSystem = {
      exists: () => true,
      lstat: (path) => fakeStat(path === socket ? "other" : "directory"),
      readDirectory: () => ["service.sock"]
    };

    const result = discoverFilesInstrumented(
      { projectRoot, paths: ["."], exclude: [] },
      fileSystem
    );

    expect(entryAt(result.instrumentation.entries, "service.sock")).toEqual({
      path: { kind: "repository-relative", path: "service.sock" },
      entryType: "other",
      extensionSupport: "not-evaluated",
      candidate: false,
      encounterCount: 1
    });
  });

  it("keeps unrelated unrepresentable entries distinct without changing candidates", () => {
    const projectRoot = createTempProject();
    const root = resolve(projectRoot);
    const names = ["secret\u0001.ts", "other\u0002.ts"];
    const fileSystem: DiscoveryFileSystem = {
      exists: () => true,
      lstat: (path) => fakeStat(path === root ? "directory" : "file"),
      readDirectory: () => [...names]
    };

    const result = discoverFilesInstrumented(
      { projectRoot, paths: ["."], exclude: [] },
      fileSystem
    );
    const unrepresentable = result.instrumentation.entries.filter(
      (entry) => entry.path.kind === "unrepresentable"
    );
    const serialized = JSON.stringify(result.instrumentation);

    expect(result.files).toEqual(
      names
        .map((name) => join(root, name))
        .sort((left, right) => left.localeCompare(right))
    );
    expect(unrepresentable).toHaveLength(2);
    expect(unrepresentable.every((entry) => entry.candidate)).toBe(true);
    expect(result.instrumentation.diagnostics).toEqual([]);
    expect(serialized).not.toContain(projectRoot);
    expect(serialized).not.toContain(names[0]);
    expect(serialized).not.toContain(names[1]);
  });
});

describe("instrumented discovery fatal errors", () => {
  it("returns sanitized partial facts and stops after the first lstat failure", () => {
    const projectRoot = createTempProject();
    const root = resolve(projectRoot);
    const before = join(root, "before.ts");
    const fatal = join(root, "fatal.ts");
    const later = join(root, "later.ts");
    const secondRoot = join(root, "second");
    const rawError = new Error(`private failure at ${fatal}`);
    const operations: string[] = [];
    const fileSystem: DiscoveryFileSystem = {
      exists: (path) => {
        operations.push(`exists:${path}`);
        return true;
      },
      lstat: (path) => {
        operations.push(`lstat:${path}`);
        if (path === fatal) {
          throw rawError;
        }
        return fakeStat(
          path === root || path === secondRoot ? "directory" : "file"
        );
      },
      readDirectory: (path) => {
        operations.push(`readdir:${path}`);
        return path === root ? ["before.ts", "fatal.ts", "later.ts"] : [];
      }
    };

    const result = discoverFilesInstrumented(
      { projectRoot, paths: [".", "second"], exclude: [] },
      fileSystem
    );
    const diagnostic = result.instrumentation.diagnostics[0];

    expect(result.files).toEqual([before]);
    expect(result.instrumentation.complete).toBe(false);
    expect(result.instrumentation.roots).toHaveLength(1);
    expect(result.instrumentation.entries).toHaveLength(2);
    expect(result.instrumentation.diagnostics).toHaveLength(1);
    expect(diagnostic).toEqual({
      code: "DISCOVERY_LSTAT_FAILED",
      category: "discovery-error",
      level: "error",
      phase: "discovery",
      origin: "repository",
      message: "Filesystem entry metadata could not be read.",
      recoverable: false,
      location: { path: "fatal.ts" }
    });
    expect(() => validateScanDiagnosticV2(diagnostic)).not.toThrow();
    expect(JSON.stringify(result.instrumentation)).not.toContain(
      rawError.message
    );
    expect(JSON.stringify(result.instrumentation)).not.toContain(projectRoot);
    expect(JSON.stringify(result.instrumentation)).not.toContain("stack");
    expect(operations).not.toContain(`lstat:${later}`);
    expect(operations).not.toContain(`exists:${secondRoot}`);
  });

  it("records a sanitized directory-read failure and does not continue", () => {
    const projectRoot = createTempProject();
    const root = resolve(projectRoot);
    const src = join(root, "src");
    const laterRoot = join(root, "later");
    const rawError = new Error(`cannot enumerate ${src}`);
    const operations: string[] = [];
    const fileSystem: DiscoveryFileSystem = {
      exists: (path) => {
        operations.push(`exists:${path}`);
        return true;
      },
      lstat: (path) => {
        operations.push(`lstat:${path}`);
        return fakeStat("directory");
      },
      readDirectory: (path) => {
        operations.push(`readdir:${path}`);
        throw rawError;
      }
    };

    const result = discoverFilesInstrumented(
      { projectRoot, paths: ["src", "later"], exclude: [] },
      fileSystem
    );

    expect(result.instrumentation.complete).toBe(false);
    expect(result.instrumentation.entries).toEqual([
      {
        path: { kind: "repository-relative", path: "src" },
        entryType: "directory",
        extensionSupport: "not-evaluated",
        candidate: false,
        encounterCount: 1
      }
    ]);
    expect(result.instrumentation.diagnostics).toEqual([
      {
        code: "DISCOVERY_READ_DIRECTORY_FAILED",
        category: "discovery-error",
        level: "error",
        phase: "discovery",
        origin: "repository",
        message: "Directory contents could not be read.",
        recoverable: false,
        location: { path: "src" }
      }
    ]);
    expect(operations).not.toContain(`exists:${laterRoot}`);
    expect(JSON.stringify(result.instrumentation)).not.toContain(
      rawError.message
    );
  });

  it("makes legacy discovery rethrow the exact original filesystem error", () => {
    const projectRoot = createTempProject();
    const root = resolve(projectRoot);
    const rawError = new Error("raw private lstat failure");
    const fileSystem: DiscoveryFileSystem = {
      exists: () => true,
      lstat: () => {
        throw rawError;
      },
      readDirectory: () => []
    };
    vi.spyOn(defaultDiscoveryFileSystem, "exists").mockImplementation(
      fileSystem.exists
    );
    vi.spyOn(defaultDiscoveryFileSystem, "lstat").mockImplementation(
      fileSystem.lstat
    );
    vi.spyOn(defaultDiscoveryFileSystem, "readDirectory").mockImplementation(
      fileSystem.readDirectory
    );

    let thrown: unknown;
    try {
      discoverFiles({ projectRoot: root, paths: ["."], exclude: [] });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBe(rawError);
  });

  it("preserves the exact original directory-read error for legacy discovery", () => {
    const projectRoot = createTempProject();
    const rawError = new Error("raw private directory failure");
    vi.spyOn(defaultDiscoveryFileSystem, "exists").mockReturnValue(true);
    vi.spyOn(defaultDiscoveryFileSystem, "lstat").mockReturnValue(
      fakeStat("directory")
    );
    vi.spyOn(defaultDiscoveryFileSystem, "readDirectory").mockImplementation(
      () => {
        throw rawError;
      }
    );

    let thrown: unknown;
    try {
      discoverFiles({ projectRoot, paths: ["."], exclude: [] });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBe(rawError);
  });
});

describe("instrumentation boundaries", () => {
  it("does not expose discovery instrumentation from the public entrypoint", () => {
    expect("discoverFilesInstrumented" in publicApi).toBe(false);
    expect("DiscoveryInstrumentationRecorder" in publicApi).toBe(false);
  });

  it("preserves representative fixed-fixture JSON output byte-for-byte", async () => {
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

function entryAt(
  entries: readonly DiscoveryEntryOutcomeV1[],
  path: string
): DiscoveryEntryOutcomeV1 {
  const entry = entries.find(
    (candidate) =>
      candidate.path.kind === "repository-relative" &&
      candidate.path.path === path
  );
  if (!entry) {
    throw new Error(`Expected instrumented entry ${path}`);
  }
  return entry;
}

function fakeStat(
  kind: "directory" | "file" | "symlink" | "other"
): ReturnType<DiscoveryFileSystem["lstat"]> {
  return {
    isSymbolicLink: () => kind === "symlink",
    isDirectory: () => kind === "directory",
    isFile: () => kind === "file"
  };
}

function relativeFiles(
  projectRoot: string,
  files: readonly string[]
): string[] {
  return files.map((file) => relative(projectRoot, file).replaceAll("\\", "/"));
}

function createTempProject(): string {
  const projectRoot = mkdtempSync(join(tmpdir(), "arcready-fs-instrumented-"));
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
