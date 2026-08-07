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

const AUTHORIZATION_TEMPLATE = `
pragma solidity ^0.8.24;
contract Gate {
  function eligible(uint256 threshold) external view returns (bool) {
    return AUTHORIZATION_EXPRESSION;
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
    ).resolves.toEqual({ status: "analyzed", records: [] });
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
    ["non-zero exponent equality", "block.prevrandao == 1e-10000"],
    [
      "non-zero long-decimal equality",
      `block.prevrandao == 0.${"0".repeat(400)}1`
    ],
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

  it("routes authorization to wallet even when function identifiers are bridge-like", async () => {
    const source = authorizationSource("block.prevrandao < threshold").replace(
      "eligible",
      "authorizeValidator"
    );
    const result = await analyzePrevrandaoFlowFile("src/Gate.sol", source);

    expect(result.records).toHaveLength(1);
    expect(result.records[0]?.shellOwner).toBe("wallet-compatibility");
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
