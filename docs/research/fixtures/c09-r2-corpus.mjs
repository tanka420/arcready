import { createHash } from "node:crypto";
import process from "node:process";

const CASE_KINDS = new Set(["source", "project"]);
const PARSE_STATUS = new Set(["parseable", "malformed", "unsupported-syntax"]);
const SOURCE_CLASS = new Set([
  "direct-prevrandao",
  "assembly-prevrandao",
  "difficulty-post-paris",
  "no-source",
  "unsupported-source"
]);
const CONTRACT_OWNERSHIP = new Set([
  "single-contract",
  "multiple-contracts",
  "cross-contract",
  "none",
  "ambiguous"
]);
const FUNCTION_OWNERSHIP = new Set([
  "same-function",
  "cross-function",
  "none",
  "ambiguous"
]);
const BINDING_CLASS = new Set([
  "direct",
  "single-assignment",
  "reassigned",
  "multi-hop",
  "branch-join",
  "none",
  "unsupported"
]);
const SINK_CLASS = new Set([
  "selection",
  "authorization",
  "ordering",
  "seed-consumed",
  "safe-observation",
  "none",
  "unsupported"
]);
const ARC_DEPLOYMENT_OWNERSHIP = new Set([
  "synthetic-r3a",
  "arc-foundry",
  "arc-hardhat",
  "non-arc",
  "unknown",
  "ambiguous",
  "conflict"
]);
const PUBLIC_ELIGIBILITY = new Set([
  "r3a-candidate-only",
  "r3b-association-candidate",
  "blocked-no-arc-association",
  "blocked-unsupported",
  "not-applicable"
]);

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function makeSourceCase(id, expected, source, note, extra = {}) {
  return {
    id,
    kind: "source",
    expected,
    files: { [`contracts/${id}.sol`]: source },
    note,
    ...extra
  };
}

function makeProjectCase(id, expected, files, note, extra = {}) {
  return { id, kind: "project", expected, files, note, ...extra };
}

const SPDX = "// SPDX-License-Identifier: MIT";
const PRAGMA = "pragma solidity ^0.8.24;";

function contract(body, name = "Selector") {
  return `${SPDX}\n${PRAGMA}\n\ncontract ${name} {\n${body}\n}\n`;
}

function sourceExpected(overrides = {}) {
  return {
    parseStatus: "parseable",
    sourceClass: "direct-prevrandao",
    contractOwnership: "single-contract",
    functionOwnership: "same-function",
    bindingClass: "direct",
    sinkClass: "selection",
    arcDeploymentOwnership: "synthetic-r3a",
    publicEmissionEligibility: "r3a-candidate-only",
    ...overrides
  };
}

function projectExpected(overrides = {}) {
  return {
    parseStatus: "parseable",
    sourceClass: "direct-prevrandao",
    contractOwnership: "single-contract",
    functionOwnership: "same-function",
    bindingClass: "direct",
    sinkClass: "selection",
    arcDeploymentOwnership: "unknown",
    publicEmissionEligibility: "blocked-no-arc-association",
    ...overrides
  };
}

const sourceCases = [
  makeSourceCase(
    "C09-S01",
    sourceExpected(),
    contract(
      "  address[] public relayers;\n\n  function selectRelay() external view returns (address) {\n    return relayers[block.prevrandao % relayers.length];\n  }"
    ),
    "Direct PREVRANDAO array selection."
  ),
  makeSourceCase(
    "C09-S02",
    sourceExpected(),
    contract(
      "  address[] public winners;\n\n  function selectWinner() external view returns (address) {\n    uint256 index = uint256(block.prevrandao) % winners.length;\n    return winners[index];\n  }"
    ),
    "Direct cast then modulo/index selection."
  ),
  makeSourceCase(
    "C09-S03",
    sourceExpected({ bindingClass: "single-assignment" }),
    contract(
      "  address[] public relayers;\n\n  function selectRelay() external view returns (address) {\n    uint256 seed = block.prevrandao;\n    return relayers[seed % relayers.length];\n  }"
    ),
    "One single-assignment same-function binding."
  ),
  makeSourceCase(
    "C09-S04",
    sourceExpected({ sinkClass: "authorization" }),
    contract(
      "  function eligible(address account) external view returns (bool) {\n    return uint160(account) % 2 == block.prevrandao % 2;\n  }"
    ),
    "Direct authorization or eligibility branch."
  ),
  makeSourceCase(
    "C09-S05",
    sourceExpected({ sinkClass: "ordering" }),
    contract(
      "  function orderingKey(uint256 item) external view returns (uint256) {\n    return uint256(keccak256(abi.encode(item, block.prevrandao)));\n  }"
    ),
    "Direct ordering key derived from PREVRANDAO."
  ),
  makeSourceCase(
    "C09-S06",
    sourceExpected({
      sourceClass: "assembly-prevrandao",
      bindingClass: "single-assignment"
    }),
    contract(
      "  address[] public relayers;\n\n  function selectRelay() external view returns (address) {\n    uint256 seed;\n    assembly { seed := prevrandao() }\n    return relayers[seed % relayers.length];\n  }"
    ),
    "Exact inline assembly prevrandao extraction with direct sink."
  ),
  makeSourceCase(
    "C09-S07",
    sourceExpected({ sourceClass: "difficulty-post-paris" }),
    contract(
      "  address[] public relayers;\n\n  function selectRelay() external view returns (address) {\n    return relayers[block.difficulty % relayers.length];\n  }"
    ),
    "block.difficulty candidate requiring separately proven post-Paris EVM target.",
    { evmTargetEvidence: "paris-or-later-required" }
  ),
  makeSourceCase(
    "C09-S08",
    sourceExpected(),
    contract(
      "  address[] public relayers;\r\n\r\n  function selectRelay() external view returns (address) {\r\n    return relayers[block.prevrandao % relayers.length];\r\n  }"
    ).replaceAll("\n", "\r\n"),
    "CRLF direct selection."
  ),
  makeSourceCase(
    "C09-N01",
    sourceExpected({
      bindingClass: "none",
      sinkClass: "safe-observation",
      publicEmissionEligibility: "not-applicable"
    }),
    contract(
      "  function observe() external view returns (uint256) {\n    return block.prevrandao;\n  }"
    ),
    "Diagnostic return without behavioral sink."
  ),
  makeSourceCase(
    "C09-N02",
    sourceExpected({
      bindingClass: "single-assignment",
      sinkClass: "none",
      publicEmissionEligibility: "not-applicable"
    }),
    contract(
      "  function readOnly() external view {\n    uint256 seed = block.prevrandao;\n    seed;\n  }"
    ),
    "Value read but unused."
  ),
  makeSourceCase(
    "C09-N03",
    sourceExpected({
      sinkClass: "safe-observation",
      publicEmissionEligibility: "not-applicable"
    }),
    contract(
      "  event Seen(uint256 value);\n\n  function logValue() external {\n    emit Seen(block.prevrandao);\n  }"
    ),
    "Event-only observation."
  ),
  makeSourceCase(
    "C09-N04",
    sourceExpected({
      sinkClass: "safe-observation",
      publicEmissionEligibility: "not-applicable"
    }),
    contract(
      '  function assertArcBehavior() external view {\n    require(block.prevrandao == 0, "Arc PREVRANDAO must be zero");\n  }'
    ),
    "Explicit zero-compatibility assertion."
  ),
  makeSourceCase(
    "C09-N05",
    sourceExpected({
      sinkClass: "none",
      publicEmissionEligibility: "not-applicable"
    }),
    contract(
      "  function hashOnly() external view returns (bytes32) {\n    return keccak256(abi.encode(block.prevrandao));\n  }"
    ),
    "Hashing without a supported behavior sink."
  ),
  makeSourceCase(
    "C09-N06",
    sourceExpected({
      sourceClass: "no-source",
      bindingClass: "none",
      sinkClass: "none",
      publicEmissionEligibility: "not-applicable"
    }),
    contract(
      "  address[] public relayers;\n  uint256 private next;\n\n  function selectRelay() external returns (address) {\n    address selected = relayers[next % relayers.length];\n    next += 1;\n    return selected;\n  }"
    ),
    "Deterministic round-robin replacement."
  ),
  makeSourceCase(
    "C09-N07",
    sourceExpected({
      sourceClass: "no-source",
      contractOwnership: "none",
      functionOwnership: "none",
      bindingClass: "none",
      sinkClass: "none",
      publicEmissionEligibility: "not-applicable"
    }),
    `${SPDX}\n${PRAGMA}\n// Do not use block.prevrandao for Arc relay selection.\ncontract Guidance {}\n`,
    "Negative guidance comment."
  ),
  makeSourceCase(
    "C09-N08",
    sourceExpected({
      sourceClass: "no-source",
      bindingClass: "none",
      sinkClass: "none",
      publicEmissionEligibility: "not-applicable"
    }),
    contract(
      '  string public constant DOC = "block.prevrandao is zero on Arc";'
    ),
    "Source text inside a string literal."
  ),
  makeSourceCase(
    "C09-N09",
    sourceExpected({
      sourceClass: "no-source",
      bindingClass: "none",
      sinkClass: "none",
      publicEmissionEligibility: "not-applicable"
    }),
    contract("  uint256 public PREVRANDAO = 7;"),
    "Bare identifier named PREVRANDAO is not the opcode source."
  ),
  makeSourceCase(
    "C09-N10",
    sourceExpected({
      sourceClass: "no-source",
      bindingClass: "none",
      sinkClass: "none",
      publicEmissionEligibility: "not-applicable"
    }),
    contract("  bytes32 public mixHash;"),
    "mixHash name has no supported equivalence."
  ),
  makeSourceCase(
    "C09-U01",
    sourceExpected({
      bindingClass: "reassigned",
      sinkClass: "unsupported",
      publicEmissionEligibility: "blocked-unsupported"
    }),
    contract(
      "  address[] public relayers;\n\n  function selectRelay() external view returns (address) {\n    uint256 seed = block.prevrandao;\n    seed = 7;\n    return relayers[seed % relayers.length];\n  }"
    ),
    "Reassignment before the sink."
  ),
  makeSourceCase(
    "C09-U02",
    sourceExpected({
      bindingClass: "multi-hop",
      sinkClass: "unsupported",
      publicEmissionEligibility: "blocked-unsupported"
    }),
    contract(
      "  address[] public relayers;\n\n  function selectRelay() external view returns (address) {\n    uint256 first = block.prevrandao;\n    uint256 second = first;\n    return relayers[second % relayers.length];\n  }"
    ),
    "Two-hop alias exceeds the approved bound."
  ),
  makeSourceCase(
    "C09-U03",
    sourceExpected({
      bindingClass: "branch-join",
      sinkClass: "unsupported",
      publicEmissionEligibility: "blocked-unsupported"
    }),
    contract(
      "  address[] public relayers;\n\n  function selectRelay(bool enabled) external view returns (address) {\n    uint256 seed;\n    if (enabled) seed = block.prevrandao;\n    else seed = 1;\n    return relayers[seed % relayers.length];\n  }"
    ),
    "Branch join is unsupported."
  ),
  makeSourceCase(
    "C09-U04",
    sourceExpected({
      functionOwnership: "cross-function",
      bindingClass: "unsupported",
      sinkClass: "unsupported",
      publicEmissionEligibility: "blocked-unsupported"
    }),
    contract(
      "  address[] public relayers;\n\n  function seed() internal view returns (uint256) {\n    return block.prevrandao;\n  }\n\n  function selectRelay() external view returns (address) {\n    return relayers[seed() % relayers.length];\n  }"
    ),
    "Cross-function flow is unsupported."
  ),
  makeSourceCase(
    "C09-U05",
    sourceExpected({
      contractOwnership: "cross-contract",
      functionOwnership: "cross-function",
      bindingClass: "unsupported",
      sinkClass: "unsupported",
      publicEmissionEligibility: "blocked-unsupported"
    }),
    `${SPDX}\n${PRAGMA}\n\ncontract SeedSource {\n  function seed() external view returns (uint256) { return block.prevrandao; }\n}\n\ncontract Selector {\n  address[] public relayers;\n  function selectRelay(SeedSource source) external view returns (address) {\n    return relayers[source.seed() % relayers.length];\n  }\n}\n`,
    "Cross-contract flow is unsupported."
  ),
  makeSourceCase(
    "C09-U06",
    sourceExpected({
      sourceClass: "unsupported-source",
      bindingClass: "unsupported",
      sinkClass: "unsupported",
      publicEmissionEligibility: "blocked-unsupported"
    }),
    contract(
      "  function unsupportedAssembly() external view returns (uint256 value) {\n    assembly {\n      function nested() -> result { result := prevrandao() }\n      value := nested()\n    }\n  }"
    ),
    "General Yul function ownership is unsupported."
  ),
  makeSourceCase(
    "C09-U07",
    sourceExpected({
      sourceClass: "unsupported-source",
      bindingClass: "unsupported",
      sinkClass: "unsupported",
      publicEmissionEligibility: "blocked-unsupported"
    }),
    contract(
      "  function legacyDifficulty() external view returns (uint256 value) {\n    assembly { value := difficulty() }\n  }"
    ),
    "Inline assembly difficulty() is unsupported."
  ),
  makeSourceCase(
    "C09-U08",
    sourceExpected({
      sourceClass: "difficulty-post-paris",
      publicEmissionEligibility: "blocked-unsupported"
    }),
    contract(
      "  address[] public relayers;\n\n  function selectRelay() external view returns (address) {\n    return relayers[block.difficulty % relayers.length];\n  }"
    ),
    "block.difficulty without exact EVM-target evidence is blocked.",
    { evmTargetEvidence: "missing" }
  ),
  makeSourceCase(
    "C09-U09",
    sourceExpected({
      parseStatus: "malformed",
      sourceClass: "unsupported-source",
      contractOwnership: "ambiguous",
      functionOwnership: "ambiguous",
      bindingClass: "unsupported",
      sinkClass: "unsupported",
      publicEmissionEligibility: "blocked-unsupported"
    }),
    `${SPDX}\n${PRAGMA}\ncontract Broken { function pick() external view returns (uint256) { return block.prevrandao % 3; }`,
    "Malformed Solidity must fail closed."
  ),
  makeSourceCase(
    "C09-U10",
    sourceExpected({
      parseStatus: "unsupported-syntax",
      sourceClass: "unsupported-source",
      bindingClass: "unsupported",
      sinkClass: "unsupported",
      publicEmissionEligibility: "blocked-unsupported"
    }),
    `${SPDX}\npragma solidity >=0.9.0;\ncontract FutureSyntax { function pick() external view returns (uint256) { return block.prevrandao; } }\n`,
    "Unknown future Solidity grammar remains unsupported."
  ),
  makeSourceCase(
    "C09-A01",
    sourceExpected({
      bindingClass: "single-assignment",
      sinkClass: "none",
      publicEmissionEligibility: "not-applicable"
    }),
    contract(
      "  address[] public relayers;\n\n  function selectRelay(uint256 otherSeed) external view returns (address) {\n    uint256 observed = block.prevrandao;\n    observed;\n    return relayers[otherSeed % relayers.length];\n  }"
    ),
    "PREVRANDAO and relay words coexist but the sink uses another seed."
  ),
  makeSourceCase(
    "C09-A02",
    sourceExpected({
      functionOwnership: "cross-function",
      bindingClass: "none",
      sinkClass: "unsupported",
      publicEmissionEligibility: "blocked-unsupported"
    }),
    contract(
      "  address[] public relayers;\n\n  function observe() external view returns (uint256) {\n    return block.prevrandao;\n  }\n\n  function selectRelay(uint256 seed) external view returns (address) {\n    return relayers[seed % relayers.length];\n  }"
    ),
    "Source and sink are in different functions."
  ),
  makeSourceCase(
    "C09-A03",
    sourceExpected({
      contractOwnership: "multiple-contracts",
      functionOwnership: "ambiguous",
      publicEmissionEligibility: "blocked-unsupported"
    }),
    `${SPDX}\n${PRAGMA}\n\ncontract First { function observe() external view returns (uint256) { return block.prevrandao; } }\ncontract Second { address[] public relayers; function pick(uint256 seed) external view returns (address) { return relayers[seed % relayers.length]; } }\n`,
    "Source and sink occur in different contracts."
  ),
  makeSourceCase(
    "C09-A04",
    sourceExpected({
      bindingClass: "reassigned",
      sinkClass: "unsupported",
      publicEmissionEligibility: "blocked-unsupported"
    }),
    contract(
      "  address[] public relayers;\n\n  function selectRelay() external view returns (address) {\n    uint256 seed = block.prevrandao;\n    unchecked { seed += 1; }\n    return relayers[seed % relayers.length];\n  }"
    ),
    "Mutation hidden inside an unchecked block."
  ),
  makeSourceCase(
    "C09-A05",
    sourceExpected({
      bindingClass: "unsupported",
      sinkClass: "unsupported",
      publicEmissionEligibility: "blocked-unsupported"
    }),
    contract(
      "  address[] public relayers;\n\n  function selectRelay() external view returns (address) {\n    uint256 seed = block.prevrandao;\n    { uint256 seed = 1; seed; }\n    return relayers[seed % relayers.length];\n  }"
    ),
    "Shadowed local binding requires fail-closed behavior."
  ),
  makeSourceCase(
    "C09-A06",
    sourceExpected({
      bindingClass: "direct",
      sinkClass: "selection"
    }),
    contract(
      "  address[] public relayers;\n\n  function selectRelay() external view returns (address) {\n    uint256 debug = block.prevrandao;\n    debug;\n    return relayers[block.prevrandao % relayers.length];\n  }"
    ),
    "Multiple occurrences require deterministic earliest reportable candidate selection."
  ),
  makeSourceCase(
    "C09-A07",
    sourceExpected({
      sinkClass: "unsupported",
      publicEmissionEligibility: "blocked-unsupported"
    }),
    contract(
      "  address[] public relayers;\n\n  function selectRelay() external view returns (address) {\n    uint256 length = relayers.length;\n    return relayers[block.prevrandao % length];\n  }"
    ),
    "Collection length ownership is indirect."
  ),
  makeSourceCase(
    "C09-A08",
    sourceExpected({
      sinkClass: "unsupported",
      publicEmissionEligibility: "blocked-unsupported"
    }),
    contract(
      "  address[] public relayers;\n\n  function selectRelay() external view returns (address) {\n    require(relayers.length > 0);\n    for (uint256 i = 0; i < 1; i++) {\n      if (i == block.prevrandao % relayers.length) return relayers[i];\n    }\n    return relayers[0];\n  }"
    ),
    "Loop-based dependency is unsupported."
  )
];

const SOURCE_CONTRACT = contract(
  "  address[] public relayers;\n\n  function selectRelay() external view returns (address) {\n    return relayers[block.prevrandao % relayers.length];\n  }",
  "RelaySelector"
);

const FOUNDRY_ARC = JSON.stringify(
  {
    chain: 5042002,
    transactions: [
      {
        transactionType: "CREATE",
        contractName: "RelaySelector",
        contractAddress: "0x1111111111111111111111111111111111111111"
      }
    ]
  },
  null,
  2
);

const FOUNDRY_ETH = JSON.stringify(
  {
    chain: 1,
    transactions: [
      {
        transactionType: "CREATE",
        contractName: "RelaySelector",
        contractAddress: "0x2222222222222222222222222222222222222222"
      }
    ]
  },
  null,
  2
);

function foundryProject(extraFiles = {}, source = SOURCE_CONTRACT) {
  return {
    "src/RelaySelector.sol": source,
    "broadcast/Deploy.s.sol/5042002/run-latest.json": FOUNDRY_ARC,
    ...extraFiles
  };
}

function hardhatDeployment(chainId = 5042002, contractName = "RelaySelector") {
  return JSON.stringify(
    {
      address: "0x3333333333333333333333333333333333333333",
      contractName,
      receipt: { chainId }
    },
    null,
    2
  );
}

const projectCases = [
  makeProjectCase(
    "C09-P01",
    projectExpected({
      arcDeploymentOwnership: "arc-foundry",
      publicEmissionEligibility: "r3b-association-candidate"
    }),
    foundryProject(),
    "Exact Foundry Arc chain and contract-name association."
  ),
  makeProjectCase(
    "C09-P02",
    projectExpected({ arcDeploymentOwnership: "non-arc" }),
    {
      "src/RelaySelector.sol": SOURCE_CONTRACT,
      "broadcast/Deploy.s.sol/1/run-latest.json": FOUNDRY_ETH
    },
    "Same contract deployed only to Ethereum mainnet."
  ),
  makeProjectCase(
    "C09-P03",
    projectExpected({
      arcDeploymentOwnership: "ambiguous",
      publicEmissionEligibility: "blocked-no-arc-association"
    }),
    foundryProject({
      "broadcast/Deploy.s.sol/1/run-latest.json": FOUNDRY_ETH
    }),
    "Same contract has Arc and Ethereum deployment artifacts."
  ),
  makeProjectCase(
    "C09-P04",
    projectExpected({ arcDeploymentOwnership: "conflict" }),
    foundryProject({
      "broadcast/OtherDeploy.s.sol/5042002/run-latest.json": JSON.stringify(
        {
          chain: 5042002,
          transactions: [
            {
              transactionType: "CREATE",
              contractName: "RelaySelector",
              contractAddress: "0x4444444444444444444444444444444444444444"
            }
          ]
        },
        null,
        2
      )
    }),
    "Duplicate Arc artifacts disagree on deployed address."
  ),
  makeProjectCase(
    "C09-P05",
    projectExpected({
      contractOwnership: "none",
      functionOwnership: "none",
      arcDeploymentOwnership: "unknown"
    }),
    {
      "src/Other.sol": contract(
        "  function value() external pure returns (uint256) { return 1; }",
        "Other"
      ),
      "broadcast/Deploy.s.sol/5042002/run-latest.json": FOUNDRY_ARC
    },
    "Artifact contract name has no matching Solidity definition."
  ),
  makeProjectCase(
    "C09-P06",
    projectExpected({ arcDeploymentOwnership: "unknown" }),
    {
      "src/RelaySelector.sol": SOURCE_CONTRACT,
      "foundry.toml": '[profile.default]\nsrc = "src"\n'
    },
    "Matching Solidity definition has no deployment artifact."
  ),
  makeProjectCase(
    "C09-P07",
    projectExpected({ arcDeploymentOwnership: "ambiguous" }),
    {
      "src/RelaySelector.sol": SOURCE_CONTRACT,
      "src/RelaySelectorV2.sol": SOURCE_CONTRACT.replaceAll(
        "RelaySelector",
        "RelaySelectorV2"
      ),
      "broadcast/Deploy.s.sol/5042002/run-latest.json": JSON.stringify(
        {
          chain: 5042002,
          transactions: [
            { transactionType: "CREATE", contractName: "RelaySelectorV" }
          ]
        },
        null,
        2
      )
    },
    "Similar contract names do not establish exact identity."
  ),
  makeProjectCase(
    "C09-P08",
    projectExpected({ arcDeploymentOwnership: "unknown" }),
    {
      "src/RelaySelector.sol": SOURCE_CONTRACT,
      "script/deploy.ts":
        "const chainId = Number(process.env.CHAIN_ID); deploy('RelaySelector', chainId);"
    },
    "Imported or computed chain ID is unsupported."
  ),
  makeProjectCase(
    "C09-P09",
    projectExpected({ arcDeploymentOwnership: "unknown" }),
    {
      "src/RelaySelector.sol": SOURCE_CONTRACT,
      "vendor/broadcast/Deploy.s.sol/5042002/run-latest.json": FOUNDRY_ARC
    },
    "Generated artifact outside configured scan scope."
  ),
  makeProjectCase(
    "C09-P10",
    projectExpected({ arcDeploymentOwnership: "unknown" }),
    {
      "apps/a/src/RelaySelector.sol": SOURCE_CONTRACT,
      "apps/b/broadcast/Deploy.s.sol/5042002/run-latest.json": FOUNDRY_ARC
    },
    "Sibling project artifact cannot lend ownership."
  ),
  makeProjectCase(
    "C09-P11",
    projectExpected({ arcDeploymentOwnership: "unknown" }),
    {
      "src/RelaySelector.sol": SOURCE_CONTRACT,
      "broadcast/Deploy.s.sol/5042002/../../outside.json": FOUNDRY_ARC
    },
    "Path traversal-like artifact path is unsupported."
  ),
  makeProjectCase(
    "C09-P12",
    projectExpected({
      arcDeploymentOwnership: "arc-hardhat",
      publicEmissionEligibility: "r3b-association-candidate"
    }),
    {
      "contracts/RelaySelector.sol": SOURCE_CONTRACT,
      "deployments/arcTestnet/RelaySelector.json": hardhatDeployment()
    },
    "Exact Hardhat-style Arc deployment association for R2 comparison."
  ),
  makeProjectCase(
    "C09-P13",
    projectExpected({ arcDeploymentOwnership: "non-arc" }),
    {
      "contracts/RelaySelector.sol": SOURCE_CONTRACT,
      "deployments/mainnet/RelaySelector.json": hardhatDeployment(1)
    },
    "Hardhat-style Ethereum-only deployment."
  ),
  makeProjectCase(
    "C09-P14",
    projectExpected({ arcDeploymentOwnership: "unknown" }),
    {
      "contracts/RelaySelector.sol": SOURCE_CONTRACT,
      "deployments/arc/RelaySelector.json": JSON.stringify(
        { address: "0x5555555555555555555555555555555555555555" },
        null,
        2
      )
    },
    "Network directory name without chain ID or official RPC is insufficient."
  ),
  makeProjectCase(
    "C09-P15",
    projectExpected({
      arcDeploymentOwnership: "arc-hardhat",
      publicEmissionEligibility: "r3b-association-candidate"
    }),
    {
      "contracts/RelaySelector.sol": SOURCE_CONTRACT,
      "deployments/custom/RelaySelector.json": JSON.stringify(
        {
          address: "0x6666666666666666666666666666666666666666",
          contractName: "RelaySelector",
          rpcUrl: "https://rpc.testnet.arc.network"
        },
        null,
        2
      )
    },
    "Exact official Arc RPC may establish network evidence when contract identity is exact."
  ),
  makeProjectCase(
    "C09-P16",
    projectExpected({ arcDeploymentOwnership: "conflict" }),
    {
      "contracts/RelaySelector.sol": SOURCE_CONTRACT,
      "deployments/arcTestnet/RelaySelector.json": JSON.stringify(
        {
          address: "0x7777777777777777777777777777777777777777",
          contractName: "RelaySelector",
          receipt: { chainId: 1 },
          rpcUrl: "https://rpc.testnet.arc.network"
        },
        null,
        2
      )
    },
    "Conflicting chain ID and official Arc RPC must fail closed."
  )
];

const cases = [...sourceCases, ...projectCases];

const astComparatorCases = [
  {
    id: "C09-S01",
    compilerVersion: "0.8.30",
    sourcePath: "contracts/C09-S01.sol"
  },
  {
    id: "C09-S03",
    compilerVersion: "0.8.30",
    sourcePath: "contracts/C09-S03.sol"
  },
  {
    id: "C09-S06",
    compilerVersion: "0.8.30",
    sourcePath: "contracts/C09-S06.sol"
  },
  {
    id: "C09-N04",
    compilerVersion: "0.8.30",
    sourcePath: "contracts/C09-N04.sol"
  },
  {
    id: "C09-A03",
    compilerVersion: "0.8.30",
    sourcePath: "contracts/C09-A03.sol"
  }
].map((entry) => {
  const fixture = cases.find((candidate) => candidate.id === entry.id);
  if (!fixture) throw new Error(`Missing AST comparator case: ${entry.id}`);
  const source = fixture.files[entry.sourcePath];
  if (typeof source !== "string") {
    throw new Error(`Missing AST comparator source: ${entry.sourcePath}`);
  }
  return { ...entry, sourceSha256: sha256(source) };
});

function validateExpected(id, expected) {
  const checks = [
    ["parseStatus", PARSE_STATUS],
    ["sourceClass", SOURCE_CLASS],
    ["contractOwnership", CONTRACT_OWNERSHIP],
    ["functionOwnership", FUNCTION_OWNERSHIP],
    ["bindingClass", BINDING_CLASS],
    ["sinkClass", SINK_CLASS],
    ["arcDeploymentOwnership", ARC_DEPLOYMENT_OWNERSHIP],
    ["publicEmissionEligibility", PUBLIC_ELIGIBILITY]
  ];

  for (const [field, values] of checks) {
    if (!values.has(expected[field])) {
      throw new Error(`${id}: invalid ${field}: ${expected[field]}`);
    }
  }
}

function validateCorpus() {
  const ids = new Set();
  for (const item of cases) {
    if (ids.has(item.id)) throw new Error(`Duplicate case ID: ${item.id}`);
    ids.add(item.id);
    if (!CASE_KINDS.has(item.kind)) throw new Error(`${item.id}: invalid kind`);
    validateExpected(item.id, item.expected);
    const paths = Object.keys(item.files);
    if (paths.length === 0) throw new Error(`${item.id}: no files`);
    if (!paths.some((path) => path.endsWith(".sol"))) {
      throw new Error(`${item.id}: missing Solidity source`);
    }
    for (const [path, content] of Object.entries(item.files)) {
      if (!path || typeof content !== "string" || content.length === 0) {
        throw new Error(`${item.id}: invalid file ${path}`);
      }
      if (/TODO|PLACEHOLDER|REPLACE_ME/.test(content)) {
        throw new Error(`${item.id}: unresolved placeholder in ${path}`);
      }
    }
    if (item.kind === "source" && paths.length !== 1) {
      throw new Error(`${item.id}: source case must contain exactly one file`);
    }
    if (item.kind === "project" && paths.length < 2) {
      throw new Error(
        `${item.id}: project case must contain at least two files`
      );
    }
  }

  for (const comparator of astComparatorCases) {
    if (!/^[a-f0-9]{64}$/.test(comparator.sourceSha256)) {
      throw new Error(`${comparator.id}: invalid source SHA-256`);
    }
  }

  if (sourceCases.length < 35) {
    throw new Error(
      `Expected at least 35 source cases, got ${sourceCases.length}`
    );
  }
  if (projectCases.length !== 16) {
    throw new Error(`Expected 16 project cases, got ${projectCases.length}`);
  }
}

validateCorpus();

const summary = {
  total: cases.length,
  sourceCases: sourceCases.length,
  projectCases: projectCases.length,
  astComparatorCases: astComparatorCases.length,
  publicEligibility: Object.fromEntries(
    [...PUBLIC_ELIGIBILITY].map((value) => [
      value,
      cases.filter((item) => item.expected.publicEmissionEligibility === value)
        .length
    ])
  ),
  arcDeploymentOwnership: Object.fromEntries(
    [...ARC_DEPLOYMENT_OWNERSHIP].map((value) => [
      value,
      cases.filter((item) => item.expected.arcDeploymentOwnership === value)
        .length
    ])
  )
};

export { astComparatorCases, cases, projectCases, sourceCases, summary };

if (process.argv[1]?.endsWith("c09-r2-corpus.mjs")) {
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}
