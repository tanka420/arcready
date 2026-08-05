import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import process from "node:process";
import { URL } from "node:url";
import { astComparatorCases, cases } from "./c09-r2-corpus.mjs";

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

const manifest = JSON.parse(readFileSync(MANIFEST_URL, "utf8"));
if (manifest.schemaVersion !== 1) {
  throw new Error(`Unsupported AST manifest schema: ${manifest.schemaVersion}`);
}
if (manifest.compiler !== "solc" || manifest.compilerVersion !== "0.8.30") {
  throw new Error("AST manifest must pin solc 0.8.30");
}
if (!Array.isArray(manifest.entries)) {
  throw new Error("AST manifest entries must be an array");
}
if (manifest.entries.length !== astComparatorCases.length) {
  throw new Error(
    `AST manifest entry count mismatch: ${manifest.entries.length} !== ${astComparatorCases.length}`
  );
}

const seen = new Set();
for (const expected of astComparatorCases) {
  const entry = manifest.entries.find(
    (candidate) => candidate.id === expected.id
  );
  if (!entry) throw new Error(`Missing AST manifest entry: ${expected.id}`);
  if (seen.has(entry.id))
    throw new Error(`Duplicate AST manifest entry: ${entry.id}`);
  seen.add(entry.id);

  if (entry.sourcePath !== expected.sourcePath) {
    throw new Error(`${entry.id}: source path mismatch`);
  }
  if (entry.compilerVersion !== expected.compilerVersion) {
    throw new Error(`${entry.id}: compiler version mismatch`);
  }

  const fixture = cases.find((candidate) => candidate.id === entry.id);
  const source = fixture?.files[entry.sourcePath];
  if (typeof source !== "string") {
    throw new Error(`${entry.id}: comparator source is missing`);
  }
  const sourceSha256 = sha256(source);
  if (
    sourceSha256 !== expected.sourceSha256 ||
    sourceSha256 !== entry.sourceSha256
  ) {
    throw new Error(`${entry.id}: retained AST source hash is stale`);
  }
  if (!entry.ast || typeof entry.ast !== "object") {
    throw new Error(`${entry.id}: retained AST is missing`);
  }
  const astSha256 = sha256(stableJson(entry.ast));
  if (astSha256 !== entry.astSha256) {
    throw new Error(`${entry.id}: retained AST hash is stale`);
  }
}

const summary = {
  schemaVersion: manifest.schemaVersion,
  compiler: manifest.compiler,
  compilerVersion: manifest.compilerVersion,
  entries: manifest.entries.length
};

if (process.argv[1]?.endsWith("c09-r2-validate-ast.mjs")) {
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}
