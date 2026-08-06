import { createRequire } from "node:module";

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

export interface PrevrandaoFlowRecord extends PrevrandaoSourceRecord {
  readonly sinkKind: "collection-selection";
  readonly sinkOffset: number;
  readonly shellOwner: "bridge-relay";
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
const BRIDGE_OWNER_IDENTIFIERS = new Set([
  "relay",
  "relays",
  "relayer",
  "relayers"
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
const flowRecordsByScanFiles = new WeakMap<
  readonly string[],
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
    records: collectDirectBridgeSelectionRecords(
      parsed.ast,
      parsed.analysis.sources
    )
  };
}

export function requestPrevrandaoFlowRecords(
  input: PrevrandaoScanInput
): Promise<readonly PrevrandaoFlowRecord[]> {
  const cached = flowRecordsByScanFiles.get(input.files);
  if (cached !== undefined) return cached;

  const requested = collectScanFlowRecords(input);
  flowRecordsByScanFiles.set(input.files, requested);
  return requested;
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
    !hasRange(ast) ||
    exactNodeArray(ast.children) === null
  ) {
    return { analysis: { status: "unsupported-source", sources: [] } };
  }
  if (hasUnsupportedSolidityPragma(ast)) {
    return { analysis: { status: "unsupported-source", sources: [] } };
  }

  const result = collectSourceRecords(filePath, ast);
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
  ast: AstNode
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
    if (!hasRange(contract)) {
      unsupported = true;
      continue;
    }
    const subNodes = exactNodeArray(contract.subNodes);
    if (subNodes === null) {
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
      if (functionName === null || !hasRange(functionNode)) {
        unsupported = true;
        continue;
      }

      const direct = collectDirectSources(
        sourceFile,
        contractName,
        functionName,
        functionNode
      );
      const assembly = collectAssemblySources(
        sourceFile,
        contractName,
        functionName,
        functionNode
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

function collectDirectBridgeSelectionRecords(
  ast: AstNode,
  sources: readonly PrevrandaoSourceRecord[]
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
      subNodes === null
    ) {
      continue;
    }

    for (const functionNode of subNodes) {
      const functionName = stringValue(functionNode.name);
      if (
        functionNode.type !== "FunctionDefinition" ||
        functionName === null ||
        !isNode(functionNode.body)
      ) {
        continue;
      }
      const ownedSources = sources.filter(
        (source) =>
          source.contractName === contractName &&
          source.functionName === functionName &&
          source.bindingKind === "direct" &&
          source.sourceKind === "block-prevrandao" &&
          nodeStart(functionNode) <= source.sourceOffset &&
          source.sourceOffset <= nodeEnd(functionNode)
      );
      if (ownedSources.length === 0) continue;

      for (const node of descendants(functionNode.body)) {
        const selection = exactDirectCollectionSelection(node);
        if (
          selection === null ||
          !hasBridgeOwnerIdentifier(functionName, selection.collectionName)
        ) {
          continue;
        }
        const source = ownedSources.find(
          (candidate) => candidate.sourceOffset === selection.sourceOffset
        );
        if (source === undefined) continue;
        records.push({
          ...source,
          sinkKind: "collection-selection",
          sinkOffset: nodeStart(node),
          shellOwner: "bridge-relay"
        });
      }
    }
  }

  return records.sort(
    (left, right) =>
      left.sourceOffset - right.sourceOffset ||
      left.sinkOffset - right.sinkOffset
  );
}

function exactDirectCollectionSelection(
  node: AstNode
): { collectionName: string; sourceOffset: number } | null {
  if (node.type !== "IndexAccess" || !hasRange(node)) return null;
  const base = isNode(node.base) ? node.base : undefined;
  const index = isNode(node.index) ? node.index : undefined;
  const collectionName = base === undefined ? null : stringValue(base.name);
  if (
    base?.type !== "Identifier" ||
    collectionName === null ||
    index?.type !== "BinaryOperation" ||
    index.operator !== "%"
  ) {
    return null;
  }
  const length = isNode(index.right) ? index.right : undefined;
  if (
    length?.type !== "MemberAccess" ||
    length.memberName !== "length" ||
    !isIdentifierNamed(length.expression, collectionName)
  ) {
    return null;
  }
  const sourceOffset = directSourceOffset(index.left);
  return sourceOffset === null ? null : { collectionName, sourceOffset };
}

function directSourceOffset(value: unknown): number | null {
  return isNode(value) && isBlockPrevrandao(value) && hasRange(value)
    ? nodeStart(value)
    : null;
}

function hasBridgeOwnerIdentifier(
  functionName: string,
  collectionName: string
): boolean {
  return [
    ...identifierTokens(functionName),
    ...identifierTokens(collectionName)
  ].some((token) => BRIDGE_OWNER_IDENTIFIERS.has(token));
}

function identifierTokens(value: string): string[] {
  return value
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
  functionNode: AstNode
): { sources: PrevrandaoSourceRecord[]; unsupported: boolean } {
  const sources: PrevrandaoSourceRecord[] = [];
  let unsupported = false;
  const parents = parentIndex(functionNode);

  for (const node of descendants(functionNode)) {
    if (!isBlockPrevrandao(node)) continue;
    if (!hasRange(node)) {
      unsupported = true;
      continue;
    }

    const parent = parents.get(node);
    const cast = isApprovedDirectCast(parent, node) ? parent : undefined;
    if (cast !== undefined && !hasRange(cast)) {
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
      functionNode
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
  functionNode: AstNode
): { sources: PrevrandaoSourceRecord[]; unsupported: boolean } {
  const sources: PrevrandaoSourceRecord[] = [];
  let unsupported = false;
  const parents = parentIndex(functionNode);
  const declarations = localDeclarations(functionNode, parents);

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
      hasRange(inlineNode) &&
      call !== undefined &&
      hasRange(call) &&
      exact !== undefined &&
      hasRange(exact) &&
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
  functionNode: AstNode
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
  if (
    variables?.length !== 1 ||
    !hasRange(statement) ||
    parents.get(statement) !== functionNode.body
  ) {
    return { unsupported: true };
  }
  const name = stringValue(variables[0].name);
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
  parents: ReadonlyMap<AstNode, AstNode>
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
    const name =
      variables?.length === 1 ? stringValue(variables[0].name) : null;
    if (name !== null) {
      declarations.push({
        name,
        offset: nodeStart(statement),
        node: statement
      });
    }
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
    Number.isInteger(node.range[1])
  );
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
