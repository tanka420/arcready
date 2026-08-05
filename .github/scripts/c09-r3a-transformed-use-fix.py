from pathlib import Path

path = Path("docs/research/fixtures/c09-r3a-prototype.mjs")
text = path.read_text(encoding="utf-8")

old_binding = '''      if (isIdentifier(selection.dependencyNode, first.name)) {
        return selection.exactLength
          ? { bindingClass: "single-assignment", sinkClass: "selection" }
          : { bindingClass: "single-assignment", sinkClass: "unsupported" };
      }
'''
new_binding = old_binding + '''      if (containsIdentifier(selection.dependencyNode, first.name)) {
        return { bindingClass: "single-assignment", sinkClass: "unsupported" };
      }
'''
if text.count(old_binding) != 1:
    raise SystemExit(f"exact local binding block count: {text.count(old_binding)}")
text = text.replace(old_binding, new_binding, 1)

old_assembly = '''    if (isIdentifier(selection.dependencyNode, exact.targetName)) {
      return {
        sourceClass: "assembly-prevrandao",
        bindingClass: "single-assignment",
        sinkClass: selection.exactLength ? "selection" : "unsupported"
      };
    }
'''
new_assembly = old_assembly + '''    if (containsIdentifier(selection.dependencyNode, exact.targetName)) {
      return {
        sourceClass: "assembly-prevrandao",
        bindingClass: "single-assignment",
        sinkClass: "unsupported"
      };
    }
'''
if text.count(old_assembly) != 1:
    raise SystemExit(f"exact assembly binding block count: {text.count(old_assembly)}")
text = text.replace(old_assembly, new_assembly, 1)

path.write_text(text, encoding="utf-8")
