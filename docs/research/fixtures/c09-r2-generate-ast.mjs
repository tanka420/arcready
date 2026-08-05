import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { astComparatorCases, cases } from "./c09-r2-corpus.mjs";

const COMPILER_VERSION = "0.8.30";
const MANIFEST_URL = new URL("./c09-r2-ast-manifest.json", import.meta.url);

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

const sources = Object.fromEntries(
  astComparatorCases.map((expected) => {
    const fixture = cases.find((candidate) => candidate.id === expected.id);
    const content = fixture?.files[expected.sourcePath];
    if (typeof content !== "string") {
      throw new Error(`${expected.id}: comparator source is missing`);
    }
    if (sha256(content) !== expected.sourceSha256) {
      throw new Error(`${expected.id}: comparator source hash is stale`);
    }
    return [expected.sourcePath, { content }];
  })
);

const input = {
  language: "Solidity",
  sources,
  settings: {
    outputSelection: {
      "*": {
        "": ["ast"]
      }
    }
  }
};

const executable = process.platform === "win32" ? "npx.cmd" : "npx";
const result = spawnSync(
  executable,
  ["--yes", `solc@${COMPILER_VERSION}`, "--standard-json"],
  {
    input: JSON.stringify(input),
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024
  }
);

if (result.error) throw result.error;
if (result.status !== 0) {
  throw new Error(`solc ${COMPILER_VERSION} failed: ${result.stderr}`);
}

const jsonStart = result.stdout.indexOf("{");
if (jsonStart < 0) {
  throw new Error("solc output did not contain Standard JSON");
}
const output = JSON.parse(result.stdout.slice(jsonStart));
const compilerErrors = (output.errors ?? []).filter(
  (entry) => entry.severity === "error"
);
if (compilerErrors.length > 0) {
  throw new Error(
    `solc reported errors:\n${compilerErrors
      .map((entry) => entry.formattedMessage ?? entry.message)
      .join("\n")}`
  );
}

const entries = astComparatorCases.map((expected) => {
  const ast = output.sources?.[expected.sourcePath]?.ast;
  if (!ast || typeof ast !== "object") {
    throw new Error(`${expected.id}: compiler AST is missing`);
  }
  return {
    id: expected.id,
    compilerVersion: COMPILER_VERSION,
    sourcePath: expected.sourcePath,
    sourceSha256: expected.sourceSha256,
    astSha256: sha256(stableJson(ast)),
    ast
  };
});

const manifest = {
  schemaVersion: 1,
  compiler: "solc",
  compilerVersion: COMPILER_VERSION,
  generatedAt: "2026-08-05",
  entries
};

const checkMode = process.argv[2] === "--check";
const outputPath =
  !checkMode && process.argv[2]
    ? resolve(process.argv[2])
    : fileURLToPath(MANIFEST_URL);

if (checkMode) {
  const retained = JSON.parse(readFileSync(MANIFEST_URL, "utf8"));
  if (stableJson(retained) !== stableJson(manifest)) {
    throw new Error(
      "Retained AST manifest does not match regenerated solc 0.8.30 output"
    );
  }
} else {
  writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

process.stdout.write(
  `${JSON.stringify(
    {
      compiler: manifest.compiler,
      compilerVersion: manifest.compilerVersion,
      entries: manifest.entries.length,
      mode: checkMode ? "check" : "write",
      outputPath
    },
    null,
    2
  )}\n`
);
