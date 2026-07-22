import { execFileSync, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

interface PackageJson {
  name: string;
  version: string;
}

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageRoot = join(repoRoot, "packages", "arcready");
const packageJson = JSON.parse(
  readFileSync(join(packageRoot, "package.json"), "utf8")
) as PackageJson;
const tarballName = `${packageJson.name}-${packageJson.version}-smoke-${randomUUID()}.tgz`;
const tarballPath = join(repoRoot, tarballName);

let smokeRoot: string | undefined;
let cliFixtureRoot: string | undefined;

try {
  run("corepack", ["pnpm", "--filter", "arcready", "build"], repoRoot);

  cliFixtureRoot = createJsonV2Fixture();
  validateJsonV2Execution(
    runCaptured(
      process.execPath,
      [join(packageRoot, "dist", "bin.js"), "scan", "--json-v2"],
      cliFixtureRoot
    ),
    true
  );

  run(
    "corepack",
    ["pnpm", "--filter", "arcready", "pack", "--out", tarballName],
    repoRoot
  );

  if (!existsSync(tarballPath)) {
    throw new Error(`Expected package tarball was not created: ${tarballPath}`);
  }

  smokeRoot = mkdtempSync(join(tmpdir(), "arcready-package-smoke-"));
  const npmCache = join(smokeRoot, "npm-cache");

  run("npm", ["init", "-y"], smokeRoot);
  run(
    "npm",
    [
      "install",
      tarballPath,
      "--cache",
      npmCache,
      "--offline",
      "--no-audit",
      "--fund=false"
    ],
    smokeRoot
  );

  run("npx", ["--no-install", "arcready", "--help"], smokeRoot);
  run("npx", ["--no-install", "arcready", "init"], smokeRoot);
  mkdirSync(join(smokeRoot, "src"), { recursive: true });
  writeFileSync(
    join(smokeRoot, "src", "bridge.ts"),
    "Arc CCTP bridge\nconst ARC_CCTP_DOMAIN = 7;\n"
  );

  const terminalOutput = run(
    "npx",
    ["--no-install", "arcready", "scan", "--format", "terminal"],
    smokeRoot
  );

  const expectedVersion = `ArcReady v${packageJson.version}`;
  if (!terminalOutput.includes(expectedVersion)) {
    throw new Error(
      `Expected terminal output to include "${expectedVersion}". Received:\n${terminalOutput}`
    );
  }

  const jsonOutput = run(
    "npx",
    ["--no-install", "arcready", "scan", "--format", "json"],
    smokeRoot
  );

  JSON.parse(jsonOutput);
  validateJsonV2Execution(
    runCapturedNpx(["--no-install", "arcready", "scan", "--json-v2"], smokeRoot)
  );
  console.log("Package smoke test passed.");
} finally {
  try {
    try {
      if (smokeRoot) {
        removeTempDirectory(smokeRoot);
      }
    } finally {
      if (cliFixtureRoot) {
        removeTempDirectory(cliFixtureRoot);
      }
    }
  } finally {
    rmSync(tarballPath, { force: true });
  }
}

function run(command: string, args: string[], cwd: string): string {
  const executable = process.platform === "win32" ? "cmd.exe" : command;
  const commandArgs =
    process.platform === "win32"
      ? ["/d", "/c", [command, ...args].join(" ")]
      : args;

  return execFileSync(executable, commandArgs, {
    cwd,
    encoding: "utf8",
    env: sanitizedEnvironment(),
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 30_000
  });
}

function runCapturedNpx(args: string[], cwd: string) {
  if (process.platform === "win32") {
    const npxCli = join(
      dirname(process.execPath),
      "node_modules",
      "npm",
      "bin",
      "npx-cli.js"
    );
    return runCaptured(process.execPath, [npxCli, ...args], cwd);
  }
  return runCaptured("npx", args, cwd);
}

function runCaptured(command: string, args: string[], cwd: string) {
  return spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    env: sanitizedEnvironment(),
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 30_000
  });
}

function createJsonV2Fixture(): string {
  const root = mkdtempSync(join(tmpdir(), "arcready-json-v2-smoke-"));
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(
    join(root, "src", "bridge.ts"),
    "Arc CCTP bridge\nconst ARC_CCTP_DOMAIN = 7;\nconst arcTestnet = { id: 1, name: 'Arc Testnet' };\n"
  );
  return root;
}

function validateJsonV2Execution(
  execution: ReturnType<typeof runCaptured>,
  expectWalletFinding = false
): void {
  if (execution.error) {
    throw execution.error;
  }
  if (execution.status !== 0) {
    throw new Error(
      `Expected json-v2 exit 0, received ${String(execution.status)}. stderr:\n${execution.stderr}`
    );
  }
  if (execution.stderr !== "") {
    throw new Error(
      `Expected empty json-v2 stderr. Received:\n${execution.stderr}`
    );
  }
  if (!execution.stdout.endsWith("\n") || execution.stdout.endsWith("\n\n")) {
    throw new Error("Expected json-v2 stdout to end with exactly one LF");
  }

  const result = JSON.parse(execution.stdout) as {
    contractVersion?: unknown;
    coverage?: {
      ruleExecution?: { counts?: { selectedOccurrences?: unknown } };
    };
    findings?: Array<{ ruleId?: unknown }>;
    diagnostics?: unknown;
  };
  if (
    JSON.stringify(Object.keys(result)) !==
    JSON.stringify(["contractVersion", "coverage", "findings", "diagnostics"])
  ) {
    throw new Error("Expected exact ScanResultV2 top-level keys");
  }
  if (result.contractVersion !== "2.0") {
    throw new Error("Expected json-v2 contractVersion 2.0");
  }
  if (result.coverage?.ruleExecution?.counts?.selectedOccurrences !== 4) {
    throw new Error("Expected json-v2 to select exactly four rule occurrences");
  }
  if (
    !result.findings?.some(({ ruleId }) => ruleId === "bridge/CCTP_DOMAIN_26")
  ) {
    throw new Error("Expected a CCTP_DOMAIN_26 FindingV2");
  }
  if (
    expectWalletFinding &&
    !result.findings.some(
      ({ ruleId }) => ruleId === "wallet/ARC_CHAIN_METADATA"
    )
  ) {
    throw new Error("Expected an ARC_CHAIN_METADATA FindingV2");
  }
}

function sanitizedEnvironment(): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    FORCE_COLOR: "0",
    NO_COLOR: "1"
  };

  for (const key of Object.keys(environment)) {
    const normalized = key.toLowerCase();
    if (
      normalized.includes("verify_deps_before_run") ||
      normalized.includes("verify-deps-before-run") ||
      normalized.includes("jsr")
    ) {
      delete environment[key];
    }
  }

  return environment;
}

function removeTempDirectory(path: string): void {
  const resolvedPath = resolve(path);
  const resolvedTemp = resolve(tmpdir());

  if (!resolvedPath.startsWith(resolvedTemp)) {
    throw new Error(`Refusing to remove non-temp path: ${resolvedPath}`);
  }

  rmSync(resolvedPath, { recursive: true, force: true });
}
