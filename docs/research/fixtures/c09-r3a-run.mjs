import assert from "node:assert/strict";
import parserModule from "@solidity-parser/parser";
import { sourceCases } from "./c09-r2-corpus.mjs";
import { classifySoliditySource } from "./c09-r3a-prototype.mjs";

const parser = parserModule.default ?? parserModule;
const EXPECTED_FIELDS = [
  "parseStatus",
  "sourceClass",
  "contractOwnership",
  "functionOwnership",
  "bindingClass",
  "sinkClass",
  "arcDeploymentOwnership",
  "publicEmissionEligibility"
];

const CORPUS_ERRATA = new Map([
  ["C09-N08", { functionOwnership: "none" }],
  ["C09-N09", { functionOwnership: "none" }],
  ["C09-N10", { functionOwnership: "none" }]
]);

function expectedFor(fixture) {
  return { ...fixture.expected, ...(CORPUS_ERRATA.get(fixture.id) ?? {}) };
}

const failures = [];
const results = [];
for (const fixture of sourceCases) {
  const sourcePath = Object.keys(fixture.files)[0];
  const actual = classifySoliditySource({
    source: fixture.files[sourcePath],
    parser,
    evmTargetEvidence: fixture.evmTargetEvidence ?? null
  });
  const expected = expectedFor(fixture);
  const mismatch = {};
  for (const field of EXPECTED_FIELDS) {
    if (actual[field] !== expected[field]) {
      mismatch[field] = { expected: expected[field], actual: actual[field] };
    }
  }
  results.push({ id: fixture.id, actual });
  if (Object.keys(mismatch).length > 0) failures.push({ id: fixture.id, mismatch });
}

if (failures.length > 0) {
  process.stderr.write(`${JSON.stringify({ failures }, null, 2)}\n`);
  process.exitCode = 1;
} else {
  const summary = {
    total: results.length,
    candidates: results.filter(
      (item) => item.actual.publicEmissionEligibility === "r3a-candidate-only"
    ).length,
    safe: results.filter(
      (item) => item.actual.publicEmissionEligibility === "not-applicable"
    ).length,
    unsupported: results.filter(
      (item) => item.actual.publicEmissionEligibility === "blocked-unsupported"
    ).length,
    corpusErrata: [...CORPUS_ERRATA.keys()]
  };
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

const directSelection = classifySoliditySource({
  parser,
  source: `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
contract Extra {
  address[] internal members;
  function pick() external view returns (address) {
    return members[block.prevrandao % members.length];
  }
}
`
});
assert.equal(directSelection.publicEmissionEligibility, "r3a-candidate-only");

const unrelatedSelection = classifySoliditySource({
  parser,
  source: `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
contract Extra {
  address[] internal members;
  function observe() external view returns (uint256) { return block.prevrandao; }
  function pick(uint256 seed) external view returns (address) {
    return members[seed % members.length];
  }
}
`
});
assert.equal(unrelatedSelection.publicEmissionEligibility, "blocked-unsupported");

const commentOnly = classifySoliditySource({
  parser,
  source: `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
// return members[block.prevrandao % members.length];
contract Extra {}
`
});
assert.equal(commentOnly.sourceClass, "no-source");
assert.equal(commentOnly.publicEmissionEligibility, "not-applicable");

const unsafeLength = classifySoliditySource({
  parser,
  source: `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
contract Extra {
  address[] internal members;
  function pick() external view returns (address) {
    uint256 length = members.length;
    return members[block.prevrandao % length];
  }
}
`
});
assert.equal(unsafeLength.sinkClass, "unsupported");
assert.equal(unsafeLength.publicEmissionEligibility, "blocked-unsupported");

if (failures.length === 0) {
  process.stdout.write("C09-R3-A adversarial checks: passed\n");
}
