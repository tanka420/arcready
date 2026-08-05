from pathlib import Path


PATH = Path("docs/research/prototypes/c09-r3a-analyzer.mjs")


def replace_once(old: str, new: str, label: str) -> None:
    text = PATH.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected one match, got {count}")
    PATH.write_text(text.replace(old, new, 1), encoding="utf-8")


replace_once(
    '''  const direct = text.match(
    /\\b(?:u?int(?:8|16|32|64|128|256)?|bytes32)\\s+([A-Za-z_$][\\w$]*)\\s*=\\s*(?:u?int(?:8|16|32|64|128|256)?\\s*\\(\\s*)?block\\s*\\.\\s*(prevrandao|difficulty)\\b[^;]*;/
  );''',
    '''  const direct = text.match(
    /\\b(?:u?int(?:8|16|32|64|128|256)?|bytes32)\\s+([A-Za-z_$][\\w$]*)\\s*=\\s*(?:u?int(?:8|16|32|64|128|256)?\\s*\\(\\s*)?block\\s*\\.\\s*(prevrandao|difficulty)\\s*\\)?\\s*;/
  );''',
    "exact source binding",
)

replace_once(
    '''    new RegExp(
      `\\\\breturn\\\\b[^;]*${dependent}[^;]*(?:==|!=|<|>|<=|>=)[^;]*;`
    ).test(text) ||
    new RegExp(`\\\\bif\\\\s*\\\\([^)]*${dependent}[^)]*\\\\)`).test(text)''',
    '''    new RegExp(
      `\\\\breturn\\\\b[^;]*(?:${dependent}[^;]*(?:==|!=|<|>|<=|>=)|(?:==|!=|<|>|<=|>=)[^;]*${dependent})[^;]*;`
    ).test(text) ||
    new RegExp(`\\\\bif\\\\s*\\\\([^)]*${dependent}[^)]*\\\\)`).test(text)''',
    "symmetric authorization comparison",
)

replace_once(
    '''export function analyzeC09Source(parser, source, metadata = {}) {
  if (/pragma\\s+solidity\\s+[^;]*\\b0\\.9\\./.test(source)) {
    return unsupportedResult("unsupported-syntax");
  }

  let ast;''',
    '''export function analyzeC09Source(parser, source, metadata = {}) {
  const unsupportedFutureSyntax =
    /pragma\\s+solidity\\s+[^;]*\\b0\\.9\\./.test(source);

  let ast;''',
    "future syntax parse ownership",
)

replace_once(
    '''  const functions = functionRecords(ast, source);
  const occurrences = sourceOccurrences(ast);

  if (occurrences.length === 0) {''',
    '''  const functions = functionRecords(ast, source);
  const occurrences = sourceOccurrences(ast);

  if (unsupportedFutureSyntax) {
    return {
      ...unsupportedResult("unsupported-syntax"),
      contractOwnership:
        contracts.length === 1 ? "single-contract" : "ambiguous",
      functionOwnership:
        functions.length === 1 ? "same-function" : "ambiguous"
    };
  }

  if (occurrences.length === 0) {''',
    "future syntax ownership result",
)

replace_once(
    '''    const contractOwnership =
      contracts.length === 0
        ? "none"
        : contracts.length === 1
          ? "single-contract"
          : "multiple-contracts";
    const functionOwnership =
      contracts.length === 0 ? "none" : "same-function";''',
    '''    const emptyGuidanceContract =
      contracts.length === 1 && (contracts[0].subNodes?.length ?? 0) === 0;
    const contractOwnership =
      contracts.length === 0 || emptyGuidanceContract
        ? "none"
        : contracts.length === 1
          ? "single-contract"
          : "multiple-contracts";
    const functionOwnership =
      contracts.length === 0 || emptyGuidanceContract ? "none" : "same-function";''',
    "empty guidance ownership",
)

old_cross = '''  if (
    contractOwnership !== "single-contract" ||
    functionOwnership !== "same-function"
  ) {
    const independentSourceOnly = occurrences.every((item) => {
      const record = functions.find((entry) => entry.node === item.function);
      return record
        ? sinkForFunction(record.text, null).sinkClass === "safe-observation"
        : false;
    });
    return {
      parseStatus: "parseable",
      sourceClass: occurrences[0].kind,
      contractOwnership,
      functionOwnership,
      bindingClass: independentSourceOnly ? "none" : "unsupported",
      sinkClass: "unsupported",
      arcDeploymentOwnership: "synthetic-r3a",
      publicEmissionEligibility: "blocked-unsupported"
    };
  }
'''
new_cross = '''  if (
    contractOwnership !== "single-contract" ||
    functionOwnership !== "same-function"
  ) {
    const sourceFunctionNames = occurrences
      .map((item) => item.function?.name)
      .filter(Boolean);
    const sinkCallsSource = sinkFunctions.some((record) =>
      sourceFunctionNames.some((name) =>
        new RegExp(`\\\\b${escapeRegExp(name)}\\\\s*\\\\(`).test(record.text)
      )
    );
    const crossDependency =
      contractOwnership === "cross-contract" || sinkCallsSource;
    const independentMultipleContracts =
      contractOwnership === "multiple-contracts" &&
      functionOwnership === "ambiguous" &&
      !crossDependency;

    return {
      parseStatus: "parseable",
      sourceClass: occurrences[0].kind,
      contractOwnership,
      functionOwnership,
      bindingClass: crossDependency
        ? "unsupported"
        : independentMultipleContracts
          ? "direct"
          : "none",
      sinkClass: independentMultipleContracts ? "selection" : "unsupported",
      arcDeploymentOwnership: "synthetic-r3a",
      publicEmissionEligibility: "blocked-unsupported"
    };
  }
'''
replace_once(old_cross, new_cross, "cross ownership evidence")

replace_once(
    '''    const supported = ["selection", "authorization", "ordering"].includes(
      sink.sinkClass
    );
    const recordResult = {
      sourceKind,
      bindingClass:
        sink.sinkClass === "safe-observation" &&
        sink.reason === "diagnostic-return"
          ? "none"
          : bindingClass,''',
    '''    const supported = ["selection", "authorization", "ordering"].includes(
      sink.sinkClass
    );
    const directReportableSource =
      supported &&
      (/block\\s*\\.\\s*(?:prevrandao|difficulty)[^;]*%\\s*[A-Za-z_$][\\w$]*\\.length/.test(
        record.text
      ) ||
        /\\b(?:u?int(?:8|16|32|64|128|256)?)\\s+[A-Za-z_$][\\w$]*\\s*=\\s*[^;]*block\\s*\\.\\s*(?:prevrandao|difficulty)[^;]*%\\s*[A-Za-z_$][\\w$]*\\.length\\s*;[\\s\\S]*?\\b[A-Za-z_$][\\w$]*\\s*\\[/.test(
          record.text
        ));
    const recordResult = {
      sourceKind,
      bindingClass: directReportableSource
        ? "direct"
        : sink.sinkClass === "safe-observation" &&
            sink.reason === "diagnostic-return"
          ? "none"
          : bindingClass,''',
    "reportable direct occurrence selection",
)
