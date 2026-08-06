import parserModule from "@solidity-parser/parser";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_CONFIG } from "../core/config/index.js";
import { runRulesInstrumented } from "../core/rules/instrumentation.js";
import { runRules, type Rule, type RuleContext } from "../core/rules/index.js";
import {
  analyzePrevrandaoFlowFile,
  analyzePrevrandaoSourceFile,
  requestPrevrandaoFlowRecords
} from "../rules/shared/prevrandao-analysis.js";

const DIRECT_BRIDGE_SELECTION = `
pragma solidity ^0.8.24;
contract Selector {
  address[] internal relayers;
  function selectRelay() external view returns (address) {
    return relayers[block.prevrandao % relayers.length];
  }
}`;

describe("C09A-E2 direct bridge-selection vertical slice", () => {
  it("records one exact same-function modulo/index sink for the bridge shell", async () => {
    const result = await analyzePrevrandaoFlowFile(
      "src/Selector.sol",
      DIRECT_BRIDGE_SELECTION
    );

    expect(result).toEqual({
      status: "analyzed",
      records: [
        {
          sourceFile: "src/Selector.sol",
          contractName: "Selector",
          functionName: "selectRelay",
          sourceKind: "block-prevrandao",
          sourceOffset: DIRECT_BRIDGE_SELECTION.indexOf("block.prevrandao"),
          bindingKind: "direct",
          sinkKind: "collection-selection",
          sinkOffset: DIRECT_BRIDGE_SELECTION.indexOf("relayers["),
          shellOwner: "bridge-relay"
        }
      ]
    });
  });

  it.each([
    [
      "wallet owner is outside this slice",
      DIRECT_BRIDGE_SELECTION.replaceAll("relayers", "winners").replace(
        "selectRelay",
        "selectWinner"
      )
    ],
    [
      "bridge identifier substring lookalike",
      DIRECT_BRIDGE_SELECTION.replaceAll("relayers", "correlayers").replace(
        "selectRelay",
        "pick"
      )
    ],
    [
      "approved source cast is outside this slice",
      DIRECT_BRIDGE_SELECTION.replace(
        "block.prevrandao %",
        "uint256(block.prevrandao) %"
      )
    ],
    [
      "transformed source",
      DIRECT_BRIDGE_SELECTION.replace(
        "block.prevrandao %",
        "(block.prevrandao + 1) %"
      )
    ],
    [
      "indirect collection length",
      DIRECT_BRIDGE_SELECTION.replace(
        "return relayers[block.prevrandao % relayers.length];",
        "uint256 length = relayers.length; return relayers[block.prevrandao % length];"
      )
    ]
  ])("does not route %s", async (_label, source) => {
    await expect(
      analyzePrevrandaoFlowFile("src/Selector.sol", source)
    ).resolves.toEqual({ status: "analyzed", records: [] });
  });

  it("does not combine a source and sink from sibling functions", async () => {
    const source = `
pragma solidity ^0.8.24;
contract Selector {
  address[] internal relayers;
  function observe() external view returns (uint256) {
    return block.prevrandao;
  }
  function selectRelay(uint256 seed) external view returns (address) {
    return relayers[seed % relayers.length];
  }
}`;

    await expect(
      analyzePrevrandaoFlowFile("src/Selector.sol", source)
    ).resolves.toEqual({ status: "analyzed", records: [] });
  });

  it("reuses one private analysis within one rule execution", async () => {
    const parse = vi.fn(parserModule.parse.bind(parserModule));
    const parserLoader = vi.fn(async () => ({ parse }));
    const readFile = vi.fn(async () => DIRECT_BRIDGE_SELECTION);
    const files = ["src/Selector.sol", "src/client.ts", "src/Selector.sol"];
    const requests: Promise<unknown>[] = [];
    const context = createContext(files, readFile);
    const rules = [
      createRequestRule("bridge/first", (requestContext) => {
        const request = requestPrevrandaoFlowRecords({
          ...requestContext,
          parserLoader
        });
        requests.push(request);
        return request;
      }),
      createRequestRule("wallet/second", (requestContext) => {
        const request = requestPrevrandaoFlowRecords({
          ...requestContext,
          parserLoader
        });
        requests.push(request);
        return request;
      })
    ];

    await runRules(rules, context);

    expect(requests).toHaveLength(2);
    expect(requests[1]).toBe(requests[0]);
    expect(readFile).toHaveBeenCalledTimes(1);
    expect(parserLoader).toHaveBeenCalledTimes(1);
    expect(parse).toHaveBeenCalledTimes(1);
  });

  it("starts a fresh analysis when one context and file list are reused", async () => {
    let source = DIRECT_BRIDGE_SELECTION;
    const readFile = vi.fn(async () => source);
    const observed: number[] = [];
    const context = createContext(["src/Selector.sol"], readFile);
    const rule = createRequestRule("bridge/reused-context", (requestContext) =>
      requestPrevrandaoFlowRecords(requestContext)
    );

    rule.run = async (requestContext) => {
      observed.push(
        (await requestPrevrandaoFlowRecords(requestContext)).length
      );
      return [];
    };

    await runRules([rule], context);
    source = DIRECT_BRIDGE_SELECTION.replace("block.prevrandao", "1");
    await runRules([rule], context);

    expect(observed).toEqual([1, 0]);
    expect(readFile).toHaveBeenCalledTimes(2);
  });

  it("shares the execution cache through instrumentation wrappers", async () => {
    const readFile = vi.fn(async () => DIRECT_BRIDGE_SELECTION);
    const context = createContext(["src/Selector.sol"], readFile);
    const observed: number[] = [];
    const rules = [
      createRequestRule("bridge/instrumented-first", async (requestContext) => {
        const records = await requestPrevrandaoFlowRecords(requestContext);
        observed.push(records.length);
        return records;
      }),
      createRequestRule(
        "wallet/instrumented-second",
        async (requestContext) => {
          const records = await requestPrevrandaoFlowRecords(requestContext);
          observed.push(records.length);
          return records;
        }
      )
    ];

    const result = await runRulesInstrumented(rules, context);

    expect(observed).toEqual([1, 1]);
    expect(readFile).toHaveBeenCalledTimes(1);
    expect(
      result.instrumentation.rules.flatMap((outcome) => outcome.readAttempts)
    ).toHaveLength(1);
  });

  it("isolates concurrent executions that share one file-list identity", async () => {
    const files = ["src/Selector.sol"];
    const unsafeRead = vi.fn(async () => DIRECT_BRIDGE_SELECTION);
    const safeRead = vi.fn(async () =>
      DIRECT_BRIDGE_SELECTION.replace("block.prevrandao", "1")
    );
    const unsafeObserved: number[] = [];
    const safeObserved: number[] = [];

    await Promise.all([
      runRules(
        [
          createRequestRule("bridge/concurrent-unsafe", async (context) => {
            const records = await requestPrevrandaoFlowRecords(context);
            unsafeObserved.push(records.length);
            return records;
          })
        ],
        createContext(files, unsafeRead)
      ),
      runRules(
        [
          createRequestRule("bridge/concurrent-safe", async (context) => {
            const records = await requestPrevrandaoFlowRecords(context);
            safeObserved.push(records.length);
            return records;
          })
        ],
        createContext(files, safeRead)
      )
    ]);

    expect(unsafeObserved).toEqual([1]);
    expect(safeObserved).toEqual([0]);
    expect(unsafeRead).toHaveBeenCalledTimes(1);
    expect(safeRead).toHaveBeenCalledTimes(1);
  });

  it("does not share a cache between concurrent uses of one context", async () => {
    const readFile = vi.fn(async () => DIRECT_BRIDGE_SELECTION);
    const context = createContext(["src/Selector.sol"], readFile);
    const requests: Promise<unknown>[] = [];
    const rule = createRequestRule("bridge/concurrent-context", (input) => {
      const request = requestPrevrandaoFlowRecords(input);
      requests.push(request);
      return request;
    });

    await Promise.all([runRules([rule], context), runRules([rule], context)]);

    expect(requests).toHaveLength(2);
    expect(requests[1]).not.toBe(requests[0]);
    expect(readFile).toHaveBeenCalledTimes(2);
  });

  it("does not cache direct requests outside a rule execution", async () => {
    let source = DIRECT_BRIDGE_SELECTION;
    const readFile = vi.fn(async () => source);
    const input = {
      files: ["src/Selector.sol"],
      readFile
    };
    const first = requestPrevrandaoFlowRecords(input);

    await expect(first).resolves.toHaveLength(1);
    source = DIRECT_BRIDGE_SELECTION.replace("block.prevrandao", "1");
    const second = requestPrevrandaoFlowRecords(input);

    expect(second).not.toBe(first);
    await expect(second).resolves.toHaveLength(0);
    expect(readFile).toHaveBeenCalledTimes(2);
  });

  it("keeps E1 source records free of E2 sink and shell fields", async () => {
    const result = await analyzePrevrandaoSourceFile(
      "src/Selector.sol",
      DIRECT_BRIDGE_SELECTION
    );

    expect(result.status).toBe("analyzed");
    expect(result.sources).toHaveLength(1);
    expect(result.sources[0]).not.toHaveProperty("sinkKind");
    expect(result.sources[0]).not.toHaveProperty("shellOwner");
  });
});

function createContext(
  files: string[],
  readFile: RuleContext["readFile"]
): RuleContext {
  return {
    projectRoot: "/fixture",
    config: DEFAULT_CONFIG,
    files,
    detectedPresets: {
      detectedPresets: ["wallet", "bridge"],
      confidence: "high",
      reasons: ["C09A-E2 execution-scope test"]
    },
    readFile
  };
}

function createRequestRule(
  id: string,
  request: (context: RuleContext) => Promise<readonly unknown[]>
): Rule {
  return {
    id,
    name: id,
    description: "Requests private C09A-E2 analysis records.",
    preset: id.startsWith("bridge/") ? "bridge" : "wallet",
    defaultSeverity: "warning",
    docs: ["https://example.com/private-c09a-e2-test"],
    run: async (context) => {
      await request(context);
      return [];
    }
  };
}
