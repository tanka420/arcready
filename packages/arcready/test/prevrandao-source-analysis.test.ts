import { describe, expect, it, vi } from "vitest";
import {
  analyzePrevrandaoSourceFile,
  supportsPrevrandaoSourcePath
} from "../rules/shared/prevrandao-analysis.js";

describe("private prevrandao source analysis", () => {
  it("gates unsupported paths before loading the parser", async () => {
    const loader = vi.fn(async () => {
      throw new Error("must remain lazy");
    });

    await expect(
      analyzePrevrandaoSourceFile("src/client.ts", "block.prevrandao", loader)
    ).resolves.toEqual({ status: "unsupported-file", sources: [] });
    await expect(
      analyzePrevrandaoSourceFile(
        "vendor/Dependency.sol",
        "contract C {}",
        loader
      )
    ).resolves.toEqual({ status: "unsupported-file", sources: [] });
    expect(loader).not.toHaveBeenCalled();
  });

  it("accepts production Solidity paths only", () => {
    expect(supportsPrevrandaoSourcePath("src/Selector.sol")).toBe(true);
    expect(supportsPrevrandaoSourcePath("src\\Selector.sol")).toBe(true);
    expect(supportsPrevrandaoSourcePath("test/Selector.sol")).toBe(false);
    expect(supportsPrevrandaoSourcePath("src/Selector.test.sol")).toBe(false);
    expect(supportsPrevrandaoSourcePath("broadcast/Run.sol")).toBe(false);
  });

  it("records exact direct, cast, and one-binding sources with exact owners", async () => {
    const source = `
contract First {
  function direct() external view returns (uint256) {
    return block.prevrandao;
  }

  function bound() external view returns (uint256) {
    uint256 seed = uint256(block.prevrandao);
    return seed;
  }
}

contract Second {
  function own() external view returns (bytes32) {
    return bytes32(block.prevrandao);
  }
}`;

    const result = await analyzePrevrandaoSourceFile(
      "src/Selector.sol",
      source
    );

    expect(result.status).toBe("analyzed");
    expect(result.sources).toEqual([
      expect.objectContaining({
        contractName: "First",
        functionName: "direct",
        sourceKind: "block-prevrandao",
        bindingKind: "direct"
      }),
      expect.objectContaining({
        contractName: "First",
        functionName: "bound",
        sourceKind: "block-prevrandao-cast",
        bindingKind: "single-assignment",
        bindingName: "seed"
      }),
      expect.objectContaining({
        contractName: "Second",
        functionName: "own",
        sourceKind: "block-prevrandao-cast",
        bindingKind: "direct"
      })
    ]);
    expect(result.sources.map((item) => item.sourceOffset)).toEqual(
      [...result.sources.map((item) => item.sourceOffset)].sort((a, b) => a - b)
    );
  });

  it("records only an exact inline assembly assignment to one prior local", async () => {
    const source = `
contract Selector {
  function choose() external view returns (uint256) {
    uint256 seed;
    assembly { seed := prevrandao() }
    return seed;
  }
}`;

    await expect(
      analyzePrevrandaoSourceFile("src/Selector.sol", source)
    ).resolves.toEqual({
      status: "analyzed",
      sources: [
        expect.objectContaining({
          contractName: "Selector",
          functionName: "choose",
          sourceKind: "inline-assembly-prevrandao",
          bindingKind: "single-assignment",
          bindingName: "seed"
        })
      ]
    });
  });

  it("does not treat comments, strings, difficulty, or abstract contracts as sources", async () => {
    const source = `
abstract contract AbstractSelector {
  function source() external view returns (uint256) { return block.prevrandao; }
}
contract Safe {
  string constant TEXT = "block.prevrandao";
  // block.prevrandao
  function observe() external view returns (uint256) { return block.difficulty; }
}`;

    await expect(
      analyzePrevrandaoSourceFile("src/Safe.sol", source)
    ).resolves.toEqual({ status: "analyzed", sources: [] });
  });

  it("fails closed for malformed Solidity and unavailable parser modules", async () => {
    await expect(
      analyzePrevrandaoSourceFile("src/Broken.sol", "contract Broken {")
    ).resolves.toEqual({ status: "malformed", sources: [] });
    await expect(
      analyzePrevrandaoSourceFile(
        "src/Selector.sol",
        "contract Selector {}",
        async () => ({})
      )
    ).resolves.toEqual({ status: "parser-unavailable", sources: [] });
  });

  it("fails closed for missing source ranges", async () => {
    const missingRangeParser = {
      parse: () => ({
        type: "SourceUnit",
        range: [0, 20],
        children: [
          {
            type: "MysteryNode",
            range: [0, 20],
            child: {
              type: "MemberAccess",
              memberName: "prevrandao",
              expression: { type: "Identifier", name: "block", range: [0, 4] }
            }
          }
        ]
      })
    };

    await expect(
      analyzePrevrandaoSourceFile(
        "src/Selector.sol",
        "ignored",
        async () => missingRangeParser
      )
    ).resolves.toEqual({ status: "unsupported-source", sources: [] });
  });

  it("fails closed for fully ranged unknown source-bearing AST wrappers", async () => {
    const unknownWrapperParser = {
      parse: () => ({
        type: "SourceUnit",
        range: [0, 100],
        children: [
          {
            type: "ContractDefinition",
            kind: "contract",
            isAbstract: false,
            name: "Selector",
            range: [0, 100],
            subNodes: [
              {
                type: "FunctionDefinition",
                name: "choose",
                range: [20, 90],
                body: {
                  type: "Block",
                  range: [40, 90],
                  statements: [
                    {
                      type: "MysteryExpression",
                      range: [50, 70],
                      child: {
                        type: "MemberAccess",
                        memberName: "prevrandao",
                        range: [51, 68],
                        expression: {
                          type: "Identifier",
                          name: "block",
                          range: [51, 55]
                        }
                      }
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
      analyzePrevrandaoSourceFile(
        "src/Selector.sol",
        "ignored",
        async () => unknownWrapperParser
      )
    ).resolves.toEqual({ status: "unsupported-source", sources: [] });
  });

  it.each(["|=", "&=", "^=", "<<=", ">>="])(
    "fails closed when a source binding is later mutated with %s",
    async (operator) => {
      const source = `
contract Selector {
  function choose() external view returns (uint256) {
    uint256 seed = block.prevrandao;
    seed ${operator} 1;
    return seed;
  }
}`;

      await expect(
        analyzePrevrandaoSourceFile("src/Selector.sol", source)
      ).resolves.toEqual({ status: "unsupported-source", sources: [] });
    }
  );

  it("fails closed for tuple and assembly writes to a source binding", async () => {
    const sources = [
      `
contract Selector {
  function choose() external view returns (uint256) {
    uint256 seed = block.prevrandao;
    (seed,) = pair();
    return seed;
  }
}`,
      `
contract Selector {
  function choose() external view returns (uint256) {
    uint256 seed = block.prevrandao;
    assembly { seed := 1 }
    return seed;
  }
}`
    ];

    for (const source of sources) {
      await expect(
        analyzePrevrandaoSourceFile("src/Selector.sol", source)
      ).resolves.toEqual({ status: "unsupported-source", sources: [] });
    }
  });

  it("fails closed when a source binding is not function-body scoped", async () => {
    const source = `
contract Selector {
  function choose() external view returns (uint256) {
    {
      uint256 seed = block.prevrandao;
    }
    assembly { seed := 1 }
    return 0;
  }
}`;

    await expect(
      analyzePrevrandaoSourceFile("src/Selector.sol", source)
    ).resolves.toEqual({ status: "unsupported-source", sources: [] });
  });

  it.each([
    "0.8.24",
    "^0.8.24",
    "~0.8.24",
    ">=0.8.18 <0.9.0",
    ">=0.8.18 <=0.8.30"
  ])("accepts the closed Solidity pragma %s", async (pragma) => {
    const source = `pragma solidity ${pragma};
contract Selector {
  function choose() external view returns (uint256) {
    return block.prevrandao;
  }
}`;

    await expect(
      analyzePrevrandaoSourceFile("src/Selector.sol", source)
    ).resolves.toEqual({
      status: "analyzed",
      sources: [expect.objectContaining({ functionName: "choose" })]
    });
  });

  it.each([">=0.8.24", "^0.8.24 || ^0.9.0", "^0.9.0"])(
    "fails closed for the open or future Solidity pragma %s",
    async (pragma) => {
      const source = `pragma solidity ${pragma};
contract Selector {
  function choose() external view returns (uint256) {
    return block.prevrandao;
  }
}`;

      await expect(
        analyzePrevrandaoSourceFile("src/Selector.sol", source)
      ).resolves.toEqual({ status: "unsupported-source", sources: [] });
    }
  );

  it("fails closed for unsupported assembly shapes", async () => {
    const source = `
contract Selector {
  function choose() external view returns (uint256 seed) {
    assembly {
      function nested() -> value { value := prevrandao() }
      seed := nested()
    }
  }
}`;

    await expect(
      analyzePrevrandaoSourceFile("src/Selector.sol", source)
    ).resolves.toEqual({ status: "unsupported-source", sources: [] });
  });
});
