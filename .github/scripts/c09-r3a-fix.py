from pathlib import Path

path = Path("docs/research/fixtures/c09-r3a-prototype.mjs")
text = path.read_text(encoding="utf-8")

old_calls = '''    const calls = descendants(
      expression,
      (node) => node.type === "FunctionCall"
    );'''
new_calls = '''    const calls = [
      ...(expression.type === "FunctionCall" ? [expression] : []),
      ...descendants(expression, (node) => node.type === "FunctionCall")
    ];'''
if text.count(old_calls) != 1:
    raise SystemExit(f"root call replacement count: {text.count(old_calls)}")
text = text.replace(old_calls, new_calls, 1)

marker = '''function structuralOwnership(contracts, contexts, sourceNodes) {'''
helper = '''function hasCrossFunctionHelperDependency(contexts, sourceNodes) {
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

'''
if text.count(marker) != 1:
    raise SystemExit(f"helper marker count: {text.count(marker)}")
text = text.replace(marker, helper + marker, 1)

old_ownership = '''  const ownership = sourceAndSinkOwnership(contracts, contexts, sourceNodes);
'''
new_ownership = '''  const ownership = sourceAndSinkOwnership(contracts, contexts, sourceNodes);
  const crossFunctionHelper = hasCrossFunctionHelperDependency(
    contexts,
    sourceNodes
  );
'''
if text.count(old_ownership) != 1:
    raise SystemExit(f"ownership replacement count: {text.count(old_ownership)}")
text = text.replace(old_ownership, new_ownership, 1)

old_cross = '''  if (ownership.functionOwnership === "cross-function") {
    result = { bindingClass: "unsupported", sinkClass: "unsupported" };
  }'''
new_cross = '''  if (ownership.functionOwnership === "cross-function") {
    result = {
      bindingClass: crossFunctionHelper ? "unsupported" : result.bindingClass,
      sinkClass: "unsupported"
    };
  }'''
if text.count(old_cross) != 1:
    raise SystemExit(f"cross-function replacement count: {text.count(old_cross)}")
text = text.replace(old_cross, new_cross, 1)

path.write_text(text, encoding="utf-8")
