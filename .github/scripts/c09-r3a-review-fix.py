from pathlib import Path

prototype_path = Path("docs/research/fixtures/c09-r3a-prototype.mjs")
prototype = prototype_path.read_text(encoding="utf-8")

old_constants = '''const COMPARISON_OPERATORS = new Set(["==", "!=", "<", ">", "<=", ">="]);
const ASSIGNMENT_OPERATORS = new Set(["=", "+=", "-=", "*=", "/=", "%="]);
'''
new_constants = '''const COMPARISON_OPERATORS = new Set(["==", "!=", "<", ">", "<=", ">="]);
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
'''
if prototype.count(old_constants) != 1:
    raise SystemExit(f"constant marker count: {prototype.count(old_constants)}")
prototype = prototype.replace(old_constants, new_constants, 1)

old_source_helper = '''function containsSourceNode(node, sourceKind) {
  if (sourceKind === "direct-prevrandao") {
    return containsNode(node, isDirectPrevrandao);
  }
  if (sourceKind === "difficulty-post-paris") {
    return containsNode(node, isDifficulty);
  }
  return false;
}
'''
new_source_helper = '''function containsSourceNode(node, sourceKind) {
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
  if (expression?.type === "Identifier") return expression.name;
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
'''
if prototype.count(old_source_helper) != 1:
    raise SystemExit(f"source helper count: {prototype.count(old_source_helper)}")
prototype = prototype.replace(old_source_helper, new_source_helper, 1)

assembly_marker = '''function variableDeclarations(functionNode) {'''
assembly_helper = '''function assemblySourceNodes(contexts) {
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

'''
if prototype.count(assembly_marker) != 1:
    raise SystemExit(f"assembly marker count: {prototype.count(assembly_marker)}")
prototype = prototype.replace(assembly_marker, assembly_helper + assembly_marker, 1)

assignment_marker = '''function hasShadowedDeclaration(functionNode, name) {'''
unary_helper = '''function unaryMutationNodes(functionNode, name) {
  return descendants(
    functionNode,
    (node) =>
      node.type === "UnaryOperation" &&
      UNARY_MUTATION_OPERATORS.has(node.operator) &&
      isIdentifier(node.subExpression, name)
  ).sort((a, b) => nodeStart(a) - nodeStart(b));
}

'''
if prototype.count(assignment_marker) != 1:
    raise SystemExit(f"assignment marker count: {prototype.count(assignment_marker)}")
prototype = prototype.replace(assignment_marker, unary_helper + assignment_marker, 1)

old_selection = '''    if (containsSourceNode(selection.dependencyNode, sourceKind)) {'''
new_selection = '''    if (isExactDirectSourceExpression(selection.dependencyNode, sourceKind)) {'''
if prototype.count(old_selection) != 1:
    raise SystemExit(f"selection dependency count: {prototype.count(old_selection)}")
prototype = prototype.replace(old_selection, new_selection, 1)

old_comparison = '''    if (
      expression.type === "BinaryOperation" &&
      COMPARISON_OPERATORS.has(expression.operator)
    ) {
      return { sinkClass: "authorization", bindingClass: "direct" };
    }
'''
new_comparison = '''    if (
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
'''
if prototype.count(old_comparison) != 1:
    raise SystemExit(f"comparison count: {prototype.count(old_comparison)}")
prototype = prototype.replace(old_comparison, new_comparison, 1)

old_binding_source = '''    if (containsSourceNode(statement.initialValue, sourceKind)) {'''
new_binding_source = '''    if (isExactDirectSourceExpression(statement.initialValue, sourceKind)) {'''
if prototype.count(old_binding_source) != 1:
    raise SystemExit(f"binding source count: {prototype.count(old_binding_source)}")
prototype = prototype.replace(old_binding_source, new_binding_source, 1)

old_mutation = '''    const laterAssignments = assignmentNodes(functionNode, first.name).filter(
      (node) => nodeStart(node) > nodeEnd(first.statement)
    );
    if (laterAssignments.length > 0) {
      return { bindingClass: "reassigned", sinkClass: "unsupported" };
    }
'''
new_mutation = '''    const laterAssignments = assignmentNodes(functionNode, first.name).filter(
      (node) => nodeStart(node) > nodeEnd(first.statement)
    );
    const laterUnaryMutations = unaryMutationNodes(
      functionNode,
      first.name
    ).filter((node) => nodeStart(node) > nodeEnd(first.statement));
    if (laterAssignments.length > 0 || laterUnaryMutations.length > 0) {
      return { bindingClass: "reassigned", sinkClass: "unsupported" };
    }
'''
if prototype.count(old_mutation) != 1:
    raise SystemExit(f"mutation count: {prototype.count(old_mutation)}")
prototype = prototype.replace(old_mutation, new_mutation, 1)

old_sources = '''  const { contracts, contexts } = collectContexts(ast);
  const sourceNodes = directSourceNodes(ast);
  const allAssembly = contexts.flatMap(({ functionNode }) =>
    assemblyFacts(functionNode)
  );
'''
new_sources = '''  const { contracts, contexts } = collectContexts(ast);
  const sourceNodes = directSourceNodes(ast);
  const assemblySources = assemblySourceNodes(contexts);
  const ownershipSourceNodes = [...sourceNodes, ...assemblySources];
  const allAssembly = contexts.flatMap(({ functionNode }) =>
    assemblyFacts(functionNode)
  );
'''
if prototype.count(old_sources) != 1:
    raise SystemExit(f"source collection count: {prototype.count(old_sources)}")
prototype = prototype.replace(old_sources, new_sources, 1)

prototype = prototype.replace(
    'const ownership = structuralOwnership(contracts, contexts, sourceNodes);',
    'const ownership = structuralOwnership(contracts, contexts, ownershipSourceNodes);',
    2,
)
if prototype.count('const ownership = structuralOwnership(contracts, contexts, sourceNodes);') != 0:
    raise SystemExit("unreplaced early ownership expression")

old_class = '''  } else if (hasAssemblyPrevrandao) {
    sourceClass = "assembly-prevrandao";
'''
new_class = '''  } else if (assemblySources.length > 0 && hasAssemblyPrevrandao) {
    sourceClass = "assembly-prevrandao";
'''
if prototype.count(old_class) != 1:
    raise SystemExit(f"assembly class count: {prototype.count(old_class)}")
prototype = prototype.replace(old_class, new_class, 1)

old_ownership = '''  const ownership = sourceAndSinkOwnership(contracts, contexts, sourceNodes);
  const crossFunctionHelper = hasCrossFunctionHelperDependency(
    contexts,
    sourceNodes
  );
'''
new_ownership = '''  const ownership = sourceAndSinkOwnership(
    contracts,
    contexts,
    ownershipSourceNodes
  );
  const crossFunctionHelper = hasCrossFunctionHelperDependency(
    contexts,
    sourceNodes
  );
'''
if prototype.count(old_ownership) != 1:
    raise SystemExit(f"main ownership count: {prototype.count(old_ownership)}")
prototype = prototype.replace(old_ownership, new_ownership, 1)

old_assembly_report = '''    const reportable = result.sinkClass === "selection";
    return {
'''
new_assembly_report = '''    const exactOwnership =
      ownership.contractOwnership === "single-contract" &&
      ownership.functionOwnership === "same-function";
    const reportable = result.sinkClass === "selection" && exactOwnership;
    const safe = result.sinkClass === "none" && exactOwnership;
    return {
'''
if prototype.count(old_assembly_report) != 1:
    raise SystemExit(f"assembly report count: {prototype.count(old_assembly_report)}")
prototype = prototype.replace(old_assembly_report, new_assembly_report, 1)

old_assembly_eligibility = '''      publicEmissionEligibility: reportable
        ? "r3a-candidate-only"
        : result.sinkClass === "none"
          ? "not-applicable"
          : "blocked-unsupported"
'''
new_assembly_eligibility = '''      publicEmissionEligibility: reportable
        ? "r3a-candidate-only"
        : safe
          ? "not-applicable"
          : "blocked-unsupported"
'''
if prototype.count(old_assembly_eligibility) != 1:
    raise SystemExit(f"assembly eligibility count: {prototype.count(old_assembly_eligibility)}")
prototype = prototype.replace(old_assembly_eligibility, new_assembly_eligibility, 1)

parse_marker = '''  return classifyParsedSource({
    source,
    ast,
    syntheticArcOwnership,
    evmTargetEvidence
  });
'''
parse_replacement = '''  if (hasMissingRelevantRange(ast)) {
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
'''
if prototype.count(parse_marker) != 1:
    raise SystemExit(f"parse marker count: {prototype.count(parse_marker)}")
prototype = prototype.replace(parse_marker, parse_replacement, 1)
prototype_path.write_text(prototype, encoding="utf-8")

corpus_path = Path("docs/research/fixtures/c09-r2-corpus.mjs")
corpus = corpus_path.read_text(encoding="utf-8")
for case_id in ("C09-N08", "C09-N09", "C09-N10"):
    marker = f'''    "{case_id}",
    sourceExpected({{
      sourceClass: "no-source",
'''
    replacement = marker + '''      functionOwnership: "none",
'''
    if corpus.count(marker) != 1:
        raise SystemExit(f"{case_id} corpus marker count: {corpus.count(marker)}")
    corpus = corpus.replace(marker, replacement, 1)
corpus_path.write_text(corpus, encoding="utf-8")

run_path = Path("docs/research/fixtures/c09-r3a-run.mjs")
run = run_path.read_text(encoding="utf-8")
errata_block = '''const CORPUS_ERRATA = new Map([
  ["C09-N08", { functionOwnership: "none" }],
  ["C09-N09", { functionOwnership: "none" }],
  ["C09-N10", { functionOwnership: "none" }]
]);

function expectedFor(fixture) {
  return { ...fixture.expected, ...(CORPUS_ERRATA.get(fixture.id) ?? {}) };
}

'''
if run.count(errata_block) != 1:
    raise SystemExit(f"errata block count: {run.count(errata_block)}")
run = run.replace(errata_block, "", 1)
run = run.replace("  const expected = expectedFor(fixture);", "  const expected = fixture.expected;", 1)
run = run.replace('''    unsupported: results.filter(
      (item) => item.actual.publicEmissionEligibility === "blocked-unsupported"
    ).length,
    corpusErrata: [...CORPUS_ERRATA.keys()]
''', '''    unsupported: results.filter(
      (item) => item.actual.publicEmissionEligibility === "blocked-unsupported"
    ).length
''', 1)

final_marker = '''if (failures.length === 0) {
  process.stdout.write("C09-R3-A adversarial checks: passed\\n");
}
'''
adversarial = r'''const transformedSelection = classifySoliditySource({
  parser,
  source: `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
contract Extra {
  address[] internal members;
  function pick() external view returns (address) {
    return members[(block.prevrandao + 1) % members.length];
  }
}
`
});
assert.equal(transformedSelection.sinkClass, "unsupported");
assert.equal(
  transformedSelection.publicEmissionEligibility,
  "blocked-unsupported"
);

const transformedBinding = classifySoliditySource({
  parser,
  source: `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
contract Extra {
  address[] internal members;
  function pick() external view returns (address) {
    uint256 seed = block.prevrandao + 1;
    return members[seed % members.length];
  }
}
`
});
assert.equal(transformedBinding.sinkClass, "unsupported");
assert.equal(transformedBinding.publicEmissionEligibility, "blocked-unsupported");

const arbitraryCallSelection = classifySoliditySource({
  parser,
  source: `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
contract Extra {
  address[] internal members;
  function normalize(uint256 value) internal pure returns (uint256) { return value; }
  function pick() external view returns (address) {
    return members[normalize(block.prevrandao) % members.length];
  }
}
`
});
assert.equal(arbitraryCallSelection.sinkClass, "unsupported");
assert.equal(
  arbitraryCallSelection.publicEmissionEligibility,
  "blocked-unsupported"
);

const unaryMutation = classifySoliditySource({
  parser,
  source: `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
contract Extra {
  address[] internal members;
  function pick() external view returns (address) {
    uint256 seed = block.prevrandao;
    seed++;
    return members[seed % members.length];
  }
}
`
});
assert.equal(unaryMutation.bindingClass, "reassigned");
assert.equal(unaryMutation.publicEmissionEligibility, "blocked-unsupported");

const assemblyCrossFunction = classifySoliditySource({
  parser,
  source: `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
contract Extra {
  address[] internal members;
  function seed() internal view returns (uint256 value) {
    assembly { value := prevrandao() }
  }
  function pick(uint256 value) external view returns (address) {
    return members[value % members.length];
  }
}
`
});
assert.equal(assemblyCrossFunction.functionOwnership, "cross-function");
assert.equal(
  assemblyCrossFunction.publicEmissionEligibility,
  "blocked-unsupported"
);

const assemblyOwnedCandidate = classifySoliditySource({
  parser,
  source: `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
contract Extra {
  address[] internal members;
  function observe() external pure returns (uint256) { return 1; }
  function pick() external view returns (address) {
    uint256 seed;
    assembly { seed := prevrandao() }
    return members[seed % members.length];
  }
}
`
});
assert.equal(assemblyOwnedCandidate.contractOwnership, "single-contract");
assert.equal(assemblyOwnedCandidate.functionOwnership, "same-function");
assert.equal(
  assemblyOwnedCandidate.publicEmissionEligibility,
  "r3a-candidate-only"
);

const returnedZeroCheck = classifySoliditySource({
  parser,
  source: `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
contract Extra {
  function isArcCompatible() external view returns (bool) {
    return block.prevrandao == 0;
  }
}
`
});
assert.equal(returnedZeroCheck.sinkClass, "safe-observation");
assert.equal(returnedZeroCheck.publicEmissionEligibility, "not-applicable");

const transformedAuthorization = classifySoliditySource({
  parser,
  source: `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
contract Extra {
  function eligible(uint256 value) external view returns (bool) {
    return value == block.prevrandao + 1;
  }
}
`
});
assert.equal(transformedAuthorization.sinkClass, "unsupported");
assert.equal(
  transformedAuthorization.publicEmissionEligibility,
  "blocked-unsupported"
);

const missingRangeParser = {
  parse(source, options) {
    const ast = parser.parse(source, options);
    let removed = false;
    const visit = (value) => {
      if (!value || typeof value !== "object" || removed) return;
      if (
        value.type === "MemberAccess" &&
        value.memberName === "prevrandao"
      ) {
        delete value.range;
        removed = true;
        return;
      }
      for (const child of Object.values(value)) {
        if (Array.isArray(child)) child.forEach(visit);
        else visit(child);
      }
    };
    visit(ast);
    return ast;
  }
};
const missingRange = classifySoliditySource({
  parser: missingRangeParser,
  source: `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
contract Extra {
  address[] internal members;
  function pick() external view returns (address) {
    return members[block.prevrandao % members.length];
  }
}
`
});
assert.equal(missingRange.sourceClass, "unsupported-source");
assert.equal(missingRange.publicEmissionEligibility, "blocked-unsupported");

if (failures.length === 0) {
  process.stdout.write("C09-R3-A adversarial checks: 13 passed\n");
}
'''
if run.count(final_marker) != 1:
    raise SystemExit(f"final marker count: {run.count(final_marker)}")
run = run.replace(final_marker, adversarial, 1)
run_path.write_text(run, encoding="utf-8")
