import process from "node:process";
import { projectCases } from "./c09-r2-corpus.mjs";
import { classifyFoundryArcAssociation } from "./c09-r3b-foundry-prototype.mjs";

const FOUNDRY_ARTIFACT_CONTRACT =
  "foundry-forge-script-run-latest-reviewed-2026-08-05";
const ARC_BROADCAST_PATH =
  "broadcast/Deploy.s.sol/5042002/run-latest.json";
const ARC_ADDRESS = "0x1111111111111111111111111111111111111111";

const EXPECTED = new Map([
  ["C09-P01", "arc-foundry"],
  ["C09-P02", "non-arc"],
  ["C09-P03", "ambiguous"],
  ["C09-P04", "conflict"],
  ["C09-P05", "unknown"],
  ["C09-P06", "unknown"],
  ["C09-P07", "ambiguous"],
  ["C09-P08", "unknown"],
  ["C09-P09", "unknown"],
  ["C09-P10", "unknown"],
  ["C09-P11", "unknown"],
  ["C09-P12", "unsupported-adapter"],
  ["C09-P13", "unsupported-adapter"],
  ["C09-P14", "unsupported-adapter"],
  ["C09-P15", "unsupported-adapter"],
  ["C09-P16", "unsupported-adapter"]
]);

function foundryBroadcast({
  chain = 5042002,
  transactionType = "CREATE",
  contractName = "RelaySelector",
  contractAddress = ARC_ADDRESS
} = {}) {
  const transaction = { transactionType, contractName };
  if (contractAddress !== undefined) {
    transaction.contractAddress = contractAddress;
  }

  return JSON.stringify({ chain, transactions: [transaction] }, null, 2);
}

function adversarialProject(id, files) {
  return {
    id,
    kind: "project",
    artifactContract: FOUNDRY_ARTIFACT_CONTRACT,
    files
  };
}

const adversarialCases = [
  {
    id: "C09-R3B-A01",
    expected: "unknown",
    project: adversarialProject("C09-R3B-A01", {
      "src/Other.sol":
        "pragma solidity ^0.8.24;\ncontract Other {}\n// contract RelaySelector {}\n",
      [ARC_BROADCAST_PATH]: foundryBroadcast()
    }),
    note: "A comment cannot spoof exact contract identity."
  },
  {
    id: "C09-R3B-A02",
    expected: "unknown",
    project: adversarialProject("C09-R3B-A02", {
      "src/Other.sol":
        'pragma solidity ^0.8.24;\ncontract Other { string constant TEXT = "contract RelaySelector {}"; }\n',
      [ARC_BROADCAST_PATH]: foundryBroadcast()
    }),
    note: "A quoted literal cannot spoof exact contract identity."
  },
  {
    id: "C09-R3B-A03",
    expected: "ambiguous",
    project: adversarialProject("C09-R3B-A03", {
      "src/RelaySelector.sol":
        "pragma solidity ^0.8.24;\ncontract RelaySelector {}\n",
      "src/Duplicate.sol":
        "pragma solidity ^0.8.24;\ncontract RelaySelector {}\n",
      [ARC_BROADCAST_PATH]: foundryBroadcast()
    }),
    note: "Duplicate exact concrete definitions are ambiguous."
  },
  {
    id: "C09-R3B-A04",
    expected: "unknown",
    project: adversarialProject("C09-R3B-A04", {
      "src/RelaySelector.sol":
        "pragma solidity ^0.8.24;\nabstract contract RelaySelector {}\n",
      [ARC_BROADCAST_PATH]: foundryBroadcast()
    }),
    note: "An abstract contract cannot establish a concrete CREATE owner."
  },
  {
    id: "C09-R3B-A05",
    expected: "unknown",
    project: adversarialProject("C09-R3B-A05", {
      "src/RelaySelector.sol":
        "pragma solidity ^0.8.24;\ncontract RelaySelector {}\n",
      [ARC_BROADCAST_PATH]: "{ malformed"
    }),
    note: "Malformed broadcast JSON fails closed."
  },
  {
    id: "C09-R3B-A06",
    expected: "conflict",
    project: adversarialProject("C09-R3B-A06", {
      "src/RelaySelector.sol":
        "pragma solidity ^0.8.24;\ncontract RelaySelector {}\n",
      [ARC_BROADCAST_PATH]: foundryBroadcast({ chain: 1 })
    }),
    note: "Path and JSON chain identity must agree."
  },
  {
    id: "C09-R3B-A07",
    expected: "unknown",
    project: adversarialProject("C09-R3B-A07", {
      "src/RelaySelector.sol":
        "pragma solidity ^0.8.24;\ncontract RelaySelector {}\n",
      [ARC_BROADCAST_PATH]: foundryBroadcast({ contractAddress: null })
    }),
    note: "A CREATE record without a valid address is incomplete."
  },
  {
    id: "C09-R3B-A08",
    expected: "unknown",
    project: adversarialProject("C09-R3B-A08", {
      "src/RelaySelector.sol":
        "pragma solidity ^0.8.24;\ncontract RelaySelector {}\n",
      [ARC_BROADCAST_PATH]: foundryBroadcast({ transactionType: "CALL" })
    }),
    note: "A non-CREATE transaction cannot establish deployment ownership."
  },
  {
    id: "C09-R3B-A09",
    expected: "arc-foundry",
    project: adversarialProject("C09-R3B-A09", {
      "src/RelaySelector.sol":
        "pragma solidity ^0.8.24;\ncontract RelaySelector {}\n",
      [ARC_BROADCAST_PATH]: foundryBroadcast(),
      "broadcast/OtherDeploy.s.sol/5042002/run-latest.json":
        foundryBroadcast()
    }),
    note: "Duplicate Arc artifacts with the same exact address are consistent."
  }
];

function evaluate(id, expected, project) {
  const actual = classifyFoundryArcAssociation(project);
  return {
    id,
    expected,
    actual: actual.status,
    foundryVersion: actual.foundryVersion,
    reason: actual.reason
  };
}

function run() {
  const failures = [];
  const canonicalResults = [];

  for (const projectCase of projectCases) {
    const expected = EXPECTED.get(projectCase.id);
    if (!expected) {
      failures.push(`${projectCase.id}: missing R3-B expected adapter status`);
      continue;
    }

    const result = evaluate(projectCase.id, expected, projectCase);
    canonicalResults.push(result);
    if (result.actual !== expected) {
      failures.push(
        `${projectCase.id}: expected ${expected}, received ${result.actual}`
      );
    }
  }

  if (canonicalResults.length !== 16) {
    failures.push(
      `expected 16 canonical project results, received ${canonicalResults.length}`
    );
  }

  const adversarialResults = adversarialCases.map((testCase) =>
    evaluate(testCase.id, testCase.expected, testCase.project)
  );
  for (const result of adversarialResults) {
    if (result.actual !== result.expected) {
      failures.push(
        `${result.id}: expected ${result.expected}, received ${result.actual}`
      );
    }
  }

  const allResults = [...canonicalResults, ...adversarialResults];
  const counts = Object.fromEntries(
    [...new Set(allResults.map((result) => result.actual))]
      .sort()
      .map((status) => [
        status,
        allResults.filter((result) => result.actual === status).length
      ])
  );

  const summary = {
    canonical: {
      total: canonicalResults.length,
      matched: canonicalResults.filter(
        (result) => result.expected === result.actual
      ).length
    },
    adversarial: {
      total: adversarialResults.length,
      matched: adversarialResults.filter(
        (result) => result.expected === result.actual
      ).length
    },
    counts,
    failures,
    canonicalResults,
    adversarialResults
  };

  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);

  if (failures.length > 0) {
    process.exitCode = 1;
  }
}

run();
