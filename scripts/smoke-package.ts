import { execFileSync, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

interface PackageJson {
  name: string;
  version: string;
  dependencies?: Record<string, string>;
  license?: string;
  engines?: Record<string, string>;
}

const require = createRequire(import.meta.url);
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageRoot = join(repoRoot, "packages", "arcready");
const packageJson = JSON.parse(
  readFileSync(join(packageRoot, "package.json"), "utf8")
) as PackageJson;
const C09_PRE_E1_PACKED_SIZE = 78_086;
const MAX_C09_E1_PACKED_DELTA = 15_000;
const SOLIDITY_PARSER_VERSION = "0.20.2";
const SOLIDITY_PARSER_INTEGRITY =
  "sha512-rbu0bzwNvMcwAjH86hiEAcOeRI2EeK8zCkHDrFykh/Al8mvJeFmjy3UrE7GYQjNwOgbGUUtCn5/k8CB8zIu7QA==";
const tarballName = `${packageJson.name}-${packageJson.version}-smoke-${randomUUID()}.tgz`;
const tarballPath = join(repoRoot, tarballName);

let smokeRoot: string | undefined;
let cliFixtureRoot: string | undefined;

try {
  assertDependencyBoundary();
  run("corepack", ["pnpm", "--filter", "arcready", "build"], repoRoot);
  assertCompilerIsExternal();
  assertParserIsExternal();

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
  const candidatePackedSize = statSync(tarballPath).size;
  const packedSizeDelta = candidatePackedSize - C09_PRE_E1_PACKED_SIZE;
  if (packedSizeDelta <= 0 || packedSizeDelta > MAX_C09_E1_PACKED_DELTA) {
    throw new Error(
      `Unexpected C09A-E1 packed-size delta: ${packedSizeDelta} bytes`
    );
  }
  console.log(
    `C09A-E1 packed size: ${candidatePackedSize} bytes (${packedSizeDelta >= 0 ? "+" : ""}${packedSizeDelta} from pre-E1 baseline ${C09_PRE_E1_PACKED_SIZE}).`
  );

  smokeRoot = mkdtempSync(join(tmpdir(), "arcready-package-smoke-"));
  const npmCache = join(smokeRoot, "npm-cache");
  const typescriptRoot = dirname(require.resolve("typescript/package.json"));
  const typescriptTarballName = run(
    "npm",
    ["pack", typescriptRoot, "--pack-destination", smokeRoot],
    repoRoot
  )
    .trim()
    .split(/\r?\n/)
    .at(-1);
  if (!typescriptTarballName) {
    throw new Error("Expected npm pack to return a TypeScript tarball name");
  }
  const typescriptTarballPath = join(smokeRoot, typescriptTarballName);
  const parserTarballName = run(
    "npm",
    [
      "pack",
      `@solidity-parser/parser@${SOLIDITY_PARSER_VERSION}`,
      "--pack-destination",
      smokeRoot,
      "--ignore-scripts"
    ],
    repoRoot
  )
    .trim()
    .split(/\r?\n/)
    .at(-1);
  if (!parserTarballName) {
    throw new Error(
      "Expected npm pack to return a Solidity parser tarball name"
    );
  }
  const parserTarballPath = join(smokeRoot, parserTarballName);
  console.log(
    `Solidity parser packed size: ${statSync(parserTarballPath).size} bytes.`
  );
  run("npm", ["init", "-y"], smokeRoot);
  run(
    "npm",
    [
      "install",
      parserTarballPath,
      "--cache",
      npmCache,
      "--offline",
      "--no-audit",
      "--fund=false"
    ],
    smokeRoot
  );
  run(
    "npm",
    [
      "install",
      typescriptTarballPath,
      tarballPath,
      "--cache",
      npmCache,
      "--offline",
      "--no-audit",
      "--fund=false"
    ],
    smokeRoot
  );
  assertInstalledTypeScript(smokeRoot);
  assertInstalledParser(smokeRoot);
  validateLazyParserBoundary(smokeRoot);

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
  validateInstalledAmountFixtures(smokeRoot);
  validateInstalledBlobFixtures(smokeRoot);
  validateLazyCompilerBoundary(smokeRoot);
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

function assertDependencyBoundary(): void {
  if (packageJson.dependencies?.typescript !== "5.9.3") {
    throw new Error("Expected exact runtime dependency typescript@5.9.3");
  }
  const manifest = JSON.parse(
    readFileSync(require.resolve("typescript/package.json"), "utf8")
  ) as PackageJson;
  if (manifest.version !== "5.9.3" || manifest.license !== "Apache-2.0") {
    throw new Error("Expected TypeScript 5.9.3 with Apache-2.0 metadata");
  }
  if (manifest.engines?.node !== ">=14.17") {
    throw new Error(
      `Unexpected TypeScript Node engine: ${manifest.engines?.node}`
    );
  }
  if (
    packageJson.dependencies?.["@solidity-parser/parser"] !==
    SOLIDITY_PARSER_VERSION
  ) {
    throw new Error(
      `Expected exact runtime dependency @solidity-parser/parser@${SOLIDITY_PARSER_VERSION}`
    );
  }
  const parserManifest = JSON.parse(
    readFileSync(
      require.resolve("@solidity-parser/parser/package.json"),
      "utf8"
    )
  ) as PackageJson;
  if (
    parserManifest.version !== SOLIDITY_PARSER_VERSION ||
    parserManifest.license !== "MIT" ||
    Object.keys(parserManifest.dependencies ?? {}).length !== 0
  ) {
    throw new Error("Unexpected Solidity parser dependency metadata");
  }
  const lockfile = readFileSync(join(repoRoot, "pnpm-lock.yaml"), "utf8");
  if (
    !lockfile.includes(
      `"@solidity-parser/parser@${SOLIDITY_PARSER_VERSION}"`
    ) ||
    !lockfile.includes(`integrity: ${SOLIDITY_PARSER_INTEGRITY}`)
  ) {
    throw new Error(
      "Expected exact Solidity parser version and integrity in lockfile"
    );
  }
}

function assertCompilerIsExternal(): void {
  const distRoot = join(packageRoot, "dist");
  let c07AnalyzerIncluded = false;
  let c07RuleIncluded = false;
  for (const fileName of readdirSync(distRoot)) {
    if (!fileName.endsWith(".js") && !fileName.endsWith(".d.ts")) continue;
    const content = readFileSync(join(distRoot, fileName), "utf8");
    if (content.includes("function createSourceFile")) {
      throw new Error(
        `TypeScript compiler implementation found in ${fileName}`
      );
    }
    if (fileName.endsWith(".d.ts") && content.includes('from "typescript"')) {
      throw new Error(`TypeScript compiler type leaked into ${fileName}`);
    }
    if (fileName.endsWith(".js")) {
      c07AnalyzerIncluded ||= content.includes(
        "async function analyzeArcTransactionSubmissionFile"
      );
      c07RuleIncluded ||= content.includes(
        "Arc transaction submission uses EIP-4844 transaction type 3"
      );
    }
  }
  if (!c07AnalyzerIncluded || !c07RuleIncluded) {
    throw new Error(
      "Expected the private C07 analyzer and hardened consumer in the production bundle"
    );
  }
}

function assertParserIsExternal(): void {
  const analyzerPath = join(packageRoot, "dist", "prevrandao-analysis.js");
  const declarationPath = join(packageRoot, "dist", "prevrandao-analysis.d.ts");
  if (!existsSync(analyzerPath) || !existsSync(declarationPath)) {
    throw new Error("Expected private prevrandao analyzer package entries");
  }
  const analyzer = readFileSync(analyzerPath, "utf8");
  const declaration = readFileSync(declarationPath, "utf8");
  if (!analyzer.includes("@solidity-parser/parser")) {
    throw new Error(
      "Expected the private analyzer to resolve the external parser"
    );
  }
  console.log(
    `Prevrandao analyzer entry size: ${Buffer.byteLength(analyzer, "utf8")} bytes.`
  );
  if (declaration.includes("@solidity-parser/parser")) {
    throw new Error("Solidity parser types leaked into ArcReady");
  }
}

function assertInstalledTypeScript(root: string): void {
  const manifestPath = join(root, "node_modules", "typescript", "package.json");
  if (!existsSync(manifestPath)) {
    throw new Error("Expected installed TypeScript to resolve separately");
  }
  const manifest = JSON.parse(
    readFileSync(manifestPath, "utf8")
  ) as PackageJson;
  if (manifest.version !== "5.9.3" || manifest.license !== "Apache-2.0") {
    throw new Error("Installed TypeScript dependency metadata did not match");
  }
}

function assertInstalledParser(root: string): void {
  const parserRoot = join(root, "node_modules", "@solidity-parser", "parser");
  const manifestPath = join(parserRoot, "package.json");
  if (!existsSync(manifestPath)) {
    throw new Error("Expected installed Solidity parser to resolve separately");
  }
  const manifest = JSON.parse(
    readFileSync(manifestPath, "utf8")
  ) as PackageJson;
  if (
    manifest.version !== SOLIDITY_PARSER_VERSION ||
    manifest.license !== "MIT" ||
    Object.keys(manifest.dependencies ?? {}).length !== 0
  ) {
    throw new Error(
      "Installed Solidity parser dependency metadata did not match"
    );
  }
  const stats = directoryStats(parserRoot);
  console.log(
    `Solidity parser installed contents: ${stats.files} files, ${stats.bytes} bytes.`
  );
}

function validateLazyParserBoundary(root: string): void {
  const installed = join(root, "node_modules", "@solidity-parser", "parser");
  const withdrawn = `${installed}-withdrawn`;
  const analyzerUrl = pathToFileURL(
    join(root, "node_modules", "arcready", "dist", "prevrandao-analysis.js")
  ).href;
  if (!resolve(installed).startsWith(resolve(root)) || !existsSync(installed)) {
    throw new Error(
      "Refusing to move an unverified Solidity parser dependency"
    );
  }

  renameSync(installed, withdrawn);
  try {
    const unsupported = runInstalledParserProbe(
      root,
      analyzerUrl,
      "src/client.ts",
      "block.prevrandao"
    );
    if (unsupported.status !== "unsupported-file") {
      throw new Error("Non-Solidity parser probe did not remain lazy");
    }

    const unavailable = runInstalledParserProbe(
      root,
      analyzerUrl,
      "src/Selector.sol",
      "contract Selector {}"
    );
    if (unavailable.status !== "parser-unavailable") {
      throw new Error(
        `Missing parser did not fail closed: ${JSON.stringify(unavailable)}`
      );
    }
  } finally {
    renameSync(withdrawn, installed);
  }

  const analyzed = runInstalledParserProbe(
    root,
    analyzerUrl,
    "src/Selector.sol",
    "contract Selector { function choose() external view returns (uint256) { return block.prevrandao; } }"
  );
  if (analyzed.status !== "analyzed" || analyzed.sources.length !== 1) {
    throw new Error("Packed ArcReady package could not lazy-load the parser");
  }
}

function runInstalledParserProbe(
  root: string,
  analyzerUrl: string,
  filePath: string,
  source: string
): { status: string; sources: unknown[] } {
  const program = `const module = await import(${JSON.stringify(analyzerUrl)}); const result = await module.analyzePrevrandaoSourceFile(${JSON.stringify(filePath)}, ${JSON.stringify(source)}); process.stdout.write(JSON.stringify(result));`;
  const execution = runCaptured(
    process.execPath,
    ["--input-type=module", "-e", program],
    root
  );
  if (execution.status !== 0) {
    throw new Error(`Installed parser probe failed: ${execution.stderr}`);
  }
  return JSON.parse(execution.stdout) as { status: string; sources: unknown[] };
}

function directoryStats(root: string): { files: number; bytes: number } {
  let files = 0;
  let bytes = 0;
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      const child = directoryStats(path);
      files += child.files;
      bytes += child.bytes;
    } else if (entry.isFile()) {
      files += 1;
      bytes += statSync(path).size;
    }
  }
  return { files, bytes };
}

function validateInstalledAmountFixtures(root: string): void {
  const good = runInstalledAmountCase(root, 18);
  const bad = runInstalledAmountCase(root, 6);

  assertLegacyReport(good, {
    exitCode: 0,
    findings: 0,
    score: 100,
    status: "pass"
  });
  assertLegacyReport(bad, {
    exitCode: 1,
    findings: 1,
    score: 75,
    status: "fail",
    ruleId: "wallet/ARC_USDC_AMOUNT_CONVERSION"
  });
}

function validateInstalledBlobFixtures(root: string): void {
  writeBlobProject(root, true);
  const jsonExecution = runCapturedNpx(
    ["--no-install", "arcready", "scan", "--format", "json"],
    root
  );
  if (jsonExecution.error) throw jsonExecution.error;
  const report = JSON.parse(jsonExecution.stdout) as {
    findings: Array<{
      ruleId: string;
      severity: string;
      message: string;
      files: string[];
      suggestedFix?: string;
      docs?: string;
      preset?: string;
    }>;
    score: number;
    status: string;
    summary: { critical: number; warning: number; info: number };
  };
  const finding = report.findings[0];
  if (
    jsonExecution.status !== 1 ||
    report.findings.length !== 1 ||
    report.score !== 75 ||
    report.status !== "fail" ||
    JSON.stringify(report.summary) !==
      JSON.stringify({ critical: 1, warning: 0, info: 0 }) ||
    finding?.ruleId !== "wallet/NO_BLOB_TX_ON_ARC" ||
    finding.severity !== "critical" ||
    finding.message !==
      "Arc transaction submission uses EIP-4844 transaction type 3, which Arc does not support." ||
    finding.files.length !== 1 ||
    !resolve(finding.files[0] ?? "").startsWith(resolve(root)) ||
    !finding.files[0]?.replaceAll("\\", "/").endsWith("/src/submit.ts") ||
    finding.suggestedFix !==
      "Submit a type-2 EIP-1559 transaction on Arc instead (`type: 2`) and remove any blob-only fields present in the submitted transaction." ||
    finding.docs !== "arc-blob-transactions" ||
    finding.preset !== "wallet"
  ) {
    throw new Error(
      `Unexpected installed C07B report: ${jsonExecution.stdout}`
    );
  }

  for (const format of ["terminal", "markdown", "html"] as const) {
    const rendered = runCapturedNpx(
      ["--no-install", "arcready", "scan", "--format", format],
      root
    );
    if (
      rendered.error ||
      rendered.status !== 1 ||
      !rendered.stdout.includes("NO_BLOB_TX_ON_ARC") ||
      !rendered.stdout.includes(
        "Arc transaction submission uses EIP-4844 transaction type 3"
      ) ||
      !rendered.stdout.includes("type-2 EIP-1559 transaction")
    ) {
      throw new Error(`Unexpected installed C07B ${format} output`);
    }
  }

  const jsonV2 = runCapturedNpx(
    ["--no-install", "arcready", "scan", "--json-v2"],
    root
  );
  if (jsonV2.error || jsonV2.status !== 0) {
    throw new Error("Installed C07B json-v2 observation failed");
  }
  const privateResult = JSON.parse(jsonV2.stdout) as {
    findings?: Array<{ ruleId?: string }>;
  };
  if (
    privateResult.findings?.some(
      ({ ruleId }) => ruleId === "wallet/NO_BLOB_TX_ON_ARC"
    )
  ) {
    throw new Error("Non-canonical C07B rule leaked into json-v2 findings");
  }

  writeBlobProject(root, false);
  assertLegacyReport(
    runCapturedNpx(
      ["--no-install", "arcready", "scan", "--format", "json"],
      root
    ),
    {
      exitCode: 0,
      findings: 0,
      score: 100,
      status: "pass"
    }
  );
}

function runInstalledAmountCase(root: string, decimals: 6 | 18) {
  writeAmountProject(root, decimals, {
    presets: ["wallet"],
    failOn: "critical"
  });
  return runCapturedNpx(
    ["--no-install", "arcready", "scan", "--format", "json"],
    root
  );
}

function assertLegacyReport(
  execution: ReturnType<typeof runCaptured>,
  expected: {
    exitCode: number;
    findings: number;
    score: number;
    status: string;
    ruleId?: string;
  }
): void {
  if (execution.error) throw execution.error;
  if (execution.status !== expected.exitCode) {
    throw new Error(
      `Expected installed CLI exit ${expected.exitCode}, received ${String(execution.status)}: ${execution.stderr}`
    );
  }
  const report = JSON.parse(execution.stdout) as {
    findings: Array<{ ruleId: string }>;
    score: number;
    status: string;
  };
  if (
    report.findings.length !== expected.findings ||
    report.score !== expected.score ||
    report.status !== expected.status ||
    (expected.ruleId !== undefined &&
      report.findings[0]?.ruleId !== expected.ruleId)
  ) {
    throw new Error(`Unexpected installed amount report: ${execution.stdout}`);
  }
}

function validateLazyCompilerBoundary(root: string): void {
  const installed = join(root, "node_modules", "typescript");
  const withdrawn = join(root, "node_modules", "typescript-withdrawn");
  if (!resolve(installed).startsWith(resolve(root)) || !existsSync(installed)) {
    throw new Error("Refusing to move an unverified TypeScript dependency");
  }
  renameSync(installed, withdrawn);
  try {
    writeAmountProject(root, 6, {
      presets: ["wallet"],
      failOn: "critical",
      rules: {
        "wallet/ARC_USDC_AMOUNT_CONVERSION": "off",
        "wallet/NO_BLOB_TX_ON_ARC": "off"
      }
    });
    assertCompilerNotRequired(runInstalledProbe(root), "disabled rule");

    writeAmountProject(root, 6, { presets: ["bridge"], failOn: "critical" });
    assertCompilerNotRequired(runInstalledProbe(root), "non-wallet preset");

    rmSync(join(root, "src", "amounts.ts"), { force: true });
    writeFileSync(
      join(root, "src", "component.tsx"),
      "<div>formatUnits(value, 6)</div>"
    );
    writeConfig(root, { presets: ["wallet"], failOn: "critical" });
    assertCompilerNotRequired(
      runInstalledProbe(root),
      "unsupported-only source"
    );

    rmSync(join(root, "src", "component.tsx"), { force: true });
    assertCompilerNotRequired(
      runInstalledProbe(root),
      "empty eligible source set"
    );

    const compilerStates = [
      {
        label: "L01 both compiler consumers disabled",
        rules: {
          "wallet/ARC_USDC_AMOUNT_CONVERSION": "off",
          "wallet/NO_BLOB_TX_ON_ARC": "off"
        },
        ruleIds: []
      },
      {
        label: "L02 C06 enabled and C07 disabled",
        rules: { "wallet/NO_BLOB_TX_ON_ARC": "off" },
        ruleIds: ["wallet/ARC_USDC_AMOUNT_CONVERSION"]
      },
      {
        label: "L03 C06 disabled and C07 enabled",
        rules: { "wallet/ARC_USDC_AMOUNT_CONVERSION": "off" },
        ruleIds: ["wallet/NO_BLOB_TX_ON_ARC"]
      },
      {
        label: "L04 both compiler consumers enabled",
        rules: {},
        ruleIds: [
          "wallet/ARC_USDC_AMOUNT_CONVERSION",
          "wallet/NO_BLOB_TX_ON_ARC"
        ]
      }
    ] as const;
    for (const state of compilerStates) {
      for (const failOn of ["info", "warning", "critical", "none"] as const) {
        writeCompilerProbeProject(root, {
          presets: ["wallet"],
          failOn,
          rules: state.rules
        });
        assertCompilerUnavailableState(
          runInstalledProbe(root),
          `${state.label} with fail-on ${failOn}`,
          state.ruleIds,
          failOn
        );
      }
    }
  } finally {
    renameSync(withdrawn, installed);
  }
}

function runInstalledProbe(root: string) {
  return runCapturedNpx(
    ["--no-install", "arcready", "scan", "--format", "json"],
    root
  );
}

function assertCompilerNotRequired(
  execution: ReturnType<typeof runCaptured>,
  label: string
): void {
  if (execution.error) throw execution.error;
  const report = JSON.parse(execution.stdout) as {
    findings: Array<{ message: string }>;
  };
  if (
    execution.status !== 0 ||
    report.findings.some(({ message }) => message.includes("failed"))
  ) {
    throw new Error(`TypeScript was unexpectedly required for ${label}`);
  }
}

function assertCompilerUnavailableState(
  execution: ReturnType<typeof runCaptured>,
  label: string,
  ruleIds: readonly string[],
  failOn: "info" | "warning" | "critical" | "none"
): void {
  if (execution.error) throw execution.error;
  const expectedExit =
    ruleIds.length > 0 && (failOn === "info" || failOn === "warning") ? 1 : 0;
  const report = JSON.parse(execution.stdout) as {
    findings: Array<{
      ruleId: string;
      severity: string;
      message: string;
      files: string[];
      suggestedFix?: string;
      docs?: string;
      preset?: string;
    }>;
    score: number;
    status: string;
    summary: { critical: number; warning: number; info: number };
  };
  const actualRuleIds = report.findings.map(({ ruleId }) => ruleId);
  const warningsAreStable = report.findings.every((finding) => {
    const prefix = `Rule "${finding.ruleId}" failed: `;
    const messageMatches =
      finding.ruleId === "wallet/NO_BLOB_TX_ON_ARC"
        ? finding.message === `${prefix}typescript compiler unavailable`
        : finding.message.startsWith(prefix) &&
          finding.message.includes("typescript");
    const docs =
      finding.ruleId === "wallet/NO_BLOB_TX_ON_ARC"
        ? "arc-blob-transactions"
        : "arc-usdc-amount-conversion";
    return (
      finding.severity === "warning" &&
      messageMatches &&
      finding.files.length === 0 &&
      finding.suggestedFix ===
        "Check the rule implementation or disable this rule temporarily." &&
      finding.docs === docs &&
      finding.preset === "wallet"
    );
  });
  if (
    execution.status !== expectedExit ||
    JSON.stringify(actualRuleIds) !== JSON.stringify(ruleIds) ||
    !warningsAreStable ||
    report.score !== 100 - ruleIds.length * 10 ||
    report.status !== (ruleIds.length === 0 ? "pass" : "warn") ||
    report.summary.critical !== 0 ||
    report.summary.warning !== ruleIds.length ||
    report.summary.info !== 0
  ) {
    throw new Error(
      `Unexpected compiler-unavailable state for ${label}: ${execution.stdout}`
    );
  }
}

function writeAmountProject(
  root: string,
  decimals: 6 | 18,
  config: Record<string, unknown>
): void {
  mkdirSync(join(root, "src"), { recursive: true });
  rmSync(join(root, "src", "bridge.ts"), { force: true });
  rmSync(join(root, "src", "component.tsx"), { force: true });
  rmSync(join(root, "src", "compiler-probe.ts"), { force: true });
  rmSync(join(root, "src", "submit.ts"), { force: true });
  writeConfig(root, config);
  writeFileSync(
    join(root, "src", "amounts.ts"),
    `import { createPublicClient, formatUnits, http } from "viem";
const client = createPublicClient({ chain: { id: 5042002 }, transport: http("https://rpc.testnet.arc.network") });
const balance = await client.getBalance({ address: account });
formatUnits(balance, ${decimals});
`
  );
}

function writeBlobProject(root: string, violation: boolean): void {
  mkdirSync(join(root, "src"), { recursive: true });
  rmSync(join(root, "src", "amounts.ts"), { force: true });
  rmSync(join(root, "src", "bridge.ts"), { force: true });
  rmSync(join(root, "src", "component.tsx"), { force: true });
  rmSync(join(root, "src", "compiler-probe.ts"), { force: true });
  writeConfig(root, { presets: ["wallet"], failOn: "critical" });
  writeFileSync(
    join(root, "src", "submit.ts"),
    violation
      ? `import { JsonRpcProvider, Wallet } from "ethers";
const provider = new JsonRpcProvider("https://rpc.testnet.arc.network");
const signer = new Wallet(key, provider);
signer.sendTransaction({ type: 3 });
`
      : `const chainId = 5042002;
const docs = "Arc EIP-4844 blob transaction type: 3";
`
  );
}

function writeCompilerProbeProject(
  root: string,
  config: Record<string, unknown>
): void {
  mkdirSync(join(root, "src"), { recursive: true });
  rmSync(join(root, "src", "amounts.ts"), { force: true });
  rmSync(join(root, "src", "bridge.ts"), { force: true });
  rmSync(join(root, "src", "component.tsx"), { force: true });
  rmSync(join(root, "src", "submit.ts"), { force: true });
  writeConfig(root, config);
  writeFileSync(
    join(root, "src", "compiler-probe.ts"),
    "export const compilerProbe = true;\n"
  );
}

function writeConfig(root: string, config: Record<string, unknown>): void {
  writeFileSync(
    join(root, "arcready.config.json"),
    JSON.stringify(config, null, 2)
  );
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
      normalized === "node_path" ||
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
