import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
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
const tarballPath = join(
  repoRoot,
  `${packageJson.name}-${packageJson.version}.tgz`
);

let smokeRoot: string | undefined;

try {
  run("corepack", ["pnpm", "--filter", "arcready", "build"], repoRoot);
  run("corepack", ["pnpm", "--filter", "arcready", "pack"], repoRoot);

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
      "--prefer-offline",
      "--no-audit",
      "--fund=false"
    ],
    smokeRoot
  );

  run("npx", ["--no-install", "arcready", "--help"], smokeRoot);
  run("npx", ["--no-install", "arcready", "init"], smokeRoot);

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
  console.log("Package smoke test passed.");
} finally {
  if (smokeRoot) {
    removeTempDirectory(smokeRoot);
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
    stdio: ["ignore", "pipe", "pipe"]
  });
}


function removeTempDirectory(path: string): void {
  const resolvedPath = resolve(path);
  const resolvedTemp = resolve(tmpdir());

  if (!resolvedPath.startsWith(resolvedTemp)) {
    throw new Error(`Refusing to remove non-temp path: ${resolvedPath}`);
  }

  rmSync(resolvedPath, { recursive: true, force: true });
}
