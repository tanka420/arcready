import { createRequire } from "node:module";
import { currentRuleExecutionScope } from "../../core/rules/execution-scope.js";

type AstNode = Record<string, unknown> & {
  readonly type?: string;
  readonly range?: readonly unknown[];
};

interface SolidityParser {
  parse(source: string, options: Record<string, unknown>): unknown;
}

export type PrevrandaoSourceAnalysisStatus =
  | "analyzed"
  | "unsupported-file"
  | "parser-unavailable"
  | "malformed"
  | "unsupported-source";

export type PrevrandaoSourceKind =
  | "block-prevrandao"
  | "block-prevrandao-cast"
  | "inline-assembly-prevrandao";

export interface PrevrandaoSourceRecord {
  readonly sourceFile: string;
  readonly contractName: string;
  readonly functionName: string;
  readonly sourceKind: PrevrandaoSourceKind;
  readonly sourceOffset: number;
  readonly bindingKind: "direct" | "single-assignment";
  readonly bindingName?: string;
}

export interface PrevrandaoSourceAnalysis {
  readonly status: PrevrandaoSourceAnalysisStatus;
  readonly sources: readonly PrevrandaoSourceRecord[];
}

export type PrevrandaoShellOwner = "bridge-relay" | "wallet-compatibility";

export interface PrevrandaoFlowRecord extends PrevrandaoSourceRecord {
  readonly sinkKind: "authorization" | "collection-selection" | "ordering";
  readonly sinkOffset: number;
  readonly shellOwner: PrevrandaoShellOwner;
}

export interface PrevrandaoFlowAnalysis {
  readonly status: PrevrandaoSourceAnalysisStatus;
  readonly records: readonly PrevrandaoFlowRecord[];
}

export interface PrevrandaoScanInput {
  readonly files: readonly string[];
  readFile(filePath: string): Promise<string>;
  readonly parserLoader?: () => Promise<unknown>;
}

const DIRECT_CAST_NAMES = new Set(["uint", "uint256", "bytes32"]);
const UINT256_PARAMETER_TYPES = new Set(["uint", "uint256"]);
const ADDRESS_PARAMETER_TYPES = new Set(["address"]);
const BOOL_RETURN_TYPES = new Set(["bool"]);
const BYTES32_RETURN_TYPES = new Set(["bytes32"]);
const STATE_VARIABLE_VISIBILITIES = new Set([
  "default",
  "internal",
  "private",
  "public"
]);
const UINT256_MAX = (1n << 256n) - 1n;
const ASSIGNMENT_OPERATORS = new Set([
  "=",
  "+=",
  "-=",
  "*=",
  "/=",
  "%=",
  "|=",
  "&=",
  "^=",
  "<<=",
  ">>="
]);
const MUTATION_OPERATORS = new Set(["++", "--", "delete"]);
const AUTHORIZATION_COMPARISON_OPERATORS = new Set([
  "==",
  "!=",
  "<",
  ">",
  "<=",
  ">="
]);
const BRIDGE_OWNER_IDENTIFIERS = new Set([
  "committee",
  "committees",
  "relay",
  "relays",
  "relayer",
  "relayers",
  "sequencer",
  "sequencers",
  "validator",
  "validators"
]);
const WALLET_OWNER_IDENTIFIERS = new Set([
  "allocation",
  "allocations",
  "eligibility",
  "eligible",
  "recipient",
  "recipients",
  "winner",
  "winners"
]);
const KNOWN_DIRECT_SOURCE_CONTEXTS = new Set([
  "BinaryOperation",
  "Block",
  "Conditional",
  "DoWhileStatement",
  "EmitStatement",
  "ExpressionStatement",
  "ForStatement",
  "FunctionCall",
  "FunctionCallOptions",
  "IfStatement",
  "IndexAccess",
  "IndexRangeAccess",
  "MemberAccess",
  "NameValueExpression",
  "ReturnStatement",
  "RevertStatement",
  "TryCatchClause",
  "TryStatement",
  "TupleExpression",
  "UnaryOperation",
  "UncheckedStatement",
  "VariableDeclarationStatement",
  "WhileStatement"
]);
const EXCLUDED_DIRECTORIES =
  /(?:^|\/)(?:test|tests|__tests__|generated|vendor|node_modules|lib|out|cache|broadcast|dist|build|coverage)(?:\/|$)/i;
const require = createRequire(import.meta.url);
const flowRecordsByExecution = new WeakMap<
  object,
  Promise<readonly PrevrandaoFlowRecord[]>
>();

export function supportsPrevrandaoSourcePath(filePath: string): boolean {
  const normalized = filePath.replaceAll("\\", "/");
  const fileName = normalized.slice(normalized.lastIndexOf("/") + 1);
  return (
    /\.sol$/i.test(fileName) &&
    !/\.(?:test|spec|generated)\.sol$/i.test(fileName) &&
    !EXCLUDED_DIRECTORIES.test(normalized)
  );
}

export async function analyzePrevrandaoSourceFile(
  filePath: string,
  source: string,
  parserLoader: () => Promise<unknown> = () =>
    Promise.resolve(require("@solidity-parser/parser"))
): Promise<PrevrandaoSourceAnalysis> {
  return (
    await analyzeParsedPrevrandaoSourceFile(filePath, source, parserLoader)
  ).analysis;
}

export async function analyzePrevrandaoFlowFile(
  filePath: string,
  source: string,
  parserLoader: () => Promise<unknown> = () =>
    Promise.resolve(require("@solidity-parser/parser"))
): Promise<PrevrandaoFlowAnalysis> {
  const parsed = await analyzeParsedPrevrandaoSourceFile(
    filePath,
    source,
    parserLoader
  );
  if (parsed.ast === undefined || parsed.analysis.status !== "analyzed") {
    return { status: parsed.analysis.status, records: [] };
  }
  return {
    status: "analyzed",
    records: collectCollectionSelectionRecords(
      parsed.ast,
      parsed.analysis.sources,
      source.length
    )
  };
}

export function requestPrevrandaoFlowRecords(
  input: PrevrandaoScanInput
): Promise<readonly PrevrandaoFlowRecord[]> {
  const execution = currentRuleExecutionScope();
  if (execution === undefined) return collectScanFlowRecords(input);

  const cached = flowRecordsByExecution.get(execution);
  if (cached !== undefined) return cached;

  const requested = collectScanFlowRecords(input);
  flowRecordsByExecution.set(execution, requested);
  return requested;
}

export function selectPrevrandaoFlowRecordsForShells(
  records: readonly PrevrandaoFlowRecord[],
  selectedOwners: readonly PrevrandaoShellOwner[]
): readonly PrevrandaoFlowRecord[] {
  const selected = new Set(selectedOwners);
  return records.filter((record) => selected.has(record.shellOwner));
}

async function collectScanFlowRecords(
  input: PrevrandaoScanInput
): Promise<readonly PrevrandaoFlowRecord[]> {
  const records: PrevrandaoFlowRecord[] = [];
  const files = [...new Set(input.files.filter(supportsPrevrandaoSourcePath))]
    .slice()
    .sort(compareText);

  for (const filePath of files) {
    let source: string;
    try {
      source = await input.readFile(filePath);
    } catch {
      continue;
    }
    const result =
      input.parserLoader === undefined
        ? await analyzePrevrandaoFlowFile(filePath, source)
        : await analyzePrevrandaoFlowFile(filePath, source, input.parserLoader);
    records.push(...result.records);
  }
  return records.sort(
    (left, right) =>
      compareText(left.sourceFile, right.sourceFile) ||
      left.sourceOffset - right.sourceOffset ||
      left.sinkOffset - right.sinkOffset
  );
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

async function analyzeParsedPrevrandaoSourceFile(
  filePath: string,
  source: string,
  parserLoader: () => Promise<unknown>
): Promise<{ analysis: PrevrandaoSourceAnalysis; ast?: AstNode }> {
  if (!supportsPrevrandaoSourcePath(filePath)) {
    return { analysis: { status: "unsupported-file", sources: [] } };
  }

  const parser = await loadParser(parserLoader);
  if (parser === null) {
    return { analysis: { status: "parser-unavailable", sources: [] } };
  }

  let ast: unknown;
  try {
    ast = parser.parse(source, { loc: true, range: true, tolerant: false });
  } catch {
    return { analysis: { status: "malformed", sources: [] } };
  }

  if (
    !isNode(ast) ||
    ast.type !== "SourceUnit" ||
    !validRange(ast, source.length) ||
    exactNodeArray(ast.children) === null
  ) {
    return { analysis: { status: "unsupported-source", sources: [] } };
  }
  if (hasUnsupportedSolidityPragma(ast)) {
    return { analysis: { status: "unsupported-source", sources: [] } };
  }

  const result = collectSourceRecords(filePath, ast, source.length);
  if (result.unsupported) {
    return { analysis: { status: "unsupported-source", sources: [] } };
  }
  return {
    ast,
    analysis: {
      status: "analyzed",
      sources: result.sources.sort(
        (left, right) => left.sourceOffset - right.sourceOffset
      )
    }
  };
}

function hasUnsupportedSolidityPragma(ast: AstNode): boolean {
  const pragmas = arrayNodes(ast.children).filter(
    (node) => node.type === "PragmaDirective" && node.name === "solidity"
  );
  return pragmas.length > 1 || pragmas.some((node) => !isSupportedPragma(node));
}

function isSupportedPragma(node: AstNode): boolean {
  if (typeof node.value !== "string") return false;
  if (/^(?:\^|~)?0\.8\.\d+$/.test(node.value)) return true;

  const closedRange = /^>=0\.8\.(\d+)\s+(?:<0\.9\.0|<=0\.8\.(\d+))$/.exec(
    node.value
  );
  if (closedRange === null) return false;
  const lowerPatch = Number(closedRange[1]);
  const upperPatch = closedRange[2];
  return upperPatch === undefined || lowerPatch <= Number(upperPatch);
}

function collectSourceRecords(
  sourceFile: string,
  ast: AstNode,
  size: number
): { sources: PrevrandaoSourceRecord[]; unsupported: boolean } {
  const sources: PrevrandaoSourceRecord[] = [];
  let unsupported = false;
  const contracts = (exactNodeArray(ast.children) ?? []).filter(
    (node) => node.type === "ContractDefinition"
  );
  const ignoredContractRanges: Array<readonly [number, number]> = [];

  for (const contract of contracts) {
    const concrete =
      contract.kind === "contract" && contract.isAbstract !== true;
    const contractName = stringValue(contract.name);
    if (!concrete) {
      if (hasRange(contract)) {
        ignoredContractRanges.push([nodeStart(contract), nodeEnd(contract)]);
      }
      continue;
    }
    if (contractName === null) continue;
    if (!validRange(contract, size, ast)) {
      unsupported = true;
      continue;
    }
    const subNodes = exactNodeArray(contract.subNodes);
    if (subNodes === null) {
      unsupported = true;
      continue;
    }
    if (hasUnsupportedFlowIdentity(ast, contract)) {
      ignoredContractRanges.push([nodeStart(contract), nodeEnd(contract)]);
      unsupported = true;
      continue;
    }

    for (const functionNode of subNodes) {
      if (
        functionNode.type !== "FunctionDefinition" ||
        !isNode(functionNode.body) ||
        functionNode.isConstructor === true ||
        functionNode.isFallback === true ||
        functionNode.isReceiveEther === true
      ) {
        continue;
      }
      const functionName = stringValue(functionNode.name);
      if (functionName === null || !validRange(functionNode, size, contract)) {
        unsupported = true;
        continue;
      }

      const direct = collectDirectSources(
        sourceFile,
        contractName,
        functionName,
        functionNode,
        size
      );
      const assembly = collectAssemblySources(
        sourceFile,
        contractName,
        functionName,
        functionNode,
        size
      );
      sources.push(...direct.sources, ...assembly.sources);
      unsupported ||= direct.unsupported || assembly.unsupported;
    }
  }

  const rawSources = descendants(ast).filter(isRawPrevrandaoSource);
  const recognizedOffsets = new Set(
    sources.map((record) => record.sourceOffset)
  );
  if (
    rawSources.some(
      (node) =>
        !isWithinRanges(node, ignoredContractRanges) &&
        (!hasRange(node) || !recognizedOffsets.has(nodeStart(node)))
    )
  ) {
    unsupported = true;
  }

  return { sources, unsupported };
}

function collectCollectionSelectionRecords(
  ast: AstNode,
  sources: readonly PrevrandaoSourceRecord[],
  size: number
): PrevrandaoFlowRecord[] {
  const records: PrevrandaoFlowRecord[] = [];
  const contracts = (exactNodeArray(ast.children) ?? []).filter(
    (node) => node.type === "ContractDefinition"
  );

  for (const contract of contracts) {
    const contractName = stringValue(contract.name);
    const subNodes = exactNodeArray(contract.subNodes);
    if (
      contract.kind !== "contract" ||
      contract.isAbstract === true ||
      contractName === null ||
      subNodes === null ||
      hasUnsupportedFlowIdentity(ast, contract)
    ) {
      continue;
    }

    for (const functionNode of subNodes) {
      const functionName = stringValue(functionNode.name);
      const modifiers = exactNodeArray(functionNode.modifiers);
      if (
        functionNode.type !== "FunctionDefinition" ||
        functionName === null ||
        modifiers === null ||
        modifiers.length > 0 ||
        !isNode(functionNode.body) ||
        !validRange(functionNode, size) ||
        !validRange(functionNode.body, size, functionNode)
      ) {
        continue;
      }
      const ownedSources = sources.filter(
        (source) =>
          source.contractName === contractName &&
          source.functionName === functionName &&
          nodeStart(functionNode) <= source.sourceOffset &&
          source.sourceOffset <= nodeEnd(functionNode) &&
          hasValidSourceRange(source, functionNode, size)
      );
      if (ownedSources.length === 0) continue;

      const candidates: PrevrandaoFlowRecord[] = [];
      let authCount = 0;
      let orderingCount = 0;
      let ambiguousOwner = false;
      const parents = parentIndex(functionNode);
      for (const node of descendants(functionNode.body)) {
        if (
          isWithinUnsupportedSelectionControlFlow(node, parents, functionNode)
        ) {
          continue;
        }
        const selection = exactCollectionSelection(
          node,
          contract,
          functionNode,
          parents,
          size
        );
        if (selection !== null) {
          const source = exactSelectionSource(
            selection.dependency,
            ownedSources
          );
          const shellOwner = classifyShellOwner(functionName, [
            selection.collectionName,
            selection.selectedEntityName
          ]);
          if (source !== undefined && shellOwner === null) {
            ambiguousOwner = true;
          } else if (source !== undefined && shellOwner !== null) {
            candidates.push({
              ...source,
              sinkKind: "collection-selection",
              sinkOffset: nodeStart(node),
              shellOwner
            });
          }
        }

        const authorization = exactAuthorization(
          node,
          contract,
          functionNode,
          parents,
          ownedSources,
          size
        );
        if (authorization !== null) {
          authCount += 1;
          const shellOwner = classifyShellOwner(
            functionName,
            authorization.ownerIdentifiers
          );
          if (shellOwner === null) {
            ambiguousOwner = true;
          } else {
            candidates.push({
              ...authorization.source,
              sinkKind: "authorization",
              sinkOffset: nodeStart(authorization.comparison),
              shellOwner
            });
          }
        }

        const ordering = exactOrdering(
          node,
          ast,
          contract,
          functionNode,
          parents,
          ownedSources,
          size
        );
        if (ordering !== null) {
          orderingCount += 1;
          const shellOwner = classifyShellOwner(
            functionName,
            ordering.ownerIdentifiers
          );
          if (shellOwner === null) {
            ambiguousOwner = true;
          } else {
            candidates.push({
              ...ordering.source,
              sinkKind: "ordering",
              sinkOffset: nodeStart(ordering.keccak),
              shellOwner
            });
          }
        }
      }
      candidates.sort(
        (left, right) =>
          left.sinkOffset - right.sinkOffset ||
          left.sourceOffset - right.sourceOffset
      );
      const routes = new Set(
        candidates.map(
          (candidate) => `${candidate.sinkKind}:${candidate.shellOwner}`
        )
      );
      if (
        candidates[0] !== undefined &&
        !ambiguousOwner &&
        (authCount + orderingCount === 0 || routes.size === 1)
      ) {
        records.push(candidates[0]);
      }
    }
  }

  return records.sort(
    (left, right) =>
      left.sourceOffset - right.sourceOffset ||
      left.sinkOffset - right.sinkOffset
  );
}

function hasValidSourceRange(
  source: PrevrandaoSourceRecord,
  functionNode: AstNode,
  size: number
): boolean {
  return descendants(functionNode).some(
    (node) =>
      nodeStart(node) === source.sourceOffset &&
      validTree(node, size) &&
      (source.sourceKind === "inline-assembly-prevrandao"
        ? node.type === "AssemblyCall" && node.functionName === "prevrandao"
        : isBlockPrevrandao(node))
  );
}

function hasUnsupportedFlowIdentity(ast: AstNode, contract: AstNode): boolean {
  return (
    arrayNodes(ast.children).some((node) => node.type === "ImportDirective") ||
    arrayNodes(contract.baseContracts).length > 0 ||
    hasDeclarationNamed(ast, "block")
  );
}

function hasDeclarationNamed(ast: AstNode, name: string): boolean {
  return descendants(ast).some(
    (node) =>
      node.name === name &&
      (node.type === "VariableDeclaration" ||
        (typeof node.type === "string" && node.type.endsWith("Definition")))
  );
}

function exactAuthorization(
  node: AstNode,
  contract: AstNode,
  functionNode: AstNode,
  parents: ReadonlyMap<AstNode, AstNode>,
  sources: readonly PrevrandaoSourceRecord[],
  size: number
): {
  comparison: AstNode;
  source: PrevrandaoSourceRecord;
  ownerIdentifiers: readonly string[];
} | null {
  const comparison = isNode(node.expression) ? node.expression : undefined;
  const leftExpression = isNode(comparison?.left) ? comparison.left : undefined;
  const rightExpression = isNode(comparison?.right)
    ? comparison.right
    : undefined;
  if (
    node.type !== "ReturnStatement" ||
    !validRange(functionNode, size) ||
    !isNode(functionNode.body) ||
    !validRange(functionNode.body, size, functionNode) ||
    !validRange(node, size, functionNode.body) ||
    parents.get(node) !== functionNode.body ||
    !hasExactUnnamedReturnType(functionNode, size, BOOL_RETURN_TYPES) ||
    comparison?.type !== "BinaryOperation" ||
    !validRange(comparison, size, node) ||
    !AUTHORIZATION_COMPARISON_OPERATORS.has(
      stringValue(comparison.operator) ?? ""
    ) ||
    leftExpression === undefined ||
    !validRange(leftExpression, size, comparison) ||
    rightExpression === undefined ||
    !validRange(rightExpression, size, comparison)
  ) {
    return null;
  }

  const left = exactAuthorizationSource(leftExpression, sources, size);
  const right = exactAuthorizationSource(rightExpression, sources, size);
  const directLeft = exactAuthorizationDirect(leftExpression, sources, size);
  const directRight = exactAuthorizationDirect(rightExpression, sources, size);
  if (
    comparison.operator === "==" &&
    ((directLeft !== undefined && isZeroLiteral(rightExpression)) ||
      (directRight !== undefined && isZeroLiteral(leftExpression)))
  ) {
    return null;
  }
  if ((left === undefined) === (right === undefined)) return null;

  const source = left ?? right;
  const other = left === undefined ? leftExpression : rightExpression;
  const counterpart = isAuthorizationCounterpart(
    other,
    contract,
    functionNode,
    parents,
    size
  );
  if (
    source === undefined ||
    counterpart === null ||
    [other, ...descendants(other)].some(
      (node) =>
        node.type === "Identifier" &&
        sources.some(
          (record) =>
            record.bindingName !== undefined && record.bindingName === node.name
        )
    )
  ) {
    return null;
  }
  return {
    comparison,
    source,
    ownerIdentifiers:
      counterpart.ownerIdentifier === null ? [] : [counterpart.ownerIdentifier]
  };
}

function exactOrdering(
  node: AstNode,
  ast: AstNode,
  contract: AstNode,
  functionNode: AstNode,
  parents: ReadonlyMap<AstNode, AstNode>,
  sources: readonly PrevrandaoSourceRecord[],
  size: number
): {
  keccak: AstNode;
  source: PrevrandaoSourceRecord;
  ownerIdentifiers: readonly string[];
} | null {
  if (
    node.type !== "ReturnStatement" ||
    !isNode(functionNode.body) ||
    parents.get(node) !== functionNode.body ||
    hasOrderingIdentityConflict(ast, contract) ||
    !validRange(node, size, functionNode.body) ||
    !isNode(node.expression) ||
    !validTree(node.expression, size)
  ) {
    return null;
  }

  const expression = node.expression;
  const outerArguments = exactNodeArray(expression.arguments);
  const possibleRoot = outerArguments?.length === 1 ? outerArguments[0] : null;
  const root =
    possibleRoot !== null && isApprovedDirectCast(expression, possibleRoot)
      ? possibleRoot
      : expression;
  const castName =
    expression === root || !isNode(expression.expression)
      ? null
      : stringValue(expression.expression.name);
  const returnTypes =
    expression === root || castName === "bytes32"
      ? BYTES32_RETURN_TYPES
      : UINT256_PARAMETER_TYPES;
  const keccakArguments = exactNodeArray(root.arguments);
  if (
    !hasExactUnnamedReturnType(functionNode, size, returnTypes) ||
    root.type !== "FunctionCall" ||
    !validRange(root, size, expression === root ? node : expression) ||
    !isIdentifierNamed(root.expression, "keccak256") ||
    keccakArguments?.length !== 1
  ) {
    return null;
  }

  const encoding = keccakArguments[0];
  const encodingTarget = isNode(encoding.expression)
    ? encoding.expression
    : undefined;
  const encodingArguments = exactNodeArray(encoding.arguments);
  if (
    encoding.type !== "FunctionCall" ||
    !validRange(encoding, size, root) ||
    encodingTarget?.type !== "MemberAccess" ||
    encodingTarget.memberName !== "encode" ||
    !isIdentifierNamed(encodingTarget.expression, "abi") ||
    encodingArguments === null ||
    encodingArguments.length < 2
  ) {
    return null;
  }

  const exactSources = encodingArguments
    .map((argument) => exactDirectSource(argument, sources))
    .filter((source): source is PrevrandaoSourceRecord => source !== undefined);
  const transformedSource = encodingArguments.some(
    (argument) =>
      exactDirectSource(argument, sources) === undefined &&
      containsKnownSource(argument, sources)
  );
  const nonSourceArguments = encodingArguments.filter(
    (argument) => !containsKnownSource(argument, sources)
  );
  if (
    transformedSource ||
    exactSources.length !== 1 ||
    nonSourceArguments.length === 0 ||
    nonSourceArguments.some(
      (argument) =>
        !isBoundOrderingInput(argument, contract, functionNode, size)
    )
  ) {
    return null;
  }
  return {
    keccak: root,
    source: exactSources[0],
    ownerIdentifiers: nonSourceArguments.flatMap((argument) => {
      const name =
        argument.type === "Identifier" ? stringValue(argument.name) : null;
      return name === null ? [] : [name];
    })
  };
}

function hasOrderingIdentityConflict(ast: AstNode, contract: AstNode): boolean {
  if (
    arrayNodes(ast.children).some((node) => node.type === "ImportDirective") ||
    arrayNodes(contract.baseContracts).length > 0
  ) {
    return true;
  }
  return (
    hasDeclarationNamed(ast, "keccak256") || hasDeclarationNamed(ast, "abi")
  );
}

function isBoundOrderingInput(
  expression: AstNode,
  contract: AstNode,
  functionNode: AstNode,
  size: number
): boolean {
  if (!validTree(expression, size)) return false;
  if (expression.type === "NumberLiteral") {
    return isUnsignedIntegerLiteral(expression);
  }
  const name =
    expression.type === "Identifier" ? stringValue(expression.name) : null;
  return (
    name !== null &&
    hasExactVisibleValueDeclaration(
      name,
      contract,
      functionNode,
      size,
      UINT256_PARAMETER_TYPES
    )
  );
}

function containsKnownSource(
  expression: AstNode,
  sources: readonly PrevrandaoSourceRecord[]
): boolean {
  const nodes = [expression, ...descendants(expression)];
  return nodes.some(
    (node) =>
      isRawPrevrandaoSource(node) ||
      (node.type === "Identifier" &&
        sources.some(
          (source) =>
            source.bindingName !== undefined && source.bindingName === node.name
        ))
  );
}

function exactAuthorizationSource(
  expression: AstNode,
  sources: readonly PrevrandaoSourceRecord[],
  size: number
): PrevrandaoSourceRecord | undefined {
  const direct = exactAuthorizationDirect(expression, sources, size);
  if (direct !== undefined) return direct;
  if (
    expression.type !== "BinaryOperation" ||
    expression.operator !== "%" ||
    !validTree(expression, size) ||
    !isNode(expression.left) ||
    !isNode(expression.right) ||
    !isNonZeroIntegerLiteral(expression.right)
  ) {
    return undefined;
  }
  return exactAuthorizationDirect(expression.left, sources, size);
}

function exactAuthorizationDirect(
  expression: AstNode,
  sources: readonly PrevrandaoSourceRecord[],
  size: number
): PrevrandaoSourceRecord | undefined {
  return validTree(expression, size)
    ? exactDirectSource(expression, sources)
    : undefined;
}

function isAuthorizationCounterpart(
  expression: AstNode,
  contract: AstNode,
  functionNode: AstNode,
  parents: ReadonlyMap<AstNode, AstNode>,
  size: number
): { ownerIdentifier: string | null } | null {
  if (!validTree(expression, size)) return null;
  if (expression.type === "Identifier") {
    const name = stringValue(expression.name);
    return name !== null &&
      hasExactFunctionParameter(
        name,
        contract,
        functionNode,
        size,
        UINT256_PARAMETER_TYPES
      )
      ? { ownerIdentifier: name }
      : null;
  }
  if (expression.type === "NumberLiteral") {
    return isUnsignedIntegerLiteral(expression)
      ? { ownerIdentifier: null }
      : null;
  }
  if (
    expression.type !== "BinaryOperation" ||
    expression.operator !== "%" ||
    !isNode(expression.left) ||
    !isNode(expression.right) ||
    !isNonZeroIntegerLiteral(expression.right)
  ) {
    return null;
  }
  const call = expression.left;
  const typeName = isNode(call.expression) ? call.expression : undefined;
  const arguments_ = exactNodeArray(call.arguments);
  const ownerIdentifier =
    arguments_?.length === 1 && arguments_[0]?.type === "Identifier"
      ? stringValue(arguments_[0].name)
      : null;
  return call.type === "FunctionCall" &&
    typeName?.type === "ElementaryTypeName" &&
    typeName.name === "uint160" &&
    arguments_?.length === 1 &&
    arguments_[0]?.type === "Identifier" &&
    ownerIdentifier !== null &&
    hasExactFunctionParameter(
      ownerIdentifier,
      contract,
      functionNode,
      size,
      ADDRESS_PARAMETER_TYPES
    ) &&
    parents.get(call) === expression
    ? { ownerIdentifier }
    : null;
}

function hasExactFunctionParameter(
  name: string,
  contract: AstNode,
  functionNode: AstNode,
  size: number,
  allowedTypes: ReadonlySet<string> = UINT256_PARAMETER_TYPES
): boolean {
  const declarations = exactVisibleValueDeclarations(
    contract,
    functionNode,
    size
  );
  if (declarations === null) return false;
  const parameters = declarations.parameters.filter(
    (parameter) => parameter.name === name
  );
  return (
    parameters.length === 1 &&
    declarations.all.filter((declaration) => declaration.name === name)
      .length === 1 &&
    hasApprovedElementaryType(parameters[0], allowedTypes, "parameter")
  );
}

function hasExactVisibleValueDeclaration(
  name: string,
  contract: AstNode,
  functionNode: AstNode,
  size: number,
  allowedTypes: ReadonlySet<string>
): boolean {
  const declarations = exactVisibleValueDeclarations(
    contract,
    functionNode,
    size
  );
  if (declarations === null) return false;
  const named = declarations.all.filter(
    (declaration) => declaration.name === name
  );
  return (
    named.length === 1 &&
    [...declarations.parameters, ...declarations.stateVariables].includes(
      named[0]
    ) &&
    hasApprovedElementaryType(
      named[0],
      allowedTypes,
      declarations.parameters.includes(named[0]) ? "parameter" : "state"
    )
  );
}

function exactVisibleValueDeclarations(
  contract: AstNode,
  functionNode: AstNode,
  size: number
): {
  parameters: readonly AstNode[];
  stateVariables: readonly AstNode[];
  all: readonly AstNode[];
} | null {
  const parameters = exactNodeArray(functionNode.parameters);
  const returnParameters = exactNodeArray(functionNode.returnParameters);
  const subNodes = exactNodeArray(contract.subNodes);
  const functionBody = isNode(functionNode.body)
    ? functionNode.body
    : undefined;
  if (
    parameters === null ||
    returnParameters === null ||
    subNodes === null ||
    functionBody === undefined
  ) {
    return null;
  }
  const stateVariables: AstNode[] = [];
  for (const state of subNodes.filter(
    (node) => node.type === "StateVariableDeclaration"
  )) {
    const variables = exactNodeArray(state.variables);
    if (variables === null) return null;
    stateVariables.push(...variables);
  }
  const locals = descendants(functionBody).filter(
    (node) => node.type === "VariableDeclaration"
  );
  if (
    parameters.some(
      (node) =>
        !hasExactVariableDeclarationShape(node, "parameter") ||
        !validTree(node, size, functionNode)
    ) ||
    returnParameters.some(
      (node) =>
        !hasExactVariableDeclarationShape(node, "return") ||
        !validTree(node, size, functionNode)
    ) ||
    locals.some(
      (node) =>
        !hasExactVariableDeclarationShape(node, "local") ||
        !validTree(node, size, functionBody)
    ) ||
    stateVariables.some(
      (node) =>
        !hasExactVariableDeclarationShape(node, "state") ||
        !validTree(node, size, contract)
    )
  ) {
    return null;
  }
  return {
    parameters,
    stateVariables,
    all: [...parameters, ...returnParameters, ...locals, ...stateVariables]
  };
}

function hasApprovedElementaryType(
  declaration: AstNode,
  allowedTypes: ReadonlySet<string>,
  role: VariableDeclarationRole
): boolean {
  const typeName = isNode(declaration.typeName)
    ? declaration.typeName
    : undefined;
  return (
    hasExactVariableDeclarationShape(declaration, role) &&
    isApprovedElementaryTypeName(typeName, allowedTypes)
  );
}

function isApprovedElementaryTypeName(
  typeName: AstNode | undefined,
  allowedTypes: ReadonlySet<string>
): boolean {
  return (
    typeName?.type === "ElementaryTypeName" &&
    typeof typeName.name === "string" &&
    allowedTypes.has(typeName.name) &&
    (typeName.stateMutability === null ||
      (typeName.name === "address" && typeName.stateMutability === "payable"))
  );
}

type VariableDeclarationRole = "parameter" | "return" | "local" | "state";

function hasExactVariableDeclarationShape(
  declaration: AstNode,
  role: VariableDeclarationRole
): boolean {
  const name = declaration.name;
  const identifier = declaration.identifier;
  return (
    declaration.type === "VariableDeclaration" &&
    (name === null || typeof name === "string") &&
    (name === null
      ? identifier === null
      : isNode(identifier) &&
        identifier.type === "Identifier" &&
        identifier.name === name) &&
    hasExactDataLocationForRole(declaration, role) &&
    declaration.isStateVar === (role === "state") &&
    declaration.isIndexed === false &&
    declaration.expression === null &&
    (role !== "state" ||
      (STATE_VARIABLE_VISIBILITIES.has(
        stringValue(declaration.visibility) ?? ""
      ) &&
        declaration.isDeclaredConst === false &&
        declaration.isImmutable === false &&
        declaration.isTransient === false &&
        declaration.override === null))
  );
}

function hasExactDataLocationForRole(
  declaration: AstNode,
  role: VariableDeclarationRole
): boolean {
  const typeName = isNode(declaration.typeName)
    ? declaration.typeName
    : undefined;
  if (typeName === undefined) return false;

  if (typeName.type === "Mapping") {
    return (
      (role === "state" && declaration.storageLocation === null) ||
      (role === "local" && declaration.storageLocation === "storage")
    );
  }

  const isReferenceType =
    typeName.type === "ArrayTypeName" ||
    (typeName.type === "ElementaryTypeName" &&
      (typeName.name === "bytes" || typeName.name === "string"));
  if (
    typeName.type !== "ArrayTypeName" &&
    typeName.type !== "ElementaryTypeName"
  ) {
    return false;
  }
  if (!isReferenceType) return declaration.storageLocation === null;

  switch (role) {
    case "state":
      return declaration.storageLocation === null;
    case "parameter":
      return (
        declaration.storageLocation === "memory" ||
        declaration.storageLocation === "calldata"
      );
    case "return":
      return declaration.storageLocation === "memory";
    case "local":
      return (
        declaration.storageLocation === "memory" ||
        declaration.storageLocation === "storage"
      );
  }
}

function hasExactUnnamedReturnType(
  functionNode: AstNode,
  size: number,
  allowedTypes: ReadonlySet<string>
): boolean {
  const returnParameters = exactNodeArray(functionNode.returnParameters);
  const parameter = returnParameters?.length === 1 ? returnParameters[0] : null;
  return (
    parameter !== null &&
    parameter.name === null &&
    validTree(parameter, size, functionNode) &&
    hasApprovedElementaryType(parameter, allowedTypes, "return")
  );
}

function isUnsignedIntegerLiteral(node: AstNode): boolean {
  if (
    node.type !== "NumberLiteral" ||
    !hasRange(node) ||
    node.subdenomination !== null
  ) {
    return false;
  }
  if (typeof node.number !== "string") return false;
  const literal = node.number.replaceAll("_", "");
  if (!/^[0-9]+$/.test(literal) || literal.length > 78) return false;
  try {
    return BigInt(literal) <= UINT256_MAX;
  } catch {
    return false;
  }
}

function isNonZeroIntegerLiteral(node: AstNode): boolean {
  if (
    node.type !== "NumberLiteral" ||
    !hasRange(node) ||
    node.subdenomination !== null
  ) {
    return false;
  }
  return isUnsignedIntegerLiteral(node) && !isZeroLiteral(node);
}

function exactDirectSource(
  expression: AstNode,
  sources: readonly PrevrandaoSourceRecord[]
): PrevrandaoSourceRecord | undefined {
  if (isBlockPrevrandao(expression) && hasRange(expression)) {
    return sources.find(
      (source) =>
        source.bindingKind === "direct" &&
        source.sourceKind === "block-prevrandao" &&
        source.sourceOffset === nodeStart(expression)
    );
  }

  const arguments_ = exactNodeArray(expression.arguments);
  const directSource = arguments_?.length === 1 ? arguments_[0] : undefined;
  if (
    directSource === undefined ||
    !isApprovedDirectCast(expression, directSource) ||
    !hasRange(expression) ||
    !hasRange(directSource)
  ) {
    return undefined;
  }
  return sources.find(
    (source) =>
      source.bindingKind === "direct" &&
      source.sourceKind === "block-prevrandao-cast" &&
      source.sourceOffset === nodeStart(directSource)
  );
}

function isZeroLiteral(node: AstNode): boolean {
  if (
    node.type !== "NumberLiteral" ||
    !hasRange(node) ||
    node.subdenomination !== null ||
    typeof node.number !== "string"
  ) {
    return false;
  }
  const literal = node.number.replaceAll("_", "").toLowerCase();
  const digits = literal.startsWith("0x")
    ? literal.slice(2)
    : (literal.split("e")[0] ?? "").replace(".", "");
  return /^0+$/.test(digits);
}

function exactCollectionSelection(
  node: AstNode,
  contract: AstNode,
  functionNode: AstNode,
  parents: ReadonlyMap<AstNode, AstNode>,
  size: number
): {
  collectionName: string;
  dependency: AstNode;
  selectedEntityName: string | null;
} | null {
  if (
    node.type !== "IndexAccess" ||
    !validTree(node, size) ||
    hasNamedReturnParameter(functionNode)
  ) {
    return null;
  }
  const sink = exactSelectionSinkContext(node, functionNode, parents, size);
  if (sink === null) return null;
  const base = isNode(node.base) ? node.base : undefined;
  const index = isNode(node.index) ? node.index : undefined;
  const collectionName = base === undefined ? null : stringValue(base.name);
  if (
    base?.type !== "Identifier" ||
    !validRange(base, size, node) ||
    collectionName === null ||
    !hasExactArrayDeclaration(collectionName, contract, functionNode, size) ||
    index === undefined ||
    !validRange(index, size, node)
  ) {
    return null;
  }

  if (index?.type === "BinaryOperation") {
    const dependency = exactModuloDependency(index, collectionName, size);
    return dependency === null
      ? null
      : {
          ...dependency,
          selectedEntityName: sink.selectedEntityName
        };
  }
  if (index?.type !== "Identifier") return null;

  const indexName = stringValue(index.name);
  if (indexName === null) return null;
  const declarations = descendants(functionNode).filter(
    (candidate) =>
      candidate.type === "VariableDeclarationStatement" &&
      parents.get(candidate) === functionNode.body &&
      (exactNodeArray(candidate.variables) ?? []).some(
        (variable) =>
          hasRange(variable) && stringValue(variable.name) === indexName
      )
  );
  if (declarations.length !== 1) return null;
  const declaration = declarations[0];
  const declarationVariables = exactNodeArray(declaration.variables);
  const indexVariable =
    declarationVariables?.length === 1 ? declarationVariables[0] : undefined;
  if (
    !hasRange(declaration) ||
    !isNode(functionNode.body) ||
    !validTree(declaration, size, functionNode.body) ||
    indexVariable === undefined ||
    !hasApprovedElementaryType(
      indexVariable,
      UINT256_PARAMETER_TYPES,
      "local"
    ) ||
    nodeEnd(declaration) >= nodeStart(node) ||
    !isStableSingleAssignment(functionNode, declaration, indexName) ||
    !isNode(declaration.initialValue) ||
    declaration.initialValue.type !== "BinaryOperation"
  ) {
    return null;
  }
  const dependency = exactModuloDependency(
    declaration.initialValue,
    collectionName,
    size
  );
  return dependency === null
    ? null
    : {
        ...dependency,
        selectedEntityName: sink.selectedEntityName
      };
}

function exactSelectionSinkContext(
  selection: AstNode,
  functionNode: AstNode,
  parents: ReadonlyMap<AstNode, AstNode>,
  size: number
): { selectedEntityName: string | null } | null {
  const functionBody = isNode(functionNode.body)
    ? functionNode.body
    : undefined;
  const parent = parents.get(selection);
  if (functionBody === undefined || parent === undefined) return null;

  if (
    parent.type === "ReturnStatement" &&
    parent.expression === selection &&
    parents.get(parent) === functionBody &&
    validTree(parent, size, functionBody) &&
    hasExactUnnamedReturnType(functionNode, size, ADDRESS_PARAMETER_TYPES)
  ) {
    return { selectedEntityName: null };
  }

  const variables = exactNodeArray(parent.variables);
  const selected = variables?.length === 1 ? variables[0] : undefined;
  if (
    parent.type !== "VariableDeclarationStatement" ||
    parent.initialValue !== selection ||
    parents.get(parent) !== functionBody ||
    !validTree(parent, size, functionBody) ||
    selected === undefined ||
    !hasApprovedElementaryType(selected, ADDRESS_PARAMETER_TYPES, "local")
  ) {
    return null;
  }
  const selectedEntityName = stringValue(selected.name);
  return selectedEntityName === null ? null : { selectedEntityName };
}

function hasNamedReturnParameter(functionNode: AstNode): boolean {
  const returnParameters = exactNodeArray(functionNode.returnParameters);
  return (
    returnParameters === null ||
    returnParameters.some((parameter) => parameter.name !== null)
  );
}

function hasExactArrayDeclaration(
  name: string,
  contract: AstNode,
  functionNode: AstNode,
  size: number
): boolean {
  const declarations = exactVisibleValueDeclarations(
    contract,
    functionNode,
    size
  );
  if (declarations === null) return false;
  const named = declarations.all.filter(
    (declaration) => declaration.name === name
  );
  return (
    named.length === 1 &&
    [...declarations.parameters, ...declarations.stateVariables].includes(
      named[0]
    ) &&
    isNode(named[0].typeName) &&
    named[0].typeName.type === "ArrayTypeName" &&
    named[0].typeName.length === null &&
    isNode(named[0].typeName.baseTypeName) &&
    isApprovedElementaryTypeName(
      named[0].typeName.baseTypeName,
      ADDRESS_PARAMETER_TYPES
    )
  );
}

function exactModuloDependency(
  modulo: AstNode,
  collectionName: string,
  size: number
): { collectionName: string; dependency: AstNode } | null {
  if (
    modulo.operator !== "%" ||
    !validTree(modulo, size) ||
    !isNode(modulo.left) ||
    !hasRange(modulo.left)
  ) {
    return null;
  }
  const length = isNode(modulo.right) ? modulo.right : undefined;
  if (
    length?.type !== "MemberAccess" ||
    !hasRange(length) ||
    length.memberName !== "length" ||
    !isNode(length.expression) ||
    !hasRange(length.expression) ||
    !isIdentifierNamed(length.expression, collectionName)
  ) {
    return null;
  }
  return { collectionName, dependency: modulo.left };
}

function exactSelectionSource(
  dependency: AstNode,
  sources: readonly PrevrandaoSourceRecord[]
): PrevrandaoSourceRecord | undefined {
  if (dependency.type === "Identifier") {
    const name = stringValue(dependency.name);
    if (name === null) return undefined;
    return sources.find(
      (source) =>
        source.bindingKind === "single-assignment" &&
        source.bindingName === name &&
        source.sourceOffset < nodeStart(dependency)
    );
  }

  if (isBlockPrevrandao(dependency) && hasRange(dependency)) {
    return exactDirectSource(dependency, sources);
  }

  const arguments_ = exactNodeArray(dependency.arguments);
  const directSource = arguments_?.length === 1 ? arguments_[0] : undefined;
  if (
    directSource === undefined ||
    !isApprovedDirectCast(dependency, directSource) ||
    !hasRange(directSource)
  ) {
    return undefined;
  }
  return exactDirectSource(dependency, sources);
}

function classifyShellOwner(
  functionName: string,
  additionalIdentifiers: readonly (string | null)[] = []
): PrevrandaoFlowRecord["shellOwner"] | null {
  const tokens = [
    ...identifierTokens(functionName),
    ...additionalIdentifiers.flatMap((identifier) =>
      identifier === null ? [] : identifierTokens(identifier)
    )
  ];
  const bridge = tokens.some((token) => BRIDGE_OWNER_IDENTIFIERS.has(token));
  const wallet = tokens.some((token) => WALLET_OWNER_IDENTIFIERS.has(token));
  if (bridge && wallet) return null;
  return bridge ? "bridge-relay" : "wallet-compatibility";
}

function isWithinUnsupportedSelectionControlFlow(
  node: AstNode,
  parents: ReadonlyMap<AstNode, AstNode>,
  functionNode: AstNode
): boolean {
  let current = node;
  while (current !== functionNode) {
    const parent = parents.get(current);
    if (parent === undefined) return true;
    if (
      parent.type === "ForStatement" ||
      parent.type === "WhileStatement" ||
      parent.type === "DoWhileStatement"
    ) {
      return true;
    }
    if (parent.type === "EmitStatement") return true;
    if (
      parent.type === "BinaryOperation" &&
      ASSIGNMENT_OPERATORS.has(stringValue(parent.operator) ?? "")
    ) {
      return true;
    }
    if (
      parent !== functionNode &&
      !KNOWN_DIRECT_SOURCE_CONTEXTS.has(parent.type ?? "")
    ) {
      return true;
    }
    current = parent;
  }
  return false;
}

function identifierTokens(value: string): string[] {
  return value
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .filter((token) => token.length > 0)
    .map((token) => token.toLowerCase());
}

function isWithinRanges(
  node: AstNode,
  ranges: readonly (readonly [number, number])[]
): boolean {
  if (!hasRange(node)) return false;
  const start = nodeStart(node);
  return ranges.some(([rangeStart, rangeEnd]) => {
    return rangeStart <= start && start <= rangeEnd;
  });
}

function collectDirectSources(
  sourceFile: string,
  contractName: string,
  functionName: string,
  functionNode: AstNode,
  size: number
): { sources: PrevrandaoSourceRecord[]; unsupported: boolean } {
  const sources: PrevrandaoSourceRecord[] = [];
  let unsupported = false;
  const parents = parentIndex(functionNode);

  for (const node of descendants(functionNode)) {
    if (!isBlockPrevrandao(node)) continue;
    if (!validTree(node, size, functionNode)) {
      unsupported = true;
      continue;
    }

    const parent = parents.get(node);
    const cast = isApprovedDirectCast(parent, node) ? parent : undefined;
    if (cast !== undefined && !validTree(cast, size, functionNode)) {
      unsupported = true;
      continue;
    }
    const sourceExpression = cast ?? node;
    if (!hasKnownDirectSourceContext(parents, sourceExpression, functionNode)) {
      unsupported = true;
      continue;
    }
    const binding = exactInitializerBinding(
      parents,
      sourceExpression,
      functionNode,
      size
    );
    if (binding.unsupported) {
      unsupported = true;
      continue;
    }
    sources.push({
      sourceFile,
      contractName,
      functionName,
      sourceKind:
        cast === undefined ? "block-prevrandao" : "block-prevrandao-cast",
      sourceOffset: nodeStart(node),
      bindingKind: binding.name === undefined ? "direct" : "single-assignment",
      ...(binding.name === undefined ? {} : { bindingName: binding.name })
    });
  }
  return { sources, unsupported };
}

function collectAssemblySources(
  sourceFile: string,
  contractName: string,
  functionName: string,
  functionNode: AstNode,
  size: number
): { sources: PrevrandaoSourceRecord[]; unsupported: boolean } {
  const sources: PrevrandaoSourceRecord[] = [];
  let unsupported = false;
  const parents = parentIndex(functionNode);
  const declarations = localDeclarations(functionNode, parents, size);

  for (const inlineNode of descendants(functionNode).filter(
    (node) => node.type === "InlineAssemblyStatement"
  )) {
    const nested = descendants(inlineNode);
    const calls = nested.filter(
      (node) =>
        node.type === "AssemblyCall" && node.functionName === "prevrandao"
    );
    if (calls.length === 0) continue;
    const assignments = nested.filter(
      (node) => node.type === "AssemblyAssignment"
    );
    const exact = assignments.length === 1 ? assignments[0] : undefined;
    const names = exact === undefined ? null : exactNodeArray(exact.names);
    const call = calls.length === 1 ? calls[0] : undefined;
    const targetName = names?.length === 1 ? stringValue(names[0].name) : null;
    const declaration =
      targetName === null
        ? undefined
        : declarations.filter(
            (item) =>
              item.name === targetName && item.offset < nodeStart(inlineNode)
          );
    const supported =
      validTree(inlineNode, size, functionNode) &&
      call !== undefined &&
      validRange(call, size, inlineNode) &&
      exact !== undefined &&
      validRange(exact, size, inlineNode) &&
      exact.expression === call &&
      exactNodeArray(call.arguments)?.length === 0 &&
      targetName !== null &&
      declaration?.length === 1 &&
      isStableSingleAssignment(
        functionNode,
        declaration[0].node,
        targetName,
        exact
      ) &&
      !nested.some((node) => node.type === "AssemblyFunctionDefinition");
    if (!supported || call === undefined || targetName === null) {
      unsupported = true;
      continue;
    }
    sources.push({
      sourceFile,
      contractName,
      functionName,
      sourceKind: "inline-assembly-prevrandao",
      sourceOffset: nodeStart(call),
      bindingKind: "single-assignment",
      bindingName: targetName
    });
  }
  return { sources, unsupported };
}

function exactInitializerBinding(
  parents: ReadonlyMap<AstNode, AstNode>,
  expression: AstNode,
  functionNode: AstNode,
  size: number
): { name?: string; unsupported: boolean } {
  const statement = parents.get(expression);
  if (
    statement?.type === "BinaryOperation" &&
    ASSIGNMENT_OPERATORS.has(stringValue(statement.operator) ?? "") &&
    statement.right === expression
  ) {
    return { unsupported: true };
  }
  if (
    statement?.type !== "VariableDeclarationStatement" ||
    statement.initialValue !== expression
  ) {
    return { unsupported: false };
  }
  const variables = exactNodeArray(statement.variables);
  const variable = variables?.length === 1 ? variables[0] : undefined;
  if (
    variable === undefined ||
    !isNode(functionNode.body) ||
    !validTree(statement, size, functionNode.body) ||
    !hasApprovedElementaryType(variable, UINT256_PARAMETER_TYPES, "local") ||
    parents.get(statement) !== functionNode.body
  ) {
    return { unsupported: true };
  }
  const name = stringValue(variable.name);
  if (
    name === null ||
    !isStableSingleAssignment(functionNode, statement, name)
  ) {
    return { unsupported: true };
  }
  return { name, unsupported: false };
}

function isStableSingleAssignment(
  functionNode: AstNode,
  declaration: AstNode,
  name: string,
  allowedAssemblyAssignment?: AstNode
): boolean {
  const declarations = descendants(functionNode).filter(
    (node) =>
      node.type === "VariableDeclarationStatement" &&
      (exactNodeArray(node.variables) ?? []).some(
        (variable) => stringValue(variable.name) === name
      )
  );
  if (declarations.length !== 1) return false;

  for (const node of descendants(functionNode)) {
    if (nodeStart(node) <= nodeEnd(declaration)) continue;
    if (
      node.type === "BinaryOperation" &&
      ASSIGNMENT_OPERATORS.has(stringValue(node.operator) ?? "") &&
      writesBindingTarget(node.left, name)
    ) {
      return false;
    }
    if (
      node.type === "AssemblyAssignment" &&
      node !== allowedAssemblyAssignment &&
      (exactNodeArray(node.names) ?? []).some((target) =>
        isIdentifierNamed(target, name)
      )
    ) {
      return false;
    }
    if (
      node.type === "AssemblyLocalDefinition" &&
      (exactNodeArray(node.names) ?? []).some((target) =>
        isIdentifierNamed(target, name)
      )
    ) {
      return false;
    }
    if (
      node.type === "UnaryOperation" &&
      MUTATION_OPERATORS.has(stringValue(node.operator) ?? "") &&
      isIdentifierNamed(node.subExpression, name)
    ) {
      return false;
    }
    if (
      node.type === "VariableDeclarationStatement" &&
      isIdentifierNamed(node.initialValue, name)
    ) {
      return false;
    }
  }
  return true;
}

function writesBindingTarget(value: unknown, name: string): boolean {
  if (isIdentifierNamed(value, name)) return true;
  if (!isNode(value) || value.type !== "TupleExpression") return false;
  return arrayNodes(value.components).some((item) =>
    writesBindingTarget(item, name)
  );
}

function isIdentifierNamed(value: unknown, name: string): boolean {
  return isNode(value) && value.type === "Identifier" && value.name === name;
}

function localDeclarations(
  functionNode: AstNode,
  parents: ReadonlyMap<AstNode, AstNode>,
  size: number
): Array<{ name: string; offset: number; node: AstNode }> {
  const declarations: Array<{ name: string; offset: number; node: AstNode }> =
    [];
  for (const statement of descendants(functionNode)) {
    if (
      statement.type !== "VariableDeclarationStatement" ||
      statement.initialValue !== null ||
      !hasRange(statement) ||
      parents.get(statement) !== functionNode.body
    ) {
      continue;
    }
    const variables = exactNodeArray(statement.variables);
    const variable = variables?.length === 1 ? variables[0] : undefined;
    const name = variable === undefined ? null : stringValue(variable.name);
    if (variable === undefined || name === null) continue;
    if (
      !isNode(functionNode.body) ||
      !validTree(statement, size, functionNode.body) ||
      !hasApprovedElementaryType(variable, UINT256_PARAMETER_TYPES, "local")
    ) {
      continue;
    }
    declarations.push({
      name,
      offset: nodeStart(statement),
      node: statement
    });
  }
  return declarations;
}

function hasKnownDirectSourceContext(
  parents: ReadonlyMap<AstNode, AstNode>,
  source: AstNode,
  functionNode: AstNode
): boolean {
  let current = source;
  while (current !== functionNode) {
    const parent = parents.get(current);
    if (parent === undefined) return false;
    if (parent === functionNode) return true;
    if (!KNOWN_DIRECT_SOURCE_CONTEXTS.has(parent.type ?? "")) return false;
    current = parent;
  }
  return true;
}

function isApprovedDirectCast(
  node: AstNode | undefined,
  source: AstNode
): node is AstNode {
  if (node?.type !== "FunctionCall") return false;
  const expression = isNode(node.expression) ? node.expression : undefined;
  const castName =
    expression === undefined ? null : stringValue(expression.name);
  const arguments_ = exactNodeArray(node.arguments);
  return (
    (expression?.type === "Identifier" ||
      expression?.type === "ElementaryTypeName") &&
    castName !== null &&
    DIRECT_CAST_NAMES.has(castName) &&
    arguments_?.length === 1 &&
    arguments_[0] === source
  );
}

function isRawPrevrandaoSource(node: AstNode): boolean {
  return (
    isBlockPrevrandao(node) ||
    (node.type === "AssemblyCall" && node.functionName === "prevrandao")
  );
}

function isBlockPrevrandao(node: AstNode): boolean {
  return (
    node.type === "MemberAccess" &&
    node.memberName === "prevrandao" &&
    isNode(node.expression) &&
    node.expression.type === "Identifier" &&
    node.expression.name === "block"
  );
}

function parentIndex(root: AstNode): Map<AstNode, AstNode> {
  const parents = new Map<AstNode, AstNode>();
  walk(root, (node, parent) => {
    if (parent !== undefined) parents.set(node, parent);
  });
  return parents;
}

function descendants(root: AstNode): AstNode[] {
  const result: AstNode[] = [];
  walk(root, (node) => {
    if (node !== root) result.push(node);
  });
  return result;
}

function walk(
  node: AstNode,
  visitor: (node: AstNode, parent?: AstNode) => void,
  parent?: AstNode
): void {
  visitor(node, parent);
  for (const child of childrenOf(node)) walk(child, visitor, node);
}

function childrenOf(node: AstNode): AstNode[] {
  const children: AstNode[] = [];
  for (const [key, value] of Object.entries(node)) {
    if (key === "loc" || key === "range") continue;
    if (Array.isArray(value)) {
      for (const item of value) if (isNode(item)) children.push(item);
    } else if (isNode(value)) {
      children.push(value);
    }
  }
  return children;
}

function arrayNodes(value: unknown): AstNode[] {
  return Array.isArray(value) ? value.filter(isNode) : [];
}

function exactNodeArray(value: unknown): AstNode[] | null {
  return Array.isArray(value) && value.every(isNode) ? value : null;
}

function isNode(value: unknown): value is AstNode {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasRange(node: AstNode): boolean {
  return (
    Array.isArray(node.range) &&
    node.range.length === 2 &&
    Number.isInteger(node.range[0]) &&
    Number.isInteger(node.range[1]) &&
    (node.range[0] as number) >= 0 &&
    (node.range[0] as number) <= (node.range[1] as number)
  );
}

function validRange(node: AstNode, size: number, parent?: AstNode): boolean {
  return (
    hasRange(node) &&
    nodeEnd(node) < size &&
    (parent === undefined ||
      (hasRange(parent) &&
        nodeStart(parent) <= nodeStart(node) &&
        nodeEnd(node) <= nodeEnd(parent)))
  );
}

function validTree(root: AstNode, size: number, parent?: AstNode): boolean {
  if (!validRange(root, size, parent)) return false;
  return childrenOf(root).every((child) => validTree(child, size, root));
}

function nodeStart(node: AstNode): number {
  return hasRange(node)
    ? ((node.range as readonly unknown[])[0] as number)
    : Number.MAX_SAFE_INTEGER;
}

function nodeEnd(node: AstNode): number {
  return hasRange(node)
    ? ((node.range as readonly unknown[])[1] as number)
    : -1;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

async function loadParser(
  parserLoader: () => Promise<unknown>
): Promise<SolidityParser | null> {
  try {
    const loaded = await parserLoader();
    if (hasParserShape(loaded)) return loaded;
    if (isNode(loaded) && hasParserShape(loaded.default)) {
      return loaded.default;
    }
  } catch {
    return null;
  }
  return null;
}

function hasParserShape(value: unknown): value is SolidityParser {
  return isNode(value) && typeof value.parse === "function";
}
