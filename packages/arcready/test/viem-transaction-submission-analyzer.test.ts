import ts from "typescript";
import type { Diagnostic, Identifier, Node, SourceFile } from "typescript";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
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
  ViemLexicalBinding,
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
  const diagnostics = (
    sourceFile as SourceFile & {
      readonly parseDiagnostics: readonly Diagnostic[];
    }
  ).parseDiagnostics;
  expect(diagnostics).toHaveLength(0);
  return { sourceFile, index: buildViemLexicalIndex(ts, sourceFile) };
}

function identifiers(sourceFile: SourceFile, name: string): Identifier[] {
  const result: Identifier[] = [];
  const visit = (node: Node): void => {
    if (ts.isIdentifier(node) && node.text === name) result.push(node);
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return result;
}

function lastIdentifier(sourceFile: SourceFile, name: string): Identifier {
  const result = identifiers(sourceFile, name).at(-1);
  if (result === undefined) throw new Error(`missing ${name}`);
  return result;
}

function exactImport(
  source: string,
  name: string,
  identity: ViemImportIdentity
): ViemLexicalBinding | null | undefined {
  const { sourceFile, index } = parse(source);
  return resolveExactViemImport(
    index,
    lastIdentifier(sourceFile, name),
    identity
  );
}

function bindingAtLastUse(
  source: string,
  name: string
): ViemLexicalBinding | null {
  const { sourceFile, index } = parse(source);
  return resolveViemBinding(index, lastIdentifier(sourceFile, name)) ?? null;
}

function expectWriteUnsafe(statement: string): void {
  const source = `import { arcTestnet } from "viem/chains";
const chain = arcTestnet;
${statement}
chain;`;
  const { sourceFile, index } = parse(source);
  const use = lastIdentifier(sourceFile, "chain");
  const binding = resolveViemBinding(index, use);
  expect(binding).not.toBeNull();
  expect(binding).toBeDefined();
  expect(binding?.writeOffsets.length).toBeGreaterThan(0);
  expect(isViemBindingSafeBefore(binding!, use.getStart(sourceFile))).toBe(
    false
  );
}

async function analyze(
  source: string,
  compilerLoader?: () => Promise<unknown>,
  filePath = "src/submit.ts"
) {
  return analyzeViemTransactionSubmissionFile(filePath, source, compilerLoader);
}

describe("viem compiler and status boundary", () => {
  it.each([
    ["src/submit.ts", true],
    ["src/submit.js", true],
    ["src/submit.tsx", false],
    ["src/submit.d.ts", false],
    ["src/submit.test.ts", false],
    ["src/submit.spec.js", false],
    ["src/submit.generated.ts", false],
    ["tests/submit.ts", false],
    ["src/__tests__/submit.ts", false],
    ["src/generated/submit.ts", false],
    ["src/dist/submit.js", false],
    ["src/build/submit.ts", false],
    ["src/coverage/submit.ts", false],
    ["src\\generated\\submit.ts", false]
  ] as const)("classifies %s", (filePath, expected) => {
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

  it("accepts the actual TypeScript compiler object", async () => {
    expect(await analyze("const value = 1;", async () => ts)).toEqual({
      status: "analyzed",
      submissions: []
    });
  });

  it("accepts a default-wrapped actual TypeScript compiler object", async () => {
    expect(
      await analyze("const value = 1;", async () => ({ default: ts }))
    ).toEqual({
      status: "analyzed",
      submissions: []
    });
  });

  it("rejects copied and proxy-wrapped compiler objects", async () => {
    expect(await analyze("const value = 1;", async () => ({ ...ts }))).toEqual({
      status: "compiler-unavailable",
      submissions: []
    });
    expect(
      await analyze("const value = 1;", async () => new Proxy(ts, {}))
    ).toEqual({
      status: "compiler-unavailable",
      submissions: []
    });
  });

  it("rejects a fully structural fake SourceFile from a copied compiler", async () => {
    let createCalled = false;
    const structuralSourceFile = {
      kind: ts.SyntaxKind.SourceFile,
      isDeclarationFile: false,
      parseDiagnostics: [],
      statements: [],
      fileName: "src/submit.ts",
      text: "const value = 1;",
      end: 16,
      getStart: () => 0
    };
    const copiedCompiler = {
      ...ts,
      createSourceFile: () => {
        createCalled = true;
        return structuralSourceFile;
      }
    };

    expect(
      await analyze("const value = 1;", async () => copiedCompiler)
    ).toEqual({
      status: "compiler-unavailable",
      submissions: []
    });
    expect(createCalled).toBe(false);
  });

  it.each([
    ["loader throw", async () => Promise.reject(new Error("missing"))],
    ["empty object", async () => ({})],
    ["missing function", async () => ({ ...ts, isForStatement: undefined })],
    ["missing wrapper", async () => ({ ...ts, isAsExpression: 1 })],
    ["missing ScriptKind", async () => ({ ...ts, ScriptKind: undefined })],
    [
      "missing NodeFlags",
      async () => ({ ...ts, NodeFlags: { ...ts.NodeFlags, Const: undefined } })
    ],
    [
      "invalid source object",
      async () => ({
        ...ts,
        createSourceFile: () => ({
          isDeclarationFile: false,
          parseDiagnostics: []
        })
      })
    ],
    [
      "spoofed source kind",
      async () => ({
        ...ts,
        createSourceFile: () => ({
          kind: ts.SyntaxKind.SourceFile,
          isDeclarationFile: false,
          parseDiagnostics: []
        })
      })
    ]
  ] as const)("fails closed for %s", async (label, loader) => {
    void label;
    expect(await analyze("const value = 1;", loader)).toEqual({
      status: "compiler-unavailable",
      submissions: []
    });
  });

  it("contains a hostile default getter inside the trust boundary", async () => {
    const hostileDefault = Object.defineProperty({}, "default", {
      get(): never {
        throw new Error("hostile default getter");
      }
    });
    expect(
      await analyze("const value = 1;", async () => hostileDefault)
    ).toEqual({
      status: "compiler-unavailable",
      submissions: []
    });
  });

  it.each([
    ["required function", "createSourceFile"],
    ["ScriptKind", "ScriptKind"],
    ["ScriptTarget", "ScriptTarget"],
    ["NodeFlags", "NodeFlags"],
    ["SyntaxKind", "SyntaxKind"],
    ["isSourceFile", "isSourceFile"]
  ] as const)(
    "rejects an untrusted compiler with a hostile %s getter before property access",
    async (_label, property) => {
      let accessed = false;
      const hostileCompiler = Object.defineProperty({}, property, {
        get(): never {
          accessed = true;
          throw new Error(`hostile ${property} getter`);
        }
      });
      expect(
        await analyze("const value = 1;", async () => hostileCompiler)
      ).toEqual({
        status: "compiler-unavailable",
        submissions: []
      });
      expect(accessed).toBe(false);
    }
  );

  it("returns malformed for parse diagnostics", async () => {
    expect(await analyze("const =")).toEqual({
      status: "malformed",
      submissions: []
    });
  });
});

describe("viem exact import provenance", () => {
  it("accepts exact named value imports and aliases", () => {
    const source = `import { createWalletClient as makeClient, http as transport } from "viem";
import { arcTestnet as chain } from "viem/chains";
import { privateKeyToAccount as accountFromKey } from "viem/accounts";
makeClient; transport; chain; accountFromKey;`;
    expect(
      exactImport(source, "makeClient", "viem:createWalletClient")?.kind
    ).toBe("import");
    expect(exactImport(source, "transport", "viem:http")?.kind).toBe("import");
    expect(exactImport(source, "chain", "viem/chains:arcTestnet")?.kind).toBe(
      "import"
    );
    expect(
      exactImport(source, "accountFromKey", "viem/accounts:privateKeyToAccount")
        ?.kind
    ).toBe("import");
  });

  it.each([
    `import { createWalletClient } from "viem/client"; createWalletClient;`,
    `import type { createWalletClient } from "viem"; createWalletClient;`,
    `import { type createWalletClient } from "viem"; createWalletClient;`,
    `import * as createWalletClient from "viem"; createWalletClient;`,
    `import createWalletClient from "viem"; createWalletClient;`,
    `import createWalletClient = require("viem"); createWalletClient;`,
    `const createWalletClient = local; createWalletClient;`
  ])("rejects unsupported provenance: %s", (source) => {
    expect(
      exactImport(source, "createWalletClient", "viem:createWalletClient")
    ).toBeUndefined();
  });

  it("rejects shadowed, duplicate, and reassigned imports", () => {
    expect(
      exactImport(
        `import { arcTestnet } from "viem/chains";
function submit(arcTestnet) { arcTestnet; }`,
        "arcTestnet",
        "viem/chains:arcTestnet"
      )
    ).toBeUndefined();
    expect(
      exactImport(
        `import { arcTestnet } from "viem/chains";
const arcTestnet = local; arcTestnet;`,
        "arcTestnet",
        "viem/chains:arcTestnet"
      )
    ).toBeNull();
    expect(
      exactImport(
        `import { arcTestnet } from "viem/chains";
arcTestnet = replacement; arcTestnet;`,
        "arcTestnet",
        "viem/chains:arcTestnet"
      )
    ).toBeUndefined();
  });

  it("keeps imported writes after use unrelated", () => {
    const { sourceFile, index } = parse(
      `import { arcTestnet } from "viem/chains";
arcTestnet; arcTestnet = replacement;`
    );
    const use = identifiers(sourceFile, "arcTestnet")[1];
    expect(
      resolveExactViemImport(index, use, "viem/chains:arcTestnet")?.kind
    ).toBe("import");
  });
});

describe("viem direct or one-const budget", () => {
  it("resolves direct and one-const imported identities", () => {
    const { sourceFile, index } = parse(
      `import { arcTestnet } from "viem/chains";
const chain = arcTestnet; arcTestnet; chain;`
    );
    expect(
      resolveDirectOrOneConstImport(
        index,
        identifiers(sourceFile, "arcTestnet")[2],
        "viem/chains:arcTestnet"
      )
    ).toHaveLength(1);
    expect(
      resolveDirectOrOneConstImport(
        index,
        lastIdentifier(sourceFile, "chain"),
        "viem/chains:arcTestnet"
      )
    ).toHaveLength(2);
  });

  it.each([
    [
      "depth two",
      `import { arcTestnet } from "viem/chains"; const one = arcTestnet; const target = one; target;`
    ],
    [
      "let alias",
      `import { arcTestnet } from "viem/chains"; let target = arcTestnet; target;`
    ],
    [
      "var alias",
      `import { arcTestnet } from "viem/chains"; var target = arcTestnet; target;`
    ],
    [
      "parameter",
      `import { arcTestnet } from "viem/chains"; function f(target = arcTestnet) { target; }`
    ],
    [
      "destructuring",
      `import { arcTestnet } from "viem/chains"; const { target } = { target: arcTestnet }; target;`
    ],
    [
      "missing initializer",
      `import { arcTestnet } from "viem/chains"; let target; target;`
    ],
    [
      "ambiguous",
      `import { arcTestnet } from "viem/chains"; const target = arcTestnet; const target = arcTestnet; target;`
    ]
  ] as const)("rejects %s", (label, source) => {
    void label;
    const { sourceFile, index } = parse(source);
    expect(
      resolveDirectOrOneConstImport(
        index,
        lastIdentifier(sourceFile, "target"),
        "viem/chains:arcTestnet"
      )
    ).toBeNull();
  });

  it("invalidates alias and source writes before use but not after use", () => {
    for (const source of [
      `import { arcTestnet } from "viem/chains"; const chain = arcTestnet; chain = replacement; chain;`,
      `import { arcTestnet } from "viem/chains"; const chain = arcTestnet; arcTestnet = replacement; chain;`
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
    const { sourceFile, index } = parse(
      `import { arcTestnet } from "viem/chains"; const chain = arcTestnet; chain; chain = replacement; arcTestnet = replacement;`
    );
    expect(
      resolveDirectOrOneConstImport(
        index,
        identifiers(sourceFile, "chain")[1],
        "viem/chains:arcTestnet"
      )
    ).toHaveLength(2);
  });

  it("resolves direct expressions and one initialized const", () => {
    const { sourceFile, index } = parse(
      `const request = { type: "eip4844" }; const one = request; request; one; ({ type: "eip4844" });`
    );
    expect(
      resolveDirectOrOneConstExpression(
        index,
        identifiers(sourceFile, "request")[2]
      )?.depth
    ).toBe(1);
    expect(
      resolveDirectOrOneConstExpression(
        index,
        lastIdentifier(sourceFile, "one")
      )
    ).toBeNull();
    const statement = sourceFile.statements.at(-1);
    if (statement === undefined || !ts.isExpressionStatement(statement))
      throw new Error("missing expression");
    expect(
      resolveDirectOrOneConstExpression(index, statement.expression)?.depth
    ).toBe(0);
  });

  it("fails closed inside a const initializer and falls back to outer scope", () => {
    const self = parse(`const request = request; request;`);
    const selfUses = identifiers(self.sourceFile, "request");
    expect(resolveViemBinding(self.index, selfUses[1])).toBeNull();
    expect(
      resolveDirectOrOneConstExpression(self.index, selfUses[2])
    ).toBeNull();

    const outer = parse(
      `const request = { type: "eip4844" }; function submit() { request; }`
    );
    expect(
      resolveDirectOrOneConstExpression(
        outer.index,
        lastIdentifier(outer.sourceFile, "request")
      )?.depth
    ).toBe(1);
  });
});

describe("viem lexical scope families", () => {
  it("keeps function, arrow, and parameter bindings scoped", () => {
    const source = `import { arcTestnet } from "viem/chains";
function declared(arcTestnet) { arcTestnet; }
const expressed = function ({ arcTestnet }) { arcTestnet; };
const arrow = (arcTestnet) => arcTestnet;
arcTestnet;`;
    const { sourceFile, index } = parse(source);
    const uses = identifiers(sourceFile, "arcTestnet");
    expect(resolveViemBinding(index, uses[2])?.kind).toBe("other");
    expect(resolveViemBinding(index, uses[4])?.kind).toBe("other");
    expect(resolveViemBinding(index, uses[6])?.kind).toBe("other");
    expect(resolveViemBinding(index, uses.at(-1)!)?.kind).toBe("import");
  });

  it("keeps named function and class expression self-bindings private", () => {
    const source = `import { arcTestnet } from "viem/chains";
const fn = function arcTestnet() { arcTestnet; };
const Holder = class arcTestnet { method() { arcTestnet; } };
arcTestnet;`;
    const { sourceFile, index } = parse(source);
    const uses = identifiers(sourceFile, "arcTestnet");
    expect(resolveViemBinding(index, uses[2])?.kind).toBe("other");
    expect(resolveViemBinding(index, uses[4])?.kind).toBe("other");
    expect(resolveViemBinding(index, uses.at(-1)!)?.kind).toBe("import");
  });

  it("keeps catch, for, for-in, and for-of bindings scoped", () => {
    const source = `import { arcTestnet } from "viem/chains";
try {} catch (arcTestnet) { arcTestnet; }
for (let arcTestnet = local; condition; update) { arcTestnet; }
for (const arcTestnet in record) { arcTestnet; }
for (const arcTestnet of values) { arcTestnet; }
arcTestnet;`;
    const { sourceFile, index } = parse(source);
    const uses = identifiers(sourceFile, "arcTestnet");
    for (const offset of [2, 4, 6, 8])
      expect(resolveViemBinding(index, uses[offset])?.kind).toBe("other");
    expect(resolveViemBinding(index, uses.at(-1)!)?.kind).toBe("import");
  });

  it("uses shared switch scope and tracks enum/module bindings", () => {
    const source = `import { arcTestnet } from "viem/chains";
switch (value) { case 0: const arcTestnet = local; arcTestnet; break; case 1: arcTestnet; }
arcTestnet;`;
    const { sourceFile, index } = parse(source);
    const uses = identifiers(sourceFile, "arcTestnet");
    expect(resolveViemBinding(index, uses[2])?.kind).toBe("const");
    expect(resolveViemBinding(index, uses[3])?.kind).toBe("const");
    expect(resolveViemBinding(index, uses.at(-1)!)?.kind).toBe("import");
    expect(bindingAtLastUse("enum local {}\nlocal;", "local")?.kind).toBe(
      "other"
    );
    expect(
      bindingAtLastUse(
        "namespace local { export const value = 1; }\nlocal;",
        "local"
      )?.kind
    ).toBe("other");
  });

  it("handles var, later declarations, and duplicate bindings fail closed", () => {
    const source = `function submit() { before; { var before = local; const blockOnly = local; blockOnly; } before; blockOnly; }`;
    const { sourceFile, index } = parse(source);
    const before = identifiers(sourceFile, "before");
    const blockOnly = identifiers(sourceFile, "blockOnly");
    expect(resolveViemBinding(index, before[0])).toBeNull();
    expect(resolveViemBinding(index, before.at(-1)!)?.kind).toBe("other");
    expect(resolveViemBinding(index, blockOnly[1])?.kind).toBe("const");
    expect(resolveViemBinding(index, blockOnly.at(-1)!)).toBeUndefined();

    const later = parse(
      `import { arcTestnet } from "viem/chains"; { arcTestnet; const arcTestnet = local; }`
    );
    expect(
      resolveViemBinding(
        later.index,
        identifiers(later.sourceFile, "arcTestnet")[1]
      )
    ).toBeNull();
    expect(
      bindingAtLastUse(
        "const chain = first; const chain = second; chain;",
        "chain"
      )
    ).toBeNull();
  });
});

describe("viem protected-binding write detection", () => {
  it.each([
    "chain = replacement;",
    "chain += replacement;",
    "chain -= replacement;",
    "chain *= replacement;",
    "chain /= replacement;",
    "chain %= replacement;",
    "chain **= replacement;",
    "chain <<= replacement;",
    "chain >>= replacement;",
    "chain >>>= replacement;",
    "chain &= replacement;",
    "chain |= replacement;",
    "chain ^= replacement;",
    "chain &&= replacement;",
    "chain ||= replacement;",
    "chain ??= replacement;"
  ])("detects assignment target: %s", expectWriteUnsafe);

  it.each(["++chain;", "chain++;", "--chain;", "chain--;", "delete chain;"])(
    "detects update/delete target: %s",
    expectWriteUnsafe
  );

  it.each([
    "[chain] = values;",
    "[...chain] = values;",
    "({ chain } = replacement);",
    "({ value: chain } = replacement);",
    "({ ...chain } = replacement);",
    "[{ value: chain }] = values;"
  ])("detects destructuring target: %s", expectWriteUnsafe);

  it.each([
    "for (chain in values) {}",
    "for (chain of values) {}",
    "for ((chain as unknown) in values) {}",
    "for ((chain as unknown) of values) {}"
  ])("detects loop target: %s", expectWriteUnsafe);

  it.each([
    "(chain) = replacement;",
    "chain! = replacement;",
    "(chain as unknown) = replacement;",
    "(<unknown>chain) = replacement;",
    "(chain satisfies unknown) = replacement;",
    "((chain as unknown)!) = replacement;"
  ])("unwraps TypeScript target: %s", expectWriteUnsafe);

  it("ignores property writes and writes after the protected use", () => {
    const source = `import { arcTestnet } from "viem/chains";
const chain = arcTestnet;
chain;
container.chain = replacement;
chain.value = replacement;
chain = replacement;`;
    const { sourceFile, index } = parse(source);
    const use = identifiers(sourceFile, "chain")[1];
    const binding = resolveViemBinding(index, use);
    expect(binding?.writeOffsets).toHaveLength(1);
    expect(isViemBindingSafeBefore(binding!, use.getStart(sourceFile))).toBe(
      true
    );
  });
});

describe("viem trusted compiler failure containment", () => {
  const trustedCompiler = { ...ts };

  beforeAll(() => {
    vi.doMock("typescript", () => ({ default: trustedCompiler }));
  });

  afterAll(() => {
    vi.doUnmock("typescript");
  });

  it.each([
    ["required function", "createSourceFile"],
    ["ScriptKind", "ScriptKind"],
    ["ScriptTarget", "ScriptTarget"],
    ["NodeFlags", "NodeFlags"],
    ["SyntaxKind", "SyntaxKind"],
    ["isSourceFile", "isSourceFile"]
  ] as const)(
    "contains a hostile trusted %s getter",
    async (_label, property) => {
      const original = Object.getOwnPropertyDescriptor(
        trustedCompiler,
        property
      );
      expect(original).toBeDefined();
      Object.defineProperty(trustedCompiler, property, {
        configurable: true,
        get(): never {
          throw new Error(`hostile trusted ${property} getter`);
        }
      });

      try {
        expect(
          await analyze("const value = 1;", async () => trustedCompiler)
        ).toEqual({
          status: "compiler-unavailable",
          submissions: []
        });
      } finally {
        Object.defineProperty(trustedCompiler, property, original!);
      }
    }
  );

  it("contains trusted createSourceFile execution", async () => {
    const original = trustedCompiler.createSourceFile;
    let createCalled = false;
    trustedCompiler.createSourceFile = () => {
      createCalled = true;
      throw new Error("trusted compiler failed");
    };

    try {
      expect(
        await analyze("const value = 1;", async () => trustedCompiler)
      ).toEqual({
        status: "compiler-unavailable",
        submissions: []
      });
      expect(createCalled).toBe(true);
    } finally {
      trustedCompiler.createSourceFile = original;
    }

    expect(trustedCompiler.createSourceFile).toBe(original);
  });

  it("contains a hostile trusted post-create SourceFile getter", async () => {
    const original = trustedCompiler.createSourceFile;
    let createCalled = false;
    let sourceGetterRead = false;
    trustedCompiler.createSourceFile = () => {
      createCalled = true;
      return Object.defineProperty({}, "kind", {
        get(): never {
          sourceGetterRead = true;
          throw new Error("hostile trusted source getter");
        }
      }) as SourceFile;
    };

    try {
      expect(
        await analyze("const value = 1;", async () => trustedCompiler)
      ).toEqual({
        status: "compiler-unavailable",
        submissions: []
      });
      expect(createCalled).toBe(true);
      expect(sourceGetterRead).toBe(true);
    } finally {
      trustedCompiler.createSourceFile = original;
    }

    expect(trustedCompiler.createSourceFile).toBe(original);
  });

  it("contains a throwing trusted isSourceFile call and restores it", async () => {
    const original = trustedCompiler.isSourceFile;
    trustedCompiler.isSourceFile = (node: Node): node is SourceFile => {
      void node;
      throw new Error("trusted isSourceFile failed");
    };

    try {
      expect(
        await analyze("const value = 1;", async () => trustedCompiler)
      ).toEqual({
        status: "compiler-unavailable",
        submissions: []
      });
    } finally {
      trustedCompiler.isSourceFile = original;
    }

    expect(trustedCompiler.isSourceFile).toBe(original);
  });
});
