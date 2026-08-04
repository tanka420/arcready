/* eslint-disable @typescript-eslint/consistent-type-imports -- compiler loading must remain runtime-lazy */
type TypeScript = typeof import("typescript");
type Node = import("typescript").Node;
type Expression = import("typescript").Expression;
type Identifier = import("typescript").Identifier;
type BindingName = import("typescript").BindingName;
type CallExpression = import("typescript").CallExpression;
type ObjectLiteralExpression = import("typescript").ObjectLiteralExpression;
type SourceFile = import("typescript").SourceFile;
export type ArcUsdcAmountIssueKind =
  | "native-read-as-erc20"
  | "erc20-read-as-native";
export interface ArcUsdcAmountIssue {
  readonly kind: ArcUsdcAmountIssueKind;
  readonly offset: number;
}
type ModuleName = "viem" | "ethers";
type UnitTag = "native18" | "erc20six" | "unknown";
type ImportIdentity = `${ModuleName}:${string}`;
interface LexicalDeclaration {
  readonly node: Node;
  readonly kind: "const" | "import" | "other";
  readonly initializer?: Expression;
  readonly importIdentity?: ImportIdentity;
  reassigned?: boolean;
}
type BindingTable = Map<Node, Map<string, LexicalDeclaration[]>>;
interface Ownership {
  readonly arc: boolean;
  readonly nonArc: boolean;
}
interface Amount {
  readonly unit: UnitTag;
  readonly converted: boolean;
}
interface ReceiverEvidence {
  readonly library?: ModuleName;
  readonly ownership: Ownership;
}

interface AnalysisState {
  readonly ts: TypeScript;
  readonly sourceFile: SourceFile;
  readonly bindings: BindingTable;
}
const ARC_TESTNET_CHAIN_ID = 5042002;
const ARC_TESTNET_RPC = "https://rpc.testnet.arc.network";
const ARC_USDC_ADDRESS = "0x3600000000000000000000000000000000000000";
const NATIVE_DECIMALS = 18;
const ERC20_DECIMALS = 6;
const DECIMAL_OFFSET = 12n;
const CONVERSION_FACTOR = 1_000_000_000_000n;
const UNKNOWN_AMOUNT: Amount = { unit: "unknown", converted: false };
const NO_OWNERSHIP: Ownership = { arc: false, nonArc: false };
const NO_RECEIVER: ReceiverEvidence = { ownership: NO_OWNERSHIP };
const VIEM_CONFIG_KEYS = ["chain", "transport"] as const;
const CONTRACT_KEYS = ["address", "functionName", "args"] as const;
export function supportsArcUsdcAmountPath(filePath: string): boolean {
  const normalized = filePath.replaceAll("\\", "/");
  const fileName = normalized.slice(normalized.lastIndexOf("/") + 1);
  return (
    /\.[jt]s$/i.test(fileName) &&
    !/\.d\.ts$/i.test(fileName) &&
    !/\.(?:test|spec)\.[jt]s$/i.test(fileName) &&
    !/(?:^|\/)(?:test|tests|__tests__)(?:\/|$)/i.test(normalized)
  );
}
export async function analyzeArcUsdcAmountFile(
  filePath: string,
  source: string
): Promise<readonly ArcUsdcAmountIssue[]> {
  if (!supportsArcUsdcAmountPath(filePath)) return [];
  const ts = await import("typescript");
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
  if (sourceFile.isDeclarationFile || parseDiagnostics.length > 0) return [];
  const state: AnalysisState = {
    ts,
    sourceFile,
    bindings: collectBindings(ts, sourceFile)
  };
  const issues: ArcUsdcAmountIssue[] = [];
  visitExecutable(state, sourceFile, (call) => {
    if (!isFormatterCall(state, call) || call.arguments.length < 2) return;
    const decimals = numericValue(state, call.arguments[1], true);
    if (decimals !== ERC20_DECIMALS && decimals !== NATIVE_DECIMALS) return;
    const amount = amountValue(state, call.arguments[0], 1);
    if (amount.converted) return;
    if (amount.unit === "native18" && decimals === ERC20_DECIMALS) {
      issues.push({
        kind: "native-read-as-erc20",
        offset: call.getStart(sourceFile)
      });
    } else if (amount.unit === "erc20six" && decimals === NATIVE_DECIMALS) {
      issues.push({
        kind: "erc20-read-as-native",
        offset: call.getStart(sourceFile)
      });
    }
  });
  return issues.sort((left, right) => left.offset - right.offset);
}
function resolveLexical(
  state: AnalysisState,
  use: Identifier,
  allowBefore = false
): LexicalDeclaration | null | undefined {
  let scope: Node | undefined = use.parent;
  while (scope !== undefined) {
    const declarations = state.bindings.get(scope)?.get(use.text);
    if (declarations !== undefined) {
      if (declarations.length !== 1) return null;
      const declaration = declarations[0];
      return (!allowBefore && use.getStart() < declaration.node.end) ||
        declaration.reassigned === true
        ? null
        : declaration;
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
function collectBindings(ts: TypeScript, sourceFile: SourceFile): BindingTable {
  const table: BindingTable = new Map();
  const writes: Identifier[] = [];
  const add = (scope: Node, name: string, value: LexicalDeclaration) => {
    const byName = table.get(scope) ?? new Map();
    byName.set(name, [...(byName.get(name) ?? []), value]);
    table.set(scope, byName);
  };
  const addBinding = (
    scope: Node,
    name: BindingName,
    value: LexicalDeclaration
  ) => {
    if (ts.isIdentifier(name)) add(scope, name.text, value);
    else
      for (const element of name.elements)
        if (!ts.isOmittedExpression(element))
          addBinding(scope, element.name, { ...value, kind: "other" });
  };
  function visit(node: Node, scope: Node, functionScope: Node): void {
    if (isAmbientRoot(ts, node)) return;
    if (
      (ts.isFunctionDeclaration(node) ||
        ts.isClassDeclaration(node) ||
        ts.isEnumDeclaration(node)) &&
      node.name !== undefined
    )
      add(scope, node.name.text, { node, kind: "other" });
    else if (ts.isModuleDeclaration(node) && ts.isIdentifier(node.name))
      add(scope, node.name.text, { node: node.name, kind: "other" });
    const currentScope = isLexicalScope(ts, node) ? node : scope;
    const currentFunction =
      ts.isSourceFile(node) || ts.isFunctionLike(node) ? node : functionScope;
    if (ts.isVariableDeclaration(node)) {
      const list = ts.isVariableDeclarationList(node.parent)
        ? node.parent
        : undefined;
      const initializer =
        list !== undefined &&
        (list.flags & ts.NodeFlags.Const) !== 0 &&
        node.initializer !== undefined
          ? node.initializer
          : undefined;
      const blockScoped =
        ts.isCatchClause(node.parent) ||
        (list !== undefined && (list.flags & ts.NodeFlags.BlockScoped) !== 0);
      addBinding(
        blockScoped ? currentScope : currentFunction,
        node.name,
        initializer !== undefined
          ? { node, kind: "const", initializer }
          : { node, kind: "other" }
      );
    } else if (ts.isParameter(node)) {
      addBinding(currentFunction, node.name, { node, kind: "other" });
    } else if (ts.isImportEqualsDeclaration(node) && !node.isTypeOnly) {
      add(currentScope, node.name.text, { node: node.name, kind: "other" });
    } else if (ts.isImportDeclaration(node)) {
      const clause = node.importClause;
      if (clause !== undefined && !clause.isTypeOnly) {
        const source = ts.isStringLiteral(node.moduleSpecifier)
          ? node.moduleSpecifier.text
          : undefined;
        const moduleName =
          source === "viem" || source === "ethers" ? source : undefined;
        if (clause.name !== undefined)
          add(currentScope, clause.name.text, {
            node: clause,
            kind: "import"
          });
        const bindings = clause.namedBindings;
        if (bindings !== undefined && ts.isNamespaceImport(bindings)) {
          add(currentScope, bindings.name.text, {
            node: bindings,
            kind: "import",
            importIdentity:
              moduleName === undefined ? undefined : `${moduleName}:*`
          });
        } else if (bindings !== undefined && ts.isNamedImports(bindings)) {
          for (const element of bindings.elements)
            if (!element.isTypeOnly)
              add(currentScope, element.name.text, {
                node: element,
                kind: "import",
                importIdentity:
                  moduleName === undefined
                    ? undefined
                    : `${moduleName}:${element.propertyName?.text ?? element.name.text}`
              });
        }
      }
    } else if (ts.isFunctionExpression(node) && node.name !== undefined) {
      add(currentScope, node.name.text, { node, kind: "other" });
    } else if (ts.isClassExpression(node) && node.name !== undefined) {
      add(currentScope, node.name.text, { node: node.name, kind: "other" });
    }
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
      node.operatorToken.kind <= ts.SyntaxKind.LastAssignment &&
      ts.isIdentifier(node.left)
    )
      writes.push(node.left);
    else if (
      (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
      (node.operator === ts.SyntaxKind.PlusPlusToken ||
        node.operator === ts.SyntaxKind.MinusMinusToken) &&
      ts.isIdentifier(node.operand)
    )
      writes.push(node.operand);
    ts.forEachChild(node, (child) =>
      visit(child, currentScope, currentFunction)
    );
  }
  visit(sourceFile, sourceFile, sourceFile);
  const state: AnalysisState = { ts, sourceFile, bindings: table };
  for (const write of writes) {
    const declaration = resolveLexical(state, write, true);
    if (declaration !== null && declaration !== undefined)
      declaration.reassigned = true;
  }
  return table;
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
function constInitializer(
  state: AnalysisState,
  use: Identifier
): Expression | undefined {
  const declaration = resolveLexical(state, use);
  return declaration?.kind === "const" ? declaration.initializer : undefined;
}
function visitExecutable(
  state: AnalysisState,
  node: Node,
  visitor: (call: CallExpression) => void
): void {
  const { ts } = state;
  if (
    isAmbientRoot(ts, node) ||
    ts.isWithStatement(node) ||
    ts.isInterfaceDeclaration(node) ||
    ts.isTypeAliasDeclaration(node) ||
    ts.isImportDeclaration(node)
  )
    return;
  if (ts.isCallExpression(node)) visitor(node);
  ts.forEachChild(node, (child) => visitExecutable(state, child, visitor));
}
function unwrap(state: AnalysisState, expression: Expression): Expression {
  const { ts } = state;
  let current = expression;
  while (true) {
    if (
      ts.isParenthesizedExpression(current) ||
      ts.isAsExpression(current) ||
      ts.isTypeAssertionExpression(current) ||
      ts.isNonNullExpression(current)
    ) {
      current = current.expression;
      continue;
    }
    return current;
  }
}
function unwrapBound(
  state: AnalysisState,
  expression: Expression,
  allowBinding: boolean
): Expression | undefined {
  const target = unwrap(state, expression);
  if (!state.ts.isIdentifier(target)) return target;
  if (!allowBinding) return undefined;
  const initializer = constInitializer(state, target);
  return initializer === undefined ? undefined : unwrap(state, initializer);
}
function importedFunction(
  state: AnalysisState,
  expression: Expression,
  names: readonly `${ModuleName}:${string}`[]
): boolean {
  const { ts } = state;
  const target = unwrap(state, expression);
  if (ts.isIdentifier(target)) {
    const imported = resolveLexical(state, target)?.importIdentity;
    return imported !== undefined && names.includes(imported);
  }
  if (
    ts.isPropertyAccessExpression(target) &&
    target.questionDotToken === undefined &&
    ts.isIdentifier(target.expression)
  ) {
    const namespace = resolveLexical(state, target.expression)?.importIdentity;
    return (
      namespace !== undefined &&
      namespace.endsWith(":*") &&
      names.includes(
        `${namespace.slice(0, namespace.indexOf(":")) as ModuleName}:${target.name.text}`
      )
    );
  }
  return false;
}
function isFormatterCall(state: AnalysisState, call: CallExpression): boolean {
  return (
    call.questionDotToken === undefined &&
    importedFunction(state, call.expression, [
      "viem:formatUnits",
      "ethers:formatUnits"
    ])
  );
}
function amountValue(
  state: AnalysisState,
  expression: Expression,
  amountBindingsLeft: number
): Amount {
  const { ts } = state;
  const source = sourceUnit(state, expression);
  if (source !== "unknown") return { unit: source, converted: false };
  const target = unwrap(state, expression);
  if (ts.isIdentifier(target) && amountBindingsLeft > 0) {
    const initializer = constInitializer(state, target);
    return initializer === undefined
      ? UNKNOWN_AMOUNT
      : amountValue(state, initializer, amountBindingsLeft - 1);
  }
  if (!ts.isBinaryExpression(target)) return UNKNOWN_AMOUNT;
  if (target.operatorToken.kind === ts.SyntaxKind.SlashToken) {
    const left = amountValue(state, target.left, amountBindingsLeft);
    return left.unit === "native18" && exactFactor(state, target.right)
      ? { unit: "erc20six", converted: true }
      : UNKNOWN_AMOUNT;
  }
  if (target.operatorToken.kind !== ts.SyntaxKind.AsteriskToken)
    return UNKNOWN_AMOUNT;
  const left = amountValue(state, target.left, amountBindingsLeft);
  if (left.unit === "erc20six" && exactFactor(state, target.right))
    return { unit: "native18", converted: true };
  const right = amountValue(state, target.right, amountBindingsLeft);
  return right.unit === "erc20six" && exactFactor(state, target.left)
    ? { unit: "native18", converted: true }
    : UNKNOWN_AMOUNT;
}
function sourceUnit(state: AnalysisState, expression: Expression): UnitTag {
  const { ts } = state;
  const call = awaitedSourceCall(state, expression);
  if (call === undefined || call.questionDotToken !== undefined)
    return "unknown";
  const callee = call.expression;
  if (
    !ts.isPropertyAccessExpression(callee) ||
    callee.questionDotToken !== undefined ||
    !ts.isIdentifier(callee.expression)
  )
    return "unknown";
  const receiver = callee.expression;
  const evidence = receiverEvidence(state, receiver);
  if (callee.name.text === "getBalance") {
    return isProvenArc(evidence.ownership) &&
      ((evidence.library === "viem" && validViemRead(state, call)) ||
        (evidence.library === "ethers" &&
          call.arguments.length > 0 &&
          !ts.isSpreadElement(call.arguments[0])))
      ? "native18"
      : "unknown";
  }
  if (
    callee.name.text !== "readContract" ||
    evidence.library !== "viem" ||
    !isProvenArc(evidence.ownership)
  )
    return "unknown";
  const options = call.arguments[0];
  if (
    options === undefined ||
    !ts.isObjectLiteralExpression(unwrap(state, options))
  )
    return "unknown";
  const object = unwrap(state, options) as ObjectLiteralExpression;
  const functionName = objectProperty(state, object, "functionName");
  return safeEvidenceObject(state, object, CONTRACT_KEYS) &&
    addressProperty(state, object) === ARC_USDC_ADDRESS &&
    functionName !== undefined &&
    ts.isStringLiteral(functionName) &&
    functionName.text === "balanceOf" &&
    singleBalanceArg(state, object)
    ? "erc20six"
    : "unknown";
}
function validViemRead(state: AnalysisState, call: CallExpression): boolean {
  if (call.arguments.length !== 1) return false;
  const object = unwrap(state, call.arguments[0]);
  return (
    state.ts.isObjectLiteralExpression(object) &&
    safeEvidenceObject(state, object, ["address"], true) &&
    object.properties.some(
      (property) =>
        (state.ts.isPropertyAssignment(property) ||
          state.ts.isShorthandPropertyAssignment(property)) &&
        state.ts.isIdentifier(property.name) &&
        property.name.text === "address"
    )
  );
}
function awaitedSourceCall(
  state: AnalysisState,
  expression: Expression
): CallExpression | undefined {
  const { ts } = state;
  let current = expression;
  let awaited = false;
  while (true) {
    if (
      ts.isParenthesizedExpression(current) ||
      ts.isAsExpression(current) ||
      ts.isTypeAssertionExpression(current) ||
      ts.isNonNullExpression(current)
    )
      current = current.expression;
    else if (ts.isAwaitExpression(current) && !awaited) {
      if (!validAwaitContext(state, current)) return undefined;
      awaited = true;
      current = current.expression;
    } else return awaited && ts.isCallExpression(current) ? current : undefined;
  }
}
function validAwaitContext(state: AnalysisState, awaitNode: Node): boolean {
  const { ts } = state;
  let child = awaitNode;
  for (
    let parent = awaitNode.parent;
    parent !== undefined;
    parent = parent.parent
  ) {
    if (ts.isFunctionLike(parent)) {
      const body = (parent as Node & { readonly body?: Node }).body;
      const modifiers = ts.canHaveModifiers(parent)
        ? ts.getModifiers(parent)
        : undefined;
      return (
        body !== undefined &&
        child === body &&
        modifiers?.some(
          (modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword
        ) === true
      );
    }
    if (
      ts.isModuleDeclaration(parent) ||
      ts.isClassLike(parent) ||
      ts.isEnumDeclaration(parent)
    )
      return false;
    if (ts.isSourceFile(parent)) return ts.isExternalModule(parent);
    child = parent;
  }
  return false;
}
function receiverEvidence(
  state: AnalysisState,
  receiver: Identifier
): ReceiverEvidence {
  const receiverInitializer = constInitializer(state, receiver);
  if (receiverInitializer === undefined) return NO_RECEIVER;
  const { ts } = state;
  const initializer = unwrap(state, receiverInitializer);
  if (
    ts.isCallExpression(initializer) &&
    initializer.questionDotToken === undefined &&
    importedFunction(state, initializer.expression, ["viem:createPublicClient"])
  ) {
    const config = initializer.arguments[0];
    return {
      library: "viem",
      ownership: ownershipFromViemConfig(state, config)
    };
  }
  if (
    ts.isNewExpression(initializer) &&
    importedFunction(state, initializer.expression, ["ethers:JsonRpcProvider"])
  ) {
    const first = initializer.arguments?.[0];
    const second = initializer.arguments?.[1];
    return {
      library: "ethers",
      ownership: mergeOwnership(
        ownershipFromRpc(state, first, true),
        ownershipFromEthersNetwork(state, second)
      )
    };
  }
  return NO_RECEIVER;
}
function ownershipFromViemConfig(
  state: AnalysisState,
  expression: Expression | undefined
): Ownership {
  if (expression === undefined) return NO_OWNERSHIP;
  const target = unwrapBound(state, expression, true);
  if (target === undefined || !state.ts.isObjectLiteralExpression(target))
    return NO_OWNERSHIP;
  if (!safeEvidenceObject(state, target, VIEM_CONFIG_KEYS)) return NO_OWNERSHIP;
  const transport = objectProperty(state, target, "transport");
  if (transport === undefined) return NO_OWNERSHIP;
  let result = ownershipFromTransport(state, transport);
  const chain = objectProperty(state, target, "chain");
  if (chain !== undefined)
    result = mergeOwnership(result, ownershipFromViemChain(state, chain));
  return result;
}
function ownershipFromViemChain(
  state: AnalysisState,
  expression: Expression
): Ownership {
  const target = unwrapBound(state, expression, true);
  if (
    target === undefined ||
    !state.ts.isObjectLiteralExpression(target) ||
    !safeEvidenceObject(state, target, ["id", "chainId"]) ||
    objectProperty(state, target, "chainId") !== undefined
  )
    return NO_OWNERSHIP;
  const id = objectProperty(state, target, "id");
  return numericOwnership(
    id === undefined ? undefined : numericValue(state, id, false)
  );
}
function ownershipFromEthersNetwork(
  state: AnalysisState,
  expression: Expression | undefined
): Ownership {
  if (expression === undefined) return NO_OWNERSHIP;
  const direct = numericValue(state, unwrap(state, expression), false);
  if (direct !== undefined) return numericOwnership(direct);
  const target = unwrapBound(state, expression, true);
  if (
    target === undefined ||
    !state.ts.isObjectLiteralExpression(target) ||
    !safeEvidenceObject(state, target, ["chainId", "id"]) ||
    objectProperty(state, target, "id") !== undefined
  )
    return NO_OWNERSHIP;
  const chainId = objectProperty(state, target, "chainId");
  return numericOwnership(
    chainId === undefined ? undefined : numericValue(state, chainId, false)
  );
}
function numericOwnership(value: number | undefined): Ownership {
  return value === undefined
    ? NO_OWNERSHIP
    : {
        arc: value === ARC_TESTNET_CHAIN_ID,
        nonArc: value !== ARC_TESTNET_CHAIN_ID
      };
}
function ownershipFromTransport(
  state: AnalysisState,
  expression: Expression
): Ownership {
  const { ts } = state;
  const target = unwrap(state, expression);
  if (
    !ts.isCallExpression(target) ||
    target.questionDotToken !== undefined ||
    !importedFunction(state, target.expression, ["viem:http"])
  )
    return NO_OWNERSHIP;
  return ownershipFromRpc(state, target.arguments[0], true);
}
function ownershipFromRpc(
  state: AnalysisState,
  expression: Expression | undefined,
  allowBinding: boolean
): Ownership {
  if (expression === undefined) return NO_OWNERSHIP;
  const target = unwrapBound(state, expression, allowBinding);
  if (target === undefined || !state.ts.isStringLiteral(target))
    return NO_OWNERSHIP;
  return {
    arc: target.text === ARC_TESTNET_RPC,
    nonArc: isKnownNonArcRpc(target.text)
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
function mergeOwnership(left: Ownership, right: Ownership): Ownership {
  return { arc: left.arc || right.arc, nonArc: left.nonArc || right.nonArc };
}
function isProvenArc(ownership: Ownership): boolean {
  return ownership.arc && !ownership.nonArc;
}
function safeEvidenceObject(
  state: AnalysisState,
  object: ObjectLiteralExpression,
  criticalKeys: readonly string[],
  allowShorthand = false
): boolean {
  const seen: string[] = [];
  for (const property of object.properties) {
    const name = property.name;
    if (
      state.ts.isSpreadAssignment(property) ||
      (name !== undefined && state.ts.isComputedPropertyName(name))
    )
      return false;
    const key =
      name !== undefined &&
      (state.ts.isIdentifier(name) || state.ts.isStringLiteral(name))
        ? name.text
        : undefined;
    if (key === undefined || !criticalKeys.includes(key)) continue;
    if (
      seen.includes(key) ||
      (!state.ts.isPropertyAssignment(property) &&
        !(
          allowShorthand && state.ts.isShorthandPropertyAssignment(property)
        )) ||
      name === undefined ||
      !state.ts.isIdentifier(name)
    )
      return false;
    seen.push(key);
  }
  return true;
}
function singleBalanceArg(
  state: AnalysisState,
  object: ObjectLiteralExpression
): boolean {
  const args = objectProperty(state, object, "args");
  if (args === undefined || !state.ts.isArrayLiteralExpression(args))
    return false;
  const element = args.elements[0];
  return (
    args.elements.length === 1 &&
    element !== undefined &&
    !state.ts.isOmittedExpression(element) &&
    !state.ts.isSpreadElement(element)
  );
}
function objectProperty(
  state: AnalysisState,
  object: ObjectLiteralExpression,
  name: string
): Expression | undefined {
  const property = object.properties.find(
    (property) =>
      state.ts.isPropertyAssignment(property) &&
      state.ts.isIdentifier(property.name) &&
      property.name.text === name
  );
  return property !== undefined && state.ts.isPropertyAssignment(property)
    ? property.initializer
    : undefined;
}
function addressProperty(
  state: AnalysisState,
  object: ObjectLiteralExpression
): string | undefined {
  const value = objectProperty(state, object, "address");
  if (value === undefined) return undefined;
  const target = unwrapBound(state, value, true);
  return target !== undefined && state.ts.isStringLiteral(target)
    ? target.text.toLowerCase()
    : undefined;
}
function numericValue(
  state: AnalysisState,
  expression: Expression,
  allowBinding: boolean
): number | undefined {
  const target = unwrapBound(state, expression, allowBinding);
  if (target !== undefined && state.ts.isNumericLiteral(target))
    return Number(target.text.replaceAll("_", ""));
  return undefined;
}
function bigintValue(
  state: AnalysisState,
  expression: Expression,
  allowBinding: boolean
): bigint | undefined {
  const target = unwrapBound(state, expression, allowBinding);
  if (target !== undefined && state.ts.isBigIntLiteral(target)) {
    try {
      return BigInt(target.text.replaceAll("_", "").replace(/n$/i, ""));
    } catch {
      return undefined;
    }
  }
  if (target !== undefined && state.ts.isNumericLiteral(target))
    return BigInt(target.text.replaceAll("_", ""));
  return undefined;
}
function exactFactor(state: AnalysisState, expression: Expression): boolean {
  const { ts } = state;
  const target = unwrap(state, expression);
  const direct = bigintValue(state, target, true);
  if (direct === CONVERSION_FACTOR) return true;
  if (
    !ts.isBinaryExpression(target) ||
    target.operatorToken.kind !== ts.SyntaxKind.AsteriskAsteriskToken
  )
    return false;
  return (
    bigintValue(state, target.left, false) === 10n &&
    bigintValue(state, target.right, true) === DECIMAL_OFFSET
  );
}

const PROTECTED_WRITE_NAME =
  /^(?:createWalletClient|erc20Abi|http|parseEther|privateKeyToAccount|arcTestnet|PRIVATE_KEY|account|client)$/;
const UINT256_MAX =
  "115792089237316195423570985008687907853269984665640564039457584007913129639935";
export async function analyzeArcUsdcWriteAmountFoundation(
  filePath: string,
  source: string,
  compilerLoader: () => Promise<unknown> = () => import("typescript")
) {
  const empty = (status: string) => ({
    status,
    foundation: "unknown" as const,
    amounts: []
  });
  if (!supportsArcUsdcAmountPath(filePath)) return empty("unsupported-file");
  let ts: TypeScript;
  try {
    ts = await import("typescript");
    if ((await compilerLoader()) !== ts) return empty("compiler-unavailable");
  } catch {
    return empty("compiler-unavailable");
  }
  const sourceFile = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    filePath.toLowerCase().endsWith(".js") ? ts.ScriptKind.JS : ts.ScriptKind.TS
  );
  const diagnostics = (
    sourceFile as SourceFile & {
      readonly parseDiagnostics: readonly import("typescript").Diagnostic[];
    }
  ).parseDiagnostics;
  if (diagnostics.length > 0) return empty("malformed");
  const state: AnalysisState = {
    ts,
    sourceFile,
    bindings: collectBindings(ts, sourceFile)
  };
  const exact = { status: "analyzed" as const, foundation: "exact" as const };
  const id = (node: Node, text: string): node is Identifier =>
    ts.isIdentifier(node) &&
    node.text === text &&
    node.getText(sourceFile) === text;
  const string = (node: Expression, text?: string) => {
    if (!ts.isStringLiteral(node)) return null;
    const raw = node.getText(sourceFile);
    return (raw[0] === '"' || raw[0] === "'") &&
      raw.at(-1) === raw[0] &&
      raw.slice(1, -1) === node.text &&
      (text === undefined || node.text === text)
      ? node.text
      : null;
  };
  const imports = (module: string, names: readonly string[]) => {
    const matches = sourceFile.statements.filter(
      (node) =>
        ts.isImportDeclaration(node) &&
        string(node.moduleSpecifier, module) !== null
    );
    if (matches.length !== 1) return null;
    const declaration = matches[0]!;
    const clause = declaration.importClause;
    const named = clause?.namedBindings;
    if (
      declaration.attributes !== undefined ||
      clause?.isTypeOnly !== false ||
      clause?.name !== undefined ||
      named === undefined ||
      !ts.isNamedImports(named)
    )
      return null;
    const items = [...named.elements];
    return items.length === names.length &&
      items.every(
        (item, index) =>
          !item.isTypeOnly &&
          item.propertyName === undefined &&
          id(item.name, names[index]!)
      )
      ? items
      : null;
  };
  const constant = (name: string) => {
    const declarations = sourceFile.statements.flatMap((statement) =>
      ts.isVariableStatement(statement) &&
      statement.modifiers === undefined &&
      (statement.declarationList.flags & ts.NodeFlags.BlockScoped) ===
        ts.NodeFlags.Const &&
      statement.declarationList.declarations.length === 1
        ? [...statement.declarationList.declarations]
        : []
    );
    const matches = declarations.filter((item) => id(item.name, name));
    return matches.length === 1 &&
      matches[0]!.type === undefined &&
      matches[0]!.exclamationToken === undefined &&
      matches[0]!.initializer !== undefined
      ? matches[0]!
      : null;
  };
  const bound = (use: Node, expected: Node, name: string) =>
    id(use, name) && resolveLexical(state, use)?.node === expected;
  const direct = (
    expression: Expression,
    expected: Node,
    name: string,
    arity: number
  ): expression is CallExpression =>
    ts.isCallExpression(expression) &&
    expression.questionDotToken === undefined &&
    expression.typeArguments === undefined &&
    expression.arguments.length === arity &&
    bound(expression.expression, expected, name);
  const root = imports("viem", [
    "createWalletClient",
    "erc20Abi",
    "http",
    "parseEther"
  ]);
  const accountImport = imports("viem/accounts", ["privateKeyToAccount"]);
  const chainImport = imports("viem/chains", ["arcTestnet"]);
  const key = constant("PRIVATE_KEY");
  const account = constant("account");
  const client = constant("client");
  if (
    !root ||
    !accountImport ||
    !chainImport ||
    !key ||
    !account ||
    !client ||
    root[0]!.pos >= accountImport[0]!.pos ||
    accountImport[0]!.pos >= chainImport[0]!.pos
  )
    return empty("analyzed");
  const clientCall = client.initializer!;
  const object =
    direct(clientCall, root[0]!, "createWalletClient", 1) &&
    ts.isObjectLiteralExpression(clientCall.arguments[0]!)
      ? clientCall.arguments[0]
      : null;
  const properties = object?.properties ?? [];
  const property = (index: number, name: string) => {
    const item = properties[index];
    return item && ts.isPropertyAssignment(item) && id(item.name, name)
      ? item.initializer
      : null;
  };
  const chain = property(1, "chain");
  const transport = property(2, "transport");
  const validAccount =
    direct(account.initializer!, accountImport[0]!, "privateKeyToAccount", 1) &&
    bound(account.initializer!.arguments[0]!, key, "PRIVATE_KEY");
  const validClient =
    key.end < account.getStart(sourceFile) &&
    account.end < client.getStart(sourceFile) &&
    properties.length === 3 &&
    ts.isShorthandPropertyAssignment(properties[0]!) &&
    properties[0]!.objectAssignmentInitializer === undefined &&
    bound(properties[0]!.name, account, "account") &&
    chain !== null &&
    bound(chain, chainImport[0]!, "arcTestnet") &&
    transport !== null &&
    direct(transport, root[2]!, "http", 0);
  const protectedTarget = (node: Node): boolean => {
    if (ts.isIdentifier(node)) return PROTECTED_WRITE_NAME.test(node.text);
    if (
      ts.isPropertyAccessExpression(node) ||
      ts.isElementAccessExpression(node)
    )
      return false;
    return ts.forEachChild(node, protectedTarget) === true;
  };
  const hasAmbientProtected = sourceFile.statements.some(
    (node) =>
      isAmbientRoot(ts, node) &&
      ((ts.isVariableStatement(node) &&
        node.declarationList.declarations.some((item) =>
          protectedTarget(item.name)
        )) ||
        ((ts.isFunctionDeclaration(node) ||
          ts.isClassDeclaration(node) ||
          ts.isEnumDeclaration(node) ||
          ts.isModuleDeclaration(node)) &&
          node.name !== undefined &&
          protectedTarget(node.name)))
  );
  let protectedWrite = false;
  const visitWrite = (node: Node): void => {
    const target =
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
      node.operatorToken.kind <= ts.SyntaxKind.LastAssignment
        ? node.left
        : (ts.isForInStatement(node) || ts.isForOfStatement(node)) &&
            !ts.isVariableDeclarationList(node.initializer)
          ? node.initializer
          : (ts.isPrefixUnaryExpression(node) ||
                ts.isPostfixUnaryExpression(node)) &&
              (node.operator === ts.SyntaxKind.PlusPlusToken ||
                node.operator === ts.SyntaxKind.MinusMinusToken)
            ? node.operand
            : ts.isDeleteExpression(node)
              ? node.expression
              : undefined;
    if (target && protectedTarget(target)) protectedWrite = true;
    else if (!protectedWrite) ts.forEachChild(node, visitWrite);
  };
  visitWrite(sourceFile);
  let parserCall: CallExpression | null | undefined = null;
  visitExecutable(state, sourceFile, (call) => {
    if (bound(call.expression, root[3]!, "parseEther"))
      parserCall =
        parserCall === null && direct(call, root[3]!, "parseEther", 1)
          ? call
          : undefined;
  });
  if (
    !/^0x[0-9a-fA-F]{64}$/.test(string(key.initializer!) ?? "") ||
    !validAccount ||
    !validClient ||
    hasAmbientProtected ||
    protectedWrite ||
    !parserCall
  )
    return empty("analyzed");
  const literal = string(parserCall.arguments[0]!);
  const match = literal?.match(/^(0|[1-9][0-9]*)(?:\.([0-9]{1,18}))?$/);
  if (!match) return { ...exact, amounts: [] };
  const rawAmount = `${match[1]}${(match[2] ?? "").padEnd(18, "0")}`;
  const normalized = rawAmount.replace(/^0+(?=[0-9])/, "");
  const bounded =
    normalized.length < UINT256_MAX.length ||
    (normalized.length === UINT256_MAX.length && normalized <= UINT256_MAX);
  if (!bounded) return { ...exact, amounts: [] };
  return {
    ...exact,
    amounts: [
      {
        parserIdentity: "parseEther" as const,
        literal,
        amountOffset: parserCall.arguments[0]!.getStart(sourceFile),
        effectiveValue: BigInt(normalized)
      }
    ]
  };
}
