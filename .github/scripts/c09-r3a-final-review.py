from pathlib import Path

prototype_path = Path("docs/research/fixtures/c09-r3a-prototype.mjs")
prototype = prototype_path.read_text(encoding="utf-8")

old_keccak_start = '''function classifyKeccakSink(expression, sourceKind) {
  const calls = [
    ...(expression?.type === "FunctionCall" ? [expression] : []),
    ...descendants(expression, (node) => node.type === "FunctionCall")
  ];
  const keccak = calls.find((node) => functionCallName(node) === "keccak256");
  if (!keccak) return null;
'''
new_keccak_start = '''function classifyKeccakSink(expression, sourceKind) {
  const directCast =
    expression?.type === "FunctionCall" &&
    DIRECT_CAST_NAMES.has(directCastName(expression)) &&
    (expression.arguments ?? []).length === 1;
  const root = directCast ? expression.arguments[0] : expression;
  const keccak =
    root?.type === "FunctionCall" && functionCallName(root) === "keccak256"
      ? root
      : null;
  if (!keccak) {
    const hasNestedKeccak = containsNode(
      expression,
      (node) => node.type === "FunctionCall" && functionCallName(node) === "keccak256"
    );
    return hasNestedKeccak
      ? { sinkClass: "unsupported", bindingClass: "direct" }
      : null;
  }
'''
if prototype.count(old_keccak_start) != 1:
    raise SystemExit(f"keccak root marker count: {prototype.count(old_keccak_start)}")
prototype = prototype.replace(old_keccak_start, new_keccak_start, 1)

old_safe_call = '''    if (
      expression.type === "MemberAccess" ||
      (expression.type === "FunctionCall" &&
        containsSourceNode(expression, sourceKind))
    ) {
      return { sinkClass: "safe-observation", bindingClass: "none" };
    }
'''
new_safe_call = '''    if (isExactDirectSourceExpression(expression, sourceKind)) {
      return { sinkClass: "safe-observation", bindingClass: "none" };
    }
'''
if prototype.count(old_safe_call) != 1:
    raise SystemExit(f"safe return marker count: {prototype.count(old_safe_call)}")
prototype = prototype.replace(old_safe_call, new_safe_call, 1)

old_assembly_shadow = '''  if (hasShadowedDeclaration(functionNode, exact.targetName)) {
    return {
      sourceClass: "unsupported-source",
      bindingClass: "unsupported",
      sinkClass: "unsupported"
    };
  }
  for (const selection of selectionFacts(functionNode)) {
'''
new_assembly_shadow = '''  if (hasShadowedDeclaration(functionNode, exact.targetName)) {
    return {
      sourceClass: "unsupported-source",
      bindingClass: "unsupported",
      sinkClass: "unsupported"
    };
  }
  const laterAssignments = assignmentNodes(functionNode, exact.targetName).filter(
    (node) => nodeStart(node) > nodeEnd(exact.inlineNode)
  );
  const laterUnaryMutations = unaryMutationNodes(
    functionNode,
    exact.targetName
  ).filter((node) => nodeStart(node) > nodeEnd(exact.inlineNode));
  if (laterAssignments.length > 0 || laterUnaryMutations.length > 0) {
    return {
      sourceClass: "assembly-prevrandao",
      bindingClass: "reassigned",
      sinkClass: "unsupported"
    };
  }
  for (const selection of selectionFacts(functionNode)) {
'''
if prototype.count(old_assembly_shadow) != 1:
    raise SystemExit(f"assembly mutation marker count: {prototype.count(old_assembly_shadow)}")
prototype = prototype.replace(old_assembly_shadow, new_assembly_shadow, 1)

prototype_path.write_text(prototype, encoding="utf-8")

run_path = Path("docs/research/fixtures/c09-r3a-run.mjs")
run = run_path.read_text(encoding="utf-8")
final_marker = '''if (failures.length === 0) {
  process.stdout.write("C09-R3-A adversarial checks: 17 passed\\n");
}
'''
additional = r'''const transformedReturnedCall = classifySoliditySource({
  parser,
  source: `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
contract Extra {
  function normalize(uint256 value) internal pure returns (uint256) { return value; }
  function observe() external view returns (uint256) {
    return normalize(block.prevrandao);
  }
}
`
});
assert.equal(transformedReturnedCall.sinkClass, "unsupported");
assert.equal(
  transformedReturnedCall.publicEmissionEligibility,
  "blocked-unsupported"
);

const wrappedKeccakResult = classifySoliditySource({
  parser,
  source: `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
contract Extra {
  function normalize(uint256 value) internal pure returns (uint256) { return value; }
  function orderingKey(uint256 item) external view returns (uint256) {
    return normalize(uint256(keccak256(abi.encode(item, block.prevrandao))));
  }
}
`
});
assert.equal(wrappedKeccakResult.sinkClass, "unsupported");
assert.equal(wrappedKeccakResult.publicEmissionEligibility, "blocked-unsupported");

const mutatedAssemblyAssignment = classifySoliditySource({
  parser,
  source: `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
contract Extra {
  address[] internal members;
  function pick() external view returns (address) {
    uint256 seed;
    assembly { seed := prevrandao() }
    seed += 1;
    return members[seed % members.length];
  }
}
`
});
assert.equal(mutatedAssemblyAssignment.bindingClass, "reassigned");
assert.equal(
  mutatedAssemblyAssignment.publicEmissionEligibility,
  "blocked-unsupported"
);

const mutatedAssemblyUnary = classifySoliditySource({
  parser,
  source: `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
contract Extra {
  address[] internal members;
  function pick() external view returns (address) {
    uint256 seed;
    assembly { seed := prevrandao() }
    seed++;
    return members[seed % members.length];
  }
}
`
});
assert.equal(mutatedAssemblyUnary.bindingClass, "reassigned");
assert.equal(
  mutatedAssemblyUnary.publicEmissionEligibility,
  "blocked-unsupported"
);

if (failures.length === 0) {
  process.stdout.write("C09-R3-A adversarial checks: 21 passed\n");
}
'''
if run.count(final_marker) != 1:
    raise SystemExit(f"21-case marker count: {run.count(final_marker)}")
run = run.replace(final_marker, additional, 1)
run_path.write_text(run, encoding="utf-8")
