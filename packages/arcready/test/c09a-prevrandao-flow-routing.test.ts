import parserModule from "@solidity-parser/parser";
import { describe, expect, it, vi } from "vitest";
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

  it("caches one private analysis by scan-owned file-list identity", async () => {
    const parse = vi.fn(parserModule.parse.bind(parserModule));
    const parserLoader = vi.fn(async () => ({ parse }));
    const readFile = vi.fn(async () => DIRECT_BRIDGE_SELECTION);
    const files = ["src/Selector.sol", "src/client.ts", "src/Selector.sol"];
    const first = requestPrevrandaoFlowRecords({
      files,
      readFile,
      parserLoader
    });
    const second = requestPrevrandaoFlowRecords({
      files,
      readFile,
      parserLoader
    });

    expect(second).toBe(first);
    await expect(first).resolves.toHaveLength(1);
    expect(readFile).toHaveBeenCalledTimes(1);
    expect(parserLoader).toHaveBeenCalledTimes(1);
    expect(parse).toHaveBeenCalledTimes(1);

    await expect(
      requestPrevrandaoFlowRecords({
        files: [...files],
        readFile,
        parserLoader
      })
    ).resolves.toHaveLength(1);
    expect(readFile).toHaveBeenCalledTimes(2);
    expect(parserLoader).toHaveBeenCalledTimes(2);
    expect(parse).toHaveBeenCalledTimes(2);
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
