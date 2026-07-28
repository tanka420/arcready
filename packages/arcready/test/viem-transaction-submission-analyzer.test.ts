import ts from "typescript";
import type { Identifier, Node, SourceFile } from "typescript";
import { describe, expect, it } from "vitest";
import {
  buildViemLexicalIndex,
  isViemBindingSafeBefore,
  resolveDirectOrOneConstExpression,
  resolveDirectOrOneConstImport,
  resolveExactViemImport,
  resolveViemBinding
} from "../rules/wallet/viem-transaction-submission-lexical.js";
import type {
  ViemImportIdentity,
  ViemLexicalIndex
} from "../rules/wallet/viem-transaction-submission-lexical.js";
import {
  analyzeViemTransactionSubmissionFile,
  supportsViemTransactionSubmissionPath
} from "../rules/wallet/viem-transaction-submission-analyzer.js";

function parse(source: string): {
  readonly sourceFile: SourceFile;
  readonly index: ViemLexicalIndex;
} {
  const sourceFile = ts.createSourceFile(
    "src/submit.ts",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );
  return { sourceFile, index: buildViemLexicalIndex(ts, sourceFile) };
}

function identifiers(sourceFile: SourceFile, name: string): Identifier[] {
  const matches: Identifier[] = [];
  const visit = (node: Node): void => {
    if (ts.isIdentifier(node) && node.text === name) matches.push(node);
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return matches;
}

function lastIdentifier(sourceFile: SourceFile, name: string): Identifier {
  const identifier = identifiers(sourceFile, name).at(-1);
  if (identifier === undefined) throw new Error(`missing ${name}`);
  return identifier;
}

function exactImport(
  source: string,
  name: string,
  identity: ViemImportIdentity
) {
  const { sourceFile, index } = parse(source);
  return resolveExactViemImport(
    index,
    lastIdentifier(sourceFile, name),
    identity
  );
}

async function analyze(
  source: string,
  compilerLoader?: () => Promise<unknown>,
  filePath = "src/submit.ts"
) {
  return analyzeViemTransactionSubmissionFile(
    filePath,
    source,
    compilerLoader
  );
}

describe("viem analyzer compiler and status boundary", () => {
  it.each([
    ["src/submit.ts", true],
    ["src/submit.js", true],
    ["src/submit.tsx", false],
    ["src/submit.d.ts", false],
    ["src/submit.test.ts", false],
    ["src/submit.spec.js", false],
    ["src/submit.generated.ts", false],
    ["tests/submit.ts", false],
    ["src/generated/submit.ts", false],
    ["src/dist/submit.js", false]
  ] as const)("classifies path %s", (filePath, expected) => {
    expect(supportsViemTransactionSubmissionPath(filePath)).toBe(expected);
  });

  it("returns unsupported-file before loading TypeScript", async () => {
    let loaded = false;
    const result = await analyze(
      "const value = 1;",
      async () => {
        loaded = true;
        return ts;
      },
      "tests/submit.ts"
    );
    expect(result).toEqual({ status: "unsupported-file", submissions: [] });
    expect(loaded).toBe(false);
  });

  it("accepts direct and default-wrapped compiler modules", async () => {
    const direct = await analyze("const value = 1;", async () => ts);
    const wrapped = await analyze("const value = 1;", async () => ({
      default: ts
    }));
    expect(direct).toEqual({ status: "analyzed", submissions: [] });
    expect(wrapped).toEqual(direct);
  });

  it.each([
    ["loader throw", async () => Promise.reject(new Error("missing"))],
    ["empty object", async () => ({})],
    ["missing function", async () => ({ ...ts, isForStatement: undefined })],
    ["missing ScriptKind", async () => ({ ...ts, ScriptKind: undefined })],
    [
      "missing NodeFlags member",
      async () => ({
        ...ts,
        NodeFlags: { ...ts.NodeFlags, Const: undefined }
      })
    ],
    [
      "invalid source-file result",
      async () => ({
        ...ts,
        createSourceFile: () => ({ isDeclarationFile: false })
      })
    ]
  ] as const)("fails closed for %s", async (label, loader) => {
    void label;
    expect(await analyze("const value = 1;", loader)).toEqual({
      status: "compiler-unavailable",
      submissions: []
    });
  });

  it("converts compiler execution failures into compiler-unavailable", async () => {
    const result = await analyze("const value = 1;", async () => ({
      ...ts,
      createSourceFile: () => {
        throw new Error("compiler failed");
      }
    }));
    expect(result).toEqual({
      status: "compiler-unavailable",
      submissions: []
    });
  });

  it("returns malformed for parse diagnostics", async () => {
    expect(await analyze("const =")).toEqual({
      status: "malformed",
      submissions: []
    });
  });
});

describe("viem exact import provenance", () => {
  it("accepts exact named imports and direct aliases", () => {
    const source = `import { createWalletClient as makeClient, http as transport } from "viem";
import { arcTestnet as chain } from "viem/chains";
import { privateKeyToAccount as accountFromKey } from "viem/accounts";
makeClient;
transport;
chain;
accountFromKey;`;
    expect(
      exactImport(source, "makeClient", "viem:createWalletClient")?.kind
    ).toBe("import");
    expect(exactImport(source, "transport", "viem:http")?.kind).toBe(
      "import"
    );
    expect(
      exactImport(source, "chain", "viem/chains:arcTestnet")?.kind
    ).toBe("import");
    expect(
      exactImport(
        source,
        "accountFromKey",
        "viem/accounts:privateKeyToAccount"
      )?.kind
    ).toBe("import");
  });

  it.each([
    `import { createWalletClient } from "viem/client";
createWalletClient;`,
    `import type { createWalletClient } from "viem";
createWalletClient;`,
    `import { type createWalletClient } from "viem";
createWalletClient;`,
    `import * as createWalletClient from "viem";
createWalletClient;`,
    `import createWalletClient from "viem";
createWalletClient;`,
    `const createWalletClient = local;
createWalletClient;`
  ])("rejects unsupported provenance: %s", (source) => {
    expect(
      exactImport(source, "createWalletClient", "viem:createWalletClient")
    ).toBeUndefined();
  });

  it("tracks import reassignment by source order", () => {
    const before = `import { arcTestnet } from "viem/chains";
arcTestnet = replacement;
arcTestnet;`;
    expect(
      exactImport(before, "arcTestnet", "viem/chains:arcTestnet")
    ).toBeUndefined();

    const after = `import { arcTestnet } from "viem/chains";
arcTestnet;
arcTestnet = replacement;`;
    const { sourceFile, index } = parse(after);
    const use = identifiers(sourceFile, "arcTestnet")[1];
    expect(
      resolveExactViemImport(index, use, "viem/chains:arcTestnet")?.kind
    ).toBe("import");
  });
});

describe("viem lexical identity and one-binding budget", () => {
  it("resolves direct and one-const imported identities", () => {
    const source = `import { arcTestnet } from "viem/chains";
const chain = arcTestnet;
arcTestnet;
chain;`;
    const { sourceFile, index } = parse(source);
    const direct = identifiers(sourceFile, "arcTestnet")[2];
    const alias = lastIdentifier(sourceFile, "chain");
    expect(
      resolveDirectOrOneConstImport(
        index,
        direct,
        "viem/chains:arcTestnet"
      )
    ).toHaveLength(1);
    expect(
      resolveDirectOrOneConstImport(
        index,
        alias,
        "viem/chains:arcTestnet"
      )
    ).toHaveLength(2);
  });

  it("rejects depth two and non-const aliases", () => {
    const source = `import { arcTestnet } from "viem/chains";
const one = arcTestnet;
const two = one;
let mutable = arcTestnet;
two;
mutable;`;
    const { sourceFile, index } = parse(source);
    expect(
      resolveDirectOrOneConstImport(
        index,
        lastIdentifier(sourceFile, "two"),
        "viem/chains:arcTestnet"
      )
    ).toBeNull();
    expect(
      resolveDirectOrOneConstImport(
        index,
        lastIdentifier(sourceFile, "mutable"),
        "viem/chains:arcTestnet"
      )
    ).toBeNull();
  });

  it("invalidates alias or imported identity written before use", () => {
    for (const source of [
      `import { arcTestnet } from "viem/chains";
const chain = arcTestnet;
chain = replacement;
chain;`,
      `import { arcTestnet } from "viem/chains";
const chain = arcTestnet;
arcTestnet = replacement;
chain;`
    ]) {
      const { sourceFile, index } = parse(source);
      expect(
        resolveDirectOrOneConstImport(
          index,
          lastIdentifier(sourceFile, "chain"),
          "viem/chains:arcTestnet"
        )
      ).toBeNull();
    }
  });

  it("keeps writes after the use unrelated", () => {
    const source = `import { arcTestnet } from "viem/chains";
const chain = arcTestnet;
chain;
chain = replacement;
arcTestnet = replacement;`;
    const { sourceFile, index } = parse(source);
    const use = identifiers(sourceFile, "chain")[1];
    expect(
      resolveDirectOrOneConstImport(
        index,
        use,
        "viem/chains:arcTestnet"
      )
    ).toHaveLength(2);
  });

  it("resolves direct expressions and one initialized const only", () => {
    const source = `const request = { type: "eip4844" };
const one = request;
request;
one;
({ type: "eip4844" });`;
    const { sourceFile, index } = parse(source);
    const request = identifiers(sourceFile, "request")[2];
    const one = lastIdentifier(sourceFile, "one");
    expect(resolveDirectOrOneConstExpression(index, request)?.depth).toBe(1);
    expect(resolveDirectOrOneConstExpression(index, one)).toBeNull();

    const statement = sourceFile.statements.at(-1);
    if (statement === undefined || !ts.isExpressionStatement(statement)) {
      throw new Error("missing expression statement");
    }
    expect(
      resolveDirectOrOneConstExpression(index, statement.expression)?.depth
    ).toBe(0);
  });

  it("does not expose a const binding inside its initializer", () => {
    const source = `const request = request;
request;`;
    const { sourceFile, index } = parse(source);
    const uses = identifiers(sourceFile, "request");
    expect(resolveViemBinding(index, uses[1])).toBeNull();
    expect(resolveDirectOrOneConstExpression(index, uses[2])).toBeNull();
  });
});

describe("viem lexical scopes and shadowing", () => {
  it("keeps parameter and block shadows separate from the import", () => {
    const source = `import { arcTestnet } from "viem/chains";
function submit(arcTestnet) {
  arcTestnet;
}
{
  const arcTestnet = local;
  arcTestnet;
}
arcTestnet;`;
    const { sourceFile, index } = parse(source);
    const uses = identifiers(sourceFile, "arcTestnet");
    expect(resolveViemBinding(index, uses[2])?.kind).toBe("other");
    expect(resolveViemBinding(index, uses[4])?.kind).toBe("const");
    expect(
      resolveExactViemImport(
        index,
        uses.at(-1)!,
        "viem/chains:arcTestnet"
      )?.kind
    ).toBe("import");
  });

  it("fails closed for a later declaration in the same scope", () => {
    const source = `import { arcTestnet } from "viem/chains";
{
  arcTestnet;
  const arcTestnet = local;
}`;
    const { sourceFile, index } = parse(source);
    expect(resolveViemBinding(index, identifiers(sourceFile, "arcTestnet")[1]))
      .toBeNull();
  });

  it("keeps for-loop bindings inside the loop scope", () => {
    const source = `import { createWalletClient } from "viem";
for (const createWalletClient of clients) {
  createWalletClient;
}
createWalletClient;`;
    const { sourceFile, index } = parse(source);
    const uses = identifiers(sourceFile, "createWalletClient");
    expect(resolveViemBinding(index, uses[2])?.kind).toBe("other");
    expect(
      resolveExactViemImport(
        index,
        uses.at(-1)!,
        "viem:createWalletClient"
      )?.kind
    ).toBe("import");
  });

  it("keeps a named class expression self-binding private", () => {
    const source = `import { arcTestnet } from "viem/chains";
const Holder = class arcTestnet {
  method() {
    arcTestnet;
  }
};
arcTestnet;`;
    const { sourceFile, index } = parse(source);
    const uses = identifiers(sourceFile, "arcTestnet");
    expect(resolveViemBinding(index, uses[2])?.kind).toBe("other");
    expect(
      resolveExactViemImport(
        index,
        uses.at(-1)!,
        "viem/chains:arcTestnet"
      )?.kind
    ).toBe("import");
  });

  it("treats duplicate same-scope bindings as ambiguous", () => {
    const source = `const chain = first;
const chain = second;
chain;`;
    const { sourceFile, index } = parse(source);
    expect(resolveViemBinding(index, lastIdentifier(sourceFile, "chain")))
      .toBeNull();
  });

  it("tracks destructuring writes against a protected binding", () => {
    const source = `import { arcTestnet } from "viem/chains";
const chain = arcTestnet;
({ chain } = replacement);
chain;`;
    const { sourceFile, index } = parse(source);
    const use = lastIdentifier(sourceFile, "chain");
    const binding = resolveViemBinding(index, use);
    expect(binding).not.toBeNull();
    expect(binding).toBeDefined();
    expect(isViemBindingSafeBefore(binding!, use.getStart(sourceFile))).toBe(
      false
    );
  });
});
