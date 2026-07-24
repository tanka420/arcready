import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createReviewBundle } from "./create-review-bundle.js";

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("createReviewBundle", () => {
  it("creates deterministic committed-candidate evidence without local paths", () => {
    const root = createRepository();
    git(root, ["switch", "-qc", "feature"]);
    writeFileSync(join(root, "file.txt"), "base\nfeature\n");
    git(root, ["add", "file.txt"]);
    git(root, ["commit", "-qm", "feature"]);

    const first = createReviewBundle(root, {
      milestone: "C07",
      candidate: "rc1",
      baseRef: "main"
    });
    const firstManifest = readFileSync(
      join(first.bundleRoot, "manifest.json"),
      "utf8"
    );
    const firstSums = readFileSync(
      join(first.bundleRoot, "SHA256SUMS"),
      "utf8"
    );

    const second = createReviewBundle(root, {
      milestone: "C07",
      candidate: "rc1",
      baseRef: "main"
    });

    expect(second.source).toBe("committed");
    expect(
      readFileSync(join(second.bundleRoot, "manifest.json"), "utf8")
    ).toBe(firstManifest);
    expect(readFileSync(join(second.bundleRoot, "SHA256SUMS"), "utf8")).toBe(
      firstSums
    );
    expect(firstManifest).not.toContain(root);
    expect(firstManifest).not.toContain("generatedAt");
  });

  it("rejects committed and staged changes in the same candidate", () => {
    const root = createRepository();
    git(root, ["switch", "-qc", "feature"]);
    writeFileSync(join(root, "file.txt"), "base\ncommitted\n");
    git(root, ["add", "file.txt"]);
    git(root, ["commit", "-qm", "feature"]);
    writeFileSync(join(root, "file.txt"), "base\ncommitted\nstaged\n");
    git(root, ["add", "file.txt"]);

    expect(() =>
      createReviewBundle(root, {
        milestone: "C07",
        candidate: "mixed",
        baseRef: "main"
      })
    ).toThrow("Both committed and staged changes exist");
  });

  it("rejects unstaged and untracked changes", () => {
    const root = createRepository();
    git(root, ["switch", "-qc", "feature"]);
    writeFileSync(join(root, "file.txt"), "base\ncommitted\n");
    git(root, ["add", "file.txt"]);
    git(root, ["commit", "-qm", "feature"]);
    writeFileSync(join(root, "file.txt"), "base\ncommitted\nunstaged\n");

    expect(() =>
      createReviewBundle(root, {
        milestone: "C07",
        candidate: "dirty",
        baseRef: "main"
      })
    ).toThrow("Unstaged or untracked changes exist");
  });

  it("supports an exact staged-only candidate with JSON validation evidence", () => {
    const root = createRepository();
    writeFileSync(join(root, "file.txt"), "base\nstaged\n");
    git(root, ["add", "file.txt"]);
    writeFileSync(
      join(root, ".artifacts", "validation.json"),
      '{"status":"pass"}\n',
      { flag: "w" }
    );

    const result = createReviewBundle(root, {
      milestone: "C07",
      candidate: "staged",
      baseRef: "HEAD",
      validationFile: ".artifacts/validation.json"
    });

    expect(result.source).toBe("staged");
    expect(result.validationProvided).toBe(true);
    expect(
      JSON.parse(
        readFileSync(join(result.bundleRoot, "validation-results.json"), "utf8")
      )
    ).toEqual({ status: "pass" });
  });

  it("rejects invalid JSON validation evidence before writing a bundle", () => {
    const root = createRepository();
    writeFileSync(join(root, "file.txt"), "base\nstaged\n");
    git(root, ["add", "file.txt"]);
    writeFileSync(join(root, ".artifacts", "invalid.json"), "not json\n", {
      flag: "w"
    });

    expect(() =>
      createReviewBundle(root, {
        milestone: "C07",
        candidate: "invalid",
        baseRef: "HEAD",
        validationFile: ".artifacts/invalid.json"
      })
    ).toThrow("Validation file is not valid JSON");
  });
});

function createRepository(): string {
  const root = mkdtempSync(join(tmpdir(), "arcready-review-bundle-"));
  temporaryRoots.push(root);
  git(root, ["init", "-q"]);
  git(root, ["config", "user.email", "test@example.com"]);
  git(root, ["config", "user.name", "ArcReady Test"]);
  writeFileSync(join(root, ".gitignore"), ".artifacts/\n");
  mkdirSync(join(root, ".artifacts"), { recursive: true });
  writeFileSync(join(root, "file.txt"), "base\n");
  git(root, ["add", ".gitignore", "file.txt"]);
  git(root, ["commit", "-qm", "base"]);
  git(root, ["branch", "-M", "main"]);
  return root;
}

function git(root: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  }).trim();
}
