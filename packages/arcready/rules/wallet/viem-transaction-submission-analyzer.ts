/* eslint-disable @typescript-eslint/consistent-type-imports -- compiler loading must remain runtime-lazy */
import {
  buildViemLexicalIndex,
  isViemBindingSafeBefore,
  resolveDirectOrOneConstExpression,
  resolveDirectOrOneConstImport,
  resolveExactViemImport,
  resolveViemBinding
} from "./viem-transaction-submission-lexical.js";
import type {
  ViemLexicalBinding,
  ViemLexicalIndex,
  ViemResolvedExpression
} from "./viem-transaction-submission-lexical.js";

type TypeScript = typeof import("typescript");
type Node = import("typescript").Node;
type SourceFile = import("typescript").SourceFile;
type Expression = import("typescript").Expression;
type Identifier = import("typescript").Identifier;
type CallExpression = import("typescript").CallExpression;
type ObjectLiteralExpression = import("typescript").ObjectLiteralExpression;

export type ViemTransactionSubmissionAnalysisStatus =
  | "analyzed"
  | "unsupported-file"
  | "compiler-unavailable"
  | "malformed"
  | "unsupported-source";

export type ViemAccountRoute = "json-rpc-address" | "private-key-local-account";

export interface ViemTransactionSubmission {
  readonly provenance: "viem-wallet-client";
  readonly sink: "sendTransaction";
  readonly structuralSafety: "proven-safe";
  readonly ownership: "proven-arc";
  readonly accountRoute: ViemAccountRoute;
  readonly transactionKind: "proven-blob";
  readonly evidenceToken: "eip4844";
  readonly callOffset: number;
}

export interface ViemTransactionSubmissionAnalysis {
  readonly status: ViemTransactionSubmissionAnalysisStatus;
  readonly submissions: readonly ViemTransactionSubmission[];
}

interface AnalysisState {
  readonly ts: TypeScript;
  readonly sourceFile: SourceFile;
  readonly lexical: ViemLexicalIndex;
}

interface Evidence {
  readonly bindings: Set<ViemLexicalBinding>;
  readonly uses: Set<Identifier>;
}

interface Candidate {
  readonly submission: ViemTransactionSubmission;
  readonly evidence: Evidence;
}

const ARC_RPC = "https://rpc.testnet.arc.network";
const JSON_RPC_ADDRESS = /^0x[0-9a-f]{40}$/;
const PROTOTYPE_KEYS = new Set(["__proto__", "prototype", "constructor"]);

const REQUIRED_COMPILER_FUNCTIONS = [
  ...["createSourceFile", "forEachChild", "isSourceFile"],
  ...["isIdentifier", "isStringLiteral", "isComputedPropertyName"],
  ...["isCallExpression", "isPropertyAccessExpression"],
  ...["isObjectLiteralExpression", "isArrayLiteralExpression"],
  ...["isPropertyAssignment", "isShorthandPropertyAssignment"],
  ...["isSpreadAssignment", "isSpreadElement", "isOmittedExpression"],
  ...["isVariableDeclaration", "isVariableDeclarationList", "isParameter"],
  ...["isImportDeclaration", "isImportEqualsDeclaration"],
  ...["isNamedImports", "isNamespaceImport"],
  ...["isFunctionDeclaration", "isFunctionExpression", "isFunctionLike"],
  ...["isClassDeclaration", "isClassExpression", "isEnumDeclaration"],
  ...["isModuleDeclaration", "isModuleBlock"],
  ...["isBlock", "isCaseBlock", "isCatchClause"],
  ...["isForStatement", "isForInStatement", "isForOfStatement"],
  ...["isBinaryExpression", "isDeleteExpression"],
  ...["isPrefixUnaryExpression", "isPostfixUnaryExpression"],
  ...["isParenthesizedExpression", "isNonNullExpression", "isAsExpression"],
  ...["isTypeAssertionExpression", "isSatisfiesExpression"],
  "isPartiallyEmittedExpression"
] as const;

export function supportsViemTransactionSubmissionPath(
  filePath: string
): boolean {
  const normalized = filePath.replaceAll("\\", "/");
  const fileName = normalized.slice(normalized.lastIndexOf("/") + 1);
  return (
    /\.[jt]s$/i.test(fileName) &&
    !/(?:\.d\.ts|\.(?:test|spec|generated)\.[jt]s)$/i.test(fileName) &&
    !/(?:^|\/)(?:test|tests|__tests__|generated|dist|build|coverage)(?:\/|$)/i.test(
      normalized
    )
  );
}

export async function analyzeViemTransactionSubmissionFile(
  filePath: string,
  source: string,
  compilerLoader: () => Promise<unknown> = () => import("typescript")
): Promise<ViemTransactionSubmissionAnalysis> {
  if (!supportsViemTransactionSubmissionPath(filePath)) {
    return { status: "unsupported-file", submissions: [] };
  }

  const ts = await loadCompiler(compilerLoader);
  if (ts === null) {
    return { status: "compiler-unavailable", submissions: [] };
  }

  try {
    const scriptKind = filePath.toLowerCase().endsWith(".js")
      ? ts.ScriptKind.JS
      : ts.ScriptKind.TS;
    const sourceFile = ts.createSourceFile(
      filePath,
      source,
      ts.ScriptTarget.Latest,
      true,
      scriptKind
    );
    if (!hasSourceFileShape(ts, sourceFile)) {
      return { status: "compiler-unavailable", submissions: [] };
    }
    if (
      sourceFile.isDeclarationFile ||
      sourceFile.parseDiagnostics.length > 0
    ) {
      return { status: "malformed", submissions: [] };
    }

    const state: AnalysisState = {
      ts,
      sourceFile,
      lexical: buildViemLexicalIndex(ts, sourceFile)
    };
    const candidates = collectCandidates(state);
    const safeUses = new Set(
      candidates.flatMap((candidate) => [...candidate.evidence.uses])
    );
    const submissions = candidates
      .filter((candidate) => isCandidateSafe(state, candidate, safeUses))
      .sort((a, b) => a.submission.callOffset - b.submission.callOffset)
      .map((candidate) => candidate.submission);
    return { status: "analyzed", submissions };
  } catch {
    return { status: "compiler-unavailable", submissions: [] };
  }
}

function collectCandidates(state: AnalysisState): Candidate[] {
  const candidates: Candidate[] = [];
  const visit = (node: Node): void => {
    if (state.ts.isCallExpression(node)) {
      const candidate = classifyCandidate(state, node);
      if (candidate !== null) candidates.push(candidate);
    }
    state.ts.forEachChild(node, visit);
  };
  visit(state.sourceFile);
  return candidates;
}

function classifyCandidate(
  state: AnalysisState,
  call: CallExpression
): Candidate | null {
  const { ts, sourceFile } = state;
  if (
    call.questionDotToken !== undefined ||
    call.arguments.length !== 1 ||
    ts.isSpreadElement(call.arguments[0]) ||
    !ts.isPropertyAccessExpression(call.expression) ||
    call.expression.questionDotToken !== undefined ||
    call.expression.name.text !== "sendTransaction"
  ) {
    return null;
  }

  const evidence: Evidence = { bindings: new Set(), uses: new Set() };
  const accountRoute = classifyClient(
    state,
    call.expression.expression,
    evidence
  );
  if (
    accountRoute === null ||
    !classifyRequest(state, call.arguments[0], evidence)
  ) {
    return null;
  }

  return {
    evidence,
    submission: {
      provenance: "viem-wallet-client",
      sink: "sendTransaction",
      structuralSafety: "proven-safe",
      ownership: "proven-arc",
      accountRoute,
      transactionKind: "proven-blob",
      evidenceToken: "eip4844",
      callOffset: call.getStart(sourceFile)
    }
  };
}

function classifyClient(
  state: AnalysisState,
  receiver: Expression,
  evidence: Evidence
): ViemAccountRoute | null {
  const { ts, sourceFile, lexical } = state;
  const resolved = resolveValue(state, receiver, evidence);
  if (
    resolved === null ||
    !ts.isCallExpression(resolved.expression) ||
    resolved.expression.questionDotToken !== undefined ||
    resolved.expression.arguments.length !== 1 ||
    ts.isSpreadElement(resolved.expression.arguments[0]) ||
    !ts.isObjectLiteralExpression(resolved.expression.arguments[0])
  ) {
    return null;
  }

  const imported = resolveExactViemImport(
    lexical,
    resolved.expression.expression,
    "viem:createWalletClient",
    resolved.expression.getStart(sourceFile)
  );
  if (!imported) return null;
  protect(evidence, imported, resolved.expression.expression);

  const properties = exactProperties(
    state,
    resolved.expression.arguments[0],
    new Set(["chain", "transport", "account"])
  );
  if (properties === null) return null;
  const chain = properties.get("chain");
  const transport = properties.get("transport");
  const account = properties.get("account");
  if (chain === undefined || transport === undefined || account === undefined) {
    return null;
  }
  if (
    !classifyChain(state, chain, evidence) ||
    !classifyTransport(state, transport, evidence)
  ) {
    return null;
  }
  return classifyAccount(state, account, evidence);
}

function classifyChain(
  state: AnalysisState,
  expression: Expression,
  evidence: Evidence
): boolean {
  const { ts, sourceFile, lexical } = state;
  const bindings = resolveDirectOrOneConstImport(
    lexical,
    expression,
    "viem/chains:arcTestnet",
    expression.getStart(sourceFile)
  );
  if (
    bindings === null ||
    (bindings.length === 2 &&
      scope(ts, bindings[0].node) !== scope(ts, expression))
  ) {
    return false;
  }
  for (const binding of bindings) protect(evidence, binding);
  if (ts.isIdentifier(expression)) protect(evidence, bindings[0], expression);
  if (bindings.length === 2) {
    const initializer = bindings[0].initializer;
    if (initializer !== undefined && ts.isIdentifier(initializer)) {
      protect(evidence, bindings[1], initializer);
    }
  }
  return true;
}

function classifyTransport(
  state: AnalysisState,
  expression: Expression,
  evidence: Evidence
): boolean {
  const { ts, sourceFile } = state;
  if (
    !ts.isCallExpression(expression) ||
    expression.questionDotToken !== undefined ||
    expression.arguments.length > 1 ||
    (expression.arguments.length === 1 &&
      (ts.isSpreadElement(expression.arguments[0]) ||
        !ts.isStringLiteral(expression.arguments[0]) ||
        expression.arguments[0].text !== ARC_RPC))
  ) {
    return false;
  }
  const imported = resolveExactViemImport(
    state.lexical,
    expression.expression,
    "viem:http",
    expression.getStart(sourceFile)
  );
  if (!imported) return false;
  protect(evidence, imported, expression.expression);
  return true;
}

function classifyAccount(
  state: AnalysisState,
  expression: Expression,
  evidence: Evidence
): ViemAccountRoute | null {
  const resolved = resolveValue(state, expression, evidence);
  if (resolved === null) return null;
  const { ts, sourceFile } = state;
  if (
    ts.isStringLiteral(resolved.expression) &&
    JSON_RPC_ADDRESS.test(resolved.expression.text)
  ) {
    return "json-rpc-address";
  }
  if (
    !ts.isCallExpression(resolved.expression) ||
    resolved.expression.questionDotToken !== undefined ||
    resolved.expression.arguments.length !== 1 ||
    ts.isSpreadElement(resolved.expression.arguments[0])
  ) {
    return null;
  }
  const imported = resolveExactViemImport(
    state.lexical,
    resolved.expression.expression,
    "viem/accounts:privateKeyToAccount",
    resolved.expression.getStart(sourceFile)
  );
  if (!imported) return null;
  protect(evidence, imported, resolved.expression.expression);
  return "private-key-local-account";
}

function classifyRequest(
  state: AnalysisState,
  expression: Expression,
  evidence: Evidence
): boolean {
  const resolved = resolveValue(state, expression, evidence);
  if (
    resolved === null ||
    !state.ts.isObjectLiteralExpression(resolved.expression)
  ) {
    return false;
  }
  const properties = exactProperties(
    state,
    resolved.expression,
    new Set(["type", "chain", "account"])
  );
  if (
    properties === null ||
    properties.has("chain") ||
    properties.has("account")
  ) {
    return false;
  }
  const type = properties.get("type");
  return (
    type !== undefined &&
    state.ts.isStringLiteral(type) &&
    type.text === "eip4844"
  );
}

function exactProperties(
  state: AnalysisState,
  object: ObjectLiteralExpression,
  uniqueKeys: ReadonlySet<string>
): Map<string, Expression> | null {
  const result = new Map<string, Expression>();
  for (const property of object.properties) {
    if (state.ts.isShorthandPropertyAssignment(property)) {
      const key = property.name.text;
      if (PROTOTYPE_KEYS.has(key) || uniqueKeys.has(key)) {
        return null;
      }
      continue;
    }
    if (
      !state.ts.isPropertyAssignment(property) ||
      state.ts.isComputedPropertyName(property.name)
    ) {
      return null;
    }
    const key = property.name.text;
    if (PROTOTYPE_KEYS.has(key)) return null;
    if (uniqueKeys.has(key) && result.has(key)) return null;
    result.set(key, property.initializer);
  }
  return result;
}

function resolveValue(
  state: AnalysisState,
  expression: Expression,
  evidence: Evidence
): ViemResolvedExpression | null {
  const resolved = resolveDirectOrOneConstExpression(
    state.lexical,
    expression,
    expression.getStart(state.sourceFile)
  );
  if (
    resolved === null ||
    (resolved.binding !== undefined &&
      scope(state.ts, resolved.binding.node) !== scope(state.ts, expression))
  ) {
    return null;
  }
  if (resolved.binding !== undefined) {
    protect(evidence, resolved.binding, expression);
  }
  return resolved;
}

function scope(ts: TypeScript, node: Node): Node {
  let current = node;
  while (!ts.isSourceFile(current) && !ts.isFunctionLike(current)) {
    current = current.parent;
  }
  return current;
}

function protect(
  evidence: Evidence,
  binding: ViemLexicalBinding,
  expression?: Expression
): void {
  evidence.bindings.add(binding);
  if (expression !== undefined) evidence.uses.add(expression as Identifier);
}

function isCandidateSafe(
  state: AnalysisState,
  candidate: Candidate,
  safeUses: ReadonlySet<Identifier>
): boolean {
  const sinkOffset = candidate.submission.callOffset;
  for (const binding of candidate.evidence.bindings) {
    if (!isViemBindingSafeBefore(binding, sinkOffset)) return false;
  }

  let safe = true;
  const visit = (node: Node): void => {
    if (!safe || node.getStart(state.sourceFile) >= sinkOffset) return;
    if (state.ts.isIdentifier(node) && isValueReference(state.ts, node)) {
      const parent = node.parent;
      const binding = resolveViemBinding(
        state.lexical,
        node,
        node.getStart(state.sourceFile)
      );
      const extraChainAlias =
        binding?.importIdentity === "viem/chains:arcTestnet" &&
        candidate.evidence.bindings.has(binding) &&
        state.ts.isVariableDeclaration(parent) &&
        parent.initializer === node &&
        ![...candidate.evidence.bindings].some(
          (candidateBinding) => candidateBinding.node === parent.name
        );
      if (
        extraChainAlias ||
        (binding !== null &&
          binding !== undefined &&
          candidate.evidence.bindings.has(binding) &&
          node !== binding.node &&
          !safeUses.has(node) &&
          !(
            binding.kind === "import" &&
            isSafeImportReference(state, binding, node)
          ))
      ) {
        safe = false;
        return;
      }
    }
    state.ts.forEachChild(node, visit);
  };
  visit(state.sourceFile);
  return safe;
}

function isValueReference(ts: TypeScript, identifier: Identifier): boolean {
  const parent = identifier.parent as Node & {
    readonly name?: Node;
    readonly propertyName?: Node;
  };
  return (
    ts.isShorthandPropertyAssignment(parent) ||
    (parent.name !== identifier && parent.propertyName !== identifier)
  );
}

function isSafeImportReference(
  state: AnalysisState,
  binding: ViemLexicalBinding,
  identifier: Identifier
): boolean {
  const { ts } = state;
  const parent = identifier.parent;
  return binding.importIdentity === "viem/chains:arcTestnet"
    ? isDirectClientChainUse(state, identifier)
    : ts.isCallExpression(parent) && parent.expression === identifier;
}

function isDirectClientChainUse(
  state: AnalysisState,
  identifier: Identifier
): boolean {
  const property = identifier.parent;
  if (
    !state.ts.isPropertyAssignment(property) ||
    property.initializer !== identifier ||
    state.ts.isComputedPropertyName(property.name) ||
    property.name.text !== "chain"
  ) {
    return false;
  }
  const object = property.parent;
  const call = object.parent;
  if (
    !state.ts.isObjectLiteralExpression(object) ||
    !state.ts.isCallExpression(call) ||
    call.arguments.length !== 1 ||
    call.arguments[0] !== object
  ) {
    return false;
  }
  const imported = resolveExactViemImport(
    state.lexical,
    call.expression,
    "viem:createWalletClient",
    call.getStart(state.sourceFile)
  );
  return imported !== null && imported !== undefined;
}

async function loadCompiler(
  compilerLoader: () => Promise<unknown>
): Promise<TypeScript | null> {
  try {
    const trustedModule = await import("typescript");
    const trustedCandidates = compilerCandidates(trustedModule);
    const loaded = await compilerLoader();

    if (
      isTrustedCompilerCandidate(loaded, trustedCandidates) &&
      hasCompilerShape(loaded)
    ) {
      return loaded;
    }
    if (typeof loaded !== "object" || loaded === null) {
      return null;
    }

    const loadedDefault = (loaded as { readonly default?: unknown }).default;
    if (
      isTrustedCompilerCandidate(loadedDefault, trustedCandidates) &&
      hasCompilerShape(loadedDefault)
    ) {
      return loadedDefault;
    }
  } catch {
    return null;
  }
  return null;
}

function compilerCandidates(value: unknown): readonly unknown[] {
  if (typeof value !== "object" || value === null) return [value];
  const defaultValue = (value as { readonly default?: unknown }).default;
  return defaultValue === undefined ? [value] : [value, defaultValue];
}

function isTrustedCompilerCandidate(
  candidate: unknown,
  trustedCandidates: readonly unknown[]
): candidate is TypeScript {
  return trustedCandidates.some((trusted) => candidate === trusted);
}

function hasCompilerShape(value: unknown): value is TypeScript {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  for (const name of REQUIRED_COMPILER_FUNCTIONS) {
    if (typeof record[name] !== "function") return false;
  }

  const scriptKind = record.ScriptKind as Record<string, unknown> | undefined;
  const scriptTarget = record.ScriptTarget as
    | Record<string, unknown>
    | undefined;
  const nodeFlags = record.NodeFlags as Record<string, unknown> | undefined;
  const syntaxKind = record.SyntaxKind as Record<string, unknown> | undefined;
  return (
    typeof scriptKind?.JS === "number" &&
    typeof scriptKind.TS === "number" &&
    typeof scriptTarget?.Latest === "number" &&
    typeof nodeFlags?.Const === "number" &&
    typeof nodeFlags.BlockScoped === "number" &&
    typeof syntaxKind?.FirstAssignment === "number" &&
    typeof syntaxKind.LastAssignment === "number" &&
    typeof syntaxKind.PlusPlusToken === "number" &&
    typeof syntaxKind.MinusMinusToken === "number"
  );
}

// Compiler identity is already proven. These checks only validate the shape
// returned by the trusted compiler before the lexical analyzer consumes it.
function hasSourceFileShape(
  ts: TypeScript,
  value: unknown
): value is SourceFile & {
  readonly parseDiagnostics: readonly import("typescript").Diagnostic[];
} {
  if (typeof value !== "object" || value === null) return false;
  if (!ts.isSourceFile(value as import("typescript").Node)) return false;

  const record = value as Record<string, unknown>;
  return (
    typeof record.isDeclarationFile === "boolean" &&
    Array.isArray(record.parseDiagnostics) &&
    Array.isArray(record.statements) &&
    typeof record.fileName === "string" &&
    typeof record.text === "string" &&
    typeof record.end === "number" &&
    typeof record.getStart === "function"
  );
}
