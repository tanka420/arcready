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

interface Options {
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

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

main();

function main(): void {
  const options = parseOptions(process.argv.slice(2));
  assertRepository();

  const headSha = git(["rev-parse", "HEAD"]);
  const baseSha = git(["rev-parse", options.baseRef]);
  const branch = git(["branch", "--show-current"]) || "DETACHED";

  const committedPatch = git([
    "diff",
    "--binary",
    "--full-index",
    `${options.baseRef}...HEAD`
  ]);
  const stagedPatch = git(["diff", "--cached", "--binary", "--full-index"]);

  const source = committedPatch.length > 0 ? "committed" : "staged";
  const patch = source === "committed" ? committedPatch : stagedPatch;
  if (patch.length === 0) {
    throw new Error(
      `No committed changes against ${options.baseRef} and no staged changes were found.`
    );
  }

  const diffArgs =
    source === "committed"
      ? [`${options.baseRef}...HEAD`]
      : ["--cached"];
  git(["diff", ...diffArgs, "--check"]);

  const nameStatus = git(["diff", ...diffArgs, "--name-status"]);
  const shortStat = git(["diff", ...diffArgs, "--shortstat"]);
  const changedFiles = parseNameStatus(nameStatus);

  const bundleName = `${options.milestone}-${options.candidate}`;
  const outputRoot = join(repoRoot, ".artifacts", "review");
  const bundleRoot = join(outputRoot, bundleName);
  rmSync(bundleRoot, { recursive: true, force: true });
  mkdirSync(bundleRoot, { recursive: true });

  const patchPath = join(bundleRoot, "changes.patch");
  writeFileSync(patchPath, patch.endsWith("\n") ? patch : `${patch}\n`);

  const validationPath = join(bundleRoot, "validation-results.json");
  if (options.validationFile !== undefined) {
    const sourcePath = resolve(repoRoot, options.validationFile);
    if (!existsSync(sourcePath)) {
      throw new Error(`Validation file does not exist: ${sourcePath}`);
    }
    copyFileSync(sourcePath, validationPath);
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
    generatedAt: new Date().toISOString(),
    source,
    repositoryRoot: repoRoot,
    branch,
    headSha,
    baseRef: options.baseRef,
    baseSha,
    diffCheck: "passed",
    shortStat,
    changedFiles,
    tools: {
      node: process.version,
      pnpm: tryCommand("corepack", ["pnpm", "--version"]),
      git: tryCommand("git", ["--version"])
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
    .map((filePath) => `${sha256(filePath)}  ${filePath.slice(bundleRoot.length + 1)}`)
    .join("\n");
  writeFileSync(sumsPath, `${sums}\n`);

  console.log(`Review bundle created: ${bundleRoot}`);
  console.log(`Source: ${source}`);
  console.log(`Changed files: ${changedFiles.length}`);
  if (options.validationFile === undefined) {
    console.warn(
      "Validation evidence was not provided; this bundle is not ready for final approval."
    );
  }
}

function parseOptions(args: string[]): Options {
  if (args.includes("--help") || args.includes("-h")) {
    console.log(`Usage:
  corepack pnpm review:bundle -- --milestone <id> --candidate <name> [options]

Options:
  --base <ref>          Base ref used for committed branch changes (default: origin/main)
  --validation <path>   Existing JSON validation evidence to copy into the bundle
  --help                Show this help text

The command prefers committed changes from <base>...HEAD. If that diff is empty,
it uses the staged diff. Output is written under .artifacts/review/.`);
    process.exit(0);
  }

  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 1) {
    const key = args[index];
    if (!key?.startsWith("--")) {
      throw new Error(`Unexpected argument: ${String(key)}`);
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
    throw new Error(`${key} may contain only letters, numbers, dot, underscore, and hyphen.`);
  }
  return value;
}

function assertRepository(): void {
  const actual = resolve(git(["rev-parse", "--show-toplevel"]));
  if (actual !== repoRoot) {
    throw new Error(`Expected repository root ${repoRoot}, received ${actual}`);
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

function git(args: string[]): string {
  return run("git", args);
}

function tryCommand(command: string, args: string[]): string {
  try {
    return run(command, args);
  } catch (error) {
    return error instanceof Error ? `unavailable: ${error.message}` : "unavailable";
  }
}

function run(command: string, args: string[]): string {
  return execFileSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  }).trim();
}
