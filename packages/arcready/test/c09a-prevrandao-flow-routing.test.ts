import parserModule from "@solidity-parser/parser";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_CONFIG } from "../core/config/index.js";
import { runRulesInstrumented } from "../core/rules/instrumentation.js";
import { runRules, type Rule, type RuleContext } from "../core/rules/index.js";
import {
  analyzePrevrandaoFlowFile,
  analyzePrevrandaoSourceFile,
  requestPrevrandaoFlowRecords,
  selectPrevrandaoFlowRecordsForShells
} from "../rules/shared/prevrandao-analysis.js";

const DIRECT_BRIDGE_SELECTION = `
pragma solidity ^0.8.24;
contract Selector {
  address[] internal relayers;
  function selectRelay() external view returns (address) {
    return relayers[block.prevrandao % relayers.length];
  }
}`;

const AUTHORIZATION_TEMPLATE = `
pragma solidity ^0.8.24;
contract Gate {
  function eligible(uint256 threshold) external view returns (bool) {
    return AUTHORIZATION_EXPRESSION;
}
}`;

const ORDERING_TEMPLATE = `
pragma solidity ^0.8.24;
contract Ordering {
  function orderingKey(uint256 item) external view returns (uint256) {
    return ORDERING_EXPRESSION;
  }
}`;

describe("C09A-E2 collection-selection routing", () => {
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

  it("routes private records only to their selected owner shells", async () => {
    const bridge = await analyzePrevrandaoFlowFile(
      "src/BridgeSelector.sol",
      DIRECT_BRIDGE_SELECTION
    );
    const wallet = await analyzePrevrandaoFlowFile(
      "src/WalletSelector.sol",
      DIRECT_BRIDGE_SELECTION.replaceAll("relayers", "winners").replace(
        "selectRelay",
        "selectWinner"
      )
    );
    const records = [...bridge.records, ...wallet.records];

    expect(
      selectPrevrandaoFlowRecordsForShells(records, ["wallet-compatibility"])
    ).toEqual(wallet.records);
    expect(
      selectPrevrandaoFlowRecordsForShells(records, ["bridge-relay"])
    ).toEqual(bridge.records);
    expect(
      selectPrevrandaoFlowRecordsForShells(records, [
        "wallet-compatibility",
        "bridge-relay"
      ])
    ).toEqual(records);
    expect(selectPrevrandaoFlowRecordsForShells(records, [])).toEqual([]);
    expect(
      selectPrevrandaoFlowRecordsForShells(records, [
        "bridge-relay",
        "bridge-relay"
      ])
    ).toEqual(bridge.records);
  });

  it.each([
    [
      "direct wallet selection",
      DIRECT_BRIDGE_SELECTION.replaceAll("relayers", "winners").replace(
        "selectRelay",
        "selectWinner"
      ),
      "wallet-compatibility",
      "block-prevrandao",
      "direct",
      undefined
    ],
    [
      "bridge substring lookalike remains with the wallet compatibility shell",
      DIRECT_BRIDGE_SELECTION.replaceAll("relayers", "correlayers").replace(
        "selectRelay",
        "pick"
      ),
      "wallet-compatibility",
      "block-prevrandao",
      "direct",
      undefined
    ],
    [
      "approved direct cast",
      DIRECT_BRIDGE_SELECTION.replace(
        "block.prevrandao %",
        "uint256(block.prevrandao) %"
      ),
      "bridge-relay",
      "block-prevrandao-cast",
      "direct",
      undefined
    ],
    [
      "one source binding",
      DIRECT_BRIDGE_SELECTION.replace(
        "return relayers[block.prevrandao % relayers.length];",
        "uint256 seed = block.prevrandao; return relayers[seed % relayers.length];"
      ),
      "bridge-relay",
      "block-prevrandao",
      "single-assignment",
      "seed"
    ],
    [
      "assembly-owned source binding",
      DIRECT_BRIDGE_SELECTION.replace(
        "return relayers[block.prevrandao % relayers.length];",
        "uint256 seed; assembly { seed := prevrandao() } return relayers[seed % relayers.length];"
      ),
      "bridge-relay",
      "inline-assembly-prevrandao",
      "single-assignment",
      "seed"
    ],
    [
      "cast modulo index binding",
      DIRECT_BRIDGE_SELECTION.replaceAll("relayers", "winners")
        .replace("selectRelay", "selectWinner")
        .replace(
          "return winners[block.prevrandao % winners.length];",
          "uint256 index = uint256(block.prevrandao) % winners.length; return winners[index];"
        ),
      "wallet-compatibility",
      "block-prevrandao-cast",
      "direct",
      undefined
    ]
  ] as const)(
    "routes %s with exact source and owner evidence",
    async (
      _label,
      source,
      shellOwner,
      sourceKind,
      bindingKind,
      bindingName
    ) => {
      const result = await analyzePrevrandaoFlowFile(
        "src/Selector.sol",
        source
      );

      expect(result.status).toBe("analyzed");
      expect(result.records).toHaveLength(1);
      const record = result.records[0];
      expect(record).toMatchObject({
        shellOwner,
        sourceKind,
        bindingKind,
        ...(bindingName === undefined ? {} : { bindingName })
      });
      expect(source.slice(record?.sinkOffset)).toMatch(/^[A-Za-z0-9_]+\[/);
      expect(source.slice(record?.sourceOffset)).toMatch(
        /^(?:block\.prevrandao|prevrandao\(\))/
      );
    }
  );

  it("fails closed when dynamic-array null sentinel evidence is missing", async () => {
    const parser = parserDeletingAstField("ArrayTypeName", "length");

    await expect(
      analyzePrevrandaoFlowFile(
        "src/Selector.sol",
        DIRECT_BRIDGE_SELECTION,
        async () => parser
      )
    ).resolves.toEqual({ status: "analyzed", records: [] });
  });

  it.each([
    ["selection", DIRECT_BRIDGE_SELECTION],
    ["authorization", authorizationSource("block.prevrandao < threshold")],
    [
      "ordering",
      orderingSource("uint256(keccak256(abi.encode(item, block.prevrandao)))")
    ]
  ] as const)(
    "fails closed when %s unnamed-return sentinel is malformed",
    async (_label, source) => {
      const parser = parserReplacingReturnName(42);

      await expect(
        analyzePrevrandaoFlowFile(
          "src/Evidence.sol",
          source,
          async () => parser
        )
      ).resolves.toEqual({ status: "analyzed", records: [] });
    }
  );

  it.each([
    ["authorization", authorizationSource("block.prevrandao < 1")],
    [
      "ordering",
      orderingSource("uint256(keccak256(abi.encode(1, block.prevrandao)))")
    ]
  ] as const)(
    "fails closed when %s literal subdenomination sentinel is missing",
    async (_label, source) => {
      const parser = parserDeletingAstField("NumberLiteral", "subdenomination");

      await expect(
        analyzePrevrandaoFlowFile(
          "src/Evidence.sol",
          source,
          async () => parser
        )
      ).resolves.toEqual({ status: "analyzed", records: [] });
    }
  );

  it.each([
    ["validator", "validators", "selectValidator"],
    ["sequencer", "sequencers", "selectSequencer"],
    ["committee", "committees", "selectCommittee"],
    ["acronym-leading relayer", "VRFRelayers", "pick"]
  ])(
    "routes exact %s identifiers to the bridge shell",
    async (_label, collection, functionName) => {
      const source = DIRECT_BRIDGE_SELECTION.replaceAll(
        "relayers",
        collection
      ).replace("selectRelay", functionName);

      const result = await analyzePrevrandaoFlowFile(
        "src/Selector.sol",
        source
      );

      expect(result.records).toHaveLength(1);
      expect(result.records[0]?.shellOwner).toBe("bridge-relay");
    }
  );

  it("uses an exact selected-entity identifier for bridge routing", async () => {
    const source = DIRECT_BRIDGE_SELECTION.replaceAll("relayers", "members")
      .replace("selectRelay", "pick")
      .replace(
        "return members[block.prevrandao % members.length];",
        "address relayer = members[block.prevrandao % members.length]; return relayer;"
      );

    const result = await analyzePrevrandaoFlowFile("src/Selector.sol", source);

    expect(result.records).toHaveLength(1);
    expect(result.records[0]?.shellOwner).toBe("bridge-relay");
  });

  it("fails closed for ambiguous selected-entity ownership", async () => {
    const source = DIRECT_BRIDGE_SELECTION.replaceAll("relayers", "members")
      .replace("selectRelay", "pick")
      .replace(
        "return members[block.prevrandao % members.length];",
        "address relayerWinner = members[block.prevrandao % members.length]; return relayerWinner;"
      );

    await expect(
      analyzePrevrandaoFlowFile("src/Selector.sol", source)
    ).resolves.toEqual({ status: "analyzed", records: [] });
  });

  it.each(["relayer", "relayerWinner"])(
    "keeps assignment-based selected entity %s outside the bounded grammar",
    async (selectedEntity) => {
      const source = `
pragma solidity ^0.8.24;
contract Selector {
  address[] internal members;
  function pick() external view returns (address ${selectedEntity}) {
    ${selectedEntity} = members[block.prevrandao % members.length];
  }
}`;

      await expect(
        analyzePrevrandaoFlowFile("src/Selector.sol", source)
      ).resolves.toEqual({ status: "analyzed", records: [] });
    }
  );

  it("rejects an invalid selected-entity declaration type", async () => {
    const source = DIRECT_BRIDGE_SELECTION.replace(
      "return relayers[block.prevrandao % relayers.length];",
      "uint256 relayer = relayers[block.prevrandao % relayers.length]; return address(0);"
    );

    await expect(
      analyzePrevrandaoFlowFile("src/Selector.sol", source)
    ).resolves.toEqual({ status: "analyzed", records: [] });
  });

  it("rejects a selection whose function return type is not address", async () => {
    const source = DIRECT_BRIDGE_SELECTION.replace(
      "returns (address)",
      "returns (uint256)"
    );

    await expect(
      analyzePrevrandaoFlowFile("src/Selector.sol", source)
    ).resolves.toEqual({ status: "analyzed", records: [] });
  });

  it("keeps expression-only collection access non-reportable", async () => {
    const source = DIRECT_BRIDGE_SELECTION.replace(
      "return relayers[block.prevrandao % relayers.length];",
      "relayers[block.prevrandao % relayers.length]; return address(0);"
    );

    await expect(
      analyzePrevrandaoFlowFile("src/Selector.sol", source)
    ).resolves.toEqual({ status: "analyzed", records: [] });
  });

  it.each(["relayer", "relayerWinner"])(
    "keeps named return parameter %s outside the bounded selection grammar",
    async (selectedEntity) => {
      const source = DIRECT_BRIDGE_SELECTION.replace(
        "returns (address)",
        `returns (address ${selectedEntity})`
      );

      await expect(
        analyzePrevrandaoFlowFile("src/Selector.sol", source)
      ).resolves.toEqual({ status: "analyzed", records: [] });
    }
  );

  it("keeps event-only collection observation non-reportable", async () => {
    const source = DIRECT_BRIDGE_SELECTION.replace(
      "return relayers[block.prevrandao % relayers.length];",
      "emit Selected(relayers[block.prevrandao % relayers.length]); return address(0);"
    ).replace(
      "address[] internal relayers;",
      "address[] internal relayers; event Selected(address selected);"
    );

    await expect(
      analyzePrevrandaoFlowFile("src/Selector.sol", source)
    ).resolves.toEqual({ status: "analyzed", records: [] });
  });

  it("does not route an undeclared collection receiver", async () => {
    const source = DIRECT_BRIDGE_SELECTION.replace(
      "address[] internal relayers;",
      ""
    );

    await expect(
      analyzePrevrandaoFlowFile("src/Selector.sol", source)
    ).resolves.toEqual({ status: "analyzed", records: [] });
  });

  it("does not borrow a shadowed state collection declaration", async () => {
    const source = DIRECT_BRIDGE_SELECTION.replace(
      "return relayers[block.prevrandao % relayers.length];",
      "address[] memory relayers; return relayers[block.prevrandao % relayers.length];"
    );

    await expect(
      analyzePrevrandaoFlowFile("src/Selector.sol", source)
    ).resolves.toEqual({ status: "analyzed", records: [] });
  });

  it("rejects an invalid collection index binding type", async () => {
    const source = DIRECT_BRIDGE_SELECTION.replace(
      "return relayers[block.prevrandao % relayers.length];",
      "address index = block.prevrandao % relayers.length; return relayers[index];"
    );

    await expect(
      analyzePrevrandaoFlowFile("src/Selector.sol", source)
    ).resolves.toEqual({ status: "analyzed", records: [] });
  });

  it.each([
    [
      "contract-owned block",
      DIRECT_BRIDGE_SELECTION.replace(
        "address[] internal relayers;",
        "struct FakeBlock { uint256 prevrandao; } FakeBlock internal block; address[] internal relayers;"
      )
    ],
    [
      "local block",
      DIRECT_BRIDGE_SELECTION.replace(
        "return relayers[block.prevrandao % relayers.length];",
        "FakeBlock memory block; return relayers[block.prevrandao % relayers.length];"
      ).replace(
        "address[] internal relayers;",
        "struct FakeBlock { uint256 prevrandao; } address[] internal relayers;"
      )
    ],
    [
      "parameter block",
      DIRECT_BRIDGE_SELECTION.replace(
        "function selectRelay()",
        "function selectRelay(FakeBlock memory block)"
      ).replace(
        "address[] internal relayers;",
        "struct FakeBlock { uint256 prevrandao; } address[] internal relayers;"
      )
    ],
    [
      "inherited block",
      DIRECT_BRIDGE_SELECTION.replace(
        "contract Selector",
        "contract Selector is FakeBase"
      ).replace(
        "pragma solidity ^0.8.24;",
        "pragma solidity ^0.8.24; struct FakeBlock { uint256 prevrandao; } contract FakeBase { FakeBlock internal block; }"
      )
    ],
    [
      "source-unit block library",
      DIRECT_BRIDGE_SELECTION.replace(
        "contract Selector",
        "library block { uint256 internal constant prevrandao = 1; } contract Selector"
      )
    ]
  ])("does not treat %s as the EVM source", async (_label, source) => {
    await expect(
      analyzePrevrandaoFlowFile("src/Selector.sol", source)
    ).resolves.toEqual({ status: "unsupported-source", records: [] });
    await expect(
      analyzePrevrandaoSourceFile("src/Selector.sol", source)
    ).resolves.toEqual({ status: "unsupported-source", sources: [] });
  });

  it("fails closed when source identity depends on an import", async () => {
    const source = DIRECT_BRIDGE_SELECTION.replace(
      "contract Selector",
      'import "./Identity.sol"; contract Selector'
    );

    await expect(
      analyzePrevrandaoFlowFile("src/Selector.sol", source)
    ).resolves.toEqual({ status: "unsupported-source", records: [] });
    await expect(
      analyzePrevrandaoSourceFile("src/Selector.sol", source)
    ).resolves.toEqual({ status: "unsupported-source", sources: [] });
  });

  it("keeps modifier-owned selection outside the bounded grammar", async () => {
    const source = DIRECT_BRIDGE_SELECTION.replace(
      "address[] internal relayers;",
      "address[] internal relayers; modifier active() { _; }"
    ).replace("external view returns", "external view active returns");

    await expect(
      analyzePrevrandaoFlowFile("src/Selector.sol", source)
    ).resolves.toEqual({ status: "analyzed", records: [] });
  });

  it.each([
    [
      "initializer binding type",
      DIRECT_BRIDGE_SELECTION.replace(
        "return relayers[block.prevrandao % relayers.length];",
        "address seed = block.prevrandao; return relayers[uint256(uint160(seed)) % relayers.length];"
      )
    ],
    [
      "assembly binding type",
      DIRECT_BRIDGE_SELECTION.replace(
        "return relayers[block.prevrandao % relayers.length];",
        "address seed; assembly { seed := prevrandao() } return relayers[uint256(uint160(seed)) % relayers.length];"
      )
    ]
  ])(
    "rejects an invalid %s at the private source API",
    async (_label, source) => {
      await expect(
        analyzePrevrandaoSourceFile("src/Selector.sol", source)
      ).resolves.toEqual({ status: "unsupported-source", sources: [] });
      await expect(
        analyzePrevrandaoFlowFile("src/Selector.sol", source)
      ).resolves.toEqual({ status: "unsupported-source", records: [] });
    }
  );

  it("rejects missing range evidence on a source binding declaration", async () => {
    const source = DIRECT_BRIDGE_SELECTION.replace(
      "return relayers[block.prevrandao % relayers.length];",
      "uint256 seed = block.prevrandao; return relayers[seed % relayers.length];"
    );
    const parser = parserRemovingDeclarationRange("seed");

    await expect(
      analyzePrevrandaoSourceFile(
        "src/Selector.sol",
        source,
        async () => parser
      )
    ).resolves.toEqual({ status: "unsupported-source", sources: [] });
  });

  it.each([
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
    ],
    [
      "ambiguous bridge and wallet ownership",
      DIRECT_BRIDGE_SELECTION.replaceAll("relayers", "relayerWinners").replace(
        "selectRelay",
        "pick"
      )
    ],
    [
      "acronym-leading bridge and wallet ownership",
      DIRECT_BRIDGE_SELECTION.replaceAll(
        "relayers",
        "VRFRelayerWinners"
      ).replace("selectRelay", "pick")
    ],
    [
      "loop-owned selection",
      DIRECT_BRIDGE_SELECTION.replace(
        "return relayers[block.prevrandao % relayers.length];",
        "for (uint256 i = 0; i < 1; i++) { return relayers[block.prevrandao % relayers.length]; } revert();"
      )
    ],
    [
      "mutated index binding",
      DIRECT_BRIDGE_SELECTION.replace(
        "return relayers[block.prevrandao % relayers.length];",
        "uint256 index = block.prevrandao % relayers.length; index += 1; return relayers[index];"
      )
    ],
    [
      "source binding declared after the sink",
      DIRECT_BRIDGE_SELECTION.replace(
        "return relayers[block.prevrandao % relayers.length];",
        "return relayers[seed % relayers.length]; uint256 seed = block.prevrandao;"
      )
    ]
  ])("does not route %s", async (_label, source) => {
    await expect(
      analyzePrevrandaoFlowFile("src/Selector.sol", source)
    ).resolves.toEqual({ status: "analyzed", records: [] });
  });

  it("chooses the earliest reportable collection-selection candidate", async () => {
    const source = DIRECT_BRIDGE_SELECTION.replace(
      "return relayers[block.prevrandao % relayers.length];",
      "address first = relayers[block.prevrandao % relayers.length]; return relayers[block.prevrandao % relayers.length];"
    );

    const result = await analyzePrevrandaoFlowFile("src/Selector.sol", source);

    expect(result.records).toHaveLength(1);
    expect(result.records[0]?.sinkOffset).toBe(source.indexOf("relayers["));
    expect(result.records[0]?.sourceOffset).toBe(
      source.indexOf("block.prevrandao")
    );
  });

  it("preserves earliest selection routing when later selection ownership differs", async () => {
    const source = `
pragma solidity ^0.8.24;
contract Selector {
  address[] internal relayers;
  address[] internal winners;
  function select() external view returns (address) {
    address relay = relayers[block.prevrandao % relayers.length];
    relay;
    return winners[block.prevrandao % winners.length];
  }
}`;

    const result = await analyzePrevrandaoFlowFile("src/Selector.sol", source);

    expect(result.records).toHaveLength(1);
    expect(result.records[0]).toMatchObject({
      sinkKind: "collection-selection",
      sinkOffset: source.indexOf("relayers["),
      shellOwner: "bridge-relay"
    });
  });

  it("fails closed for a fully ranged unknown sink-bearing wrapper", async () => {
    const sourceNode = {
      type: "MemberAccess",
      memberName: "prevrandao",
      expression: { type: "Identifier", name: "block", range: [20, 24] },
      range: [20, 35]
    };
    const selectionNode = {
      type: "IndexAccess",
      range: [60, 100],
      base: { type: "Identifier", name: "relayers", range: [60, 67] },
      index: {
        type: "BinaryOperation",
        operator: "%",
        range: [69, 98],
        left: { type: "Identifier", name: "seed", range: [69, 72] },
        right: {
          type: "MemberAccess",
          memberName: "length",
          range: [76, 91],
          expression: {
            type: "Identifier",
            name: "relayers",
            range: [76, 83]
          }
        }
      }
    };
    const parser = {
      parse: () => ({
        type: "SourceUnit",
        range: [0, 200],
        children: [
          {
            type: "ContractDefinition",
            kind: "contract",
            name: "Selector",
            range: [0, 200],
            subNodes: [
              {
                type: "FunctionDefinition",
                name: "selectRelay",
                range: [5, 190],
                body: {
                  type: "Block",
                  range: [10, 180],
                  statements: [
                    {
                      type: "VariableDeclarationStatement",
                      range: [15, 40],
                      variables: [
                        {
                          type: "VariableDeclaration",
                          name: "seed",
                          range: [15, 18]
                        }
                      ],
                      initialValue: sourceNode
                    },
                    {
                      type: "MysteryExpression",
                      range: [55, 105],
                      expression: selectionNode
                    }
                  ]
                }
              }
            ]
          }
        ]
      })
    };

    await expect(
      analyzePrevrandaoFlowFile("src/Selector.sol", "ignored", async () =>
        Promise.resolve(parser)
      )
    ).resolves.toEqual({ status: "unsupported-source", records: [] });
  });

  it.each([
    "selection",
    "collection-base",
    "modulo",
    "dependency",
    "length-member",
    "length-collection"
  ] as const)(
    "fails closed when %s range evidence is missing",
    async (target) => {
      const parser = parserRemovingSelectionRange(target);
      const result = await analyzePrevrandaoFlowFile(
        "src/Selector.sol",
        DIRECT_BRIDGE_SELECTION,
        async () => parser
      );

      expect(result.records).toEqual([]);
      if (target !== "dependency") expect(result.status).toBe("analyzed");
    }
  );

  it.each(["selection-index", "index-declaration"] as const)(
    "fails closed when %s range evidence is missing",
    async (target) => {
      const source = DIRECT_BRIDGE_SELECTION.replace(
        "return relayers[block.prevrandao % relayers.length];",
        "uint256 index = block.prevrandao % relayers.length; return relayers[index];"
      );
      const parser = parserRemovingSelectionRange(target);

      await expect(
        analyzePrevrandaoFlowFile("src/Selector.sol", source, async () =>
          Promise.resolve(parser)
        )
      ).resolves.toEqual({ status: "analyzed", records: [] });
    }
  );

  it.each([
    ["inverted", [100, 60]],
    ["negative", [-1, 100]],
    ["out-of-bounds", [60, Number.MAX_SAFE_INTEGER]]
  ] as const)(
    "fails closed for a %s selection range",
    async (_label, range) => {
      const parser = parserReplacingSelectionRange(range);

      await expect(
        analyzePrevrandaoFlowFile(
          "src/Selector.sol",
          DIRECT_BRIDGE_SELECTION,
          async () => parser
        )
      ).resolves.toEqual({ status: "analyzed", records: [] });
    }
  );

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

  it("routes one exact direct PREVRANDAO ordering key to the wallet shell", async () => {
    const expression = "uint256(keccak256(abi.encode(item, block.prevrandao)))";
    const source = orderingSource(expression);
    const result = await analyzePrevrandaoFlowFile("src/Ordering.sol", source);

    expect(result).toEqual({
      status: "analyzed",
      records: [
        {
          sourceFile: "src/Ordering.sol",
          contractName: "Ordering",
          functionName: "orderingKey",
          sourceKind: "block-prevrandao",
          sourceOffset: source.indexOf("block.prevrandao"),
          bindingKind: "direct",
          sinkKind: "ordering",
          sinkOffset: source.indexOf("keccak256"),
          shellOwner: "wallet-compatibility"
        }
      ]
    });
  });

  it.each([
    [
      "approved source cast",
      "uint256(keccak256(abi.encode(item, uint256(block.prevrandao))))"
    ],
    [
      "bytes32 ordering result",
      "bytes32(keccak256(abi.encode(item, block.prevrandao)))"
    ]
  ] as const)("routes exact ordering with %s", async (label, expression) => {
    const source =
      label === "bytes32 ordering result"
        ? orderingSource(expression).replace(
            "returns (uint256)",
            "returns (bytes32)"
          )
        : orderingSource(expression);
    const result = await analyzePrevrandaoFlowFile("src/Ordering.sol", source);

    expect(result.records).toHaveLength(1);
    expect(result.records[0]).toMatchObject({
      sinkKind: "ordering",
      shellOwner: "wallet-compatibility"
    });
  });

  it.each([
    ["no non-source input", "uint256(keccak256(abi.encode(block.prevrandao)))"],
    [
      "multiple sources",
      "uint256(keccak256(abi.encode(block.prevrandao, block.prevrandao)))"
    ],
    [
      "transformed source",
      "uint256(keccak256(abi.encode(item, block.prevrandao + 1)))"
    ],
    [
      "wrong encoder",
      "uint256(keccak256(bytes.concat(item, block.prevrandao)))"
    ],
    [
      "arbitrary outer wrapper",
      "normalize(uint256(keccak256(abi.encode(item, block.prevrandao))))"
    ]
  ])("does not route ordering with %s", async (_label, expression) => {
    await expect(
      analyzePrevrandaoFlowFile("src/Ordering.sol", orderingSource(expression))
    ).resolves.toEqual({ status: "analyzed", records: [] });
  });

  it.each([
    [
      "an import that could affect builtin identity",
      orderingSource(
        "uint256(keccak256(abi.encode(item, block.prevrandao)))"
      ).replace(
        "contract Ordering",
        'import "./Hashing.sol"; contract Ordering'
      ),
      "unsupported-source"
    ],
    [
      "an inherited namespace",
      orderingSource(
        "uint256(keccak256(abi.encode(item, block.prevrandao)))"
      ).replace("contract Ordering", "contract Ordering is Hashing"),
      "unsupported-source"
    ],
    [
      "a shadowing keccak256 declaration",
      orderingSource(
        "uint256(keccak256(abi.encode(item, block.prevrandao)))"
      ).replace(
        "function orderingKey",
        "function keccak256(bytes memory value) internal pure returns (bytes32) { value; return bytes32(0); } function orderingKey"
      ),
      "analyzed"
    ],
    [
      "a source-unit keccak256 declaration",
      orderingSource(
        "uint256(keccak256(abi.encode(item, block.prevrandao)))"
      ).replace(
        "contract Ordering",
        "function keccak256(bytes memory value) pure returns (bytes32) { value; return bytes32(0); } contract Ordering"
      ),
      "analyzed"
    ],
    [
      "a sibling abi library",
      orderingSource(
        "uint256(keccak256(abi.encode(item, block.prevrandao)))"
      ).replace(
        "contract Ordering",
        "library abi { function encode(uint256 value) internal pure returns (bytes memory) { return bytes.concat(bytes32(value)); } } contract Ordering"
      ),
      "analyzed"
    ],
    [
      "a source-unit keccak256 contract",
      orderingSource(
        "uint256(keccak256(abi.encode(item, block.prevrandao)))"
      ).replace("contract Ordering", "contract keccak256 {} contract Ordering"),
      "analyzed"
    ]
  ] as const)(
    "does not route ordering with %s",
    async (_label, source, status) => {
      await expect(
        analyzePrevrandaoFlowFile("src/Ordering.sol", source)
      ).resolves.toEqual({ status, records: [] });
    }
  );

  it("does not route ordering with an undeclared non-source input", async () => {
    const source = orderingSource(
      "uint256(keccak256(abi.encode(other, block.prevrandao)))"
    );

    await expect(
      analyzePrevrandaoFlowFile("src/Ordering.sol", source)
    ).resolves.toEqual({ status: "analyzed", records: [] });
  });

  it("does not borrow a shadowed ordering input declaration", async () => {
    const source = orderingSource(
      "uint256(keccak256(abi.encode(item, block.prevrandao)))"
    ).replace("contract Ordering {", "contract Ordering { uint256 item;");

    await expect(
      analyzePrevrandaoFlowFile("src/Ordering.sol", source)
    ).resolves.toEqual({ status: "analyzed", records: [] });
  });

  it("rejects a uint256-overflow ordering literal", async () => {
    const overflow = (1n << 256n).toString();
    const source = orderingSource(
      `uint256(keccak256(abi.encode(${overflow}, block.prevrandao)))`
    );

    await expect(
      analyzePrevrandaoFlowFile("src/Ordering.sol", source)
    ).resolves.toEqual({ status: "analyzed", records: [] });
  });

  it("rejects an ordering expression that conflicts with its return type", async () => {
    const source = orderingSource(
      "uint256(keccak256(abi.encode(item, block.prevrandao)))"
    ).replace("returns (uint256)", "returns (bytes32)");

    await expect(
      analyzePrevrandaoFlowFile("src/Ordering.sol", source)
    ).resolves.toEqual({ status: "analyzed", records: [] });
  });

  it("routes ordering with exact bridge function identity to the bridge shell", async () => {
    const source = orderingSource(
      "uint256(keccak256(abi.encode(item, block.prevrandao)))"
    ).replace("orderingKey", "validatorOrderingKey");
    const result = await analyzePrevrandaoFlowFile("src/Ordering.sol", source);

    expect(result.records).toHaveLength(1);
    expect(result.records[0]?.shellOwner).toBe("bridge-relay");
  });

  it("fails closed for ambiguous ordering function ownership", async () => {
    const source = orderingSource(
      "uint256(keccak256(abi.encode(item, block.prevrandao)))"
    ).replace("orderingKey", "validatorWinnerOrderingKey");

    await expect(
      analyzePrevrandaoFlowFile("src/Ordering.sol", source)
    ).resolves.toEqual({ status: "analyzed", records: [] });
  });

  it("uses an exact ordering input identifier as owner evidence", async () => {
    const source = orderingSource(
      "uint256(keccak256(abi.encode(validator, block.prevrandao)))"
    ).replace("uint256 item", "uint256 validator");
    const result = await analyzePrevrandaoFlowFile("src/Ordering.sol", source);

    expect(result.records).toHaveLength(1);
    expect(result.records[0]?.shellOwner).toBe("bridge-relay");
  });

  it("fails closed for ambiguous ordering input ownership", async () => {
    const source = orderingSource(
      "uint256(keccak256(abi.encode(validatorWinner, block.prevrandao)))"
    ).replace("uint256 item", "uint256 validatorWinner");

    await expect(
      analyzePrevrandaoFlowFile("src/Ordering.sol", source)
    ).resolves.toEqual({ status: "analyzed", records: [] });
  });

  it.each(["return", "keccak", "encoding", "source"] as const)(
    "fails closed when ordering %s range evidence is missing",
    async (target) => {
      const source = orderingSource(
        "uint256(keccak256(abi.encode(item, block.prevrandao)))"
      );
      const parser = parserRemovingOrderingRange(target);

      const result = await analyzePrevrandaoFlowFile(
        "src/Ordering.sol",
        source,
        async () => Promise.resolve(parser)
      );

      expect(result.records).toEqual([]);
      expect(result.status).toBe(
        target === "source" ? "unsupported-source" : "analyzed"
      );
    }
  );

  it.each([
    ["collection declaration", DIRECT_BRIDGE_SELECTION, "relayers"],
    [
      "ordering parameter",
      orderingSource("uint256(keccak256(abi.encode(item, block.prevrandao)))"),
      "item"
    ],
    [
      "authorization parameter",
      authorizationSource("block.prevrandao < threshold"),
      "threshold"
    ]
  ] as const)(
    "fails closed when %s range evidence is missing",
    async (_label, source, declarationName) => {
      const parser = parserRemovingDeclarationRange(declarationName);

      await expect(
        analyzePrevrandaoFlowFile(
          "src/Evidence.sol",
          source,
          async () => parser
        )
      ).resolves.toEqual({ status: "analyzed", records: [] });
    }
  );

  it.each(
    ["==", "!=", "<", ">", "<=", ">="].flatMap((operator) => [
      [operator, `block.prevrandao ${operator} threshold`],
      [operator, `threshold ${operator} block.prevrandao`]
    ])
  )(
    "routes returned %s authorization with the source on either side",
    async (_operator, expression) => {
      const source = authorizationSource(expression);
      const result = await analyzePrevrandaoFlowFile("src/Gate.sol", source);

      expect(result).toEqual({
        status: "analyzed",
        records: [
          {
            sourceFile: "src/Gate.sol",
            contractName: "Gate",
            functionName: "eligible",
            sourceKind: "block-prevrandao",
            sourceOffset: source.indexOf("block.prevrandao"),
            bindingKind: "direct",
            sinkKind: "authorization",
            sinkOffset: source.indexOf(expression),
            shellOwner: "wallet-compatibility"
          }
        ]
      });
    }
  );

  it.each([
    ["approved direct cast", "uint256(block.prevrandao) < threshold"],
    ["source modulo literal", "block.prevrandao % 2 < threshold"],
    ["source modulo zero equality", "block.prevrandao % 2 == 0"],
    ["non-zero equality", "block.prevrandao == 1"],
    ["zero inequality", "block.prevrandao != 0"]
  ])("routes exact %s authorization", async (_label, expression) => {
    const result = await analyzePrevrandaoFlowFile(
      "src/Gate.sol",
      authorizationSource(expression)
    );

    expect(result.status).toBe("analyzed");
    expect(result.records).toHaveLength(1);
    expect(result.records[0]).toMatchObject({
      sinkKind: "authorization",
      shellOwner: "wallet-compatibility"
    });
  });

  it("routes the reviewed eligibility corpus comparison", async () => {
    const source = AUTHORIZATION_TEMPLATE.replace(
      "function eligible(uint256 threshold)",
      "function eligible(address account)"
    ).replace(
      "AUTHORIZATION_EXPRESSION",
      "uint160(account) % 2 == block.prevrandao % 2"
    );
    const result = await analyzePrevrandaoFlowFile("src/Gate.sol", source);

    expect(result.records).toHaveLength(1);
    expect(result.records[0]).toMatchObject({
      sourceOffset: source.indexOf("block.prevrandao"),
      sinkKind: "authorization",
      sinkOffset: source.indexOf("uint160(account)"),
      shellOwner: "wallet-compatibility"
    });
  });

  it.each([
    ["direct zero equality", "block.prevrandao == 0"],
    ["symmetric direct zero equality", "0 == block.prevrandao"],
    ["cast zero equality", "uint256(block.prevrandao) == 0"],
    ["zero modulo", "block.prevrandao % 0 < threshold"],
    ["hex zero modulo", "block.prevrandao % 0x0 < threshold"],
    ["fractional modulo", "block.prevrandao % 1.5 < threshold"],
    ["exponent modulo", "block.prevrandao % 1e2 < threshold"],
    ["fractional comparison", "block.prevrandao < 0.1"],
    ["exponent comparison", "block.prevrandao == 1e-10000"],
    ["long-decimal comparison", `block.prevrandao == 0.${"0".repeat(400)}1`],
    ["unbound comparison identifier", "block.prevrandao < missing"],
    ["transformed source", "(block.prevrandao + 1) < threshold"],
    ["source on both sides", "block.prevrandao < uint256(block.prevrandao)"]
  ])("does not route %s as authorization", async (_label, expression) => {
    await expect(
      analyzePrevrandaoFlowFile("src/Gate.sol", authorizationSource(expression))
    ).resolves.toEqual({ status: "analyzed", records: [] });
  });

  it.each(
    ["00", "0_0", "0x0", "0x00", "0e0", "0.0"].flatMap((zero) => [
      [`direct source equals ${zero}`, `block.prevrandao == ${zero}`],
      [`${zero} equals direct source`, `${zero} == block.prevrandao`],
      [`cast source equals ${zero}`, `uint256(block.prevrandao) == ${zero}`]
    ])
  )(
    "keeps semantic zero form %s compatibility-safe",
    async (_label, expression) => {
      await expect(
        analyzePrevrandaoFlowFile(
          "src/Gate.sol",
          authorizationSource(expression)
        )
      ).resolves.toEqual({ status: "analyzed", records: [] });
    }
  );

  it.each([
    "helper()",
    "threshold + 1",
    "threshold > 0 ? threshold : 1",
    "thresholds[0]",
    "config.threshold"
  ])(
    "rejects unsupported authorization counterpart %s",
    async (counterpart) => {
      await expect(
        analyzePrevrandaoFlowFile(
          "src/Gate.sol",
          authorizationSource(`block.prevrandao < ${counterpart}`)
        )
      ).resolves.toEqual({ status: "analyzed", records: [] });
    }
  );

  it("rejects a runtime-invalid zero modulo authorization counterpart", async () => {
    const source = AUTHORIZATION_TEMPLATE.replace(
      "function eligible(uint256 threshold)",
      "function eligible(address account)"
    ).replace(
      "AUTHORIZATION_EXPRESSION",
      "uint160(account) % 0 == block.prevrandao % 2"
    );

    await expect(
      analyzePrevrandaoFlowFile("src/Gate.sol", source)
    ).resolves.toEqual({ status: "analyzed", records: [] });
  });

  it("rejects an unbound identifier in the reviewed modulo counterpart", async () => {
    const source = AUTHORIZATION_TEMPLATE.replace(
      "function eligible(uint256 threshold)",
      "function eligible(address user)"
    ).replace(
      "AUTHORIZATION_EXPRESSION",
      "uint160(account) % 2 == block.prevrandao % 2"
    );

    await expect(
      analyzePrevrandaoFlowFile("src/Gate.sol", source)
    ).resolves.toEqual({ status: "analyzed", records: [] });
  });

  it("does not borrow a shadowed authorization parameter declaration", async () => {
    const source = authorizationSource("block.prevrandao < threshold").replace(
      "contract Gate {",
      "contract Gate { uint256 threshold;"
    );

    await expect(
      analyzePrevrandaoFlowFile("src/Gate.sol", source)
    ).resolves.toEqual({ status: "analyzed", records: [] });
  });

  it.each(["string memory", "address"])(
    "rejects an authorization counterpart declared as %s",
    async (type) => {
      const source = authorizationSource(
        "block.prevrandao < threshold"
      ).replace("uint256 threshold", `${type} threshold`);

      await expect(
        analyzePrevrandaoFlowFile("src/Gate.sol", source)
      ).resolves.toEqual({ status: "analyzed", records: [] });
    }
  );

  it("rejects a uint256-overflow authorization literal", async () => {
    const overflow = (1n << 256n).toString();

    await expect(
      analyzePrevrandaoFlowFile(
        "src/Gate.sol",
        authorizationSource(`block.prevrandao < ${overflow}`)
      )
    ).resolves.toEqual({ status: "analyzed", records: [] });
  });

  it("rejects authorization when the function return type is not bool", async () => {
    const source = authorizationSource("block.prevrandao < threshold").replace(
      "returns (bool)",
      "returns (uint256)"
    );

    await expect(
      analyzePrevrandaoFlowFile("src/Gate.sol", source)
    ).resolves.toEqual({ status: "analyzed", records: [] });
  });

  it.each([
    [
      "source binding",
      "uint256 seed = block.prevrandao; return seed < threshold;"
    ],
    [
      "source-derived counterpart on the right",
      "uint256 seed = block.prevrandao; return block.prevrandao < seed;"
    ],
    [
      "source-derived counterpart on the left",
      "uint256 seed = block.prevrandao; return seed > block.prevrandao;"
    ],
    [
      "assembly binding",
      "uint256 seed; assembly { seed := prevrandao() } return seed < threshold;"
    ],
    ["require context", "require(block.prevrandao < threshold); return true;"],
    [
      "nested return",
      "if (threshold > 0) { return block.prevrandao < threshold; } return false;"
    ]
  ])("keeps %s outside authorization grammar", async (_label, body) => {
    const source = AUTHORIZATION_TEMPLATE.replace(
      "return AUTHORIZATION_EXPRESSION;",
      body
    );

    await expect(
      analyzePrevrandaoFlowFile("src/Gate.sol", source)
    ).resolves.toEqual({ status: "analyzed", records: [] });
  });

  it("routes authorization by exact bridge function identity", async () => {
    const source = authorizationSource("block.prevrandao < threshold").replace(
      "eligible",
      "authorizeValidator"
    );
    const result = await analyzePrevrandaoFlowFile("src/Gate.sol", source);

    expect(result.records).toHaveLength(1);
    expect(result.records[0]?.shellOwner).toBe("bridge-relay");
  });

  it("fails closed for ambiguous authorization function ownership", async () => {
    const source = authorizationSource("block.prevrandao < threshold").replace(
      "eligible",
      "eligibleValidator"
    );

    await expect(
      analyzePrevrandaoFlowFile("src/Gate.sol", source)
    ).resolves.toEqual({ status: "analyzed", records: [] });
  });

  it("uses an exact authorization entity identifier as owner evidence", async () => {
    const source = AUTHORIZATION_TEMPLATE.replace(
      "function eligible(uint256 threshold)",
      "function check(address validator)"
    ).replace(
      "AUTHORIZATION_EXPRESSION",
      "uint160(validator) % 2 == block.prevrandao % 2"
    );
    const result = await analyzePrevrandaoFlowFile("src/Gate.sol", source);

    expect(result.records).toHaveLength(1);
    expect(result.records[0]?.shellOwner).toBe("bridge-relay");
  });

  it("fails closed for ambiguous authorization entity ownership", async () => {
    const source = AUTHORIZATION_TEMPLATE.replace(
      "function eligible(uint256 threshold)",
      "function check(address validatorWinner)"
    ).replace(
      "AUTHORIZATION_EXPRESSION",
      "uint160(validatorWinner) % 2 == block.prevrandao % 2"
    );

    await expect(
      analyzePrevrandaoFlowFile("src/Gate.sol", source)
    ).resolves.toEqual({ status: "analyzed", records: [] });
  });

  it("fails closed when one function has conflicting sink routes", async () => {
    const source = `
pragma solidity ^0.8.24;
contract Mixed {
  address[] internal relayers;
  function decide(uint256 threshold) external view returns (bool) {
    address relay = relayers[block.prevrandao % relayers.length];
    relay;
    return block.prevrandao < threshold;
  }
}`;

    await expect(
      analyzePrevrandaoFlowFile("src/Mixed.sol", source)
    ).resolves.toEqual({ status: "analyzed", records: [] });
  });

  it("treats an ambiguous selection as conflict evidence beside authorization", async () => {
    const source = `
pragma solidity ^0.8.24;
contract Mixed {
  address[] internal relayerWinners;
  function decide(uint256 threshold) external view returns (bool) {
    address winner = relayerWinners[block.prevrandao % relayerWinners.length];
    winner;
    return block.prevrandao < threshold;
  }
}`;

    await expect(
      analyzePrevrandaoFlowFile("src/Mixed.sol", source)
    ).resolves.toEqual({ status: "analyzed", records: [] });
  });

  it.each([
    ["return", "block.prevrandao < threshold"],
    ["comparison", "block.prevrandao < threshold"],
    ["source-expression", "block.prevrandao < threshold"],
    ["other-operand", "block.prevrandao < threshold"],
    ["modulo", "block.prevrandao % 2 < threshold"],
    ["modulus", "block.prevrandao % 2 < threshold"],
    ["cast", "uint256(block.prevrandao) < threshold"],
    ["cast-source", "uint256(block.prevrandao) < threshold"],
    ["function-body", "block.prevrandao < threshold"]
  ] as const)(
    "fails closed when authorization %s range evidence is missing",
    async (target, expression) => {
      const source = authorizationSource(expression);
      const parser = parserRemovingAuthorizationRange(target);
      const result = await analyzePrevrandaoFlowFile(
        "src/Gate.sol",
        source,
        async () => parser
      );

      expect(result.records).toEqual([]);
    }
  );

  it("fails closed when nested non-source operand range evidence is missing", async () => {
    const source = authorizationSource("block.prevrandao < uint256(threshold)");
    const parser = parserRemovingAuthorizationRange("nested-other");

    await expect(
      analyzePrevrandaoFlowFile("src/Gate.sol", source, async () => parser)
    ).resolves.toEqual({ status: "analyzed", records: [] });
  });

  it("fails closed for a fully ranged unknown authorization operand", async () => {
    const parser = parserWrappingAuthorizationOperand();

    await expect(
      analyzePrevrandaoFlowFile(
        "src/Gate.sol",
        authorizationSource("block.prevrandao < threshold"),
        async () => parser
      )
    ).resolves.toEqual({ status: "analyzed", records: [] });
  });

  it.each([
    ["inverted comparison", [200, 100]],
    ["negative comparison", [-1, 100]],
    ["out-of-bounds comparison", [0, Number.MAX_SAFE_INTEGER]],
    ["comparison outside its return", [0, 20]]
  ] as const)("fails closed for %s range evidence", async (_label, range) => {
    const source = authorizationSource("block.prevrandao < threshold");
    const parser = parserReplacingAuthorizationRange("comparison", range);

    await expect(
      analyzePrevrandaoFlowFile("src/Gate.sol", source, async () => parser)
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

function authorizationSource(expression: string): string {
  return AUTHORIZATION_TEMPLATE.replace("AUTHORIZATION_EXPRESSION", expression);
}

function orderingSource(expression: string): string {
  return ORDERING_TEMPLATE.replace("ORDERING_EXPRESSION", expression);
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

type RangeEvidenceTarget =
  | "selection"
  | "collection-base"
  | "modulo"
  | "dependency"
  | "length-member"
  | "length-collection"
  | "selection-index"
  | "index-declaration";

type AuthorizationRangeTarget =
  | "function-body"
  | "return"
  | "comparison"
  | "source-expression"
  | "other-operand"
  | "modulo"
  | "modulus"
  | "cast"
  | "cast-source"
  | "nested-other";

type MutableAstNode = Record<string, unknown> & {
  type: string;
  range?: unknown;
};

function parserRemovingSelectionRange(target: RangeEvidenceTarget): {
  parse(source: string, options: Record<string, unknown>): unknown;
} {
  return {
    parse(source, options) {
      const ast = parserModule.parse(source, options) as MutableAstNode;
      const selection = findAstNode(ast, (node) => node.type === "IndexAccess");
      const base = astNode(selection?.base);
      const index = astNode(selection?.index);
      const declaration = findAstNode(
        ast,
        (node) =>
          node.type === "VariableDeclarationStatement" &&
          astNode(node.initialValue)?.type === "BinaryOperation"
      );
      const modulo =
        index?.type === "BinaryOperation"
          ? index
          : astNode(declaration?.initialValue);
      const dependency = astNode(modulo?.left);
      const length = astNode(modulo?.right);
      const lengthCollection = astNode(length?.expression);
      const declarationVariable = Array.isArray(declaration?.variables)
        ? astNode(declaration.variables[0])
        : undefined;
      const evidence: Record<RangeEvidenceTarget, MutableAstNode | undefined> =
        {
          selection,
          "collection-base": base,
          modulo,
          dependency,
          "length-member": length,
          "length-collection": lengthCollection,
          "selection-index": index,
          "index-declaration": declarationVariable
        };
      const node = evidence[target];
      if (node === undefined) {
        throw new Error(`Missing test AST evidence for ${target}`);
      }
      delete node.range;
      return ast;
    }
  };
}

function parserReplacingSelectionRange(range: readonly [number, number]): {
  parse(source: string, options: Record<string, unknown>): unknown;
} {
  return {
    parse(source, options) {
      const ast = parserModule.parse(source, options) as MutableAstNode;
      const selection = findAstNode(ast, (node) => node.type === "IndexAccess");
      if (selection === undefined)
        throw new Error("Missing selection AST evidence");
      selection.range = [...range];
      return ast;
    }
  };
}

function parserRemovingOrderingRange(
  target: "return" | "keccak" | "encoding" | "source"
): {
  parse(source: string, options: Record<string, unknown>): unknown;
} {
  return {
    parse(source, options) {
      const ast = parserModule.parse(source, options) as MutableAstNode;
      const returnNode = findAstNode(
        ast,
        (node) => node.type === "ReturnStatement"
      );
      const keccak = findAstNode(
        ast,
        (node) =>
          node.type === "FunctionCall" &&
          astNode(node.expression)?.type === "Identifier" &&
          astNode(node.expression)?.name === "keccak256"
      );
      const encoding = findAstNode(
        ast,
        (node) =>
          node.type === "FunctionCall" &&
          astNode(node.expression)?.type === "MemberAccess" &&
          astNode(node.expression)?.memberName === "encode"
      );
      const sourceNode = findAstNode(
        ast,
        (node) =>
          node.type === "MemberAccess" && node.memberName === "prevrandao"
      );
      const evidence = {
        return: returnNode,
        keccak,
        encoding,
        source: sourceNode
      };
      const node = evidence[target];
      if (node === undefined)
        throw new Error(`Missing ordering AST evidence for ${target}`);
      delete node.range;
      return ast;
    }
  };
}

function parserRemovingAuthorizationRange(target: AuthorizationRangeTarget): {
  parse(source: string, options: Record<string, unknown>): unknown;
} {
  return {
    parse(source, options) {
      const ast = parserModule.parse(source, options) as MutableAstNode;
      const functionNode = findAstNode(
        ast,
        (node) => node.type === "FunctionDefinition"
      );
      const functionBody = astNode(functionNode?.body);
      const returnNode = findAstNode(
        ast,
        (node) => node.type === "ReturnStatement"
      );
      const comparison = astNode(returnNode?.expression);
      const left = astNode(comparison?.left);
      const right = astNode(comparison?.right);
      const sourceExpression =
        left !== undefined && containsPrevrandaoNode(left) ? left : right;
      const otherOperand = sourceExpression === left ? right : left;
      const modulo =
        sourceExpression?.type === "BinaryOperation"
          ? sourceExpression
          : undefined;
      const cast =
        sourceExpression?.type === "FunctionCall"
          ? sourceExpression
          : undefined;
      const rawSource =
        sourceExpression === undefined
          ? undefined
          : findAstNode(
              sourceExpression,
              (node) =>
                node.type === "MemberAccess" && node.memberName === "prevrandao"
            );
      const nestedOther =
        otherOperand === undefined
          ? undefined
          : findAstNode(
              otherOperand,
              (node) =>
                node !== otherOperand &&
                (node.type === "Identifier" || node.type === "FunctionCall")
            );
      const evidence: Record<
        AuthorizationRangeTarget,
        MutableAstNode | undefined
      > = {
        "function-body": functionBody,
        return: returnNode,
        comparison,
        "source-expression": sourceExpression,
        "other-operand": otherOperand,
        modulo,
        modulus: astNode(modulo?.right),
        cast,
        "cast-source": rawSource,
        "nested-other": nestedOther
      };
      const node = evidence[target];
      if (node === undefined) {
        throw new Error(`Missing authorization AST evidence for ${target}`);
      }
      delete node.range;
      return ast;
    }
  };
}

function parserRemovingDeclarationRange(name: string): {
  parse(source: string, options: Record<string, unknown>): unknown;
} {
  return {
    parse(source, options) {
      const ast = parserModule.parse(source, options) as MutableAstNode;
      const declaration = findAstNode(
        ast,
        (node) => node.type === "VariableDeclaration" && node.name === name
      );
      if (declaration === undefined) {
        throw new Error(`Missing declaration AST evidence for ${name}`);
      }
      delete declaration.range;
      return ast;
    }
  };
}

function parserDeletingAstField(
  type: string,
  field: string
): {
  parse(source: string, options: Record<string, unknown>): unknown;
} {
  return {
    parse(source, options) {
      const ast = parserModule.parse(source, options) as MutableAstNode;
      const node = findAstNode(ast, (candidate) => candidate.type === type);
      if (node === undefined) {
        throw new Error(`Missing ${type} AST evidence`);
      }
      delete node[field];
      return ast;
    }
  };
}

function parserReplacingReturnName(value: unknown): {
  parse(source: string, options: Record<string, unknown>): unknown;
} {
  return {
    parse(source, options) {
      const ast = parserModule.parse(source, options) as MutableAstNode;
      const functionNode = findAstNode(
        ast,
        (candidate) => candidate.type === "FunctionDefinition"
      );
      const returnParameter = Array.isArray(functionNode?.returnParameters)
        ? astNode(functionNode.returnParameters[0])
        : undefined;
      if (returnParameter === undefined) {
        throw new Error("Missing return parameter AST evidence");
      }
      returnParameter.name = value;
      return ast;
    }
  };
}

function parserReplacingAuthorizationRange(
  target: "comparison",
  range: readonly [number, number]
): {
  parse(source: string, options: Record<string, unknown>): unknown;
} {
  return {
    parse(source, options) {
      const ast = parserModule.parse(source, options) as MutableAstNode;
      const returnNode = findAstNode(
        ast,
        (node) => node.type === "ReturnStatement"
      );
      const comparison = astNode(returnNode?.expression);
      if (target !== "comparison" || comparison === undefined) {
        throw new Error(`Missing authorization AST evidence for ${target}`);
      }
      comparison.range = [...range];
      return ast;
    }
  };
}

function parserWrappingAuthorizationOperand(): {
  parse(source: string, options: Record<string, unknown>): unknown;
} {
  return {
    parse(source, options) {
      const ast = parserModule.parse(source, options) as MutableAstNode;
      const returnNode = findAstNode(
        ast,
        (node) => node.type === "ReturnStatement"
      );
      const comparison = astNode(returnNode?.expression);
      const operand = astNode(comparison?.right);
      if (comparison === undefined || operand === undefined) {
        throw new Error("Missing authorization operand test evidence");
      }
      comparison.right = {
        type: "MysteryExpression",
        range: operand.range,
        expression: operand
      } satisfies MutableAstNode;
      return ast;
    }
  };
}

function containsPrevrandaoNode(root: MutableAstNode): boolean {
  return (
    findAstNode(
      root,
      (node) => node.type === "MemberAccess" && node.memberName === "prevrandao"
    ) !== undefined
  );
}

function findAstNode(
  root: MutableAstNode,
  predicate: (node: MutableAstNode) => boolean
): MutableAstNode | undefined {
  if (predicate(root)) return root;
  for (const value of Object.values(root)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        const child = astNode(item);
        if (child === undefined) continue;
        const found = findAstNode(child, predicate);
        if (found !== undefined) return found;
      }
      continue;
    }
    const child = astNode(value);
    if (child === undefined) continue;
    const found = findAstNode(child, predicate);
    if (found !== undefined) return found;
  }
  return undefined;
}

function astNode(value: unknown): MutableAstNode | undefined {
  return typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    typeof (value as { type?: unknown }).type === "string"
    ? (value as MutableAstNode)
    : undefined;
}
