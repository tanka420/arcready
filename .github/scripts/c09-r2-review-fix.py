from pathlib import Path


CORPUS = Path("docs/research/fixtures/c09-r2-corpus.mjs")
DOC = Path("docs/research/C09-R2.md")


def replace_once(path: Path, old: str, new: str, label: str) -> None:
    text = path.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected one match, got {count}")
    path.write_text(text.replace(old, new, 1), encoding="utf-8")


def replace_case(kind: str, case_id: str, next_id: str, replacement: str) -> None:
    text = CORPUS.read_text(encoding="utf-8")
    start = f'  make{kind}Case(\n    "{case_id}",'
    end = f'  make{kind}Case(\n    "{next_id}",'
    if text.count(start) != 1 or text.count(end) != 1:
        raise SystemExit(
            f"{case_id}: start={text.count(start)} end={text.count(end)}"
        )
    start_index = text.index(start)
    end_index = text.index(end, start_index + len(start))
    CORPUS.write_text(
        text[:start_index] + replacement + text[end_index:], encoding="utf-8"
    )


replace_once(
    CORPUS,
    '''const PUBLIC_ELIGIBILITY = new Set([
  "r3a-candidate-only",
  "r3b-association-candidate",
  "blocked-no-arc-association",
  "blocked-unsupported",
  "not-applicable"
]);
''',
    '''const PUBLIC_ELIGIBILITY = new Set([
  "r3a-candidate-only",
  "r3b-association-candidate",
  "blocked-no-arc-association",
  "blocked-unsupported",
  "not-applicable"
]);
const ARTIFACT_CONTRACT = new Set([
  "foundry-forge-script-run-latest-reviewed-2026-08-05",
  "hardhat-deploy-v1",
  "nonstandard-hardhat-like",
  "unsupported"
]);
''',
    "artifact contract enum",
)

replace_once(
    CORPUS,
    '''function makeProjectCase(id, expected, files, note, extra = {}) {
  return { id, kind: "project", expected, files, note, ...extra };
}
''',
    '''function inferArtifactContract(files) {
  const paths = Object.keys(files);
  if (
    paths.some((path) =>
      /(^|\\/)broadcast\\/.*\\/run-latest\\.json$/.test(path)
    )
  ) {
    return "foundry-forge-script-run-latest-reviewed-2026-08-05";
  }
  if (paths.some((path) => path.startsWith("deployments/"))) {
    return "hardhat-deploy-v1";
  }
  return "unsupported";
}

function makeProjectCase(id, expected, files, note, extra = {}) {
  const artifactContract =
    extra.artifactContract ?? inferArtifactContract(files);
  return {
    id,
    kind: "project",
    expected,
    files,
    note,
    artifactContract,
    ...extra
  };
}
''',
    "artifact contract inference",
)

replace_case(
    "Source",
    "C09-S08",
    "C09-N01",
    '''  makeSourceCase(
    "C09-S08",
    sourceExpected(),
    contract(
      "  address[] public relayers;\\n\\n  function selectRelay() external view returns (address) {\\n    return relayers[block.prevrandao % relayers.length];\\n  }"
    ).replaceAll("\\n", "\\r\\n"),
    "CRLF direct selection."
  ),
''',
)

replace_once(
    CORPUS,
    '''function hardhatDeployment(chainId = 5042002, contractName = "RelaySelector") {
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
''',
    '''function hardhatDeployment() {
  return JSON.stringify(
    {
      address: "0x3333333333333333333333333333333333333333",
      abi: []
    },
    null,
    2
  );
}
''',
    "hardhat-deploy v1 fixture",
)

replace_case(
    "Project",
    "C09-P12",
    "C09-P13",
    '''  makeProjectCase(
    "C09-P12",
    projectExpected({
      arcDeploymentOwnership: "arc-hardhat",
      publicEmissionEligibility: "r3b-association-candidate"
    }),
    {
      "contracts/RelaySelector.sol": SOURCE_CONTRACT,
      "deployments/arcTestnet/.chainId": "5042002\\n",
      "deployments/arcTestnet/RelaySelector.json": hardhatDeployment()
    },
    "Pinned hardhat-deploy v1 association using .chainId and the exact deployment filename."
  ),
''',
)

replace_case(
    "Project",
    "C09-P13",
    "C09-P14",
    '''  makeProjectCase(
    "C09-P13",
    projectExpected({ arcDeploymentOwnership: "non-arc" }),
    {
      "contracts/RelaySelector.sol": SOURCE_CONTRACT,
      "deployments/mainnet/.chainId": "1\\n",
      "deployments/mainnet/RelaySelector.json": hardhatDeployment()
    },
    "Pinned hardhat-deploy v1 Ethereum-only deployment."
  ),
''',
)

replace_case(
    "Project",
    "C09-P14",
    "C09-P15",
    '''  makeProjectCase(
    "C09-P14",
    projectExpected({ arcDeploymentOwnership: "unknown" }),
    {
      "contracts/RelaySelector.sol": SOURCE_CONTRACT,
      "deployments/arc/RelaySelector.json": hardhatDeployment()
    },
    "Hardhat network directory name without a v1 .chainId file is insufficient."
  ),
''',
)

replace_case(
    "Project",
    "C09-P15",
    "C09-P16",
    '''  makeProjectCase(
    "C09-P15",
    projectExpected({ arcDeploymentOwnership: "unknown" }),
    {
      "contracts/RelaySelector.sol": SOURCE_CONTRACT,
      "deployments/custom/RelaySelector.json": JSON.stringify(
        {
          address: "0x6666666666666666666666666666666666666666",
          abi: [],
          contractName: "RelaySelector",
          receipt: { chainId: 5042002 },
          rpcUrl: "https://rpc.testnet.arc.network"
        },
        null,
        2
      )
    },
    "Nonstandard inline contractName, receipt.chainId, and rpcUrl fields are not hardhat-deploy v1 evidence.",
    { artifactContract: "nonstandard-hardhat-like" }
  ),
''',
)

text = CORPUS.read_text(encoding="utf-8")
start = '  makeProjectCase(\n    "C09-P16",'
end = '  )\n];\n\nconst cases ='
if text.count(start) != 1 or text.count(end) != 1:
    raise SystemExit(
        f"C09-P16: start={text.count(start)} end={text.count(end)}"
    )
start_index = text.index(start)
end_index = text.index(end, start_index) + len("  )\n")
replacement = '''  makeProjectCase(
    "C09-P16",
    projectExpected({ arcDeploymentOwnership: "conflict" }),
    {
      "contracts/RelaySelector.sol": SOURCE_CONTRACT,
      "hardhat.config.ts":
        "export default { networks: { arcTestnet: { url: 'https://rpc.testnet.arc.network', chainId: 5042002 } } };",
      "deployments/arcTestnet/.chainId": "1\\n",
      "deployments/arcTestnet/RelaySelector.json": hardhatDeployment()
    },
    "Pinned hardhat-deploy v1 chain identity conflicts with an Arc network configuration."
  )
'''
CORPUS.write_text(
    text[:start_index] + replacement + text[end_index:], encoding="utf-8"
)

replace_once(
    CORPUS,
    '''    if (item.kind === "project" && paths.length < 2) {
      throw new Error(
        `${item.id}: project case must contain at least two files`
      );
    }
  }

  for (const comparator of astComparatorCases) {
''',
    '''    if (item.kind === "project" && paths.length < 2) {
      throw new Error(
        `${item.id}: project case must contain at least two files`
      );
    }
    if (item.kind === "project") {
      if (!ARTIFACT_CONTRACT.has(item.artifactContract)) {
        throw new Error(
          `${item.id}: invalid artifact contract: ${item.artifactContract}`
        );
      }
      if (item.artifactContract === "hardhat-deploy-v1") {
        const chainFiles = paths.filter((path) => path.endsWith("/.chainId"));
        if (chainFiles.length > 1) {
          throw new Error(`${item.id}: multiple hardhat-deploy v1 .chainId files`);
        }
        const deploymentFiles = paths.filter((path) =>
          /^deployments\\/[^/]+\\/[^/]+\\.json$/.test(path)
        );
        for (const path of deploymentFiles) {
          const deployment = JSON.parse(item.files[path]);
          if (
            typeof deployment.address !== "string" ||
            !Array.isArray(deployment.abi)
          ) {
            throw new Error(`${item.id}: invalid hardhat-deploy v1 file ${path}`);
          }
          if (
            "contractName" in deployment ||
            "rpcUrl" in deployment ||
            deployment.receipt?.chainId !== undefined
          ) {
            throw new Error(
              `${item.id}: nonstandard inline network or contract evidence in ${path}`
            );
          }
        }
      }
    }
  }

  const crlfCase = sourceCases.find((item) => item.id === "C09-S08");
  const crlfSource = crlfCase?.files["contracts/C09-S08.sol"];
  if (
    typeof crlfSource !== "string" ||
    !crlfSource.includes("\\r\\n") ||
    crlfSource.includes("\\r\\r\\n") ||
    /(^|[^\\r])\\n/.test(crlfSource)
  ) {
    throw new Error("C09-S08: expected CRLF only with no CR-CR-LF or lone LF");
  }

  for (const comparator of astComparatorCases) {
''',
    "project and CRLF validation",
)

replace_once(
    DOC,
    '''The machine-readable artifact is:

```text
docs/research/fixtures/c09-r2-corpus.mjs
```
''',
    '''The machine-readable research artifacts are:

```text
docs/research/fixtures/c09-r2-corpus.mjs
docs/research/fixtures/c09-r2-generate-ast.mjs
docs/research/fixtures/c09-r2-validate-ast.mjs
docs/research/fixtures/c09-r2-ast-manifest.json
```
''',
    "artifact list",
)

replace_once(
    DOC,
    '''The project corpus compares Foundry and Hardhat evidence shapes without selecting
an R3-B adapter.
''',
    '''The project corpus pins two reviewed artifact contracts:

- Foundry `forge script` broadcast `run-latest.json`, with chain identity in the
  broadcast path and JSON and CREATE contract identity in the transaction record;
- hardhat-deploy v1, with network identity in
  `deployments/<network>/.chainId` and contract identity in the deployment
  filename. The contract JSON uses the v1 `address` and `abi` contract; inline
  `contractName`, `receipt.chainId`, and `rpcUrl` fields are negative pressure,
  not accepted evidence.

Hardhat-deploy v2 uses a different Rocketh-based artifact contract and remains
outside this corpus.
''',
    "project artifact contracts",
)

replace_once(
    DOC,
    '''R2 may compare both framework families. C09-R3-B remains limited to exactly one
framework-specific adapter total for its first experiment.
''',
    '''R2 compares both framework families. Independent review selects Foundry
broadcast artifacts for the first C09-R3-B adapter experiment because the bounded
path and JSON expose chain identity and CREATE contract names directly. The
hardhat-deploy v1 cases remain comparison and negative pressure only. R3-B remains
limited to exactly one framework-specific adapter total.
''',
    "R3-B adapter selection",
)

replace_once(
    DOC,
    '''The corpus pins compiler version `0.8.30` and computes a SHA-256 for each source.
A retained Standard JSON AST manifest must record both source and AST hashes.
Validation must fail when a retained AST no longer matches the source hash or
compiler version.

Compiler AST generation is a research build step only. It does not add `solc` or
`solc-js` to the production package.
''',
    '''The corpus pins compiler version `0.8.30` and computes a SHA-256 for each source.
The retained Standard JSON AST manifest records both source and normalized AST
hashes. The research-only generator invokes exact `solc 0.8.30` Standard JSON and
supports `--check` mode, which fails unless regenerated compiler output is
semantically identical to the retained manifest.

Compiler AST generation is a research build step only. It does not add `solc` or
`solc-js` to the production package manifest.
''',
    "AST reproducibility",
)

replace_once(
    DOC,
    '''- project cases without a Solidity source or deployment/project companion file;
- missing comparator sources;
- invalid source SHA-256 values;
''',
    '''- project cases without a Solidity source or deployment/project companion file;
- unknown deployment artifact contracts;
- hardhat-deploy v1 contract files that contain nonstandard inline network or
  contract-identity fields;
- malformed CRLF pressure with CR-CR-LF or lone LF;
- missing comparator sources;
- invalid source SHA-256 values;
''',
    "validator guarantees",
)

replace_once(
    DOC,
    '''C09-R3-B may begin only after independent review selects exactly one of the
Foundry or Hardhat evidence families for the first adapter experiment.
''',
    '''C09-R3-B may begin only after independent review confirms the Foundry broadcast
family as the single first adapter experiment. Hardhat support requires a later
separate adapter review.
''',
    "R3-B handoff",
)

replace_once(
    DOC,
    '''node --check docs/research/fixtures/c09-r2-corpus.mjs
node docs/research/fixtures/c09-r2-corpus.mjs
node docs/research/fixtures/c09-r2-validate-ast.mjs
corepack pnpm exec prettier --check \\
  docs/research/C09-R2.md \\
  docs/research/fixtures/c09-r2-corpus.mjs \\
  docs/research/fixtures/c09-r2-validate-ast.mjs \\
  docs/research/fixtures/c09-r2-ast-manifest.json
''',
    '''node --check docs/research/fixtures/c09-r2-corpus.mjs
node --check docs/research/fixtures/c09-r2-generate-ast.mjs
node --check docs/research/fixtures/c09-r2-validate-ast.mjs
node docs/research/fixtures/c09-r2-corpus.mjs
node docs/research/fixtures/c09-r2-validate-ast.mjs
node docs/research/fixtures/c09-r2-generate-ast.mjs --check
corepack pnpm exec prettier --check \\
  docs/research/C09-R2.md \\
  docs/research/fixtures/c09-r2-corpus.mjs \\
  docs/research/fixtures/c09-r2-generate-ast.mjs \\
  docs/research/fixtures/c09-r2-validate-ast.mjs \\
  docs/research/fixtures/c09-r2-ast-manifest.json
''',
    "validation commands",
)
