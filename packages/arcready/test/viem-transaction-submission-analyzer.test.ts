import ts from "typescript";
import type { Diagnostic, Identifier, Node, SourceFile } from "typescript";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  buildViemLexicalIndex,
  isViemBindingSafeBefore as safeBefore,
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
import type { ViemAccountRoute } from "../rules/wallet/viem-transaction-submission-analyzer.js";

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
  expect(safeBefore(binding!, use.getStart(sourceFile))).toBe(false);
}

const analyze = (
  source: string,
  compilerLoader?: () => Promise<unknown>,
  filePath = "src/submit.ts"
) => analyzeViemTransactionSubmissionFile(filePath, source, compilerLoader);

const ADDRESS = "0x1111111111111111111111111111111111111111";
const VIEM_IMPORTS = `import { createWalletClient, http } from "viem";
import { arcTestnet } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";`;
const CLIENT_CONFIG = `{ chain: arcTestnet, transport: http(), account: "${ADDRESS}" }`;

const boundSubmission = (
  config = CLIENT_CONFIG,
  request = `{ type: "eip4844" }`,
  beforeSink = "",
  afterSink = ""
): string => `${VIEM_IMPORTS}
const client = createWalletClient(${config});
${beforeSink}
client.sendTransaction(${request});
${afterSink}`;

function expectedSubmission(
  source: string,
  marker: string,
  accountRoute: ViemAccountRoute = "json-rpc-address"
) {
  return {
    provenance: "viem-wallet-client",
    sink: "sendTransaction",
    structuralSafety: "proven-safe",
    ownership: "proven-arc",
    accountRoute,
    transactionKind: "proven-blob",
    evidenceToken: "eip4844",
    callOffset: source.indexOf(marker)
  } as const;
}

async function expectNoSubmissions(
  sources: string | readonly string[]
): Promise<void> {
  for (const source of typeof sources === "string" ? [sources] : sources) {
    expect(await analyze(source)).toEqual({
      status: "analyzed",
      submissions: []
    });
  }
}

async function expectOneSubmission(
  source: string,
  marker: string,
  route?: ViemAccountRoute
): Promise<void> {
  expect(await analyze(source)).toEqual({
    status: "analyzed",
    submissions: [expectedSubmission(source, marker, route)]
  });
}

describe("viem compiler and status boundary", () => {
  it.each([
    ["src/submit.ts", true],
    ["src/submit.js", true],
    ["src/submit.d.js", true],
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
    [
      "missing semantic predicate",
      async () => ({ ...ts, isCallExpression: undefined })
    ],
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
  ] as const)("fails closed for %s", async (_label, loader) => {
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
  ] as const)("rejects %s", (_label, source) => {
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
    expect(safeBefore(binding!, use.getStart(sourceFile))).toBe(true);
  });
});

describe("viem semantic positive grammar", () => {
  it("accepts a direct client, direct JSON-RPC account, direct request, and http()", async () => {
    const source = `${VIEM_IMPORTS}
createWalletClient(${CLIENT_CONFIG}).sendTransaction({ type: "eip4844" });`;
    await expectOneSubmission(source, "createWalletClient({");
  });

  it("accepts one client binding and the exact Arc RPC", async () => {
    const source = boundSubmission(
      `{ chain: arcTestnet, transport: http("https://rpc.testnet.arc.network"), account: "${ADDRESS}" }`
    );
    await expectOneSubmission(source, "client.sendTransaction");
  });

  it("accepts one request binding", async () => {
    const source = boundSubmission(
      CLIENT_CONFIG,
      "request",
      `const request = { type: "eip4844" };`
    );
    await expectOneSubmission(source, "client.sendTransaction");
  });

  it("accepts one lowercase JSON-RPC account binding", async () => {
    const source = `${VIEM_IMPORTS}
const account = "${ADDRESS}";
const client = createWalletClient({ chain: arcTestnet, transport: http(), account: account });
client.sendTransaction({ type: "eip4844" });`;
    await expectOneSubmission(source, "client.sendTransaction");
  });

  it("accepts direct privateKeyToAccount provenance", async () => {
    await expectOneSubmission(
      boundSubmission(
        `{ chain: arcTestnet, transport: http(), account: privateKeyToAccount(secret) }`
      ),
      "client.sendTransaction",
      "private-key-local-account"
    );
  });

  it("accepts one private-key account binding", async () => {
    const source = `${VIEM_IMPORTS}
const account = privateKeyToAccount(secret);
const client = createWalletClient({ chain: arcTestnet, transport: http(), account: account });
client.sendTransaction({ type: "eip4844" });`;
    await expectOneSubmission(
      source,
      "client.sendTransaction",
      "private-key-local-account"
    );
  });

  it("accepts proven named import aliases", async () => {
    const source = `import { createWalletClient as wallet, http as arcHttp } from "viem";
import { arcTestnet as arcChain } from "viem/chains";
import { privateKeyToAccount as fromKey } from "viem/accounts";
const client = wallet({ chain: arcChain, transport: arcHttp(), account: fromKey(secret) });
client.sendTransaction({ type: "eip4844" });`;
    await expectOneSubmission(
      source,
      "client.sendTransaction",
      "private-key-local-account"
    );
  });

  it("accepts one immutable arcTestnet binding", async () => {
    const source = `${VIEM_IMPORTS}
const chain = arcTestnet;
const client = createWalletClient({ chain: chain, transport: http(), account: "${ADDRESS}" });
client.sendTransaction({ type: "eip4844" });`;
    await expectOneSubmission(source, "client.sendTransaction");
  });

  it("allows harmless ordinary extra and duplicate non-relevant properties", async () => {
    const source = boundSubmission(
      `{ chain: arcTestnet, transport: http(), account: "${ADDRESS}", label: "a", label: "b" }`,
      `{ nonce: 1, "type": "eip4844", nonce: 2 }`
    );
    await expectOneSubmission(source, "client.sendTransaction");
  });

  it("returns multiple valid calls sorted by exact source offset", async () => {
    const source = `${VIEM_IMPORTS}
const first = createWalletClient(${CLIENT_CONFIG});
first.sendTransaction({ type: "eip4844" });
const second = createWalletClient({ chain: arcTestnet, transport: http(), account: privateKeyToAccount(secret) });
const request = { type: "eip4844" };
second.sendTransaction(request);`;
    expect(await analyze(source)).toEqual({
      status: "analyzed",
      submissions: [
        expectedSubmission(source, "first.sendTransaction"),
        expectedSubmission(
          source,
          "second.sendTransaction",
          "private-key-local-account"
        )
      ]
    });
  });

  it("preserves the valid sibling in both source orders", async () => {
    const imports = `import { createWalletClient, http } from "viem";
import { arcTestnet as badArc, arcTestnet as goodArc } from "viem/chains";`;
    const good = `const chainB = goodArc;
const goodClient = createWalletClient({ chain: chainB, transport: http(), account: "${ADDRESS}" });
goodClient.sendTransaction({ type: "eip4844" });`;
    const bad = `const chainA = badArc;
const leaked = chainA;
const badClient = createWalletClient({ chain: chainA, transport: http(), account: "${ADDRESS}" });
badClient.sendTransaction({ type: "eip4844" });`;
    for (const badFirst of [false, true]) {
      const source = `${imports}
${badFirst ? `${bad}\n${good}` : `${good}\n${bad}`}`;
      await expectOneSubmission(source, "goodClient.sendTransaction");
    }
  });
});

describe("viem semantic fail-closed grammar", () => {
  it("rejects wrong import modules and value forms", async () => {
    await expectNoSubmissions([
      boundSubmission().replace(`from "viem";`, `from "viem/client";`),
      boundSubmission().replace(
        `import { createWalletClient, http } from "viem";`,
        `import type { createWalletClient, http } from "viem";`
      ),
      boundSubmission().replace(
        `import { createWalletClient, http } from "viem";`,
        `import * as viem from "viem";
const { createWalletClient, http } = viem;`
      ),
      boundSubmission().replace(
        `import { createWalletClient, http } from "viem";`,
        `import viem from "viem";
const { createWalletClient, http } = viem;`
      )
    ]);
  });

  it("rejects re-exported and local lookalike roots", async () => {
    await expectNoSubmissions([
      boundSubmission().replace(
        `import { createWalletClient, http } from "viem";`,
        `export { createWalletClient, http } from "viem";
import { createWalletClient, http } from "./viem-proxy";`
      ),
      boundSubmission().replace(
        `import { createWalletClient, http } from "viem";`,
        `const createWalletClient = localClient;
const http = localHttp;`
      )
    ]);
  });

  it("rejects shadowed, duplicate, and reassigned protected imports", async () => {
    const shadowed = `${VIEM_IMPORTS}
function submit(createWalletClient) {
  const client = createWalletClient(${CLIENT_CONFIG});
  client.sendTransaction({ type: "eip4844" });
}`;
    await expectNoSubmissions([
      shadowed,
      boundSubmission().replace(
        `const client =`,
        `createWalletClient = replacement;
const client =`
      ),
      boundSubmission().replace(
        `import { createWalletClient, http } from "viem";`,
        `import { createWalletClient, http } from "viem";
const createWalletClient = replacement;`
      )
    ]);
  });

  it("rejects client depth two, branching selection, and wrappers", async () => {
    await expectNoSubmissions([
      `${VIEM_IMPORTS}
const first = createWalletClient(${CLIENT_CONFIG});
const client = first;
client.sendTransaction({ type: "eip4844" });`,
      `${VIEM_IMPORTS}
const client = condition ? createWalletClient(${CLIENT_CONFIG}) : createWalletClient(${CLIENT_CONFIG});
client.sendTransaction({ type: "eip4844" });`,
      `${VIEM_IMPORTS}
const client = wrap(createWalletClient(${CLIENT_CONFIG}));
client.sendTransaction({ type: "eip4844" });`,
      `${VIEM_IMPORTS}
const client = createWalletClient(${CLIENT_CONFIG}, options);
client.sendTransaction({ type: "eip4844" });`
    ]);
  });

  it("rejects missing, duplicate, and relevant shorthand client keys", async () => {
    await expectNoSubmissions([
      boundSubmission(`{ transport: http(), account: "${ADDRESS}" }`),
      boundSubmission(
        `{ chain: arcTestnet, chain: arcTestnet, transport: http(), account: "${ADDRESS}" }`
      ),
      `${VIEM_IMPORTS}
const chain = arcTestnet;
const client = createWalletClient({ chain, transport: http(), account: "${ADDRESS}" });
client.sendTransaction({ type: "eip4844" });`
    ]);
  });

  it("rejects client spread and computed properties", async () => {
    await expectNoSubmissions([
      boundSubmission(
        `{ ...config, chain: arcTestnet, transport: http(), account: "${ADDRESS}" }`
      ),
      boundSubmission(
        `{ ["chain"]: arcTestnet, transport: http(), account: "${ADDRESS}" }`
      )
    ]);
  });

  it("rejects client accessors, methods, and prototype-sensitive keys", async () => {
    await expectNoSubmissions([
      boundSubmission(
        `{ get extra() { return 1; }, chain: arcTestnet, transport: http(), account: "${ADDRESS}" }`
      ),
      boundSubmission(
        `{ extra() {}, chain: arcTestnet, transport: http(), account: "${ADDRESS}" }`
      ),
      boundSubmission(
        `{ constructor: value, chain: arcTestnet, transport: http(), account: "${ADDRESS}" }`
      )
    ]);
  });

  it("rejects omitted, null, numeric, and direct-object chains", async () => {
    await expectNoSubmissions([
      boundSubmission(`{ transport: http(), account: "${ADDRESS}" }`),
      boundSubmission(
        `{ chain: null, transport: http(), account: "${ADDRESS}" }`
      ),
      boundSubmission(
        `{ chain: 5042002, transport: http(), account: "${ADDRESS}" }`
      ),
      boundSubmission(
        `{ chain: { id: 5042002 }, transport: http(), account: "${ADDRESS}" }`
      )
    ]);
  });

  it("rejects non-Arc, defineChain, arc, and wrapped chain values", async () => {
    await expectNoSubmissions([
      boundSubmission(
        `{ chain: mainnet, transport: http(), account: "${ADDRESS}" }`
      ).replace(
        `import { arcTestnet } from "viem/chains";`,
        `import { arcTestnet, mainnet } from "viem/chains";`
      ),
      boundSubmission(
        `{ chain: defineChain({ id: 5042002 }), transport: http(), account: "${ADDRESS}" }`
      ),
      boundSubmission(
        `{ chain: arc, transport: http(), account: "${ADDRESS}" }`
      ).replace(
        `import { arcTestnet } from "viem/chains";`,
        `import { arcTestnet, arc } from "viem/chains";`
      ),
      boundSubmission(
        `{ chain: pick(arcTestnet), transport: http(), account: "${ADDRESS}" }`
      )
    ]);
  });

  it("rejects chain depth two, imported values, and per-call overrides", async () => {
    await expectNoSubmissions([
      `${VIEM_IMPORTS}
const first = arcTestnet;
const chain = first;
const client = createWalletClient({ chain: chain, transport: http(), account: "${ADDRESS}" });
client.sendTransaction({ type: "eip4844" });`,
      boundSubmission(
        `{ chain: chain, transport: http(), account: "${ADDRESS}" }`
      ).replace(
        VIEM_IMPORTS,
        `${VIEM_IMPORTS}
import { chain } from "./chain";`
      ),
      boundSubmission(CLIENT_CONFIG, `{ type: "eip4844", chain: arcTestnet }`)
    ]);
  });

  it("rejects bound and configured transports", async () => {
    await expectNoSubmissions([
      `${VIEM_IMPORTS}
const transport = http();
const client = createWalletClient({ chain: arcTestnet, transport: transport, account: "${ADDRESS}" });
client.sendTransaction({ type: "eip4844" });`,
      boundSubmission(
        `{ chain: arcTestnet, transport: http("https://rpc.testnet.arc.network", {}), account: "${ADDRESS}" }`
      ),
      boundSubmission(
        `{ chain: arcTestnet, transport: http?.(), account: "${ADDRESS}" }`
      ),
      boundSubmission(
        `{ chain: arcTestnet, transport: http(...urls), account: "${ADDRESS}" }`
      )
    ]);
  });

  it("rejects computed and non-Arc transport URLs", async () => {
    await expectNoSubmissions([
      `${VIEM_IMPORTS}
const rpc = "https://rpc.testnet.arc.network";
const client = createWalletClient({ chain: arcTestnet, transport: http(rpc), account: "${ADDRESS}" });
client.sendTransaction({ type: "eip4844" });`,
      boundSubmission(
        `{ chain: arcTestnet, transport: http("https://example.invalid"), account: "${ADDRESS}" }`
      )
    ]);
  });

  it("rejects custom, fallback, WebSocket, and wrapped transports", async () => {
    await expectNoSubmissions([
      boundSubmission(
        `{ chain: arcTestnet, transport: custom(provider), account: "${ADDRESS}" }`
      ),
      boundSubmission(
        `{ chain: arcTestnet, transport: fallback([http()]), account: "${ADDRESS}" }`
      ),
      boundSubmission(
        `{ chain: arcTestnet, transport: webSocket(), account: "${ADDRESS}" }`
      ),
      boundSubmission(
        `{ chain: arcTestnet, transport: wrap(http()), account: "${ADDRESS}" }`
      )
    ]);
  });

  it("rejects malformed, mixed-case, custom, and imported accounts", async () => {
    await expectNoSubmissions([
      boundSubmission(
        `{ chain: arcTestnet, transport: http(), account: "0x1234" }`
      ),
      boundSubmission(
        `{ chain: arcTestnet, transport: http(), account: "0xA111111111111111111111111111111111111111" }`
      ),
      boundSubmission(
        `{ chain: arcTestnet, transport: http(), account: { address: "${ADDRESS}" } }`
      ),
      boundSubmission(
        `{ chain: arcTestnet, transport: http(), account: account }`
      ).replace(
        VIEM_IMPORTS,
        `${VIEM_IMPORTS}
import { account } from "./account";`
      )
    ]);
  });

  it("rejects alternative account factories and wrappers", async () => {
    await expectNoSubmissions([
      boundSubmission(
        `{ chain: arcTestnet, transport: http(), account: toAccount(secret) }`
      ),
      boundSubmission(
        `{ chain: arcTestnet, transport: http(), account: mnemonicToAccount(words) }`
      ),
      boundSubmission(
        `{ chain: arcTestnet, transport: http(), account: smartAccount(owner) }`
      ),
      boundSubmission(
        `{ chain: arcTestnet, transport: http(), account: wrap(privateKeyToAccount(secret)) }`
      ),
      `${VIEM_IMPORTS}
const first = "${ADDRESS}";
const account = first;
const client = createWalletClient({ chain: arcTestnet, transport: http(), account: account });
client.sendTransaction({ type: "eip4844" });`
    ]);
  });

  it("rejects privateKeyToAccount with wrong provenance", async () => {
    await expectNoSubmissions([
      boundSubmission(
        `{ chain: arcTestnet, transport: http(), account: privateKeyToAccount(secret) }`
      ).replace(`from "viem/accounts";`, `from "./accounts";`),
      boundSubmission(
        `{ chain: arcTestnet, transport: http(), account: localKey(secret) }`
      )
    ]);
  });

  it("rejects privateKeyToAccount optional, arity, and spread calls", async () => {
    await expectNoSubmissions([
      boundSubmission(
        `{ chain: arcTestnet, transport: http(), account: privateKeyToAccount?.(secret) }`
      ),
      boundSubmission(
        `{ chain: arcTestnet, transport: http(), account: privateKeyToAccount() }`
      ),
      boundSubmission(
        `{ chain: arcTestnet, transport: http(), account: privateKeyToAccount(one, two) }`
      ),
      boundSubmission(
        `{ chain: arcTestnet, transport: http(), account: privateKeyToAccount(...keys) }`
      )
    ]);
  });

  it("rejects request depth two, wrappers, and imports", async () => {
    await expectNoSubmissions([
      boundSubmission(
        CLIENT_CONFIG,
        "request",
        `const first = { type: "eip4844" };
const request = first;`
      ),
      boundSubmission(CLIENT_CONFIG, `wrap({ type: "eip4844" })`),
      `${VIEM_IMPORTS}
import { request } from "./request";
const client = createWalletClient(${CLIENT_CONFIG});
client.sendTransaction(request);`
    ]);
  });

  it("rejects request spreads and computed properties", async () => {
    await expectNoSubmissions([
      boundSubmission(CLIENT_CONFIG, `{ ...request, type: "eip4844" }`),
      boundSubmission(CLIENT_CONFIG, `{ ["type"]: "eip4844" }`)
    ]);
  });

  it("rejects request accessors, methods, and prototype-sensitive keys", async () => {
    await expectNoSubmissions([
      boundSubmission(
        CLIENT_CONFIG,
        `{ get value() { return 1; }, type: "eip4844" }`
      ),
      boundSubmission(CLIENT_CONFIG, `{ value() {}, type: "eip4844" }`),
      boundSubmission(CLIENT_CONFIG, `{ __proto__: value, type: "eip4844" }`)
    ]);
  });

  it("rejects duplicate exact type evidence", async () => {
    await expectNoSubmissions(
      boundSubmission(CLIENT_CONFIG, `{ type: "eip4844", type: "eip4844" }`)
    );
  });

  it("rejects numeric, hexadecimal-string, identifier, and shorthand types", async () => {
    await expectNoSubmissions([
      boundSubmission(CLIENT_CONFIG, `{ type: 3 }`),
      boundSubmission(CLIENT_CONFIG, `{ type: "0x3" }`),
      boundSubmission(CLIENT_CONFIG, `{ type }`, `const type = "eip4844";`),
      boundSubmission(
        CLIENT_CONFIG,
        `{ type: kind }`,
        `const kind = "eip4844";`
      )
    ]);
  });

  it("rejects template, concatenated, and deferred blob-looking evidence", async () => {
    await expectNoSubmissions([
      boundSubmission(CLIENT_CONFIG, "{ type: `eip4844` }"),
      boundSubmission(CLIENT_CONFIG, `{ type: "eip" + "4844" }`),
      boundSubmission(
        CLIENT_CONFIG,
        `{ blobs, maxFeePerBlobGas: 1n, blobVersionedHashes }`
      )
    ]);
  });

  it("rejects per-call account and chain properties including shorthand", async () => {
    await expectNoSubmissions([
      boundSubmission(
        CLIENT_CONFIG,
        `{ type: "eip4844", account: "${ADDRESS}" }`
      ),
      boundSubmission(CLIENT_CONFIG, `{ type: "eip4844", chain: arcTestnet }`),
      boundSubmission(
        CLIENT_CONFIG,
        `{ type: "eip4844", account }`,
        `const account = "${ADDRESS}";`
      )
    ]);
  });

  it("rejects element and optional sink access", async () => {
    await expectNoSubmissions([
      boundSubmission().replace(
        `client.sendTransaction`,
        `client["sendTransaction"]`
      ),
      boundSubmission().replace(
        `client.sendTransaction`,
        `client?.sendTransaction`
      ),
      boundSubmission().replace(
        `client.sendTransaction(`,
        `client.sendTransaction?.(`
      )
    ]);
  });

  it("rejects detached, call, apply, and bind sink forms", async () => {
    await expectNoSubmissions([
      boundSubmission().replace(
        `client.sendTransaction({ type: "eip4844" });`,
        `const submit = client.sendTransaction;
submit({ type: "eip4844" });`
      ),
      boundSubmission().replace(
        `client.sendTransaction(`,
        `client.sendTransaction.call(client, `
      ),
      boundSubmission().replace(
        `client.sendTransaction({ type: "eip4844" })`,
        `client.sendTransaction.apply(client, [{ type: "eip4844" }])`
      ),
      boundSubmission().replace(
        `client.sendTransaction({ type: "eip4844" })`,
        `client.sendTransaction.bind(client)({ type: "eip4844" })`
      )
    ]);
  });

  it("rejects omitted, extra, and spread sink arguments", async () => {
    await expectNoSubmissions([
      boundSubmission().replace(
        `client.sendTransaction({ type: "eip4844" })`,
        `client.sendTransaction()`
      ),
      boundSubmission().replace(
        `client.sendTransaction({ type: "eip4844" })`,
        `client.sendTransaction({ type: "eip4844" }, options)`
      ),
      boundSubmission().replace(
        `client.sendTransaction({ type: "eip4844" })`,
        `client.sendTransaction(...requests)`
      )
    ]);
  });

  it("rejects alternate actions and wrapper sinks", async () => {
    await expectNoSubmissions([
      boundSubmission().replace(`sendTransaction`, `writeContract`),
      boundSubmission().replace(
        `client.sendTransaction({ type: "eip4844" })`,
        `submit(client, { type: "eip4844" })`
      )
    ]);
  });
});

describe("viem candidate-local safety", () => {
  const directChain = (beforeSink = "", afterSink = "") =>
    boundSubmission(undefined, undefined, beforeSink, afterSink);
  const aliasedChain = (extraAlias: string) => `${VIEM_IMPORTS}
const chain = arcTestnet;
${extraAlias}
const client = createWalletClient({ chain: chain, transport: http(), account: "${ADDRESS}" });
client.sendTransaction({ type: "eip4844" });`;
  const boundRequest = (beforeSink: string, afterSink = "") =>
    `${VIEM_IMPORTS}
const request = { type: "eip4844" };
const client = createWalletClient(${CLIENT_CONFIG});
${beforeSink}
client.sendTransaction(request);
${afterSink}`;

  it("rejects protected property mutation, delete, and update before the sink", async () => {
    await expectNoSubmissions([
      boundRequest(`request.type = "eip1559";`),
      boundRequest(`delete request.type;`),
      boundRequest(`request.nonce++;`),
      `${VIEM_IMPORTS}
const chain = arcTestnet;
const client = createWalletClient({ chain: chain, transport: http(), account: "${ADDRESS}" });
chain.id = 1;
client.sendTransaction({ type: "eip4844" });`
    ]);
  });

  it("rejects protected reassignment and destructuring writes before the sink", async () => {
    await expectNoSubmissions([
      boundRequest(`request = replacement;`),
      boundRequest(`({ value: request } = replacement);`),
      boundSubmission(CLIENT_CONFIG, `{ type: "eip4844" }`).replace(
        `client.sendTransaction`,
        `client = replacement;
client.sendTransaction`
      )
    ]);
  });

  it("rejects unknown-call and constructor escape before the sink", async () => {
    await expectNoSubmissions([
      boundRequest(`mutate(request);`),
      boundRequest(`new Holder(request);`),
      boundRequest(`Object.setPrototypeOf(request, replacement);`)
    ]);
  });

  it("rejects extra aliases, returns, and container escape before the sink", async () => {
    await expectNoSubmissions([
      directChain(`const leaked = arcTestnet;`),
      directChain(`const leaked = arcTestnet; leaked.id = 1;`),
      directChain(`const leaked = arcTestnet; mutate(leaked);`),
      directChain(`const leaked = arcTestnet; const box = { leaked };`),
      aliasedChain(`const leaked = arcTestnet;`),
      aliasedChain(`const leaked = chain;`),
      boundRequest(`const alias = request;`),
      boundRequest(`const container = { request };`),
      `${VIEM_IMPORTS}
function submit() {
  const request = { type: "eip4844" };
  const client = createWalletClient(${CLIENT_CONFIG});
  if (condition) return request;
  client.sendTransaction(request);
}`
    ]);
  });

  it("rejects detached, element, and unsupported protected-client access", async () => {
    await expectNoSubmissions([
      boundSubmission(
        CLIENT_CONFIG,
        `{ type: "eip4844" }`,
        `client.sendTransaction;`
      ),
      boundSubmission(
        CLIENT_CONFIG,
        `{ type: "eip4844" }`,
        `client["sendTransaction"];`
      ),
      boundSubmission(CLIENT_CONFIG, `{ type: "eip4844" }`, `client.extend;`)
    ]);
  });

  it("keeps exact mutations and escapes after the sink unrelated", async () => {
    const source = boundRequest(
      "",
      `request.type = "eip1559";
mutate(request);
client.sendTransaction = replacement;
const leaked = arcTestnet; leaked.id = 1;`
    );
    await expectOneSubmission(source, "client.sendTransaction");
  });

  it("does not join Arc client and blob request evidence across siblings", async () => {
    const source = `${VIEM_IMPORTS}
const arcClient = createWalletClient(${CLIENT_CONFIG});
arcClient.sendTransaction({ type: "eip1559" });
const otherClient = createWalletClient({ chain: mainnet, transport: http(), account: "${ADDRESS}" });
otherClient.sendTransaction({ type: "eip4844" });`;
    await expectNoSubmissions(source);
  });

  it("invalidates only the candidate owning the escaped binding", async () => {
    const source = `${VIEM_IMPORTS}
const badRequest = { type: "eip4844" };
const badClient = createWalletClient(${CLIENT_CONFIG});
mutate(badRequest);
badClient.sendTransaction(badRequest);
const goodClient = createWalletClient(${CLIENT_CONFIG});
goodClient.sendTransaction({ type: "eip4844" });`;
    await expectOneSubmission(source, "goodClient.sendTransaction");
  });

  it("rejects cross-function client, request, account, and chain bindings", async () => {
    const source = `${VIEM_IMPORTS}
const chain = arcTestnet;
const account = "${ADDRESS}";
const request = { type: "eip4844" };
const client = createWalletClient({ chain: chain, transport: http(), account: account });
function submit() {
  client.sendTransaction(request);
}`;
    await expectNoSubmissions(source);
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
