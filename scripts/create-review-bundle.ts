import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface ReviewBundleOptions {
  milestone: string;
  candidate: string;
  baseRef: string;
  validationFile?: string;
}

interface ChangedFile {
  status: string;
  path: string;
  previousPath?: string;
}

export interface ReviewBundleResult {
  bundleRoot: string;
  source: "committed" | "staged";
  changedFileCount: number;
  validationProvided: boolean;
}

const defaultRepoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ALLOWED_OPTIONS = new Set([
  "--milestone",
  "--candidate",
  "--base",
  "--validation"
]);

if (isMainModule()) main();

function main(): void {
  const options = parseOptions(process.argv.slice(2));
  if (options === undefined) return;
  const result = createReviewBundle(defaultRepoRoot, options);

  console.log(`Review bundle created: ${result.bundleRoot}`);
  console.log(`Source: ${result.source}`);
  console.log(`Changed files: ${result.changedFileCount}`);
  if (!result.validationProvided) {
    console.warn(
      "Validation evidence was not provided; this bundle is not ready for final approval."
    );
  }
}

export function createReviewBundle(
  root: string,
  options: ReviewBundleOptions
): ReviewBundleResult {
  const repoRoot = resolve(root);
  assertRepository(repoRoot);

  const headSha = git(repoRoot, ["rev-parse", "HEAD"]);
  const baseSha = git(repoRoot, ["rev-parse", options.baseRef]);
  const mergeBaseSha = git(repoRoot, ["merge-base", options.baseRef, "HEAD"]);
  const branch = git(repoRoot, ["branch", "--show-current"]) || "DETACHED";

  const committedPatch = git(repoRoot, [
    "diff",
    "--binary",
    "--full-index",
    `${mergeBaseSha}..HEAD`
  ]);
  const stagedPatch = git(repoRoot, [
    "diff",
    "--cached",
    "--binary",
    "--full-index"
  ]);
  const unstagedPatch = git(repoRoot, ["diff", "--binary", "--full-index"]);
  const untrackedFiles = git(repoRoot, [
    "ls-files",
    "--others",
    "--exclude-standard"
  ]);

  if (committedPatch.length > 0 && stagedPatch.length > 0) {
    throw new Error(
      "Both committed and staged changes exist. Commit the candidate or return to a staged-only review before creating a bundle."
    );
  }
  if (unstagedPatch.length > 0 || untrackedFiles.length > 0) {
    throw new Error(
      "Unstaged or untracked changes exist. A review bundle must represent one exact clean candidate."
    );
  }

  const source = committedPatch.length > 0 ? "committed" : "staged";
  const patch = source === "committed" ? committedPatch : stagedPatch;
  if (patch.length === 0) {
    throw new Error(
      `No committed changes against ${options.baseRef} and no staged changes were found.`
    );
  }

  const diffArgs =
    source === "committed" ? [`${mergeBaseSha}..HEAD`] : ["--cached"];
  git(repoRoot, ["diff", ...diffArgs, "--check"]);

  const nameStatus = git(repoRoot, ["diff", ...diffArgs, "--name-status"]);
  const shortStat = git(repoRoot, ["diff", ...diffArgs, "--shortstat"]);
  const changedFiles = parseNameStatus(nameStatus);

  const validationSourcePath =
    options.validationFile === undefined
      ? undefined
      : resolve(repoRoot, options.validationFile);
  if (validationSourcePath !== undefined) {
    if (!existsSync(validationSourcePath)) {
      throw new Error(
        `Validation file does not exist: ${validationSourcePath}`
      );
    }
    assertJsonFile(validationSourcePath);
  }

  const bundleName = `${options.milestone}-${options.candidate}`;
  const outputRoot = join(repoRoot, ".artifacts", "review");
  const bundleRoot = join(outputRoot, bundleName);
  rmSync(bundleRoot, { recursive: true, force: true });
  mkdirSync(bundleRoot, { recursive: true });

  const patchPath = join(bundleRoot, "changes.patch");
  writeFileSync(patchPath, patch.endsWith("\n") ? patch : `${patch}\n`);

  const validationPath = join(bundleRoot, "validation-results.json");
  if (validationSourcePath !== undefined) {
    copyFileSync(validationSourcePath, validationPath);
  } else {
    writeFileSync(
      validationPath,
      `${JSON.stringify(
        {
          status: "not-provided",
          note: "Attach exact validation evidence before requesting final approval."
        },
        null,
        2
      )}\n`
    );
  }

  const manifestPath = join(bundleRoot, "manifest.json");
  const manifest = {
    schemaVersion: 1,
    milestone: options.milestone,
    candidate: options.candidate,
    source,
    branch,
    headSha,
    baseRef: options.baseRef,
    baseSha,
    mergeBaseSha,
    diffCheck: "passed",
    shortStat,
    changedFiles,
    tools: {
      node: process.version,
      pnpm: tryCommand(repoRoot, "corepack", ["pnpm", "--version"]),
      git: tryCommand(repoRoot, "git", ["--version"])
    },
    files: {
      patch: {
        name: "changes.patch",
        sha256: sha256(patchPath)
      },
      validation: {
        name: "validation-results.json",
        sha256: sha256(validationPath)
      }
    }
  };
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  const sumsPath = join(bundleRoot, "SHA256SUMS");
  const sums = [patchPath, validationPath, manifestPath]
    .map(
      (filePath) =>
        `${sha256(filePath)}  ${filePath.slice(bundleRoot.length + 1)}`
    )
    .join("\n");
  writeFileSync(sumsPath, `${sums}\n`);

  return {
    bundleRoot,
    source,
    changedFileCount: changedFiles.length,
    validationProvided: options.validationFile !== undefined
  };
}

function parseOptions(args: string[]): ReviewBundleOptions | undefined {
  if (args.includes("--help") || args.includes("-h")) {
    console.log(`Usage:
  corepack pnpm review:bundle -- --milestone <id> --candidate <name> [options]

Options:
  --base <ref>          Base ref used for committed branch changes (default: origin/main)
  --validation <path>   Existing JSON validation evidence to copy into the bundle
  --help                Show this help text

The command accepts exactly one candidate source: committed changes from the
merge base of <base> and HEAD, or a staged-only diff. It rejects mixed committed,
staged, unstaged, or untracked changes. Output is written under
.artifacts/review/.`);
    return undefined;
  }

  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 1) {
    const key = args[index];
    if (!key?.startsWith("--")) {
      throw new Error(`Unexpected argument: ${String(key)}`);
    }
    if (!ALLOWED_OPTIONS.has(key)) {
      throw new Error(`Unknown option: ${key}`);
    }
    if (values.has(key)) {
      throw new Error(`Duplicate option: ${key}`);
    }
    const value = args[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`Missing value for ${key}`);
    }
    values.set(key, value);
    index += 1;
  }

  const milestone = requiredLabel(values, "--milestone");
  const candidate = requiredLabel(values, "--candidate");
  const baseRef = values.get("--base") ?? "origin/main";
  const validationFile = values.get("--validation");

  return { milestone, candidate, baseRef, validationFile };
}

function requiredLabel(values: Map<string, string>, key: string): string {
  const value = values.get(key);
  if (value === undefined) throw new Error(`Missing required option ${key}`);
  if (!/^[A-Za-z0-9._-]+$/.test(value)) {
    throw new Error(
      `${key} may contain only letters, numbers, dot, underscore, and hyphen.`
    );
  }
  return value;
}

function assertRepository(repoRoot: string): void {
  const actual = resolve(git(repoRoot, ["rev-parse", "--show-toplevel"]));
  if (actual !== repoRoot) {
    throw new Error(`Expected repository root ${repoRoot}, received ${actual}`);
  }
}

function assertJsonFile(filePath: string): void {
  try {
    JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    throw new Error(`Validation file is not valid JSON: ${filePath}`);
  }
}

function parseNameStatus(value: string): ChangedFile[] {
  if (value.length === 0) return [];
  return value.split(/\r?\n/).map((line) => {
    const [status = "", firstPath = "", secondPath] = line.split("\t");
    if (status.startsWith("R") || status.startsWith("C")) {
      return { status, path: secondPath ?? firstPath, previousPath: firstPath };
    }
    return { status, path: firstPath };
  });
}

function sha256(filePath: string): string {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function git(repoRoot: string, args: string[]): string {
  return run(repoRoot, "git", args);
}

function tryCommand(repoRoot: string, command: string, args: string[]): string {
  try {
    return run(repoRoot, command, args);
  } catch (error) {
    return error instanceof Error
      ? `unavailable: ${error.message}`
      : "unavailable";
  }
}

function run(repoRoot: string, command: string, args: string[]): string {
  return execFileSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  }).trim();
}

function isMainModule(): boolean {
  const entry = process.argv[1];
  return (
    entry !== undefined && resolve(entry) === fileURLToPath(import.meta.url)
  );
}
