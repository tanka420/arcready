from pathlib import Path

prototype_path = Path("docs/research/fixtures/c09-r3a-prototype.mjs")
prototype = prototype_path.read_text(encoding="utf-8")

call_name_marker = '''function classifyDirectSink(functionNode, sourceKind) {'''
ordering_helpers = '''function isAbiEncodeCall(node) {
  return (
    node?.type === "FunctionCall" &&
    node.expression?.type === "MemberAccess" &&
    node.expression.memberName === "encode" &&
    isIdentifier(node.expression.expression, "abi")
  );
}

function classifyKeccakSink(expression, sourceKind) {
  const calls = [
    ...(expression?.type === "FunctionCall" ? [expression] : []),
    ...descendants(expression, (node) => node.type === "FunctionCall")
  ];
  const keccak = calls.find((node) => functionCallName(node) === "keccak256");
  if (!keccak) return null;

  const argumentsList = keccak.arguments ?? [];
  if (argumentsList.length !== 1 || !isAbiEncodeCall(argumentsList[0])) {
    return { sinkClass: "unsupported", bindingClass: "direct" };
  }

  const encodedArguments = argumentsList[0].arguments ?? [];
  const exactSourceArguments = encodedArguments.filter((argument) =>
    isExactDirectSourceExpression(argument, sourceKind)
  );
  const transformedSource = encodedArguments.some(
    (argument) =>
      containsSourceNode(argument, sourceKind) &&
      !isExactDirectSourceExpression(argument, sourceKind)
  );
  if (transformedSource || exactSourceArguments.length !== 1) {
    return { sinkClass: "unsupported", bindingClass: "direct" };
  }

  const nonSourceArguments = encodedArguments.filter(
    (argument) => !containsSourceNode(argument, sourceKind)
  );
  return nonSourceArguments.length > 0
    ? { sinkClass: "ordering", bindingClass: "direct" }
    : { sinkClass: "none", bindingClass: "direct" };
}

'''
if prototype.count(call_name_marker) != 1:
    raise SystemExit(f"classifyDirectSink marker count: {prototype.count(call_name_marker)}")
prototype = prototype.replace(call_name_marker, ordering_helpers + call_name_marker, 1)

old_keccak = '''    const calls = [
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
'''
new_keccak = '''    const keccakResult = classifyKeccakSink(expression, sourceKind);
    if (keccakResult) return keccakResult;
'''
if prototype.count(old_keccak) != 1:
    raise SystemExit(f"keccak block count: {prototype.count(old_keccak)}")
prototype = prototype.replace(old_keccak, new_keccak, 1)

old_require = '''      ((containsSourceNode(condition.left, sourceKind) &&
        isZeroLiteral(condition.right)) ||
        (containsSourceNode(condition.right, sourceKind) &&
          isZeroLiteral(condition.left)))
'''
new_require = '''      ((isExactDirectSourceExpression(condition.left, sourceKind) &&
        isZeroLiteral(condition.right)) ||
        (isExactDirectSourceExpression(condition.right, sourceKind) &&
          isZeroLiteral(condition.left)))
'''
if prototype.count(old_require) != 1:
    raise SystemExit(f"require zero matcher count: {prototype.count(old_require)}")
prototype = prototype.replace(old_require, new_require, 1)

old_binding_use = '''      if (containsIdentifier(selection.dependencyNode, first.name)) {'''
new_binding_use = '''      if (isIdentifier(selection.dependencyNode, first.name)) {'''
if prototype.count(old_binding_use) != 1:
    raise SystemExit(f"binding sink matcher count: {prototype.count(old_binding_use)}")
prototype = prototype.replace(old_binding_use, new_binding_use, 1)

old_assembly_use = '''    if (containsIdentifier(selection.dependencyNode, exact.targetName)) {'''
new_assembly_use = '''    if (isIdentifier(selection.dependencyNode, exact.targetName)) {'''
if prototype.count(old_assembly_use) != 1:
    raise SystemExit(f"assembly sink matcher count: {prototype.count(old_assembly_use)}")
prototype = prototype.replace(old_assembly_use, new_assembly_use, 1)

prototype_path.write_text(prototype, encoding="utf-8")

run_path = Path("docs/research/fixtures/c09-r3a-run.mjs")
run = run_path.read_text(encoding="utf-8")
final_marker = '''if (failures.length === 0) {
  process.stdout.write("C09-R3-A adversarial checks: 13 passed\\n");
}
'''
additional = r'''const transformedLocalUse = classifySoliditySource({
  parser,
  source: `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
contract Extra {
  address[] internal members;
  function pick() external view returns (address) {
    uint256 seed = block.prevrandao;
    return members[(seed + 1) % members.length];
  }
}
`
});
assert.equal(transformedLocalUse.sinkClass, "unsupported");
assert.equal(
  transformedLocalUse.publicEmissionEligibility,
  "blocked-unsupported"
);

const transformedAssemblyUse = classifySoliditySource({
  parser,
  source: `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
contract Extra {
  address[] internal members;
  function pick() external view returns (address) {
    uint256 seed;
    assembly { seed := prevrandao() }
    return members[(seed + 1) % members.length];
  }
}
`
});
assert.equal(transformedAssemblyUse.sinkClass, "unsupported");
assert.equal(
  transformedAssemblyUse.publicEmissionEligibility,
  "blocked-unsupported"
);

const transformedRequireZero = classifySoliditySource({
  parser,
  source: `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
contract Extra {
  function check() external view {
    require(block.prevrandao + 1 == 0);
  }
}
`
});
assert.equal(transformedRequireZero.sinkClass, "unsupported");
assert.equal(
  transformedRequireZero.publicEmissionEligibility,
  "blocked-unsupported"
);

const wrappedKeccakOrdering = classifySoliditySource({
  parser,
  source: `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
contract Extra {
  function normalize(uint256 value) internal pure returns (uint256) { return value; }
  function orderingKey(uint256 item) external view returns (uint256) {
    return uint256(keccak256(abi.encode(item, normalize(block.prevrandao))));
  }
}
`
});
assert.equal(wrappedKeccakOrdering.sinkClass, "unsupported");
assert.equal(
  wrappedKeccakOrdering.publicEmissionEligibility,
  "blocked-unsupported"
);

if (failures.length === 0) {
  process.stdout.write("C09-R3-A adversarial checks: 17 passed\n");
}
'''
if run.count(final_marker) != 1:
    raise SystemExit(f"final adversarial marker count: {run.count(final_marker)}")
run = run.replace(final_marker, additional, 1)
run_path.write_text(run, encoding="utf-8")
