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

const DIRECT_CAST_NAMES = new Set(["uint", "uint256", "bytes32"]);
const ASSIGNMENT_OPERATORS = new Set(["=", "+=", "-=", "*=", "/=", "%="]);
const MUTATION_OPERATORS = new Set(["++", "--", "delete"]);
const EXCLUDED_DIRECTORIES =
  /(?:^|\/)(?:test|tests|__tests__|generated|vendor|node_modules|lib|out|cache|broadcast|dist|build|coverage)(?:\/|$)/i;
const require = createRequire(import.meta.url);

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
  if (!supportsPrevrandaoSourcePath(filePath)) {
    return { status: "unsupported-file", sources: [] };
  }

  const parser = await loadParser(parserLoader);
  if (parser === null) {
    return { status: "parser-unavailable", sources: [] };
  }

  let ast: unknown;
  try {
    ast = parser.parse(source, { loc: true, range: true, tolerant: false });
  } catch {
    return { status: "malformed", sources: [] };
  }

  if (
    !isNode(ast) ||
    ast.type !== "SourceUnit" ||
    !hasRange(ast) ||
    exactNodeArray(ast.children) === null
  ) {
    return { status: "unsupported-source", sources: [] };
  }
  if (hasUnsupportedSolidityPragma(ast)) {
    return { status: "unsupported-source", sources: [] };
  }

  const result = collectSourceRecords(filePath, ast);
  if (result.unsupported) {
    return { status: "unsupported-source", sources: [] };
  }
  return {
    status: "analyzed",
    sources: result.sources.sort(
      (left, right) => left.sourceOffset - right.sourceOffset
    )
  };
}

function hasUnsupportedSolidityPragma(ast: AstNode): boolean {
  return arrayNodes(ast.children).some((node) => {
    return (
      node.type === "PragmaDirective" &&
      node.name === "solidity" &&
      (typeof node.value !== "string" || !/0\.8\.\d+/.test(node.value))
    );
  });
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
  const declarations = localDeclarations(functionNode);

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
      isStableSingleAssignment(functionNode, declaration[0].node, targetName) &&
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
  if (variables?.length !== 1 || !hasRange(statement)) {
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
  name: string
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
      isIdentifierNamed(node.left, name)
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

function isIdentifierNamed(value: unknown, name: string): boolean {
  return isNode(value) && value.type === "Identifier" && value.name === name;
}

function localDeclarations(
  functionNode: AstNode
): Array<{ name: string; offset: number; node: AstNode }> {
  const declarations: Array<{ name: string; offset: number; node: AstNode }> =
    [];
  for (const statement of descendants(functionNode)) {
    if (
      statement.type !== "VariableDeclarationStatement" ||
      statement.initialValue !== null ||
      !hasRange(statement)
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
