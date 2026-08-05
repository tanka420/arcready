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

contract ExtendedPressure {
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
  bindingClass: "direct",
  sinkClass: "selection",
  arcDeploymentOwnership: "synthetic-r3a",
  publicEmissionEligibility: "r3a-candidate-only",
  ...overrides
});

const cases = [
  {
    id: "C09-R3A-ADV11",
    source: contract(`
  function observe() external view {
    string memory note = unicode"🙂 return relayers[seed % relayers.length]";
    uint256 seed = block.prevrandao;
    note;
    seed;
  }`),
    expected: expected({
      bindingClass: "single-assignment",
      sinkClass: "none",
      publicEmissionEligibility: "not-applicable"
    })
  },
  {
    id: "C09-R3A-ADV12",
    source: contract(`
  function observe() external view {
    string memory note = "escaped quote: \\\" return relayers[seed % relayers.length]";
    uint256 seed = block.prevrandao;
    note;
    seed;
  }`),
    expected: expected({
      bindingClass: "single-assignment",
      sinkClass: "none",
      publicEmissionEligibility: "not-applicable"
    })
  },
  {
    id: "C09-R3A-ADV13",
    source: contract(`
  function selectCompatibility() external view returns (bool) {
    return block.prevrandao == 0;
  }`),
    expected: expected({
      sinkClass: "safe-observation",
      publicEmissionEligibility: "not-applicable"
    })
  },
  {
    id: "C09-R3A-ADV14",
    source: contract(`
  function selectRelayCompatibility() external view {
    require(block.prevrandao == 0, "Arc PREVRANDAO must be zero");
  }`),
    expected: expected({
      sinkClass: "safe-observation",
      publicEmissionEligibility: "not-applicable"
    })
  },
  {
    id: "C09-R3A-ADV15",
    source: contract(`
  function selectRelay() external view returns (address) {
    return relayers[block // split source across a line comment
      .prevrandao % relayers.length];
  }`),
    expected: expected()
  },
  {
    id: "C09-R3A-ADV16",
    source: contract(`
  function selectRelay() external view returns (address) {
    /* 🙂 fake return relayers[seed % relayers.length]; */
    return relayers[block.prevrandao % relayers.length];
  }`),
    expected: expected()
  },
  {
    id: "C09-R3A-ADV17",
    source: contract(`
  function selectRelay() external view returns (address) {
    string memory note = unicode"🙂 for while do uint256 length = relayers.length;";
    note;
    return relayers[block.prevrandao % relayers.length];
  }`),
    expected: expected()
  },
  {
    id: "C09-R3A-ADV18",
    source: contract(`
  function selectTelemetry() external {
    string memory note = "return relayers[block.prevrandao % relayers.length]";
    note;
    emit Seen(block.prevrandao);
  }`),
    expected: expected({
      sinkClass: "safe-observation",
      publicEmissionEligibility: "not-applicable"
    })
  },
  {
    id: "C09-R3A-ADV19",
    source: contract(`
  function selectRelay() external view returns (address) {
    string memory note = unicode"🙂 uint256 seed = 1; seed += 7;";
    uint256 seed = block.prevrandao;
    note;
    return relayers[seed % relayers.length];
  }`),
    expected: expected({ bindingClass: "single-assignment" })
  },
  {
    id: "C09-R3A-ADV20",
    source: contract(`
  function selectRelay() external view returns (address) {
    string memory note = "slashes // and block /* uint256 second = seed; */";
    uint256 seed = block.prevrandao;
    note;
    return relayers[seed % relayers.length];
  }`),
    expected: expected({ bindingClass: "single-assignment" })
  },
  {
    id: "C09-R3A-ADV21",
    source: contract(`
  function selectRelay() external view returns (address) {
    uint256 seed = block /* comment with quote \" and emoji 🙂 */ .prevrandao;
    return relayers[seed % relayers.length];
  }`),
    expected: expected({ bindingClass: "single-assignment" })
  },
  {
    id: "C09-R3A-ADV22",
    source: contract(`
  function eligible(address account) external view returns (bool) {
    string memory note = unicode"🙂 return block.prevrandao == 0";
    note;
    return uint160(account) % 2 == block.prevrandao % 2;
  }`),
    expected: expected({ sinkClass: "authorization" })
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
