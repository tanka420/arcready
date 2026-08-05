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

const failures = [];
const results = [];
for (const fixture of sourceCases) {
  const sourcePath = Object.keys(fixture.files)[0];
  const actual = classifySoliditySource({
    source: fixture.files[sourcePath],
    parser,
    evmTargetEvidence: fixture.evmTargetEvidence ?? null
  });
  const expected = fixture.expected;
  const mismatch = {};
  for (const field of EXPECTED_FIELDS) {
    if (actual[field] !== expected[field]) {
      mismatch[field] = { expected: expected[field], actual: actual[field] };
    }
  }
  results.push({ id: fixture.id, actual });
  if (Object.keys(mismatch).length > 0)
    failures.push({ id: fixture.id, mismatch });
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
    ).length
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
assert.equal(
  unrelatedSelection.publicEmissionEligibility,
  "blocked-unsupported"
);

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

const transformedSelection = classifySoliditySource({
  parser,
  source: `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
contract Extra {
  address[] internal members;
  function pick() external view returns (address) {
    return members[(block.prevrandao + 1) % members.length];
  }
}
`
});
assert.equal(transformedSelection.sinkClass, "unsupported");
assert.equal(
  transformedSelection.publicEmissionEligibility,
  "blocked-unsupported"
);

const transformedBinding = classifySoliditySource({
  parser,
  source: `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
contract Extra {
  address[] internal members;
  function pick() external view returns (address) {
    uint256 seed = block.prevrandao + 1;
    return members[seed % members.length];
  }
}
`
});
assert.equal(transformedBinding.sinkClass, "unsupported");
assert.equal(
  transformedBinding.publicEmissionEligibility,
  "blocked-unsupported"
);

const arbitraryCallSelection = classifySoliditySource({
  parser,
  source: `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
contract Extra {
  address[] internal members;
  function normalize(uint256 value) internal pure returns (uint256) { return value; }
  function pick() external view returns (address) {
    return members[normalize(block.prevrandao) % members.length];
  }
}
`
});
assert.equal(arbitraryCallSelection.sinkClass, "unsupported");
assert.equal(
  arbitraryCallSelection.publicEmissionEligibility,
  "blocked-unsupported"
);

const unaryMutation = classifySoliditySource({
  parser,
  source: `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
contract Extra {
  address[] internal members;
  function pick() external view returns (address) {
    uint256 seed = block.prevrandao;
    seed++;
    return members[seed % members.length];
  }
}
`
});
assert.equal(unaryMutation.bindingClass, "reassigned");
assert.equal(unaryMutation.publicEmissionEligibility, "blocked-unsupported");

const assemblyCrossFunction = classifySoliditySource({
  parser,
  source: `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
contract Extra {
  address[] internal members;
  function seed() internal view returns (uint256 value) {
    assembly { value := prevrandao() }
  }
  function pick(uint256 value) external view returns (address) {
    return members[value % members.length];
  }
}
`
});
assert.equal(assemblyCrossFunction.functionOwnership, "cross-function");
assert.equal(
  assemblyCrossFunction.publicEmissionEligibility,
  "blocked-unsupported"
);

const assemblyOwnedCandidate = classifySoliditySource({
  parser,
  source: `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
contract Extra {
  address[] internal members;
  function observe() external pure returns (uint256) { return 1; }
  function pick() external view returns (address) {
    uint256 seed;
    assembly { seed := prevrandao() }
    return members[seed % members.length];
  }
}
`
});
assert.equal(assemblyOwnedCandidate.contractOwnership, "single-contract");
assert.equal(assemblyOwnedCandidate.functionOwnership, "same-function");
assert.equal(
  assemblyOwnedCandidate.publicEmissionEligibility,
  "r3a-candidate-only"
);

const returnedZeroCheck = classifySoliditySource({
  parser,
  source: `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
contract Extra {
  function isArcCompatible() external view returns (bool) {
    return block.prevrandao == 0;
  }
}
`
});
assert.equal(returnedZeroCheck.sinkClass, "safe-observation");
assert.equal(returnedZeroCheck.publicEmissionEligibility, "not-applicable");

const transformedAuthorization = classifySoliditySource({
  parser,
  source: `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
contract Extra {
  function eligible(uint256 value) external view returns (bool) {
    return value == block.prevrandao + 1;
  }
}
`
});
assert.equal(transformedAuthorization.sinkClass, "unsupported");
assert.equal(
  transformedAuthorization.publicEmissionEligibility,
  "blocked-unsupported"
);

const missingRangeParser = {
  parse(source, options) {
    const ast = parser.parse(source, options);
    let removed = false;
    const visit = (value) => {
      if (!value || typeof value !== "object" || removed) return;
      if (value.type === "MemberAccess" && value.memberName === "prevrandao") {
        delete value.range;
        removed = true;
        return;
      }
      for (const child of Object.values(value)) {
        if (Array.isArray(child)) child.forEach(visit);
        else visit(child);
      }
    };
    visit(ast);
    return ast;
  }
};
const missingRange = classifySoliditySource({
  parser: missingRangeParser,
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
assert.equal(missingRange.sourceClass, "unsupported-source");
assert.equal(missingRange.publicEmissionEligibility, "blocked-unsupported");

if (failures.length === 0) {
  process.stdout.write("C09-R3-A adversarial checks: 13 passed\n");
}
