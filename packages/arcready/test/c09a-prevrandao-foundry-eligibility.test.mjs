import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import parserModule from "@solidity-parser/parser";
import { describe, expect, it, vi } from "vitest";

import { projectCases } from "../../../docs/research/fixtures/c09-r2-corpus.mjs";
import { DEFAULT_CONFIG } from "../core/config/index.ts";
import { runRulesInstrumented } from "../core/rules/instrumentation.ts";
import { runRules } from "../core/rules/index.ts";
import {
  requestPrevrandaoEligibleRecords,
  requestPrevrandaoFlowRecords
} from "../rules/shared/prevrandao-analysis.ts";

const PROJECT_ROOT = resolve(".artifacts/test/c09a-e3-project");
const ARC_PATH = "broadcast/Deploy.s.sol/5042002/run-latest.json";
const ARC_ADDRESS = "0x1111111111111111111111111111111111111111";
const SOURCE = `
pragma solidity ^0.8.24;
contract RelaySelector {
  address[] internal relayers;
  function selectRelay() external view returns (address) {
    return relayers[block.prevrandao % relayers.length];
  }
}`;

function broadcast({
  chain = 5042002,
  transactionType = "CREATE",
  contractName = "RelaySelector",
  contractAddress = ARC_ADDRESS
} = {}) {
  const transaction = { transactionType, contractName };
  if (contractAddress !== undefined)
    transaction.contractAddress = contractAddress;
  return JSON.stringify({ chain, transactions: [transaction] });
}

function broadcastTransaction(chain, transaction) {
  return JSON.stringify({ chain, transactions: [transaction] });
}

function nativePath(repositoryPath) {
  return join(PROJECT_ROOT, ...repositoryPath.split("/"));
}

function repositoryPath(operationalPath) {
  const absolute = resolve(PROJECT_ROOT, operationalPath);
  return relative(PROJECT_ROOT, absolute).replaceAll("\\", "/");
}

function createInput(
  files,
  {
    scanFiles,
    complete = true,
    sourceFiles,
    artifactFiles,
    readFile = undefined,
    parserLoader = undefined
  } = {}
) {
  const entries = new Map(Object.entries(files));
  const discoveredSources =
    sourceFiles ??
    Object.keys(files).filter((path) => /(?:^|\/)src\/.*\.sol$/.test(path));
  const discoveredArtifacts =
    artifactFiles ??
    Object.keys(files).filter((path) =>
      /(?:^|\/)broadcast\/.*\.json$/.test(path)
    );
  return {
    projectRoot: PROJECT_ROOT,
    files: (scanFiles ?? discoveredSources).map(nativePath),
    async readFile(filePath) {
      if (readFile !== undefined) return readFile(filePath, entries);
      const content = entries.get(repositoryPath(filePath));
      if (content === undefined) throw new Error(`Missing ${filePath}`);
      return content;
    },
    ...(parserLoader === undefined ? {} : { parserLoader }),
    discoverProjectEvidence: vi.fn(async ({ sourcePath, broadcastPath }) => ({
      complete,
      sourceFiles: discoveredSources
        .filter((path) => path.startsWith(`${sourcePath}/`))
        .map(nativePath),
      artifactFiles: discoveredArtifacts
        .filter((path) => path.startsWith(`${broadcastPath}/`))
        .map(nativePath)
    }))
  };
}

describe("C09A-E3 Foundry eligibility", () => {
  it("composes one exact flow with one exact Arc deployment", async () => {
    const result = await requestPrevrandaoEligibleRecords(
      createInput({ "src/RelaySelector.sol": SOURCE, [ARC_PATH]: broadcast() })
    );

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      sourceFile: "src/RelaySelector.sol",
      contractName: "RelaySelector",
      sinkKind: "collection-selection",
      shellOwner: "bridge-relay",
      foundryArtifactPath: ARC_PATH,
      chainId: 5042002,
      contractAddress: ARC_ADDRESS,
      confidence: "medium"
    });
  });

  for (const projectCase of projectCases) {
    it(`${projectCase.id} preserves the reviewed composed eligibility boundary`, async () => {
      const result = await requestPrevrandaoEligibleRecords(
        createInput(projectCase.files)
      );

      expect(result).toHaveLength(projectCase.id === "C09-P01" ? 1 : 0);
    });
  }

  it("fails closed when config-scoped files omit a duplicate definition", async () => {
    const result = await requestPrevrandaoEligibleRecords(
      createInput(
        {
          "src/RelaySelector.sol": SOURCE,
          "src/Duplicate.sol": "contract RelaySelector {}",
          [ARC_PATH]: broadcast()
        },
        { scanFiles: ["src/RelaySelector.sol"] }
      )
    );

    expect(result).toEqual([]);
  });

  it.each([
    ["missing", (definition) => delete definition.type],
    ["mislabeled", (definition) => (definition.type = "PragmaDirective")]
  ])(
    "fails closed when a duplicate definition has a %s AST type",
    async (_label, mutateDefinition) => {
      const parse = (source, options) => {
        const ast = parserModule.parse(source, options);
        if (source === "contract RelaySelector {}") {
          mutateDefinition(ast.children[0]);
        }
        return ast;
      };
      const result = await requestPrevrandaoEligibleRecords(
        createInput(
          {
            "src/RelaySelector.sol": SOURCE,
            "src/Duplicate.sol": "contract RelaySelector {}",
            [ARC_PATH]: broadcast()
          },
          { parserLoader: async () => ({ parse }) }
        )
      );

      expect(result).toEqual([]);
    }
  );

  it("fails closed when config-scoped files omit malformed Solidity", async () => {
    const result = await requestPrevrandaoEligibleRecords(
      createInput(
        {
          "src/RelaySelector.sol": SOURCE,
          "src/Broken.sol": "contract Broken {",
          [ARC_PATH]: broadcast()
        },
        { scanFiles: ["src/RelaySelector.sol"] }
      )
    );

    expect(result).toEqual([]);
  });

  it("fails closed when a discovered source is included but malformed", async () => {
    const result = await requestPrevrandaoEligibleRecords(
      createInput({
        "src/RelaySelector.sol": SOURCE,
        "src/Broken.sol": "contract Broken {",
        [ARC_PATH]: broadcast()
      })
    );

    expect(result).toEqual([]);
  });

  it("fails closed when one complete-inventory source cannot be read", async () => {
    const result = await requestPrevrandaoEligibleRecords(
      createInput(
        {
          "src/RelaySelector.sol": SOURCE,
          "src/Other.sol": "contract Other {}",
          [ARC_PATH]: broadcast()
        },
        {
          async readFile(filePath, entries) {
            const path = repositoryPath(filePath);
            if (path === "src/Other.sol") throw new Error("unreadable source");
            return entries.get(path);
          }
        }
      )
    );

    expect(result).toEqual([]);
  });

  it("fails closed for incomplete supplemental discovery", async () => {
    const result = await requestPrevrandaoEligibleRecords(
      createInput(
        { "src/RelaySelector.sol": SOURCE, [ARC_PATH]: broadcast() },
        { complete: false }
      )
    );

    expect(result).toEqual([]);
  });

  it("fails closed when supplemental discovery throws", async () => {
    const input = createInput({
      "src/RelaySelector.sol": SOURCE,
      [ARC_PATH]: broadcast()
    });
    input.discoverProjectEvidence = async () => {
      throw new Error("discovery failed");
    };

    await expect(requestPrevrandaoEligibleRecords(input)).resolves.toEqual([]);
  });

  it("fails closed when a canonical artifact cannot be read", async () => {
    const result = await requestPrevrandaoEligibleRecords(
      createInput(
        { "src/RelaySelector.sol": SOURCE, [ARC_PATH]: broadcast() },
        {
          async readFile(filePath, entries) {
            const path = repositoryPath(filePath);
            if (path === ARC_PATH) throw new Error("unreadable artifact");
            return entries.get(path);
          }
        }
      )
    );

    expect(result).toEqual([]);
  });

  it("fails closed for a canonical artifact with an unsupported JSON shape", async () => {
    const result = await requestPrevrandaoEligibleRecords(
      createInput({
        "src/RelaySelector.sol": SOURCE,
        [ARC_PATH]: JSON.stringify({ chain: 5042002, transactions: {} })
      })
    );

    expect(result).toEqual([]);
  });

  it.each([
    ["missing", undefined],
    ["non-string", 1]
  ])(
    "fails closed when a non-Arc ownership transaction has a %s discriminator",
    async (_label, transactionType) => {
      const transaction = {
        ...(transactionType === undefined ? {} : { transactionType }),
        contractName: "RelaySelector",
        contractAddress: ARC_ADDRESS
      };
      const result = await requestPrevrandaoEligibleRecords(
        createInput({
          "src/RelaySelector.sol": SOURCE,
          [ARC_PATH]: broadcast(),
          "broadcast/Deploy.s.sol/1/run-latest.json": broadcastTransaction(
            1,
            transaction
          )
        })
      );

      expect(result).toEqual([]);
    }
  );

  it("ignores a well-shaped non-Arc CALL without hiding Arc ownership", async () => {
    const result = await requestPrevrandaoEligibleRecords(
      createInput({
        "src/RelaySelector.sol": SOURCE,
        [ARC_PATH]: broadcast(),
        "broadcast/Deploy.s.sol/1/run-latest.json": broadcast({
          chain: 1,
          transactionType: "CALL"
        })
      })
    );

    expect(result).toHaveLength(1);
  });

  it("does not lend Arc ownership from another exact contract name", async () => {
    const result = await requestPrevrandaoEligibleRecords(
      createInput({
        "src/RelaySelector.sol": SOURCE,
        [ARC_PATH]: broadcast({ contractName: "Other" })
      })
    );

    expect(result).toEqual([]);
  });

  it.each([
    [
      "comment spoof",
      "contract Other {} // contract RelaySelector {}",
      broadcast()
    ],
    [
      "string spoof",
      'contract Other { string constant TEXT = "contract RelaySelector {}"; }',
      broadcast()
    ],
    [
      "duplicate exact definitions",
      `${SOURCE}\ncontract RelaySelector {}`,
      broadcast()
    ],
    ["abstract-only", "abstract contract RelaySelector {}", broadcast()],
    ["malformed JSON", SOURCE, "{ malformed"],
    ["path-chain mismatch", SOURCE, broadcast({ chain: 1 })],
    ["missing address", SOURCE, broadcast({ contractAddress: null })],
    ["non-CREATE", SOURCE, broadcast({ transactionType: "CALL" })]
  ])(
    "rejects ownership adversarial case %s",
    async (_label, source, artifact) => {
      const result = await requestPrevrandaoEligibleRecords(
        createInput({ "src/RelaySelector.sol": source, [ARC_PATH]: artifact })
      );

      expect(result).toEqual([]);
    }
  );

  it("accepts same-address duplicates and selects by code-unit artifact path", async () => {
    const firstPath = "broadcast/A.s.sol/5042002/run-latest.json";
    const result = await requestPrevrandaoEligibleRecords(
      createInput({
        "src/RelaySelector.sol": SOURCE,
        "broadcast/Z.s.sol/5042002/run-latest.json": broadcast(),
        [firstPath]: broadcast()
      })
    );

    expect(result).toHaveLength(1);
    expect(result[0].foundryArtifactPath).toBe(firstPath);
  });

  it("accepts a safe relative operational source path", async () => {
    const input = createInput({
      "src/RelaySelector.sol": SOURCE,
      [ARC_PATH]: broadcast()
    });
    input.files = ["src/RelaySelector.sol"];

    await expect(requestPrevrandaoEligibleRecords(input)).resolves.toHaveLength(
      1
    );
  });

  it("shares one Solidity snapshot between flow and eligibility requests", async () => {
    const parse = vi.fn(parserModule.parse.bind(parserModule));
    const input = createInput(
      { "src/RelaySelector.sol": SOURCE, [ARC_PATH]: broadcast() },
      { parserLoader: vi.fn(async () => ({ parse })) }
    );
    const observed = [];

    await runRules(
      [
        createPrivateRequestRule("bridge/flow", async () => {
          observed.push((await requestPrevrandaoFlowRecords(input)).length);
        }),
        createPrivateRequestRule("wallet/eligibility", async () => {
          observed.push((await requestPrevrandaoEligibleRecords(input)).length);
        })
      ],
      createRuleContext(input)
    );

    expect(observed).toEqual([1, 1]);
    expect(parse).toHaveBeenCalledTimes(1);
    expect(input.discoverProjectEvidence).toHaveBeenCalledTimes(1);
  });

  it("discovers default broadcast evidence outside config paths and instruments reads", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "arcready-c09a-e3-"));
    const sourcePath = join(projectRoot, "src", "RelaySelector.sol");
    const artifactPath = join(
      projectRoot,
      "broadcast",
      "Deploy.s.sol",
      "5042002",
      "run-latest.json"
    );
    try {
      await mkdir(join(projectRoot, "src"), { recursive: true });
      await mkdir(resolve(artifactPath, ".."), { recursive: true });
      await writeFile(sourcePath, SOURCE, "utf8");
      await writeFile(artifactPath, broadcast(), "utf8");
      const context = {
        projectRoot,
        config: DEFAULT_CONFIG,
        files: [sourcePath],
        detectedPresets: {
          detectedPresets: ["wallet", "bridge"],
          confidence: "high",
          reasons: ["C09A-E3 instrumentation test"]
        },
        readFile: (filePath) => readFile(filePath, "utf8")
      };
      let eligibleCount = 0;
      const result = await runRulesInstrumented(
        [
          createPrivateRequestRule("bridge/eligibility", async (input) => {
            eligibleCount = (await requestPrevrandaoEligibleRecords(input))
              .length;
          })
        ],
        context
      );

      expect(DEFAULT_CONFIG.paths).not.toContain("broadcast");
      expect(eligibleCount).toBe(1);
      expect(result.instrumentation.rules[0].readAttempts).toHaveLength(2);
      expect(
        result.instrumentation.rules[0].readAttempts.map(
          (attempt) => attempt.path.path
        )
      ).toEqual(["src/RelaySelector.sol", ARC_PATH]);
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it.each([
    ["parent traversal", "../outside/run-latest.json"],
    ["UNC", "//server/share/run-latest.json"],
    ["drive mismatch", "D:\\outside\\run-latest.json"],
    ["non-integer chain", "broadcast/Deploy.s.sol/not-a-chain/run-latest.json"],
    [
      "unsafe integer chain",
      "broadcast/Deploy.s.sol/999999999999999999999/run-latest.json"
    ],
    ["mixed separators", "broadcast\\Deploy.s.sol/5042002/run-latest.json"]
  ])(
    "rejects %s paths returned by the discovery seam",
    async (_label, path) => {
      const result = await requestPrevrandaoEligibleRecords(
        createInput(
          { "src/RelaySelector.sol": SOURCE, [ARC_PATH]: broadcast() },
          { artifactFiles: [path] }
        )
      );

      expect(result).toEqual([]);
    }
  );
});

function createRuleContext(input) {
  return {
    projectRoot: input.projectRoot,
    config: DEFAULT_CONFIG,
    files: input.files,
    detectedPresets: {
      detectedPresets: ["wallet", "bridge"],
      confidence: "high",
      reasons: ["C09A-E3 snapshot test"]
    },
    readFile: input.readFile
  };
}

function createPrivateRequestRule(id, request) {
  return {
    id,
    name: id,
    description: "Requests private C09A-E3 analysis records.",
    preset: id.startsWith("bridge/") ? "bridge" : "wallet",
    defaultSeverity: "warning",
    docs: ["https://example.com/private-c09a-e3-test"],
    async run(context) {
      await request(context);
      return [];
    }
  };
}
