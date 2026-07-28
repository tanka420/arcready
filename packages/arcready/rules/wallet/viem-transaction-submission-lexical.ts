/* eslint-disable @typescript-eslint/consistent-type-imports -- compiler loading remains runtime-lazy */
type TypeScript = typeof import("typescript");
type Node = import("typescript").Node;
type SourceFile = import("typescript").SourceFile;
type Expression = import("typescript").Expression;
type Identifier = import("typescript").Identifier;
type BindingName = import("typescript").BindingName;
export type ViemImportIdentity =
  | "viem:createWalletClient"
  | "viem:http"
  | "viem/chains:arcTestnet"
  | "viem/accounts:privateKeyToAccount";
export interface ViemLexicalBinding {
  readonly node: Node;
  readonly kind: "import" | "const" | "other";
  readonly readyOffset: number;
  readonly initializer?: Expression;
  readonly importIdentity?: ViemImportIdentity;
  readonly writeOffsets: readonly number[];
}
export interface ViemLexicalIndex {
  readonly ts: TypeScript;
  readonly sourceFile: SourceFile;
  readonly bindings: ReadonlyMap<
    Node,
    ReadonlyMap<string, readonly ViemLexicalBinding[]>
  >;
}
export interface ViemResolvedExpression {
  readonly expression: Expression;
  readonly depth: 0 | 1;
  readonly binding?: ViemLexicalBinding;
}
type MutableBinding = Omit<ViemLexicalBinding, "writeOffsets"> & {
  readonly writeOffsets: number[];
};
type MutableBindingTable = Map<Node, Map<string, MutableBinding[]>>;

export function buildViemLexicalIndex(
  ts: TypeScript,
  sourceFile: SourceFile
): ViemLexicalIndex {
  const bindings: MutableBindingTable = new Map();
  const writeIdentifiers: Identifier[] = [];

  const add = (
    scope: Node,
    name: string,
    value: Omit<MutableBinding, "writeOffsets">
  ): void => {
    const byName = bindings.get(scope) ?? new Map<string, MutableBinding[]>();
    const list = byName.get(name) ?? [];
    list.push({ ...value, writeOffsets: [] });
    byName.set(name, list);
    bindings.set(scope, byName);
  };

  const addBindingName = (
    scope: Node,
    name: BindingName,
    value: Omit<MutableBinding, "writeOffsets">
  ): void => {
    if (ts.isIdentifier(name)) {
      add(scope, name.text, value);
      return;
    }
    for (const element of name.elements) {
      if (!ts.isOmittedExpression(element)) {
        addBindingName(scope, element.name, otherBinding(element.name));
      }
    }
  };

  const visit = (
    node: Node,
    lexicalScope: Node,
    functionScope: Node
  ): void => {
    if (
      (ts.isFunctionDeclaration(node) ||
        ts.isClassDeclaration(node) ||
        ts.isEnumDeclaration(node)) &&
      node.name !== undefined
    ) {
      add(lexicalScope, node.name.text, otherBinding(node.name));
    } else if (ts.isModuleDeclaration(node) && ts.isIdentifier(node.name)) {
      add(lexicalScope, node.name.text, otherBinding(node.name));
    }

    const currentLexicalScope = isLexicalScope(ts, node) ? node : lexicalScope;
    const currentFunctionScope =
      ts.isSourceFile(node) || ts.isFunctionLike(node) ? node : functionScope;

    if (
      (ts.isClassDeclaration(node) || ts.isClassExpression(node)) &&
      node.name !== undefined
    ) {
      add(currentLexicalScope, node.name.text, otherBinding(node.name));
    }

    if (ts.isVariableDeclaration(node)) {
      const list = ts.isVariableDeclarationList(node.parent)
        ? node.parent
        : undefined;
      const isConst =
        list !== undefined &&
        (list.flags & ts.NodeFlags.Const) !== 0 &&
        node.initializer !== undefined &&
        ts.isIdentifier(node.name);
      const isBlockScoped =
        ts.isCatchClause(node.parent) ||
        (list !== undefined && (list.flags & ts.NodeFlags.BlockScoped) !== 0);
      addBindingName(
        isBlockScoped ? currentLexicalScope : currentFunctionScope,
        node.name,
        {
          node: node.name,
          kind: isConst ? "const" : "other",
          readyOffset: isConst ? node.end : node.name.end,
          ...(isConst ? { initializer: node.initializer } : {})
        }
      );
    } else if (ts.isParameter(node)) {
      addBindingName(currentFunctionScope, node.name, otherBinding(node.name));
    } else if (ts.isImportEqualsDeclaration(node)) {
      add(currentLexicalScope, node.name.text, otherBinding(node.name));
    } else if (ts.isImportDeclaration(node)) {
      collectImportBindings(ts, node, currentLexicalScope, add);
    } else if (ts.isFunctionExpression(node) && node.name !== undefined) {
      add(currentLexicalScope, node.name.text, otherBinding(node.name));
    }

    collectWriteIdentifiers(ts, node, writeIdentifiers);
    ts.forEachChild(node, (child) =>
      visit(child, currentLexicalScope, currentFunctionScope)
    );
  };

  visit(sourceFile, sourceFile, sourceFile);

  const mutableIndex: ViemLexicalIndex = {
    ts,
    sourceFile,
    bindings
  };
  for (const identifier of writeIdentifiers) {
    const binding = resolveViemBinding(
      mutableIndex,
      identifier,
      identifier.getStart(sourceFile)
    );
    if (binding !== null && binding !== undefined) {
      (binding.writeOffsets as number[]).push(identifier.getStart(sourceFile));
    }
  }

  return { ts, sourceFile, bindings };
}

export function resolveViemBinding(
  index: ViemLexicalIndex,
  identifier: Identifier,
  useOffset = identifier.getStart(index.sourceFile)
): ViemLexicalBinding | null | undefined {
  const { ts, bindings } = index;
  let scope: Node | undefined = nearestScope(ts, identifier);

  while (scope !== undefined) {
    const declarations = bindings.get(scope)?.get(identifier.text);
    if (declarations !== undefined && declarations.length > 0) {
      const available = declarations.filter(
        (declaration) =>
          declaration.kind === "import" || declaration.readyOffset <= useOffset
      );
      if (available.length !== 1 || declarations.length !== 1) return null;
      return available[0];
    }
    if (ts.isSourceFile(scope)) break;
    scope = nearestScope(ts, scope.parent);
  }

  return undefined;
}

export function isViemBindingSafeBefore(
  binding: ViemLexicalBinding,
  useOffset: number
): boolean {
  return (
    (binding.kind === "import" || binding.readyOffset <= useOffset) &&
    !binding.writeOffsets.some((offset) => offset < useOffset)
  );
}

export function resolveExactViemImport(
  index: ViemLexicalIndex,
  expression: Expression,
  identity: ViemImportIdentity,
  useOffset = expression.getStart(index.sourceFile)
): ViemLexicalBinding | null | undefined {
  if (!index.ts.isIdentifier(expression)) return undefined;
  const binding = resolveViemBinding(index, expression, useOffset);
  if (binding === null || binding === undefined) return binding;
  if (
    binding.kind !== "import" ||
    binding.importIdentity !== identity ||
    !isViemBindingSafeBefore(binding, useOffset)
  ) {
    return undefined;
  }
  return binding;
}

export function resolveDirectOrOneConstExpression(
  index: ViemLexicalIndex,
  expression: Expression,
  useOffset = expression.getStart(index.sourceFile)
): ViemResolvedExpression | null {
  if (!index.ts.isIdentifier(expression)) {
    return { expression, depth: 0 };
  }
  const binding = resolveViemBinding(index, expression, useOffset);
  if (
    binding === null ||
    binding === undefined ||
    binding.kind !== "const" ||
    binding.initializer === undefined ||
    !isViemBindingSafeBefore(binding, useOffset) ||
    index.ts.isIdentifier(binding.initializer)
  ) {
    return null;
  }
  return { expression: binding.initializer, depth: 1, binding };
}

export function resolveDirectOrOneConstImport(
  index: ViemLexicalIndex,
  expression: Expression,
  identity: ViemImportIdentity,
  useOffset = expression.getStart(index.sourceFile)
): readonly ViemLexicalBinding[] | null {
  const direct = resolveExactViemImport(index, expression, identity, useOffset);
  if (direct !== undefined) return direct === null ? null : [direct];
  if (!index.ts.isIdentifier(expression)) return null;

  const alias = resolveViemBinding(index, expression, useOffset);
  if (
    alias === null ||
    alias === undefined ||
    alias.kind !== "const" ||
    alias.initializer === undefined ||
    !isViemBindingSafeBefore(alias, useOffset) ||
    !index.ts.isIdentifier(alias.initializer)
  ) {
    return null;
  }
  const imported = resolveExactViemImport(
    index,
    alias.initializer,
    identity,
    alias.initializer.getStart(index.sourceFile)
  );
  if (
    imported === null ||
    imported === undefined ||
    !isViemBindingSafeBefore(imported, useOffset)
  ) {
    return null;
  }
  return [alias, imported];
}

function otherBinding(node: Node): Omit<MutableBinding, "writeOffsets"> {
  return {
    node,
    kind: "other",
    readyOffset: node.end
  };
}

function collectImportBindings(
  ts: TypeScript,
  node: import("typescript").ImportDeclaration,
  scope: Node,
  add: (
    scope: Node,
    name: string,
    value: Omit<MutableBinding, "writeOffsets">
  ) => void
): void {
  const clause = node.importClause;
  if (clause === undefined) return;
  if (clause.name !== undefined) {
    add(scope, clause.name.text, otherBinding(clause.name));
  }

  const named = clause.namedBindings;
  if (named !== undefined && ts.isNamespaceImport(named)) {
    add(scope, named.name.text, otherBinding(named.name));
    return;
  }
  if (named === undefined || !ts.isNamedImports(named)) return;

  const moduleName = ts.isStringLiteral(node.moduleSpecifier)
    ? node.moduleSpecifier.text
    : undefined;
  for (const element of named.elements) {
    const importedName = element.propertyName?.text ?? element.name.text;
    const identity =
      clause.isTypeOnly || element.isTypeOnly
        ? undefined
        : importIdentity(moduleName, importedName);
    add(
      scope,
      element.name.text,
      identity === undefined
        ? otherBinding(element.name)
        : {
            node: element.name,
            kind: "import",
            readyOffset: element.name.end,
            importIdentity: identity
          }
    );
  }
}

function importIdentity(
  moduleName: string | undefined,
  importedName: string
): ViemImportIdentity | undefined {
  switch (`${moduleName}:${importedName}`) {
    case "viem:createWalletClient":
    case "viem:http":
    case "viem/chains:arcTestnet":
    case "viem/accounts:privateKeyToAccount":
      return `${moduleName}:${importedName}` as ViemImportIdentity;
    default:
      return undefined;
  }
}

function collectWriteIdentifiers(
  ts: TypeScript,
  node: Node,
  output: Identifier[]
): void {
  if (
    ts.isBinaryExpression(node) &&
    isAssignmentOperator(ts, node.operatorToken.kind)
  ) {
    collectTargetIdentifiers(ts, node.left, output);
    return;
  }
  if (ts.isDeleteExpression(node)) {
    collectTargetIdentifiers(ts, node.expression, output);
    return;
  }
  if (
    (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
    (node.operator === ts.SyntaxKind.PlusPlusToken ||
      node.operator === ts.SyntaxKind.MinusMinusToken)
  ) {
    collectTargetIdentifiers(ts, node.operand, output);
    return;
  }
  if (ts.isForInStatement(node) || ts.isForOfStatement(node)) {
    const initializer = node.initializer;
    if (!ts.isVariableDeclarationList(initializer)) {
      collectTargetIdentifiers(ts, initializer, output);
    }
  }
}

function collectTargetIdentifiers(
  ts: TypeScript,
  node: Node,
  output: Identifier[]
): void {
  if (ts.isIdentifier(node)) {
    output.push(node);
    return;
  }
  if (ts.isParenthesizedExpression(node) || ts.isNonNullExpression(node)) {
    collectTargetIdentifiers(ts, node.expression, output);
    return;
  }
  if (ts.isSpreadElement(node)) {
    collectTargetIdentifiers(ts, node.expression, output);
    return;
  }
  if (ts.isArrayLiteralExpression(node)) {
    for (const element of node.elements) {
      if (!ts.isOmittedExpression(element)) {
        collectTargetIdentifiers(ts, element, output);
      }
    }
    return;
  }
  if (ts.isObjectLiteralExpression(node)) {
    for (const property of node.properties) {
      if (ts.isShorthandPropertyAssignment(property)) {
        output.push(property.name);
      } else if (ts.isPropertyAssignment(property)) {
        collectTargetIdentifiers(ts, property.initializer, output);
      } else if (ts.isSpreadAssignment(property)) {
        collectTargetIdentifiers(ts, property.expression, output);
      }
    }
  }
}

function isAssignmentOperator(
  ts: TypeScript,
  kind: import("typescript").SyntaxKind
): boolean {
  return (
    kind >= ts.SyntaxKind.FirstAssignment &&
    kind <= ts.SyntaxKind.LastAssignment
  );
}

function nearestScope(
  ts: TypeScript,
  node: Node | undefined
): Node | undefined {
  let current = node;
  while (current !== undefined) {
    if (isLexicalScope(ts, current)) return current;
    current = current.parent;
  }
  return undefined;
}

function isLexicalScope(ts: TypeScript, node: Node): boolean {
  return (
    ts.isSourceFile(node) ||
    ts.isFunctionLike(node) ||
    ts.isClassDeclaration(node) ||
    ts.isClassExpression(node) ||
    ts.isForStatement(node) ||
    ts.isForInStatement(node) ||
    ts.isForOfStatement(node) ||
    ts.isBlock(node) ||
    ts.isModuleBlock(node) ||
    ts.isCaseBlock(node) ||
    ts.isCatchClause(node)
  );
}
