/* eslint-disable @typescript-eslint/consistent-type-imports -- compiler loading must remain runtime-lazy */
type TypeScript = typeof import("typescript");
type Node = import("typescript").Node;
type Expression = import("typescript").Expression;
type Identifier = import("typescript").Identifier;
type BindingName = import("typescript").BindingName;
type SourceFile = import("typescript").SourceFile;
type CallExpression = import("typescript").CallExpression;
type NewExpression = import("typescript").NewExpression;
type ObjectLiteralExpression = import("typescript").ObjectLiteralExpression;
type EthersConstructorName = "JsonRpcProvider" | "Wallet";

export type EthersOwnershipState =
  | "proven-arc"
  | "proven-non-arc"
  | "unknown"
  | "conflicting";

export type EthersSignerProvenance = "ethers-wallet" | "ethers-json-rpc-signer";

export type EthersTransactionKind =
  | "proven-blob"
  | "proven-non-blob"
  | "unknown";

export type ArcTransactionSubmissionAnalysisStatus =
  | "analyzed"
  | "unsupported-file"
  | "compiler-unavailable"
  | "malformed"
  | "unsupported-source";

export interface EthersTransactionEvidence {
  readonly objectOffset: number;
  readonly safe: true;
  readonly chainId: "omitted" | EthersOwnershipState;
  readonly kind: EthersTransactionKind;
  readonly exactTypeToken?: 0 | 1 | 2 | 3 | 4;
  readonly supportedBlobFields: readonly (
    | "blobs"
    | "blobVersionedHashes"
    | "maxFeePerBlobGas"
  )[];
}

export interface EthersTransactionSubmission {
  readonly provenance: EthersSignerProvenance;
  readonly sink: "sendTransaction";
  readonly ownership: EthersOwnershipState;
  readonly callOffset: number;
  readonly transaction: EthersTransactionEvidence;
}

export interface ArcTransactionSubmissionAnalysis {
  readonly status: ArcTransactionSubmissionAnalysisStatus;
  readonly submissions: readonly EthersTransactionSubmission[];
}

interface LexicalDeclaration {
  readonly node: Node;
  readonly kind: "const" | "import" | "other";
  readonly initializer?: Expression;
  readonly importIdentity?:
    | "ethers:*"
    | "ethers:JsonRpcProvider"
    | "ethers:Wallet";
  reassigned: boolean;
}

type BindingTable = Map<Node, Map<string, LexicalDeclaration[]>>;

interface AnalysisState {
  readonly ts: TypeScript;
  readonly sourceFile: SourceFile;
  readonly bindings: BindingTable;
  readonly declarations: readonly LexicalDeclaration[];
  readonly namespaceConstructorMutations: Map<
    LexicalDeclaration,
    ReadonlySet<EthersConstructorName>
  >;
}

interface OwnershipEvidence {
  readonly arc: boolean;
  readonly nonArc: boolean;
  readonly stickyUnknown: boolean;
}

interface ProviderEvidence {
  readonly ownership: OwnershipEvidence;
  readonly critical: ReadonlySet<LexicalDeclaration>;
  readonly construction: NewExpression;
  readonly objectDeclaration?: LexicalDeclaration;
}

interface SignerEvidence {
  readonly provenance: EthersSignerProvenance;
  readonly provider: ProviderEvidence;
  readonly declaration: LexicalDeclaration;
  readonly critical: ReadonlySet<LexicalDeclaration>;
}

interface TransactionEvidenceInternal {
  readonly result: EthersTransactionEvidence;
  readonly chainId: "omitted" | OwnershipEvidence;
  readonly declaration?: LexicalDeclaration;
  readonly critical: ReadonlySet<LexicalDeclaration>;
  readonly objectCritical: ReadonlySet<LexicalDeclaration>;
}

interface Candidate {
  readonly result: EthersTransactionSubmission;
  readonly call: CallExpression;
  readonly signer: SignerEvidence;
  readonly transaction: TransactionEvidenceInternal;
  readonly critical: ReadonlySet<LexicalDeclaration>;
  readonly objectCritical: ReadonlySet<LexicalDeclaration>;
}

const ARC_CHAIN_ID = 5_042_002n;
const ARC_RPC = "https://rpc.testnet.arc.network";
const EMPTY_OWNERSHIP: OwnershipEvidence = {
  arc: false,
  nonArc: false,
  stickyUnknown: false
};
const UNKNOWN_OWNERSHIP: OwnershipEvidence = {
  arc: false,
  nonArc: false,
  stickyUnknown: true
};
const CRITICAL_TRANSACTION_KEYS = new Set([
  "type",
  "chainId",
  "blobs",
  "maxFeePerBlobGas",
  "blobVersionedHashes",
  "kzg"
]);
const ALLOWED_GLOBAL_MUTATORS = new Set([
  "Object.assign",
  "Object.defineProperty",
  "Object.defineProperties",
  "Object.setPrototypeOf",
  "Reflect.setPrototypeOf"
]);

export function supportsArcTransactionSubmissionPath(
  filePath: string
): boolean {
  const normalized = filePath.replaceAll("\\", "/");
  const fileName = normalized.slice(normalized.lastIndexOf("/") + 1);
  return (
    /\.[jt]s$/i.test(fileName) &&
    !/\.d\.ts$/i.test(fileName) &&
    !/\.(?:test|spec)\.[jt]s$/i.test(fileName) &&
    !/\.generated\.[jt]s$/i.test(fileName) &&
    !/(?:^|\/)(?:test|tests|__tests__|generated|dist|build|coverage)(?:\/|$)/i.test(
      normalized
    )
  );
}

export async function analyzeArcTransactionSubmissionFile(
  filePath: string,
  source: string,
  compilerLoader: () => Promise<unknown> = () => import("typescript")
): Promise<ArcTransactionSubmissionAnalysis> {
  if (!supportsArcTransactionSubmissionPath(filePath)) {
    return { status: "unsupported-file", submissions: [] };
  }

  let ts: TypeScript;
  try {
    ts = (await compilerLoader()) as TypeScript;
    if (
      typeof ts.createSourceFile !== "function" ||
      typeof ts.forEachChild !== "function"
    ) {
      return { status: "compiler-unavailable", submissions: [] };
    }
  } catch {
    return { status: "compiler-unavailable", submissions: [] };
  }

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
  const parseDiagnostics = (
    sourceFile as SourceFile & {
      readonly parseDiagnostics: readonly import("typescript").Diagnostic[];
    }
  ).parseDiagnostics;
  if (sourceFile.isDeclarationFile || parseDiagnostics.length > 0) {
    return { status: "malformed", submissions: [] };
  }

  const bindingResult = collectBindings(ts, sourceFile);
  const state: AnalysisState = {
    ts,
    sourceFile,
    bindings: bindingResult.bindings,
    declarations: bindingResult.declarations,
    namespaceConstructorMutations: new Map()
  };
  collectNamespaceConstructorMutations(state);

  if (hasWholeFileBarrier(state)) {
    return { status: "unsupported-source", submissions: [] };
  }

  const candidates = collectCandidates(state);
  if (candidates.length === 0) {
    return { status: "analyzed", submissions: [] };
  }

  const builtInSafety = validateBuiltInTargets(state, candidates);
  if (builtInSafety.wholeFileUnsupported) {
    return { status: "unsupported-source", submissions: [] };
  }

  const submissions = candidates
    .filter(
      (candidate) =>
        !builtInSafety.invalidCandidates.has(candidate) &&
        !hasCriticalMutationOrEscape(state, candidate, candidates)
    )
    .map((candidate) => candidate.result)
    .sort((left, right) => left.callOffset - right.callOffset);

  return { status: "analyzed", submissions };
}

function collectBindings(
  ts: TypeScript,
  sourceFile: SourceFile
): {
  readonly bindings: BindingTable;
  readonly declarations: readonly LexicalDeclaration[];
} {
  const bindings: BindingTable = new Map();
  const declarations: LexicalDeclaration[] = [];
  const writeIdentifiers: Identifier[] = [];

  const add = (
    scope: Node,
    name: string,
    declaration: Omit<LexicalDeclaration, "reassigned">
  ) => {
    const value: LexicalDeclaration = { ...declaration, reassigned: false };
    const byName = bindings.get(scope) ?? new Map();
    byName.set(name, [...(byName.get(name) ?? []), value]);
    bindings.set(scope, byName);
    declarations.push(value);
  };
  const addBinding = (
    scope: Node,
    name: BindingName,
    declaration: Omit<LexicalDeclaration, "reassigned">
  ) => {
    if (ts.isIdentifier(name)) {
      add(scope, name.text, declaration);
      return;
    }
    for (const element of name.elements) {
      if (!ts.isOmittedExpression(element)) {
        addBinding(scope, element.name, {
          node: declaration.node,
          kind: "other"
        });
      }
    }
  };

  function visit(node: Node, scope: Node, functionScope: Node): void {
    if (isAmbientRoot(ts, node)) return;

    if (
      (ts.isFunctionDeclaration(node) ||
        ts.isClassDeclaration(node) ||
        ts.isEnumDeclaration(node)) &&
      node.name !== undefined
    ) {
      add(scope, node.name.text, { node, kind: "other" });
    } else if (ts.isModuleDeclaration(node) && ts.isIdentifier(node.name)) {
      add(scope, node.name.text, { node: node.name, kind: "other" });
    }

    const currentScope = isLexicalScope(ts, node) ? node : scope;
    const currentFunction =
      ts.isSourceFile(node) || ts.isFunctionLike(node) ? node : functionScope;

    if (ts.isVariableDeclaration(node)) {
      const list = ts.isVariableDeclarationList(node.parent)
        ? node.parent
        : undefined;
      const isConst =
        list !== undefined &&
        (list.flags & ts.NodeFlags.Const) !== 0 &&
        node.initializer !== undefined;
      const blockScoped =
        ts.isCatchClause(node.parent) ||
        (list !== undefined && (list.flags & ts.NodeFlags.BlockScoped) !== 0);
      addBinding(
        blockScoped ? currentScope : currentFunction,
        node.name,
        isConst
          ? { node, kind: "const", initializer: node.initializer }
          : { node, kind: "other" }
      );
    } else if (ts.isParameter(node)) {
      addBinding(currentFunction, node.name, { node, kind: "other" });
    } else if (ts.isImportEqualsDeclaration(node) && !node.isTypeOnly) {
      add(currentScope, node.name.text, { node: node.name, kind: "other" });
    } else if (ts.isImportDeclaration(node)) {
      collectImportBindings(ts, node, currentScope, add);
    } else if (ts.isFunctionExpression(node) && node.name !== undefined) {
      add(currentScope, node.name.text, { node, kind: "other" });
    } else if (ts.isClassExpression(node) && node.name !== undefined) {
      add(currentScope, node.name.text, { node: node.name, kind: "other" });
    }

    collectAssignmentTargetIdentifiers(ts, node, writeIdentifiers);
    ts.forEachChild(node, (child) =>
      visit(child, currentScope, currentFunction)
    );
  }

  visit(sourceFile, sourceFile, sourceFile);
  const state: AnalysisState = {
    ts,
    sourceFile,
    bindings,
    declarations,
    namespaceConstructorMutations: new Map()
  };
  for (const identifier of writeIdentifiers) {
    const declaration = resolveLexical(state, identifier, true);
    if (declaration !== null && declaration !== undefined) {
      declaration.reassigned = true;
    }
  }
  return { bindings, declarations };
}

function collectImportBindings(
  ts: TypeScript,
  node: import("typescript").ImportDeclaration,
  scope: Node,
  add: (
    scope: Node,
    name: string,
    declaration: Omit<LexicalDeclaration, "reassigned">
  ) => void
): void {
  const clause = node.importClause;
  if (clause === undefined || clause.isTypeOnly) return;
  const exactEthers =
    ts.isStringLiteral(node.moduleSpecifier) &&
    node.moduleSpecifier.text === "ethers";
  if (clause.name !== undefined) {
    add(scope, clause.name.text, { node: clause, kind: "import" });
  }
  const named = clause.namedBindings;
  if (named !== undefined && ts.isNamespaceImport(named)) {
    add(scope, named.name.text, {
      node: named,
      kind: "import",
      importIdentity: exactEthers ? "ethers:*" : undefined
    });
    return;
  }
  if (named === undefined || !ts.isNamedImports(named)) return;
  for (const element of named.elements) {
    if (element.isTypeOnly) continue;
    const importedName = element.propertyName?.text ?? element.name.text;
    const importIdentity =
      exactEthers &&
      (importedName === "JsonRpcProvider" || importedName === "Wallet")
        ? (`ethers:${importedName}` as
            | "ethers:JsonRpcProvider"
            | "ethers:Wallet")
        : undefined;
    add(scope, element.name.text, {
      node: element,
      kind: "import",
      importIdentity
    });
  }
}

function collectAssignmentTargetIdentifiers(
  ts: TypeScript,
  node: Node,
  writes: Identifier[]
): void {
  if (
    ts.isBinaryExpression(node) &&
    isAssignmentOperator(ts, node.operatorToken.kind)
  ) {
    collectTargetIdentifiers(ts, node.left, writes);
    return;
  }
  if (
    (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
    (node.operator === ts.SyntaxKind.PlusPlusToken ||
      node.operator === ts.SyntaxKind.MinusMinusToken)
  ) {
    collectTargetIdentifiers(ts, node.operand, writes);
    return;
  }
  if (
    (ts.isForInStatement(node) || ts.isForOfStatement(node)) &&
    !ts.isVariableDeclarationList(node.initializer)
  ) {
    collectTargetIdentifiers(ts, node.initializer, writes);
  }
}

function collectTargetIdentifiers(
  ts: TypeScript,
  node: Node,
  writes: Identifier[]
): void {
  if (ts.isIdentifier(node)) {
    writes.push(node);
    return;
  }
  if (ts.isParenthesizedExpression(node)) {
    collectTargetIdentifiers(ts, node.expression, writes);
    return;
  }
  if (ts.isArrayLiteralExpression(node)) {
    for (const element of node.elements) {
      if (!ts.isOmittedExpression(element)) {
        collectTargetIdentifiers(
          ts,
          ts.isSpreadElement(element) ? element.expression : element,
          writes
        );
      }
    }
    return;
  }
  if (ts.isObjectLiteralExpression(node)) {
    for (const property of node.properties) {
      if (ts.isShorthandPropertyAssignment(property)) {
        writes.push(property.name);
      } else if (ts.isPropertyAssignment(property)) {
        collectTargetIdentifiers(ts, property.initializer, writes);
      } else if (ts.isSpreadAssignment(property)) {
        collectTargetIdentifiers(ts, property.expression, writes);
      }
    }
  }
}

function resolveLexical(
  state: AnalysisState,
  use: Identifier,
  allowBefore = false
): LexicalDeclaration | null | undefined {
  const declaration = lookupLexical(state, use);
  if (declaration === null || declaration === undefined) return declaration;
  return (!allowBefore && use.getStart() < declaration.node.end) ||
    declaration.reassigned
    ? null
    : declaration;
}

function lookupLexical(
  state: AnalysisState,
  use: Identifier
): LexicalDeclaration | null | undefined {
  let scope: Node | undefined = use.parent;
  while (scope !== undefined) {
    const declarations = state.bindings.get(scope)?.get(use.text);
    if (declarations !== undefined) {
      if (declarations.length !== 1) return null;
      return declarations[0];
    }
    scope = scope.parent;
  }
  return undefined;
}

function isLexicalScope(ts: TypeScript, node: Node): boolean {
  return (
    ts.isSourceFile(node) ||
    ts.isBlock(node) ||
    ts.isModuleDeclaration(node) ||
    ts.isModuleBlock(node) ||
    ts.isCaseBlock(node) ||
    ts.isCatchClause(node) ||
    ts.isIterationStatement(node, false) ||
    ts.isClassExpression(node) ||
    ts.isFunctionLike(node)
  );
}

function isAmbientRoot(ts: TypeScript, node: Node): boolean {
  return (
    (ts.isModuleDeclaration(node) && ts.isStringLiteral(node.name)) ||
    (ts.canHaveModifiers(node) &&
      ts
        .getModifiers(node)
        ?.some((modifier) => modifier.kind === ts.SyntaxKind.DeclareKeyword) ===
        true)
  );
}

function isAssignmentOperator(ts: TypeScript, kind: number): boolean {
  return (
    kind >= ts.SyntaxKind.FirstAssignment &&
    kind <= ts.SyntaxKind.LastAssignment
  );
}

function unwrapParentheses(ts: TypeScript, expression: Expression): Expression {
  let current = expression;
  while (ts.isParenthesizedExpression(current)) current = current.expression;
  return current;
}

function constInitializer(
  state: AnalysisState,
  identifier: Identifier
):
  | { readonly declaration: LexicalDeclaration; readonly value: Expression }
  | undefined {
  const declaration = resolveLexical(state, identifier);
  return declaration?.kind === "const" &&
    declaration.initializer !== undefined &&
    !declaration.reassigned
    ? { declaration, value: declaration.initializer }
    : undefined;
}

function isExactImportIdentity(
  state: AnalysisState,
  expression: Expression,
  expected: EthersConstructorName
): boolean {
  const target = unwrapParentheses(state.ts, expression);
  if (state.ts.isIdentifier(target)) {
    return (
      resolveLexical(state, target)?.importIdentity === `ethers:${expected}`
    );
  }
  if (
    !state.ts.isPropertyAccessExpression(target) ||
    target.questionDotToken !== undefined ||
    target.name.text !== expected ||
    !state.ts.isIdentifier(target.expression)
  ) {
    return false;
  }
  const namespace = resolveLexical(state, target.expression);
  return (
    namespace?.importIdentity === "ethers:*" &&
    !state.namespaceConstructorMutations.get(namespace)?.has(expected)
  );
}

function collectNamespaceConstructorMutations(state: AnalysisState): void {
  const mutations = new Map<LexicalDeclaration, Set<EthersConstructorName>>();
  const record = (expression: Expression) => {
    const target = unwrapParentheses(state.ts, expression);
    if (
      !state.ts.isPropertyAccessExpression(target) &&
      !state.ts.isElementAccessExpression(target)
    ) {
      return;
    }
    const name = staticAccessName(state.ts, target);
    if (name !== "Wallet" && name !== "JsonRpcProvider") return;
    const receiver = unwrapParentheses(state.ts, target.expression);
    if (!state.ts.isIdentifier(receiver)) return;
    const declaration = resolveLexical(state, receiver);
    if (declaration?.importIdentity !== "ethers:*") return;
    const names = mutations.get(declaration) ?? new Set();
    names.add(name);
    mutations.set(declaration, names);
  };

  visitExecutable(state, state.sourceFile, (node) => {
    const { ts } = state;
    if (
      ts.isBinaryExpression(node) &&
      isAssignmentOperator(ts, node.operatorToken.kind)
    ) {
      record(node.left);
      return;
    }
    if (
      (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
      (node.operator === ts.SyntaxKind.PlusPlusToken ||
        node.operator === ts.SyntaxKind.MinusMinusToken)
    ) {
      record(node.operand);
      return;
    }
    if (ts.isDeleteExpression(node)) record(node.expression);
  });
  for (const [declaration, names] of mutations) {
    state.namespaceConstructorMutations.set(declaration, names);
  }
}

function collectCandidates(state: AnalysisState): Candidate[] {
  const candidates: Candidate[] = [];
  visitExecutable(state, state.sourceFile, (node) => {
    if (!state.ts.isCallExpression(node)) return;
    const candidate = candidateFromCall(state, node);
    if (candidate !== undefined) candidates.push(candidate);
  });
  return candidates.sort(
    (left, right) => left.result.callOffset - right.result.callOffset
  );
}

function candidateFromCall(
  state: AnalysisState,
  call: CallExpression
): Candidate | undefined {
  const { ts } = state;
  if (
    call.questionDotToken !== undefined ||
    call.arguments.length !== 1 ||
    ts.isSpreadElement(call.arguments[0])
  ) {
    return undefined;
  }
  const callee = call.expression;
  if (
    !ts.isPropertyAccessExpression(callee) ||
    callee.questionDotToken !== undefined ||
    callee.name.text !== "sendTransaction"
  ) {
    return undefined;
  }
  const receiver = unwrapParentheses(ts, callee.expression);
  if (!ts.isIdentifier(receiver)) return undefined;
  const signer = signerFromBinding(state, receiver);
  if (signer === undefined) return undefined;
  const transaction = transactionFromExpression(state, call.arguments[0]);
  if (transaction === undefined) return undefined;

  const critical = new Set([...signer.critical, ...transaction.critical]);
  const objectCritical = new Set<LexicalDeclaration>([
    signer.declaration,
    ...(signer.provider.objectDeclaration === undefined
      ? []
      : [signer.provider.objectDeclaration]),
    ...(transaction.declaration === undefined ? [] : [transaction.declaration]),
    ...transaction.objectCritical
  ]);
  const ownership = effectiveOwnership(
    signer.provider.ownership,
    transaction.chainId
  );
  const result: EthersTransactionSubmission = {
    provenance: signer.provenance,
    sink: "sendTransaction",
    ownership,
    callOffset: call.getStart(state.sourceFile),
    transaction: transaction.result
  };
  return {
    result,
    call,
    signer,
    transaction,
    critical,
    objectCritical
  };
}

function signerFromBinding(
  state: AnalysisState,
  identifier: Identifier
): SignerEvidence | undefined {
  const binding = constInitializer(state, identifier);
  if (binding === undefined) return undefined;
  const initializer = unwrapParentheses(state.ts, binding.value);
  const wallet = walletFromExpression(state, initializer);
  if (wallet !== undefined) {
    return {
      provenance: "ethers-wallet",
      provider: wallet,
      declaration: binding.declaration,
      critical: new Set([...wallet.critical, binding.declaration])
    };
  }
  const provider = jsonRpcSignerProvider(state, initializer);
  if (provider === undefined) return undefined;
  return {
    provenance: "ethers-json-rpc-signer",
    provider,
    declaration: binding.declaration,
    critical: new Set([...provider.critical, binding.declaration])
  };
}

function walletFromExpression(
  state: AnalysisState,
  expression: Expression
): ProviderEvidence | undefined {
  const { ts } = state;
  if (
    !ts.isNewExpression(expression) ||
    !isExactImportIdentity(state, expression.expression, "Wallet") ||
    expression.arguments === undefined ||
    expression.arguments.length !== 2 ||
    expression.arguments.some((argument) => ts.isSpreadElement(argument))
  ) {
    return undefined;
  }
  return providerFromExpression(state, expression.arguments[1], true);
}

function jsonRpcSignerProvider(
  state: AnalysisState,
  expression: Expression
): ProviderEvidence | undefined {
  const { ts } = state;
  if (
    !ts.isAwaitExpression(expression) ||
    !validAwaitContext(state, expression)
  ) {
    return undefined;
  }
  const call = unwrapParentheses(ts, expression.expression);
  if (
    !ts.isCallExpression(call) ||
    call.questionDotToken !== undefined ||
    call.arguments.length !== 0 ||
    !ts.isPropertyAccessExpression(call.expression) ||
    call.expression.questionDotToken !== undefined ||
    call.expression.name.text !== "getSigner"
  ) {
    return undefined;
  }
  const receiver = unwrapParentheses(ts, call.expression.expression);
  return ts.isIdentifier(receiver)
    ? providerFromExpression(state, receiver, false)
    : undefined;
}

function providerFromExpression(
  state: AnalysisState,
  expression: Expression,
  allowDirect: boolean
): ProviderEvidence | undefined {
  const { ts } = state;
  const target = unwrapParentheses(ts, expression);
  if (ts.isIdentifier(target)) {
    const binding = constInitializer(state, target);
    if (binding === undefined) return undefined;
    const provider = providerFromConstruction(
      state,
      unwrapParentheses(ts, binding.value)
    );
    if (provider === undefined) return undefined;
    return {
      ownership: provider.ownership,
      critical: new Set([...provider.critical, binding.declaration]),
      construction: provider.construction,
      objectDeclaration: binding.declaration
    };
  }
  return allowDirect ? providerFromConstruction(state, target) : undefined;
}

function providerFromConstruction(
  state: AnalysisState,
  expression: Expression
): ProviderEvidence | undefined {
  const { ts } = state;
  if (
    !ts.isNewExpression(expression) ||
    !isExactImportIdentity(state, expression.expression, "JsonRpcProvider") ||
    expression.arguments === undefined ||
    (expression.arguments.length !== 1 && expression.arguments.length !== 2) ||
    expression.arguments.some((argument) => ts.isSpreadElement(argument))
  ) {
    return undefined;
  }
  const rpc = rpcEvidence(state, expression.arguments[0]);
  if (rpc === undefined) return undefined;
  const network =
    expression.arguments.length === 2
      ? providerNetworkEvidence(state, expression.arguments[1])
      : { ownership: EMPTY_OWNERSHIP, critical: new Set<LexicalDeclaration>() };
  if (network === undefined) return undefined;
  return {
    ownership: mergeOwnership(rpc.ownership, network.ownership),
    critical: new Set([...rpc.critical, ...network.critical]),
    construction: expression
  };
}

function rpcEvidence(
  state: AnalysisState,
  expression: Expression
):
  | {
      readonly ownership: OwnershipEvidence;
      readonly critical: ReadonlySet<LexicalDeclaration>;
    }
  | undefined {
  const direct = unwrapParentheses(state.ts, expression);
  if (state.ts.isStringLiteral(direct)) {
    return {
      ownership: ownershipFromRpcString(direct.text),
      critical: new Set()
    };
  }
  if (!state.ts.isIdentifier(direct)) {
    return { ownership: UNKNOWN_OWNERSHIP, critical: new Set() };
  }
  const declaration = lookupLexical(state, direct);
  if (declaration === undefined) {
    return { ownership: UNKNOWN_OWNERSHIP, critical: new Set() };
  }
  if (
    declaration === null ||
    declaration.kind !== "const" ||
    declaration.initializer === undefined ||
    declaration.reassigned ||
    direct.getStart() < declaration.node.end
  ) {
    return undefined;
  }
  const binding = { declaration, value: declaration.initializer };
  const value = unwrapParentheses(state.ts, binding.value);
  if (state.ts.isIdentifier(value)) return undefined;
  if (!state.ts.isStringLiteral(value)) {
    return {
      ownership: UNKNOWN_OWNERSHIP,
      critical: new Set([binding.declaration])
    };
  }
  return {
    ownership: ownershipFromRpcString(value.text),
    critical: new Set([binding.declaration])
  };
}

function ownershipFromRpcString(value: string): OwnershipEvidence {
  return {
    arc: value === ARC_RPC,
    nonArc: isKnownNonArcRpc(value),
    stickyUnknown: false
  };
}

function isKnownNonArcRpc(value: string): boolean {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/\.$/, "");
    const firstPath = url.pathname.split("/").filter(Boolean)[0]?.toLowerCase();
    return (
      host === "cloudflare-eth.com" ||
      host.endsWith(".infura.io") ||
      host.endsWith(".alchemy.com") ||
      host.includes("ethereum") ||
      (host === "rpc.ankr.com" &&
        ["eth", "eth_sepolia", "eth_holesky"].includes(firstPath ?? ""))
    );
  } catch {
    return false;
  }
}

function providerNetworkEvidence(
  state: AnalysisState,
  expression: Expression
):
  | {
      readonly ownership: OwnershipEvidence;
      readonly critical: ReadonlySet<LexicalDeclaration>;
    }
  | undefined {
  const direct = unwrapParentheses(state.ts, expression);
  const directValue = providerNetworkLiteral(state, direct);
  if (directValue !== undefined) {
    return { ownership: directValue, critical: new Set() };
  }
  if (!state.ts.isIdentifier(direct)) {
    return { ownership: UNKNOWN_OWNERSHIP, critical: new Set() };
  }
  const declaration = lookupLexical(state, direct);
  if (declaration === undefined) {
    return { ownership: UNKNOWN_OWNERSHIP, critical: new Set() };
  }
  if (
    declaration === null ||
    declaration.kind !== "const" ||
    declaration.initializer === undefined ||
    declaration.reassigned ||
    direct.getStart() < declaration.node.end
  ) {
    return undefined;
  }
  const binding = { declaration, value: declaration.initializer };
  const initializer = unwrapParentheses(state.ts, binding.value);
  if (state.ts.isIdentifier(initializer)) return undefined;
  const value = providerNetworkLiteral(state, initializer);
  return {
    ownership: value ?? UNKNOWN_OWNERSHIP,
    critical: new Set([binding.declaration])
  };
}

function providerNetworkLiteral(
  state: AnalysisState,
  expression: Expression
): OwnershipEvidence | undefined {
  if (state.ts.isStringLiteral(expression)) {
    return expression.text === "mainnet"
      ? { arc: false, nonArc: true, stickyUnknown: false }
      : undefined;
  }
  const value = supportedPositiveIntegerLiteral(state, expression, false);
  return value === undefined ? undefined : ownershipFromInteger(value);
}

function transactionFromExpression(
  state: AnalysisState,
  expression: Expression
): TransactionEvidenceInternal | undefined {
  const direct = unwrapParentheses(state.ts, expression);
  if (state.ts.isObjectLiteralExpression(direct)) {
    return transactionFromObject(state, direct);
  }
  if (!state.ts.isIdentifier(direct)) return undefined;
  const binding = constInitializer(state, direct);
  if (binding === undefined) return undefined;
  const value = unwrapParentheses(state.ts, binding.value);
  if (!state.ts.isObjectLiteralExpression(value)) return undefined;
  const transaction = transactionFromObject(state, value);
  if (transaction === undefined) return undefined;
  return {
    ...transaction,
    declaration: binding.declaration,
    critical: new Set([...transaction.critical, binding.declaration])
  };
}

function transactionFromObject(
  state: AnalysisState,
  object: ObjectLiteralExpression
): TransactionEvidenceInternal | undefined {
  const properties = safeTransactionProperties(state, object);
  if (properties === undefined) return undefined;
  const type = transactionTypeEvidence(state, properties.get("type"));
  const chainId =
    properties.has("chainId") && properties.get("chainId") !== undefined
      ? transactionChainIdEvidence(state, properties.get("chainId")!)
      : "omitted";
  const critical = new Set<LexicalDeclaration>();
  const objectCritical = new Set<LexicalDeclaration>();
  const supportedBlobFields: (
    | "blobs"
    | "blobVersionedHashes"
    | "maxFeePerBlobGas"
  )[] = [];

  for (const name of ["blobs", "blobVersionedHashes"] as const) {
    const value = properties.get(name);
    if (value === undefined) continue;
    const support = supportedDenseArray(state, value);
    if (support.invalidBinding) return undefined;
    if (support.supported) supportedBlobFields.push(name);
    if (support.declaration !== undefined) {
      critical.add(support.declaration);
      if (support.objectBinding === true) {
        objectCritical.add(support.declaration);
      }
    }
  }
  const fee = properties.get("maxFeePerBlobGas");
  if (fee !== undefined) {
    const support = supportedBlobFee(state, fee);
    if (support.invalidBinding) return undefined;
    if (support.supported) supportedBlobFields.push("maxFeePerBlobGas");
    if (support.declaration !== undefined) critical.add(support.declaration);
  }

  return {
    result: {
      objectOffset: object.getStart(state.sourceFile),
      safe: true,
      chainId: chainId === "omitted" ? "omitted" : ownershipState(chainId),
      kind: type.kind,
      ...(type.token === undefined ? {} : { exactTypeToken: type.token }),
      supportedBlobFields
    },
    chainId,
    critical,
    objectCritical
  };
}

function safeTransactionProperties(
  state: AnalysisState,
  object: ObjectLiteralExpression
): Map<string, Expression> | undefined {
  const result = new Map<string, Expression>();
  for (const property of object.properties) {
    if (
      state.ts.isSpreadAssignment(property) ||
      state.ts.isGetAccessorDeclaration(property) ||
      state.ts.isSetAccessorDeclaration(property) ||
      state.ts.isMethodDeclaration(property)
    ) {
      return undefined;
    }
    const name = property.name;
    if (name !== undefined && state.ts.isComputedPropertyName(name)) {
      return undefined;
    }
    const key = staticPropertyName(state.ts, name);
    if (key === "__proto__") return undefined;
    if (
      key !== undefined &&
      CRITICAL_TRANSACTION_KEYS.has(key) &&
      result.has(key)
    ) {
      return undefined;
    }
    if (state.ts.isShorthandPropertyAssignment(property)) {
      if (key !== undefined && CRITICAL_TRANSACTION_KEYS.has(key)) {
        return undefined;
      }
      continue;
    }
    if (!state.ts.isPropertyAssignment(property)) return undefined;
    if (key !== undefined && CRITICAL_TRANSACTION_KEYS.has(key)) {
      result.set(key, property.initializer);
    }
  }
  return result;
}

function transactionTypeEvidence(
  state: AnalysisState,
  expression: Expression | undefined
): {
  readonly kind: EthersTransactionKind;
  readonly token?: 0 | 1 | 2 | 3 | 4;
} {
  if (expression === undefined) return { kind: "unknown" };
  const target = unwrapParentheses(state.ts, expression);
  if (!state.ts.isNumericLiteral(target)) return { kind: "unknown" };
  const text = target.getText(state.sourceFile);
  if (!/^[0-4]$/.test(text)) return { kind: "unknown" };
  const token = Number(text) as 0 | 1 | 2 | 3 | 4;
  return { kind: token === 3 ? "proven-blob" : "proven-non-blob", token };
}

function transactionChainIdEvidence(
  state: AnalysisState,
  expression: Expression
): OwnershipEvidence {
  const target = unwrapParentheses(state.ts, expression);
  if (state.ts.isIdentifier(target)) return UNKNOWN_OWNERSHIP;
  const value = supportedPositiveIntegerLiteral(state, target, true);
  return value === undefined ? UNKNOWN_OWNERSHIP : ownershipFromInteger(value);
}

function supportedPositiveIntegerLiteral(
  state: AnalysisState,
  expression: Expression,
  allowString: boolean
): bigint | undefined {
  const text = expression.getText(state.sourceFile);
  if (state.ts.isNumericLiteral(expression)) {
    if (!/^(?:[0-9]+|0[xX][0-9a-fA-F]+)$/.test(text)) return undefined;
    const numberValue = Number(text);
    if (!Number.isSafeInteger(numberValue) || numberValue <= 0) {
      return undefined;
    }
    return BigInt(numberValue);
  }
  if (state.ts.isBigIntLiteral(expression)) {
    if (!/^(?:[0-9]+|0[xX][0-9a-fA-F]+)n$/.test(text)) return undefined;
    try {
      const value = BigInt(text.slice(0, -1));
      return value > 0n ? value : undefined;
    } catch {
      return undefined;
    }
  }
  if (allowString && state.ts.isStringLiteral(expression)) {
    const value = expression.text;
    if (!/^(?:[0-9]+|0[xX][0-9a-fA-F]+)$/.test(value)) return undefined;
    try {
      const parsed = BigInt(value);
      return parsed > 0n ? parsed : undefined;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function ownershipFromInteger(value: bigint): OwnershipEvidence {
  return {
    arc: value === ARC_CHAIN_ID,
    nonArc: value !== ARC_CHAIN_ID,
    stickyUnknown: false
  };
}

function mergeOwnership(
  left: OwnershipEvidence,
  right: OwnershipEvidence
): OwnershipEvidence {
  if (left.stickyUnknown || right.stickyUnknown) return UNKNOWN_OWNERSHIP;
  return {
    arc: left.arc || right.arc,
    nonArc: left.nonArc || right.nonArc,
    stickyUnknown: false
  };
}

function ownershipState(evidence: OwnershipEvidence): EthersOwnershipState {
  if (evidence.arc && evidence.nonArc) return "conflicting";
  if (evidence.stickyUnknown) return "unknown";
  if (evidence.arc) return "proven-arc";
  if (evidence.nonArc) return "proven-non-arc";
  return "unknown";
}

function effectiveOwnership(
  provider: OwnershipEvidence,
  chainId: "omitted" | OwnershipEvidence
): EthersOwnershipState {
  const providerState = ownershipState(provider);
  if (providerState === "conflicting") return "conflicting";
  if (chainId === "omitted") return providerState;
  if (chainId.stickyUnknown) return "unknown";
  if (provider.stickyUnknown) return "unknown";
  return ownershipState(mergeOwnership(provider, chainId));
}

function supportedDenseArray(
  state: AnalysisState,
  expression: Expression
): {
  readonly supported: boolean;
  readonly declaration?: LexicalDeclaration;
  readonly objectBinding?: boolean;
  readonly invalidBinding?: boolean;
} {
  const target = unwrapParentheses(state.ts, expression);
  if (state.ts.isArrayLiteralExpression(target)) {
    return { supported: isDenseArray(state, target) };
  }
  if (!state.ts.isIdentifier(target)) return { supported: false };
  const declaration = lookupLexical(state, target);
  if (declaration === undefined) return { supported: false };
  if (
    declaration === null ||
    declaration.kind !== "const" ||
    declaration.initializer === undefined ||
    declaration.reassigned ||
    target.getStart() < declaration.node.end
  ) {
    return { supported: false, invalidBinding: true };
  }
  const binding = { declaration, value: declaration.initializer };
  const value = unwrapParentheses(state.ts, binding.value);
  if (state.ts.isIdentifier(value)) {
    return { supported: false, invalidBinding: true };
  }
  return {
    supported:
      state.ts.isArrayLiteralExpression(value) && isDenseArray(state, value),
    declaration: binding.declaration,
    objectBinding: state.ts.isArrayLiteralExpression(value)
  };
}

function isDenseArray(
  state: AnalysisState,
  array: import("typescript").ArrayLiteralExpression
): boolean {
  return (
    array.elements.length > 0 &&
    array.elements.every(
      (element) =>
        !state.ts.isOmittedExpression(element) &&
        !state.ts.isSpreadElement(element) &&
        element.kind !== state.ts.SyntaxKind.NullKeyword &&
        !(
          state.ts.isIdentifier(element) &&
          element.text === "undefined" &&
          resolveLexical(state, element) === undefined
        ) &&
        !state.ts.isVoidExpression(element)
    )
  );
}

function supportedBlobFee(
  state: AnalysisState,
  expression: Expression
): {
  readonly supported: boolean;
  readonly declaration?: LexicalDeclaration;
  readonly invalidBinding?: boolean;
} {
  const target = unwrapParentheses(state.ts, expression);
  if (isNonNegativeSafeIntegerOrBigInt(state, target)) {
    return { supported: true };
  }
  if (!state.ts.isIdentifier(target)) return { supported: false };
  const declaration = lookupLexical(state, target);
  if (declaration === undefined) return { supported: false };
  if (
    declaration === null ||
    declaration.kind !== "const" ||
    declaration.initializer === undefined ||
    declaration.reassigned ||
    target.getStart() < declaration.node.end
  ) {
    return { supported: false, invalidBinding: true };
  }
  const binding = { declaration, value: declaration.initializer };
  if (state.ts.isIdentifier(unwrapParentheses(state.ts, binding.value))) {
    return { supported: false, invalidBinding: true };
  }
  return {
    supported: isNonNegativeSafeIntegerOrBigInt(
      state,
      unwrapParentheses(state.ts, binding.value)
    ),
    declaration: binding.declaration
  };
}

function isNonNegativeSafeIntegerOrBigInt(
  state: AnalysisState,
  expression: Expression
): boolean {
  const text = expression.getText(state.sourceFile);
  if (state.ts.isNumericLiteral(expression)) {
    if (!/^(?:[0-9]+|0[xX][0-9a-fA-F]+)$/.test(text)) return false;
    const value = Number(text);
    return Number.isSafeInteger(value) && value >= 0;
  }
  if (!state.ts.isBigIntLiteral(expression)) return false;
  if (!/^(?:[0-9]+|0[xX][0-9a-fA-F]+)n$/.test(text)) return false;
  try {
    return BigInt(text.slice(0, -1)) >= 0n;
  } catch {
    return false;
  }
}

function validAwaitContext(state: AnalysisState, awaitNode: Node): boolean {
  let parent = awaitNode.parent;
  while (parent !== undefined) {
    if (state.ts.isFunctionLike(parent)) {
      return (
        state.ts.canHaveModifiers(parent) &&
        state.ts
          .getModifiers(parent)
          ?.some(
            (modifier) => modifier.kind === state.ts.SyntaxKind.AsyncKeyword
          ) === true
      );
    }
    if (
      state.ts.isModuleDeclaration(parent) ||
      state.ts.isClassLike(parent) ||
      state.ts.isEnumDeclaration(parent)
    ) {
      return false;
    }
    if (state.ts.isSourceFile(parent)) return state.ts.isExternalModule(parent);
    parent = parent.parent;
  }
  return false;
}

function hasWholeFileBarrier(state: AnalysisState): boolean {
  let barrier = false;
  visitExecutable(state, state.sourceFile, (node) => {
    if (barrier) return;
    const { ts } = state;
    if (ts.isElementAccessExpression(node)) {
      const name = staticElementName(ts, node);
      if (name === undefined || name === "prototype" || name === "__proto__") {
        barrier = true;
        return;
      }
    }
    if (
      ts.isPropertyAccessExpression(node) &&
      (node.name.text === "prototype" || node.name.text === "__proto__")
    ) {
      barrier = true;
      return;
    }
    if (
      (ts.isCallExpression(node) || ts.isNewExpression(node)) &&
      isConstructorNamedCallee(ts, node.expression)
    ) {
      barrier = true;
      return;
    }
    if (ts.isIdentifier(node) && isExecutableIdentifierValue(state, node)) {
      const declaration = resolveLexical(state, node);
      if (
        declaration === undefined &&
        ["eval", "Function", "globalThis", "window", "self", "global"].includes(
          node.text
        )
      ) {
        barrier = true;
        return;
      }
      if (
        declaration === undefined &&
        (node.text === "Object" || node.text === "Reflect") &&
        !isAllowedGlobalBuiltInUse(state, node)
      ) {
        barrier = true;
      }
    }
  });
  return barrier;
}

function isConstructorNamedCallee(
  ts: TypeScript,
  expression: Expression
): boolean {
  const target = unwrapParentheses(ts, expression);
  if (ts.isPropertyAccessExpression(target)) {
    return target.name.text === "constructor";
  }
  return (
    ts.isElementAccessExpression(target) &&
    staticElementName(ts, target) === "constructor"
  );
}

function isExecutableIdentifierValue(
  state: AnalysisState,
  identifier: Identifier
): boolean {
  const parent = identifier.parent;
  const { ts } = state;
  if (
    (ts.isPropertyAccessExpression(parent) && parent.name === identifier) ||
    (ts.isPropertyAssignment(parent) && parent.name === identifier) ||
    (ts.isPropertyDeclaration(parent) && parent.name === identifier) ||
    (ts.isMethodDeclaration(parent) && parent.name === identifier) ||
    (ts.isGetAccessorDeclaration(parent) && parent.name === identifier) ||
    (ts.isSetAccessorDeclaration(parent) && parent.name === identifier) ||
    (ts.isBindingElement(parent) &&
      (parent.name === identifier || parent.propertyName === identifier)) ||
    (ts.isEnumMember(parent) && parent.name === identifier) ||
    (ts.isLabeledStatement(parent) && parent.label === identifier) ||
    (ts.isBreakStatement(parent) && parent.label === identifier) ||
    (ts.isContinueStatement(parent) && parent.label === identifier) ||
    (ts.isVariableDeclaration(parent) && parent.name === identifier) ||
    (ts.isParameter(parent) && parent.name === identifier) ||
    (ts.isFunctionDeclaration(parent) && parent.name === identifier) ||
    (ts.isFunctionExpression(parent) && parent.name === identifier) ||
    (ts.isClassDeclaration(parent) && parent.name === identifier) ||
    (ts.isClassExpression(parent) && parent.name === identifier) ||
    (ts.isEnumDeclaration(parent) && parent.name === identifier) ||
    (ts.isModuleDeclaration(parent) && parent.name === identifier) ||
    (ts.isImportEqualsDeclaration(parent) && parent.name === identifier) ||
    (ts.isImportClause(parent) && parent.name === identifier) ||
    ts.isImportSpecifier(parent) ||
    ts.isNamespaceImport(parent) ||
    ts.isExportSpecifier(parent)
  ) {
    return false;
  }
  return true;
}

function isAllowedGlobalBuiltInUse(
  state: AnalysisState,
  identifier: Identifier
): boolean {
  const parent = identifier.parent;
  if (
    !state.ts.isPropertyAccessExpression(parent) &&
    !state.ts.isElementAccessExpression(parent)
  ) {
    return false;
  }
  if (parent.expression !== identifier) return false;
  if (parent.questionDotToken !== undefined) return false;
  const name = staticAccessName(state.ts, parent);
  if (name === undefined) return false;
  const grandparent = parent.parent;
  if (
    !state.ts.isCallExpression(grandparent) ||
    grandparent.expression !== parent ||
    grandparent.questionDotToken !== undefined
  ) {
    return false;
  }
  return ALLOWED_GLOBAL_MUTATORS.has(`${identifier.text}.${name}`);
}

function validateBuiltInTargets(
  state: AnalysisState,
  candidates: readonly Candidate[]
): {
  readonly wholeFileUnsupported: boolean;
  readonly invalidCandidates: ReadonlySet<Candidate>;
} {
  let wholeFileUnsupported = false;
  const invalidCandidates = new Set<Candidate>();
  const aliasesByCandidate = new Map(
    candidates.map(
      (candidate) => [candidate, aliasesForCandidate(state, candidate)] as const
    )
  );
  visitExecutable(state, state.sourceFile, (node) => {
    if (!state.ts.isCallExpression(node)) return;
    const builtIn = globalBuiltInCall(state, node);
    if (builtIn === undefined) return;
    const target = node.arguments[0];
    if (target === undefined || state.ts.isSpreadElement(target)) {
      wholeFileUnsupported = true;
      return;
    }
    const classification = classifyMutationTarget(
      state,
      target,
      candidates,
      aliasesByCandidate
    );
    if (classification.kind === "resolved") {
      for (const candidate of classification.candidates) {
        invalidCandidates.add(candidate);
      }
    } else if (classification.kind === "unknown") {
      wholeFileUnsupported = true;
    }
    for (const candidate of candidates) {
      const aliases = aliasesByCandidate.get(candidate)!;
      if (
        node.arguments
          .slice(1)
          .some((argument) =>
            expressionReferencesCandidate(state, argument, candidate, aliases)
          )
      ) {
        invalidCandidates.add(candidate);
      }
    }
  });
  return { wholeFileUnsupported, invalidCandidates };
}

function globalBuiltInCall(
  state: AnalysisState,
  call: CallExpression
): string | undefined {
  if (call.questionDotToken !== undefined) return undefined;
  const access = call.expression;
  if (
    !state.ts.isPropertyAccessExpression(access) &&
    !state.ts.isElementAccessExpression(access)
  ) {
    return undefined;
  }
  const name = staticAccessName(state.ts, access);
  const receiver = access.expression;
  if (
    name === undefined ||
    !state.ts.isIdentifier(receiver) ||
    resolveLexical(state, receiver) !== undefined
  ) {
    return undefined;
  }
  const identity = `${receiver.text}.${name}`;
  return ALLOWED_GLOBAL_MUTATORS.has(identity) ? identity : undefined;
}

function classifyMutationTarget(
  state: AnalysisState,
  expression: Expression,
  candidates: readonly Candidate[],
  aliasesByCandidate: ReadonlyMap<Candidate, ReadonlySet<LexicalDeclaration>>
):
  | {
      readonly kind: "resolved";
      readonly candidates: ReadonlySet<Candidate>;
    }
  | { readonly kind: "unrelated" | "unknown" } {
  const target = unwrapParentheses(state.ts, expression);
  if (
    state.ts.isObjectLiteralExpression(target) ||
    state.ts.isArrayLiteralExpression(target)
  ) {
    return { kind: "unrelated" };
  }
  if (!state.ts.isIdentifier(target)) return { kind: "unknown" };
  const declaration = resolveLexical(state, target);
  if (declaration === null || declaration === undefined) {
    return { kind: "unknown" };
  }
  const resolvedCandidates = new Set(
    candidates.filter(
      (candidate) =>
        candidate.critical.has(declaration) ||
        aliasesByCandidate.get(candidate)?.has(declaration) === true
    )
  );
  if (resolvedCandidates.size > 0) {
    return { kind: "resolved", candidates: resolvedCandidates };
  }
  if (
    declaration.kind === "const" &&
    declaration.initializer !== undefined &&
    !declaration.reassigned
  ) {
    const initializer = unwrapParentheses(state.ts, declaration.initializer);
    if (
      state.ts.isObjectLiteralExpression(initializer) ||
      state.ts.isArrayLiteralExpression(initializer)
    ) {
      return { kind: "unrelated" };
    }
  }
  return { kind: "unknown" };
}

function aliasesForCandidate(
  state: AnalysisState,
  candidate: Candidate
): ReadonlySet<LexicalDeclaration> {
  const aliases = new Set<LexicalDeclaration>();
  for (const declaration of state.declarations) {
    if (
      declaration.kind !== "const" ||
      declaration.initializer === undefined ||
      declaration.reassigned
    ) {
      continue;
    }
    const initializer = unwrapParentheses(state.ts, declaration.initializer);
    if (!state.ts.isIdentifier(initializer)) continue;
    const target = resolveLexical(state, initializer);
    if (
      target !== null &&
      target !== undefined &&
      candidate.objectCritical.has(target)
    ) {
      aliases.add(declaration);
    }
  }
  return aliases;
}

function hasCriticalMutationOrEscape(
  state: AnalysisState,
  candidate: Candidate,
  candidates: readonly Candidate[]
): boolean {
  const aliases = aliasesForCandidate(state, candidate);
  if (hasUnsupportedAliasTopology(state, candidate, aliases)) return true;
  let invalid = false;

  visitExecutable(state, state.sourceFile, (node) => {
    if (invalid) return;
    const { ts } = state;
    if (
      ts.isBinaryExpression(node) &&
      isAssignmentOperator(ts, node.operatorToken.kind)
    ) {
      if (
        targetTouchesCandidate(state, node.left, candidate, aliases) ||
        storesCriticalValue(state, node.right, candidate, aliases)
      ) {
        invalid = true;
      }
      return;
    }
    if (
      (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
      targetTouchesCandidate(state, node.operand, candidate, aliases)
    ) {
      invalid = true;
      return;
    }
    if (
      ts.isDeleteExpression(node) &&
      targetTouchesCandidate(state, node.expression, candidate, aliases)
    ) {
      invalid = true;
      return;
    }
    if (
      (ts.isForInStatement(node) || ts.isForOfStatement(node)) &&
      !ts.isVariableDeclarationList(node.initializer) &&
      targetTouchesCandidate(state, node.initializer, candidate, aliases)
    ) {
      invalid = true;
      return;
    }
    if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
      if (isSafeCandidateCall(state, node, candidate, candidates, aliases))
        return;
      if (globalBuiltInCall(state, node as CallExpression) !== undefined)
        return;
      if (callTouchesCandidate(state, node, candidate, aliases)) {
        invalid = true;
      }
      return;
    }
    if (
      ts.isTaggedTemplateExpression(node) &&
      (expressionReferencesCandidate(state, node.tag, candidate, aliases) ||
        expressionReferencesCandidate(state, node.template, candidate, aliases))
    ) {
      invalid = true;
      return;
    }
    if (
      (ts.isReturnStatement(node) || ts.isYieldExpression(node)) &&
      node.expression !== undefined &&
      expressionReferencesCandidate(state, node.expression, candidate, aliases)
    ) {
      invalid = true;
      return;
    }
    if (
      ts.isExportAssignment(node) &&
      expressionReferencesCandidate(state, node.expression, candidate, aliases)
    ) {
      invalid = true;
      return;
    }
    if (ts.isExportDeclaration(node) && node.exportClause !== undefined) {
      if (
        ts.isNamedExports(node.exportClause) &&
        node.exportClause.elements.some((element) => {
          const name = element.propertyName ?? element.name;
          return (
            ts.isIdentifier(name) &&
            identifierResolvesCandidate(state, name, candidate, aliases)
          );
        })
      ) {
        invalid = true;
        return;
      }
    }
    if (
      ts.isVariableStatement(node) &&
      ts.canHaveModifiers(node) &&
      ts
        .getModifiers(node)
        ?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ===
        true &&
      node.declarationList.declarations.some((declaration) =>
        bindingNameTouchesCandidate(state, declaration.name, candidate, aliases)
      )
    ) {
      invalid = true;
      return;
    }
    if (ts.isVariableDeclaration(node) && node.initializer !== undefined) {
      const declarations = state.declarations.filter(
        (declaration) => declaration.node === node
      );
      const approvedStorage = declarations.some(
        (declaration) =>
          candidates.some(({ critical }) => critical.has(declaration)) ||
          aliases.has(declaration)
      );
      if (
        !approvedStorage &&
        expressionReferencesCandidate(
          state,
          node.initializer,
          candidate,
          aliases
        )
      ) {
        invalid = true;
      }
      return;
    }
    if (
      ts.isParameter(node) &&
      node.initializer !== undefined &&
      expressionReferencesCandidate(state, node.initializer, candidate, aliases)
    ) {
      invalid = true;
      return;
    }
    if (
      ts.isPropertyDeclaration(node) &&
      node.initializer !== undefined &&
      expressionReferencesCandidate(state, node.initializer, candidate, aliases)
    ) {
      invalid = true;
      return;
    }
    if (
      (ts.isObjectLiteralExpression(node) ||
        ts.isArrayLiteralExpression(node)) &&
      aggregateContainsCritical(state, node, candidate, aliases)
    ) {
      const isTransactionObject =
        ts.isObjectLiteralExpression(node) &&
        node.getStart(state.sourceFile) ===
          candidate.transaction.result.objectOffset;
      if (
        !isTransactionObject ||
        transactionObjectStoresUnexpectedCritical(
          state,
          node as ObjectLiteralExpression,
          candidate,
          aliases
        )
      ) {
        invalid = true;
      }
    }
  });
  return invalid;
}

function hasUnsupportedAliasTopology(
  state: AnalysisState,
  candidate: Candidate,
  aliases: ReadonlySet<LexicalDeclaration>
): boolean {
  const aliasesByTarget = new Map<LexicalDeclaration, number>();
  for (const alias of aliases) {
    const initializer = unwrapParentheses(state.ts, alias.initializer!);
    if (!state.ts.isIdentifier(initializer)) continue;
    const target = resolveLexical(state, initializer);
    if (target === null || target === undefined) return true;
    if (
      candidate.transaction.objectCritical.has(target) &&
      !hasOnlyBenignSupportingArrayAliasUses(state, alias)
    ) {
      return true;
    }
    aliasesByTarget.set(target, (aliasesByTarget.get(target) ?? 0) + 1);
  }
  if ([...aliasesByTarget.values()].some((count) => count > 1)) return true;
  for (const declaration of state.declarations) {
    if (declaration.kind !== "const" || declaration.initializer === undefined) {
      continue;
    }
    const initializer = unwrapParentheses(state.ts, declaration.initializer);
    if (!state.ts.isIdentifier(initializer)) continue;
    const target = resolveLexical(state, initializer);
    if (target !== null && target !== undefined && aliases.has(target)) {
      return true;
    }
  }
  return false;
}

function targetTouchesCandidate(
  state: AnalysisState,
  node: Node,
  candidate: Candidate,
  aliases: ReadonlySet<LexicalDeclaration>
): boolean {
  const identifiers: Identifier[] = [];
  collectMutationRootIdentifiers(state.ts, node, identifiers);
  return identifiers.some((identifier) =>
    identifierResolvesCandidate(state, identifier, candidate, aliases)
  );
}

function collectMutationRootIdentifiers(
  ts: TypeScript,
  node: Node,
  identifiers: Identifier[]
): void {
  if (ts.isIdentifier(node)) {
    identifiers.push(node);
    return;
  }
  if (
    ts.isPropertyAccessExpression(node) ||
    ts.isElementAccessExpression(node)
  ) {
    const root = rootAccessIdentifier(ts, node);
    if (root !== undefined) identifiers.push(root);
    return;
  }
  if (ts.isParenthesizedExpression(node)) {
    collectMutationRootIdentifiers(ts, node.expression, identifiers);
    return;
  }
  if (ts.isArrayLiteralExpression(node)) {
    for (const element of node.elements) {
      if (!ts.isOmittedExpression(element)) {
        collectMutationRootIdentifiers(
          ts,
          ts.isSpreadElement(element) ? element.expression : element,
          identifiers
        );
      }
    }
    return;
  }
  if (!ts.isObjectLiteralExpression(node)) return;
  for (const property of node.properties) {
    if (ts.isShorthandPropertyAssignment(property)) {
      identifiers.push(property.name);
    } else if (ts.isPropertyAssignment(property)) {
      collectMutationRootIdentifiers(ts, property.initializer, identifiers);
    } else if (ts.isSpreadAssignment(property)) {
      collectMutationRootIdentifiers(ts, property.expression, identifiers);
    }
  }
}

function bindingNameTouchesCandidate(
  state: AnalysisState,
  name: BindingName,
  candidate: Candidate,
  aliases: ReadonlySet<LexicalDeclaration>
): boolean {
  if (state.ts.isIdentifier(name)) {
    const declarations = state.declarations.filter(
      (declaration) => declaration.node === name.parent
    );
    return declarations.some(
      (declaration) =>
        candidate.critical.has(declaration) || aliases.has(declaration)
    );
  }
  return name.elements.some(
    (element) =>
      !state.ts.isOmittedExpression(element) &&
      bindingNameTouchesCandidate(state, element.name, candidate, aliases)
  );
}

function rootAccessIdentifier(
  ts: TypeScript,
  node: Node
): Identifier | undefined {
  let current = node;
  while (
    ts.isPropertyAccessExpression(current) ||
    ts.isElementAccessExpression(current)
  ) {
    current = current.expression;
  }
  return ts.isIdentifier(current) ? current : undefined;
}

function identifierResolvesCandidate(
  state: AnalysisState,
  identifier: Identifier,
  candidate: Candidate,
  aliases: ReadonlySet<LexicalDeclaration>
): boolean {
  const declaration = resolveLexical(state, identifier, true);
  return (
    declaration !== null &&
    declaration !== undefined &&
    (candidate.critical.has(declaration) || aliases.has(declaration))
  );
}

function storesCriticalValue(
  state: AnalysisState,
  expression: Expression,
  candidate: Candidate,
  aliases: ReadonlySet<LexicalDeclaration>
): boolean {
  return expressionReferencesCandidate(state, expression, candidate, aliases);
}

function expressionReferencesCandidate(
  state: AnalysisState,
  node: Node,
  candidate: Candidate,
  aliases: ReadonlySet<LexicalDeclaration>
): boolean {
  let found = false;
  const visit = (current: Node) => {
    if (found) return;
    if (
      state.ts.isIdentifier(current) &&
      isExecutableIdentifierValue(state, current) &&
      identifierResolvesCandidate(state, current, candidate, aliases)
    ) {
      if (
        isBenignSupportingArrayLengthRead(state, current, candidate, aliases)
      ) {
        return;
      }
      found = true;
      return;
    }
    state.ts.forEachChild(current, visit);
  };
  visit(node);
  return found;
}

function isBenignSupportingArrayLengthRead(
  state: AnalysisState,
  identifier: Identifier,
  candidate: Candidate,
  aliases: ReadonlySet<LexicalDeclaration>
): boolean {
  const declaration = resolveLexical(state, identifier, true);
  if (declaration === null || declaration === undefined) {
    return false;
  }
  let supportingArray = candidate.transaction.objectCritical.has(declaration);
  if (
    !supportingArray &&
    aliases.has(declaration) &&
    declaration.initializer !== undefined
  ) {
    const initializer = unwrapParentheses(state.ts, declaration.initializer);
    if (state.ts.isIdentifier(initializer)) {
      const target = resolveLexical(state, initializer, true);
      supportingArray =
        target !== null &&
        target !== undefined &&
        candidate.transaction.objectCritical.has(target);
    }
  }
  return supportingArray && isStaticLengthRead(state, identifier);
}

function hasOnlyBenignSupportingArrayAliasUses(
  state: AnalysisState,
  alias: LexicalDeclaration
): boolean {
  let sawUse = false;
  let unsupportedUse = false;
  visitExecutable(state, state.sourceFile, (node) => {
    if (
      unsupportedUse ||
      !state.ts.isIdentifier(node) ||
      !isExecutableIdentifierValue(state, node) ||
      resolveLexical(state, node, true) !== alias
    ) {
      return;
    }
    sawUse = true;
    if (!isStaticLengthRead(state, node)) unsupportedUse = true;
  });
  return sawUse && !unsupportedUse;
}

function isStaticLengthRead(
  state: AnalysisState,
  identifier: Identifier
): boolean {
  let receiver: Node = identifier;
  while (
    state.ts.isParenthesizedExpression(receiver.parent) &&
    receiver.parent.expression === receiver
  ) {
    receiver = receiver.parent;
  }
  const access = receiver.parent;
  return (
    state.ts.isPropertyAccessExpression(access) &&
    access.expression === receiver &&
    access.questionDotToken === undefined &&
    access.name.text === "length"
  );
}

function isSafeCandidateCall(
  state: AnalysisState,
  node: CallExpression | NewExpression,
  candidate: Candidate,
  candidates: readonly Candidate[],
  aliases: ReadonlySet<LexicalDeclaration>
): boolean {
  if (
    state.ts.isCallExpression(node) &&
    candidates.some(({ call }) => call === node)
  )
    return true;
  if (state.ts.isNewExpression(node)) {
    const providerConstruction = candidates.some(
      ({ signer }) => node === signer.provider.construction
    );
    if (providerConstruction) {
      return !(
        node.arguments?.some((argument) =>
          expressionReferencesObjectCandidate(
            state,
            argument,
            candidate,
            aliases
          )
        ) ?? false
      );
    }
  }

  for (const sibling of candidates) {
    const initializer = sibling.signer.declaration.initializer;
    if (initializer === undefined) continue;
    const root = unwrapParentheses(state.ts, initializer);
    if (
      sibling.signer.provenance === "ethers-wallet" &&
      state.ts.isNewExpression(root) &&
      node === root
    ) {
      const privateKey = root.arguments?.[0];
      return (
        privateKey !== undefined &&
        !expressionReferencesObjectCandidate(
          state,
          privateKey,
          candidate,
          aliases
        )
      );
    }
    if (
      sibling.signer.provenance === "ethers-json-rpc-signer" &&
      state.ts.isAwaitExpression(root)
    ) {
      const awaited = unwrapParentheses(state.ts, root.expression);
      if (state.ts.isCallExpression(awaited) && node === awaited) return true;
    }
  }
  return false;
}

function expressionReferencesObjectCandidate(
  state: AnalysisState,
  node: Node,
  candidate: Candidate,
  aliases: ReadonlySet<LexicalDeclaration>
): boolean {
  let found = false;
  const visit = (current: Node) => {
    if (found) return;
    if (
      state.ts.isIdentifier(current) &&
      isExecutableIdentifierValue(state, current)
    ) {
      const declaration = resolveLexical(state, current, true);
      if (
        declaration !== null &&
        declaration !== undefined &&
        (candidate.objectCritical.has(declaration) || aliases.has(declaration))
      ) {
        found = true;
        return;
      }
    }
    state.ts.forEachChild(current, visit);
  };
  visit(node);
  return found;
}

function callTouchesCandidate(
  state: AnalysisState,
  node: CallExpression | NewExpression,
  candidate: Candidate,
  aliases: ReadonlySet<LexicalDeclaration>
): boolean {
  if (
    expressionReferencesCandidate(state, node.expression, candidate, aliases)
  ) {
    return true;
  }
  return (
    node.arguments?.some((argument) =>
      expressionReferencesCandidate(state, argument, candidate, aliases)
    ) === true
  );
}

function aggregateContainsCritical(
  state: AnalysisState,
  node: ObjectLiteralExpression | import("typescript").ArrayLiteralExpression,
  candidate: Candidate,
  aliases: ReadonlySet<LexicalDeclaration>
): boolean {
  return expressionReferencesCandidate(state, node, candidate, aliases);
}

function transactionObjectStoresUnexpectedCritical(
  state: AnalysisState,
  object: ObjectLiteralExpression,
  candidate: Candidate,
  aliases: ReadonlySet<LexicalDeclaration>
): boolean {
  return object.properties.some((property) => {
    if (
      !state.ts.isPropertyAssignment(property) ||
      !expressionReferencesCandidate(
        state,
        property.initializer,
        candidate,
        aliases
      )
    ) {
      return false;
    }
    const name = staticPropertyName(state.ts, property.name);
    const value = unwrapParentheses(state.ts, property.initializer);
    if (!state.ts.isIdentifier(value)) return true;
    const declaration = resolveLexical(state, value, true);
    if (declaration === null || declaration === undefined) return true;
    if (name === "blobs" || name === "blobVersionedHashes") {
      return !candidate.transaction.objectCritical.has(declaration);
    }
    if (name === "maxFeePerBlobGas") {
      return (
        candidate.objectCritical.has(declaration) ||
        !candidate.transaction.critical.has(declaration)
      );
    }
    return true;
  });
}

function staticPropertyName(
  ts: TypeScript,
  name: import("typescript").PropertyName | undefined
): string | undefined {
  return name !== undefined &&
    (ts.isIdentifier(name) || ts.isStringLiteral(name))
    ? name.text
    : undefined;
}

function staticElementName(
  ts: TypeScript,
  access: import("typescript").ElementAccessExpression
): string | undefined {
  const argument = access.argumentExpression;
  return argument !== undefined && ts.isStringLiteral(argument)
    ? argument.text
    : undefined;
}

function staticAccessName(
  ts: TypeScript,
  access:
    | import("typescript").PropertyAccessExpression
    | import("typescript").ElementAccessExpression
): string | undefined {
  return ts.isPropertyAccessExpression(access)
    ? access.name.text
    : staticElementName(ts, access);
}

function visitExecutable(
  state: AnalysisState,
  node: Node,
  visitor: (node: Node) => void
): void {
  if (
    isAmbientRoot(state.ts, node) ||
    state.ts.isTypeNode(node) ||
    state.ts.isInterfaceDeclaration(node) ||
    state.ts.isTypeAliasDeclaration(node) ||
    state.ts.isImportDeclaration(node) ||
    state.ts.isImportEqualsDeclaration(node)
  ) {
    return;
  }
  visitor(node);
  state.ts.forEachChild(node, (child) =>
    visitExecutable(state, child, visitor)
  );
}
