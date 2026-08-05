import { createRequire } from "node:module";
import { resolve } from "node:path";
import process from "node:process";
import { sourceCases } from "../fixtures/c09-r2-corpus.mjs";
import { analyzeC09Source } from "./c09-r3a-analyzer.mjs";

const parserRoot = process.env.C09_PARSER_ROOT;
if (!parserRoot) throw new Error("C09_PARSER_ROOT is required");

const require = createRequire(import.meta.url);
const parser = require(
  resolve(parserRoot, "node_modules/@solidity-parser/parser")
);

const fields = [
  "parseStatus",
  "sourceClass",
  "contractOwnership",
  "functionOwnership",
  "bindingClass",
  "sinkClass",
  "arcDeploymentOwnership",
  "publicEmissionEligibility"
];

const mismatches = [];
const results = [];

for (const testCase of sourceCases) {
  const [[sourcePath, source]] = Object.entries(testCase.files);
  const actual = analyzeC09Source(parser, source, testCase);
  const differences = fields.filter(
    (field) => actual[field] !== testCase.expected[field]
  );

  results.push({ id: testCase.id, sourcePath, actual });
  if (differences.length > 0) {
    mismatches.push({
      id: testCase.id,
      differences,
      expected: testCase.expected,
      actual
    });
  }
}

process.stdout.write(
  `${JSON.stringify(
    {
      parserVersion: "0.20.2",
      total: sourceCases.length,
      matched: sourceCases.length - mismatches.length,
      mismatched: mismatches.length,
      mismatches,
      results
    },
    null,
    2
  )}\n`
);

if (mismatches.length > 0) process.exitCode = 1;
