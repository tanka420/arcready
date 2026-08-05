const COMPARISON_OPERATORS = new Set(["==", "!=", "<", ">", "<=", ">="]);
const ASSIGNMENT_OPERATORS = new Set(["=", "+=", "-=", "*=", "/=", "%="]);
const UNARY_MUTATION_OPERATORS = new Set(["++", "--", "delete"]);
const DIRECT_CAST_NAMES = new Set(["uint", "uint256", "bytes32"]);
const RANGE_REQUIRED_TYPES = new Set([
  "SourceUnit",
  "ContractDefinition",
  "FunctionDefinition",
  "VariableDeclarationStatement",
  "ReturnStatement",
  "EmitStatement",
  "IfStatement",
  "ForStatement",
  "InlineAssemblyStatement",
  "AssemblyAssignment",
  "AssemblyCall",
  "MemberAccess",
  "Identifier",
  "IndexAccess",
  "BinaryOperation",
  "UnaryOperation",
  "FunctionCall"
]);

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function childrenOf(node) {
  const children = [];
  if (!isObject(node)) return children;
  for (const [key, value] of Object.entries(node)) {
    if (key === "loc" || key === "range") continue;
    if (Array.isArray(value)) {
      for (const item of value) if (isObject(item)) children.push(item);
    } else if (isObject(value)) {
      children.push(value);
    }
  }
  return children;
}

function walk(node, visitor, parent = null) {
  if (!isObject(node)) return;
  visitor(node, parent);
  for (const child of childrenOf(node)) walk(child, visitor, node);
}

function descendants(node, predicate) {
  const found = [];
  walk(node, (candidate, parent) => {
    if (candidate !== node && predicate(candidate, parent))
      found.push(candidate);
  });
  return found;
}

function containsNode(node, predicate) {
  let matched = false;
  walk(node, (candidate, parent) => {
    if (!matched && predicate(candidate, parent)) matched = true;
  });
  return matched;
}

function nodeStart(node) {
  return Array.isArray(node?.range) ? node.range[0] : Number.MAX_SAFE_INTEGER;
}

function nodeEnd(node) {
  return Array.isArray(node?.range) ? node.range[1] : -1;
}

function isIdentifier(node, name) {
  return node?.type === "Identifier" && node.name === name;
}

function isBlockMember(node, memberName) {
  return (
    node?.type === "MemberAccess" &&
    node.memberName === memberName &&
    isIdentifier(node.expression, "block")
  );
}

function isDirectPrevrandao(node) {
  return isBlockMember(node, "prevrandao");
}

function isDifficulty(node) {
  return isBlockMember(node, "difficulty");
}

function identifierNames(node) {
  return descendants(node, (candidate) => candidate.type === "Identifier").map(
    (candidate) => candidate.name
  );
}

function containsIdentifier(node, name) {
  return containsNode(node, (candidate) => isIdentifier(candidate, name));
}

function containsSourceNode(node, sourceKind) {
  if (sourceKind === "direct-prevrandao") {
    return containsNode(node, isDirectPrevrandao);
  }
  if (sourceKind === "difficulty-post-paris") {
    return containsNode(node, isDifficulty);
  }
  return false;
}

function isExactSourceNode(node, sourceKind) {
  if (sourceKind === "direct-prevrandao") return isDirectPrevrandao(node);
  if (sourceKind === "difficulty-post-paris") return isDifficulty(node);
  return false;
}

function directCastName(node) {
  if (node?.type !== "FunctionCall") return null;
  const expression = node.expression;
  if (
    expression?.type === "Identifier" ||
    expression?.type === "ElementaryTypeName"
  ) {
    return expression.name;
  }
  if (expression?.type !== "ElementaryTypeNameExpression") return null;
  if (typeof expression.typeName === "string") return expression.typeName;
  return expression.typeName?.name ?? expression.typeName?.type ?? null;
}

function isExactDirectSourceExpression(node, sourceKind) {
  if (isExactSourceNode(node, sourceKind)) return true;
  return (
    node?.type === "FunctionCall" &&
    DIRECT_CAST_NAMES.has(directCastName(node)) &&
    (node.arguments ?? []).length === 1 &&
    isExactSourceNode(node.arguments[0], sourceKind)
  );
}

function isExactAuthorizationSourceExpression(node, sourceKind) {
  if (isExactDirectSourceExpression(node, sourceKind)) return true;
  return (
    node?.type === "BinaryOperation" &&
    node.operator === "%" &&
    isExactDirectSourceExpression(node.left, sourceKind) &&
    node.right?.type === "NumberLiteral"
  );
}

function hasMissingRelevantRange(ast) {
  let missing = false;
  walk(ast, (node) => {
    if (
      !missing &&
      RANGE_REQUIRED_TYPES.has(node.type) &&
      (!Array.isArray(node.range) || node.range.length !== 2)
    ) {
      missing = true;
    }
  });
  return missing;
}

function functionNodes(contractNode) {
  return (contractNode.subNodes ?? []).filter(
    (node) => node?.type === "FunctionDefinition" && node.body
  );
}

function collectContexts(ast) {
  const contracts = (ast.children ?? []).filter(
    (node) => node?.type === "ContractDefinition"
  );
  const contexts = [];
  for (const contractNode of contracts) {
    for (const functionNode of functionNodes(contractNode)) {
      contexts.push({ contractNode, functionNode });
    }
  }
  return { contracts, contexts };
}

function contextForNode(contexts, node) {
  const start = nodeStart(node);
  return contexts.find(
    ({ functionNode }) =>
      nodeStart(functionNode) <= start && start <= nodeEnd(functionNode)
  );
}

function directSourceNodes(ast) {
  const nodes = [];
  walk(ast, (node) => {
    if (isDirectPrevrandao(node))
      nodes.push({ node, kind: "direct-prevrandao" });
    if (isDifficulty(node)) nodes.push({ node, kind: "difficulty-post-paris" });
  });
  return nodes.sort((a, b) => nodeStart(a.node) - nodeStart(b.node));
}

function assemblyFacts(functionNode) {
  const inlineNodes = descendants(
    functionNode,
    (node) => node.type === "InlineAssemblyStatement"
  );
  const facts = [];
  for (const inlineNode of inlineNodes) {
    const nestedFunction = containsNode(
      inlineNode,
      (node) => node.type === "AssemblyFunctionDefinition"
    );
    const calls = descendants(
      inlineNode,
      (node) => node.type === "AssemblyCall"
    );
    const assignments = descendants(
      inlineNode,
      (node) => node.type === "AssemblyAssignment"
    );
    const prevrandaoCalls = calls.filter(
      (node) => node.functionName === "prevrandao"
    );
    const difficultyCalls = calls.filter(
      (node) => node.functionName === "difficulty"
    );
    const exactAssignment = assignments.find((assignment) => {
      const names = assignment.names ?? [];
      return (
        names.length === 1 &&
        names[0]?.type === "Identifier" &&
        assignment.expression?.type === "AssemblyCall" &&
        assignment.expression.functionName === "prevrandao" &&
        (assignment.expression.arguments ?? []).length === 0
      );
    });
    facts.push({
      inlineNode,
      nestedFunction,
      prevrandaoCalls,
      difficultyCalls,
      exactAssignment,
      targetName: exactAssignment?.names?.[0]?.name ?? null,
      supported:
        !nestedFunction &&
        prevrandaoCalls.length === 1 &&
        difficultyCalls.length === 0 &&
        assignments.length === 1 &&
        Boolean(exactAssignment)
    });
  }
  return facts;
}

function assemblySourceNodes(contexts) {
  const records = [];
  for (const context of contexts) {
    for (const fact of assemblyFacts(context.functionNode)) {
      for (const node of fact.prevrandaoCalls) {
        records.push({ node, kind: "assembly-prevrandao", ...context });
      }
    }
  }
  return records.sort((a, b) => nodeStart(a.node) - nodeStart(b.node));
}

function variableDeclarations(functionNode) {
  return descendants(
    functionNode,
    (node) => node.type === "VariableDeclarationStatement"
  ).sort((a, b) => nodeStart(a) - nodeStart(b));
}

function variableName(statement) {
  const names = (statement.variables ?? [])
    .filter(Boolean)
    .map((item) => item.name)
    .filter(Boolean);
  return names.length === 1 ? names[0] : null;
}

function assignmentNodes(functionNode, name) {
  return descendants(
    functionNode,
    (node) =>
      node.type === "BinaryOperation" &&
      ASSIGNMENT_OPERATORS.has(node.operator) &&
      isIdentifier(node.left, name)
  ).sort((a, b) => nodeStart(a) - nodeStart(b));
}

function unaryMutationNodes(functionNode, name) {
  return descendants(
    functionNode,
    (node) =>
      node.type === "UnaryOperation" &&
      UNARY_MUTATION_OPERATORS.has(node.operator) &&
      isIdentifier(node.subExpression, name)
  ).sort((a, b) => nodeStart(a) - nodeStart(b));
}

function hasShadowedDeclaration(functionNode, name) {
  const declarations = variableDeclarations(functionNode).filter(
    (statement) => variableName(statement) === name
  );
  return declarations.length > 1;
}

function directLengthMember(node) {
  return (
    node?.type === "MemberAccess" &&
    node.memberName === "length" &&
    node.expression?.type === "Identifier"
  );
}

function selectionFacts(functionNode) {
  const results = [];
  for (const indexNode of descendants(
    functionNode,
    (node) => node.type === "IndexAccess"
  )) {
    const collection =
      indexNode.base?.type === "Identifier" ? indexNode.base.name : null;
    const index = indexNode.index;
    if (!collection || !index) continue;

    if (index.type === "BinaryOperation" && index.operator === "%") {
      const right = index.right;
      const exactLength =
        directLengthMember(right) && right.expression.name === collection;
      results.push({
        node: indexNode,
        collection,
        dependencyNode: index.left,
        exactLength,
        indirectLength: !exactLength
      });
      continue;
    }

    if (index.type === "Identifier") {
      const declaration = variableDeclarations(functionNode).find(
        (statement) => variableName(statement) === index.name
      );
      const initial = declaration?.initialValue;
      if (initial?.type === "BinaryOperation" && initial.operator === "%") {
        const right = initial.right;
        const exactLength =
          directLengthMember(right) && right.expression.name === collection;
        results.push({
          node: indexNode,
          collection,
          dependencyNode: initial.left,
          exactLength,
          indirectLength: !exactLength,
          indexBinding: index.name
        });
      }
    }
  }
  return results.sort((a, b) => nodeStart(a.node) - nodeStart(b.node));
}

function isZeroLiteral(node) {
  return (
    node?.type === "NumberLiteral" && String(node.number ?? node.value) === "0"
  );
}

function functionCallName(node) {
  if (node?.type !== "FunctionCall") return null;
  if (node.expression?.type === "Identifier") return node.expression.name;
  if (node.expression?.type === "MemberAccess")
    return node.expression.memberName;
  return null;
}

function classifyDirectSink(functionNode, sourceKind) {
  const selections = selectionFacts(functionNode);
  for (const selection of selections) {
    if (isExactDirectSourceExpression(selection.dependencyNode, sourceKind)) {
      return selection.exactLength
        ? { sinkClass: "selection", bindingClass: "direct" }
        : { sinkClass: "unsupported", bindingClass: "direct" };
    }
  }

  for (const returnNode of descendants(
    functionNode,
    (node) => node.type === "ReturnStatement"
  )) {
    const expression = returnNode.expression;
    if (!expression || !containsSourceNode(expression, sourceKind)) continue;

    if (
      expression.type === "BinaryOperation" &&
      expression.operator === "==" &&
      ((isExactDirectSourceExpression(expression.left, sourceKind) &&
        isZeroLiteral(expression.right)) ||
        (isExactDirectSourceExpression(expression.right, sourceKind) &&
          isZeroLiteral(expression.left)))
    ) {
      return { sinkClass: "safe-observation", bindingClass: "direct" };
    }

    if (
      expression.type === "BinaryOperation" &&
      COMPARISON_OPERATORS.has(expression.operator) &&
      (isExactAuthorizationSourceExpression(expression.left, sourceKind) ||
        isExactAuthorizationSourceExpression(expression.right, sourceKind))
    ) {
      return { sinkClass: "authorization", bindingClass: "direct" };
    }

    const calls = [
      ...(expression.type === "FunctionCall" ? [expression] : []),
      ...descendants(expression, (node) => node.type === "FunctionCall")
    ];
    const keccak = calls.find((node) => functionCallName(node) === "keccak256");
    if (keccak) {
      const nonSourceIdentifiers = identifierNames(keccak).filter(
        (name) => !["block", "keccak256", "abi"].includes(name)
      );
      if (nonSourceIdentifiers.length > 0) {
        return { sinkClass: "ordering", bindingClass: "direct" };
      }
      return { sinkClass: "none", bindingClass: "direct" };
    }

    if (
      expression.type === "MemberAccess" ||
      (expression.type === "FunctionCall" &&
        containsSourceNode(expression, sourceKind))
    ) {
      return { sinkClass: "safe-observation", bindingClass: "none" };
    }
  }

  for (const emitNode of descendants(
    functionNode,
    (node) => node.type === "EmitStatement"
  )) {
    if (containsSourceNode(emitNode, sourceKind)) {
      return { sinkClass: "safe-observation", bindingClass: "direct" };
    }
  }

  for (const call of descendants(
    functionNode,
    (node) => node.type === "FunctionCall"
  )) {
    if (functionCallName(call) !== "require") continue;
    const condition = call.arguments?.[0];
    if (
      condition?.type === "BinaryOperation" &&
      condition.operator === "==" &&
      ((containsSourceNode(condition.left, sourceKind) &&
        isZeroLiteral(condition.right)) ||
        (containsSourceNode(condition.right, sourceKind) &&
          isZeroLiteral(condition.left)))
    ) {
      return { sinkClass: "safe-observation", bindingClass: "direct" };
    }
  }

  return null;
}

function bindingFacts(functionNode, sourceKind) {
  const declarations = variableDeclarations(functionNode);
  const sourceBindings = [];

  for (const statement of declarations) {
    const name = variableName(statement);
    if (!name || !statement.initialValue) continue;
    if (isExactDirectSourceExpression(statement.initialValue, sourceKind)) {
      sourceBindings.push({ statement, name, kind: "single-assignment" });
    }
  }

  for (const first of sourceBindings) {
    if (hasShadowedDeclaration(functionNode, first.name)) {
      return { bindingClass: "unsupported", sinkClass: "unsupported" };
    }

    const laterAssignments = assignmentNodes(functionNode, first.name).filter(
      (node) => nodeStart(node) > nodeEnd(first.statement)
    );
    const laterUnaryMutations = unaryMutationNodes(
      functionNode,
      first.name
    ).filter((node) => nodeStart(node) > nodeEnd(first.statement));
    if (laterAssignments.length > 0 || laterUnaryMutations.length > 0) {
      return { bindingClass: "reassigned", sinkClass: "unsupported" };
    }

    const secondHop = declarations.find(
      (statement) =>
        nodeStart(statement) > nodeEnd(first.statement) &&
        statement.initialValue?.type === "Identifier" &&
        statement.initialValue.name === first.name
    );
    if (secondHop) {
      return { bindingClass: "multi-hop", sinkClass: "unsupported" };
    }

    for (const selection of selectionFacts(functionNode)) {
      if (containsIdentifier(selection.dependencyNode, first.name)) {
        return selection.exactLength
          ? { bindingClass: "single-assignment", sinkClass: "selection" }
          : { bindingClass: "single-assignment", sinkClass: "unsupported" };
      }
    }

    const expressionUses = descendants(
      functionNode,
      (node, parent) =>
        isIdentifier(node, first.name) &&
        parent?.type !== "VariableDeclaration" &&
        nodeStart(node) > nodeEnd(first.statement)
    );
    if (expressionUses.length > 0) {
      return { bindingClass: "single-assignment", sinkClass: "none" };
    }

    return { bindingClass: "single-assignment", sinkClass: "none" };
  }

  const uninitialized = declarations.filter(
    (statement) => variableName(statement) && !statement.initialValue
  );
  for (const statement of uninitialized) {
    const name = variableName(statement);
    const assignments = assignmentNodes(functionNode, name);
    if (
      assignments.some((node) => containsSourceNode(node.right, sourceKind)) &&
      containsNode(functionNode, (node) => node.type === "IfStatement")
    ) {
      return { bindingClass: "branch-join", sinkClass: "unsupported" };
    }
  }

  return null;
}

function assemblyBindingFacts(functionNode) {
  const facts = assemblyFacts(functionNode);
  if (
    facts.some((item) => item.nestedFunction || item.difficultyCalls.length > 0)
  ) {
    return {
      sourceClass: "unsupported-source",
      bindingClass: "unsupported",
      sinkClass: "unsupported"
    };
  }

  const exact = facts.find((item) => item.supported && item.targetName);
  if (!exact) return null;
  if (hasShadowedDeclaration(functionNode, exact.targetName)) {
    return {
      sourceClass: "unsupported-source",
      bindingClass: "unsupported",
      sinkClass: "unsupported"
    };
  }
  for (const selection of selectionFacts(functionNode)) {
    if (containsIdentifier(selection.dependencyNode, exact.targetName)) {
      return {
        sourceClass: "assembly-prevrandao",
        bindingClass: "single-assignment",
        sinkClass: selection.exactLength ? "selection" : "unsupported"
      };
    }
  }
  return {
    sourceClass: "assembly-prevrandao",
    bindingClass: "single-assignment",
    sinkClass: "none"
  };
}

function sameFunctionCandidates(contexts, sourceNodes) {
  const candidates = [];
  for (const sourceRecord of sourceNodes) {
    const context = contextForNode(contexts, sourceRecord.node);
    if (!context) continue;
    candidates.push({ ...sourceRecord, ...context });
  }
  return candidates;
}

function hasCrossFunctionHelperDependency(contexts, sourceNodes) {
  const sourceFunctionNames = new Set(
    sameFunctionCandidates(contexts, sourceNodes).map(
      (item) => item.functionNode.name
    )
  );
  return contexts.some(({ functionNode }) =>
    selectionFacts(functionNode).some((selection) =>
      containsNode(
        selection.dependencyNode,
        (node) =>
          node.type === "FunctionCall" &&
          node.expression?.type === "Identifier" &&
          sourceFunctionNames.has(node.expression.name)
      )
    )
  );
}

function structuralOwnership(contracts, contexts, sourceNodes) {
  if (contracts.length === 0) {
    return { contractOwnership: "none", functionOwnership: "none" };
  }
  if (sourceNodes.length === 0) {
    if (contexts.length === 0) {
      const hasMeaningfulContractBody = contracts.some(
        (contractNode) => (contractNode.subNodes ?? []).length > 0
      );
      return {
        contractOwnership: hasMeaningfulContractBody
          ? "single-contract"
          : "none",
        functionOwnership: "none"
      };
    }
    return {
      contractOwnership:
        contracts.length === 1 ? "single-contract" : "multiple-contracts",
      functionOwnership: contexts.length === 1 ? "same-function" : "ambiguous"
    };
  }

  const sourceContexts = sameFunctionCandidates(contexts, sourceNodes);
  const sourceContracts = new Set(
    sourceContexts.map((item) => item.contractNode.name)
  );
  const sourceFunctions = new Set(
    sourceContexts.map(
      (item) => `${item.contractNode.name}:${item.functionNode.name}`
    )
  );

  return {
    contractOwnership:
      sourceContracts.size === 1
        ? "single-contract"
        : contracts.length > 1
          ? "multiple-contracts"
          : "ambiguous",
    functionOwnership:
      sourceFunctions.size === 1 ? "same-function" : "ambiguous"
  };
}

function sourceAndSinkOwnership(contracts, contexts, sourceNodes) {
  const base = structuralOwnership(contracts, contexts, sourceNodes);
  const selections = contexts.flatMap((context) =>
    selectionFacts(context.functionNode).map((selection) => ({
      ...selection,
      ...context
    }))
  );
  if (sourceNodes.length === 0 || selections.length === 0) return base;

  const sourceContexts = sameFunctionCandidates(contexts, sourceNodes);
  const sameFunction = sourceContexts.some((sourceContext) =>
    selections.some(
      (selection) =>
        selection.functionNode === sourceContext.functionNode &&
        selection.contractNode === sourceContext.contractNode
    )
  );
  if (sameFunction) return base;

  const sameContract = sourceContexts.some((sourceContext) =>
    selections.some(
      (selection) => selection.contractNode === sourceContext.contractNode
    )
  );
  if (sameContract) {
    return {
      contractOwnership: "single-contract",
      functionOwnership: "cross-function"
    };
  }

  if (contracts.length > 1) {
    const helperCall = contexts.some((context) =>
      containsNode(
        context.functionNode,
        (node) =>
          node.type === "FunctionCall" &&
          node.expression?.type === "MemberAccess" &&
          selectionFacts(context.functionNode).some((selection) =>
            containsNode(
              selection.dependencyNode,
              (candidate) => candidate === node
            )
          )
      )
    );
    return {
      contractOwnership: helperCall ? "cross-contract" : "multiple-contracts",
      functionOwnership: helperCall ? "cross-function" : "ambiguous"
    };
  }

  return base;
}

function classifyParsedSource({
  source,
  ast,
  syntheticArcOwnership,
  evmTargetEvidence
}) {
  const { contracts, contexts } = collectContexts(ast);
  const sourceNodes = directSourceNodes(ast);
  const assemblySources = assemblySourceNodes(contexts);
  const ownershipSourceNodes = [...sourceNodes, ...assemblySources];
  const allAssembly = contexts.flatMap(({ functionNode }) =>
    assemblyFacts(functionNode)
  );
  const hasUnsupportedAssembly = allAssembly.some(
    (item) => item.nestedFunction || item.difficultyCalls.length > 0
  );
  const hasAssemblyPrevrandao = allAssembly.some(
    (item) => item.prevrandaoCalls.length > 0
  );

  const pragmaUnsupported = /pragma\s+solidity\s+[^;]*0\.9\./.test(source);
  if (pragmaUnsupported) {
    const ownership = structuralOwnership(
      contracts,
      contexts,
      ownershipSourceNodes
    );
    return {
      parseStatus: "unsupported-syntax",
      sourceClass: "unsupported-source",
      ...ownership,
      bindingClass: "unsupported",
      sinkClass: "unsupported",
      arcDeploymentOwnership: syntheticArcOwnership,
      publicEmissionEligibility: "blocked-unsupported"
    };
  }

  if (hasUnsupportedAssembly) {
    const ownership = structuralOwnership(
      contracts,
      contexts,
      ownershipSourceNodes
    );
    return {
      parseStatus: "parseable",
      sourceClass: "unsupported-source",
      ...ownership,
      bindingClass: "unsupported",
      sinkClass: "unsupported",
      arcDeploymentOwnership: syntheticArcOwnership,
      publicEmissionEligibility: "blocked-unsupported"
    };
  }

  let sourceClass = "no-source";
  if (sourceNodes.some((item) => item.kind === "direct-prevrandao")) {
    sourceClass = "direct-prevrandao";
  } else if (assemblySources.length > 0 && hasAssemblyPrevrandao) {
    sourceClass = "assembly-prevrandao";
  } else if (
    sourceNodes.some((item) => item.kind === "difficulty-post-paris")
  ) {
    sourceClass = "difficulty-post-paris";
  }

  const ownership = sourceAndSinkOwnership(
    contracts,
    contexts,
    ownershipSourceNodes
  );
  const crossFunctionHelper = hasCrossFunctionHelperDependency(
    contexts,
    sourceNodes
  );

  if (sourceClass === "no-source") {
    return {
      parseStatus: "parseable",
      sourceClass,
      ...ownership,
      bindingClass: "none",
      sinkClass: "none",
      arcDeploymentOwnership: syntheticArcOwnership,
      publicEmissionEligibility: "not-applicable"
    };
  }

  if (sourceClass === "assembly-prevrandao") {
    const candidates = contexts
      .map(({ functionNode }) => assemblyBindingFacts(functionNode))
      .filter(Boolean);
    const result = candidates[0] ?? {
      sourceClass,
      bindingClass: "unsupported",
      sinkClass: "unsupported"
    };
    const exactOwnership =
      ownership.contractOwnership === "single-contract" &&
      ownership.functionOwnership === "same-function";
    const reportable = result.sinkClass === "selection" && exactOwnership;
    const safe = result.sinkClass === "none" && exactOwnership;
    return {
      parseStatus: "parseable",
      sourceClass: result.sourceClass,
      ...ownership,
      bindingClass: result.bindingClass,
      sinkClass: result.sinkClass,
      arcDeploymentOwnership: syntheticArcOwnership,
      publicEmissionEligibility: reportable
        ? "r3a-candidate-only"
        : safe
          ? "not-applicable"
          : "blocked-unsupported"
    };
  }

  const sourceKind = sourceClass;
  const sameFunction = sameFunctionCandidates(contexts, sourceNodes);
  const ranked = [];
  for (const candidate of sameFunction) {
    const direct = classifyDirectSink(candidate.functionNode, sourceKind);
    if (direct) {
      ranked.push({
        rank: direct.sinkClass === "selection" ? 0 : 2,
        ...direct
      });
    }
    const binding = bindingFacts(candidate.functionNode, sourceKind);
    if (binding) {
      ranked.push({
        rank: binding.sinkClass === "selection" ? 1 : 3,
        ...binding
      });
    }
  }
  ranked.sort((a, b) => a.rank - b.rank);
  let result = ranked[0] ?? {
    bindingClass: "direct",
    sinkClass: "unsupported"
  };

  if (ownership.functionOwnership === "cross-function") {
    result = {
      bindingClass: crossFunctionHelper ? "unsupported" : result.bindingClass,
      sinkClass: "unsupported"
    };
  }
  if (ownership.contractOwnership === "cross-contract") {
    result = { bindingClass: "unsupported", sinkClass: "unsupported" };
  }
  if (
    ownership.contractOwnership === "multiple-contracts" &&
    ownership.functionOwnership === "ambiguous"
  ) {
    result = { bindingClass: "direct", sinkClass: "selection" };
  }

  const difficultyBlocked =
    sourceClass === "difficulty-post-paris" &&
    evmTargetEvidence !== "paris-or-later-required";
  const reportable =
    ["selection", "authorization", "ordering", "seed-consumed"].includes(
      result.sinkClass
    ) &&
    result.bindingClass !== "unsupported" &&
    !difficultyBlocked &&
    ownership.functionOwnership === "same-function" &&
    ownership.contractOwnership === "single-contract";

  const safe = ["safe-observation", "none"].includes(result.sinkClass);
  return {
    parseStatus: "parseable",
    sourceClass,
    ...ownership,
    bindingClass: result.bindingClass,
    sinkClass: result.sinkClass,
    arcDeploymentOwnership: syntheticArcOwnership,
    publicEmissionEligibility: reportable
      ? "r3a-candidate-only"
      : safe
        ? "not-applicable"
        : "blocked-unsupported"
  };
}

function classifySoliditySource({
  source,
  parser,
  syntheticArcOwnership = "synthetic-r3a",
  evmTargetEvidence = null
}) {
  if (typeof source !== "string" || source.length === 0) {
    throw new TypeError("source must be a non-empty string");
  }
  if (!parser || typeof parser.parse !== "function") {
    throw new TypeError("parser.parse is required");
  }

  let ast;
  try {
    ast = parser.parse(source, { loc: true, range: true, tolerant: false });
  } catch {
    return {
      parseStatus: "malformed",
      sourceClass: "unsupported-source",
      contractOwnership: "ambiguous",
      functionOwnership: "ambiguous",
      bindingClass: "unsupported",
      sinkClass: "unsupported",
      arcDeploymentOwnership: syntheticArcOwnership,
      publicEmissionEligibility: "blocked-unsupported"
    };
  }

  if (hasMissingRelevantRange(ast)) {
    return {
      parseStatus: "parseable",
      sourceClass: "unsupported-source",
      contractOwnership: "ambiguous",
      functionOwnership: "ambiguous",
      bindingClass: "unsupported",
      sinkClass: "unsupported",
      arcDeploymentOwnership: syntheticArcOwnership,
      publicEmissionEligibility: "blocked-unsupported"
    };
  }

  return classifyParsedSource({
    source,
    ast,
    syntheticArcOwnership,
    evmTargetEvidence
  });
}

export { classifySoliditySource };
