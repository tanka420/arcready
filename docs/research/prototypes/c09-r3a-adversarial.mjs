import { createRequire } from "node:module";
import { resolve } from "node:path";
import process from "node:process";
import { analyzeC09Source } from "./c09-r3a-analyzer.mjs";

const parserRoot = process.env.C09_PARSER_ROOT;
if (!parserRoot) throw new Error("C09_PARSER_ROOT is required");
const require = createRequire(import.meta.url);
const parser = require(
  resolve(parserRoot, "node_modules/@solidity-parser/parser")
);

const header = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

contract Pressure {
  address[] public relayers;
  event Seen(uint256 value);
`;
const contract = (body) => `${header}${body}
}
`;
const expected = (overrides = {}) => ({
  parseStatus: "parseable",
  sourceClass: "direct-prevrandao",
  contractOwnership: "single-contract",
  functionOwnership: "same-function",
  bindingClass: "single-assignment",
  sinkClass: "selection",
  arcDeploymentOwnership: "synthetic-r3a",
  publicEmissionEligibility: "r3a-candidate-only",
  ...overrides
});

const cases = [
  {
    id: "C09-R3A-ADV01",
    source: contract(`
  function observe() external view {
    uint256 seed = block.prevrandao;
    // return relayers[seed % relayers.length];
    seed;
  }`),
    expected: expected({
      sinkClass: "none",
      publicEmissionEligibility: "not-applicable"
    })
  },
  {
    id: "C09-R3A-ADV02",
    source: contract(`
  function observe() external view {
    uint256 seed = block.prevrandao;
    string memory note = "return relayers[seed % relayers.length]";
    note;
    seed;
  }`),
    expected: expected({
      sinkClass: "none",
      publicEmissionEligibility: "not-applicable"
    })
  },
  {
    id: "C09-R3A-ADV03",
    source: contract(`
  function selectRelay() external view returns (address) {
    uint256 seed = block.prevrandao;
    // seed = 7;
    return relayers[seed % relayers.length];
  }`),
    expected: expected()
  },
  {
    id: "C09-R3A-ADV04",
    source: contract(`
  function selectRelay() external view returns (address) {
    uint256 seed = block.prevrandao;
    string memory note = "uint256 seed = 1;";
    note;
    return relayers[seed % relayers.length];
  }`),
    expected: expected()
  },
  {
    id: "C09-R3A-ADV05",
    source: contract(`
  function selectRelay() external view returns (address) {
    return relayers[block /* split source */ . prevrandao % relayers.length];
  }`),
    expected: expected({ bindingClass: "direct" })
  },
  {
    id: "C09-R3A-ADV06",
    source: contract(`
  function selectRelay() external view returns (address) {
    uint256 seed = block /* split source */ . prevrandao;
    return relayers[seed % relayers.length];
  }`),
    expected: expected()
  },
  {
    id: "C09-R3A-ADV07",
    source: contract(`
  function selectTelemetry() external {
    emit Seen(block.prevrandao);
  }`),
    expected: expected({
      bindingClass: "direct",
      sinkClass: "safe-observation",
      publicEmissionEligibility: "not-applicable"
    })
  },
  {
    id: "C09-R3A-ADV08",
    source: contract(`
  function selectRelay() external view returns (address) {
    // for (uint256 i = 0; i < 1; i++) {}
    return relayers[block.prevrandao % relayers.length];
  }`),
    expected: expected({ bindingClass: "direct" })
  },
  {
    id: "C09-R3A-ADV09",
    source: contract(`
  function selectRelay() external view returns (address) {
    string memory note = "uint256 length = relayers.length;";
    note;
    return relayers[block.prevrandao % relayers.length];
  }`),
    expected: expected({ bindingClass: "direct" })
  },
  {
    id: "C09-R3A-ADV10",
    source: contract(`
  function selectRelay() external view returns (address) {
    uint256 seed = block.prevrandao;
    /* uint256 second = seed; */
    return relayers[seed % relayers.length];
  }`),
    expected: expected()
  }
];

const fields = Object.keys(expected());
const mismatches = [];
for (const item of cases) {
  const actual = analyzeC09Source(parser, item.source);
  const differences = fields.filter(
    (field) => actual[field] !== item.expected[field]
  );
  if (differences.length > 0) {
    mismatches.push({
      id: item.id,
      differences,
      expected: item.expected,
      actual
    });
  }
}

process.stdout.write(
  `${JSON.stringify(
    {
      parserVersion: "0.20.2",
      total: cases.length,
      matched: cases.length - mismatches.length,
      mismatched: mismatches.length,
      mismatches
    },
    null,
    2
  )}\n`
);

if (mismatches.length > 0) process.exitCode = 1;
