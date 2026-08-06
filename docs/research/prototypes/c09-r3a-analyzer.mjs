function isNode(value) {
  return Boolean(
    value && typeof value === "object" && typeof value.type === "string"
  );
}

function walk(node, ancestors, visitor) {
  if (!isNode(node)) return;
  visitor(node, ancestors);
  const nextAncestors = [...ancestors, node];
  for (const [key, value] of Object.entries(node)) {
    if (key === "loc" || key === "range") continue;
    if (Array.isArray(value)) {
      for (const child of value) walk(child, nextAncestors, visitor);
    } else if (isNode(value)) {
      walk(value, nextAncestors, visitor);
    }
  }
}

function nearest(ancestors, type) {
  for (let index = ancestors.length - 1; index >= 0; index -= 1) {
    if (ancestors[index]?.type === type) return ancestors[index];
  }
  return null;
}

function sliceNode(source, node) {
  if (!Array.isArray(node?.range) || node.range.length !== 2) return "";
  return source.slice(node.range[0], node.range[1] + 1);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function maskNonCode(text) {
  const output = text.split("");
  let state = "code";

  for (let index = 0; index < text.length; index += 1) {
    const current = text[index];
    const next = text[index + 1];

    if (state === "line-comment") {
      if (current === "\n" || current === "\r") state = "code";
      else output[index] = " ";
      continue;
    }

    if (state === "block-comment") {
      if (current === "*" && next === "/") {
        output[index] = " ";
        output[index + 1] = " ";
        index += 1;
        state = "code";
      } else if (current !== "\n" && current !== "\r") {
        output[index] = " ";
      }
      continue;
    }

    if (state === "single-string" || state === "double-string") {
      const quote = state === "single-string" ? "'" : '"';
      if (current === "\\") {
        output[index] = " ";
        if (index + 1 < text.length) {
          output[index + 1] = " ";
          index += 1;
        }
      } else {
        if (current === quote) state = "code";
        if (current !== "\n" && current !== "\r") output[index] = " ";
      }
      continue;
    }

    if (current === "/" && next === "/") {
      output[index] = " ";
      output[index + 1] = " ";
      index += 1;
      state = "line-comment";
    } else if (current === "/" && next === "*") {
      output[index] = " ";
      output[index + 1] = " ";
      index += 1;
      state = "block-comment";
    } else if (current === "'") {
      output[index] = " ";
      state = "single-string";
    } else if (current === '"') {
      output[index] = " ";
      state = "double-string";
    }
  }

  return output.join("");
}

function identifierAssignments(text, name) {
  const escaped = escapeRegExp(name);
  const pattern = new RegExp(
    `\\b${escaped}\\s*(?:=|\\+=|-=|\\*=|\\/=|%=)`,
    "g"
  );
  return [...text.matchAll(pattern)].length;
}

function declarationCount(text, name) {
  const escaped = escapeRegExp(name);
  const pattern = new RegExp(
    `\\b(?:u?int(?:8|16|32|64|128|256)?|address|bytes32|bool)\\s+${escaped}\\b`,
    "g"
  );
  return [...text.matchAll(pattern)].length;
}

function sourceBinding(text) {
  const direct = text.match(
    /\b(?:u?int(?:8|16|32|64|128|256)?|bytes32)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:u?int(?:8|16|32|64|128|256)?\s*\(\s*)?block\s*\.\s*(prevrandao|difficulty)\s*\)?\s*;/
  );
  if (direct) {
    return { name: direct[1], source: direct[2], kind: "declaration" };
  }

  const branch = text.match(
    /\b(?:u?int(?:8|16|32|64|128|256)?|bytes32)\s+([A-Za-z_$][\w$]*)\s*;[\s\S]*?\bif\s*\([^)]*\)[\s\S]*?\b\1\s*=\s*block\s*\.\s*(prevrandao|difficulty)\b/
  );
  if (branch) {
    return { name: branch[1], source: branch[2], kind: "branch" };
  }

  const assembly = text.match(
    /\b(?:u?int(?:8|16|32|64|128|256)?|bytes32)\s+([A-Za-z_$][\w$]*)\s*;[\s\S]*?\bassembly\s*\{[\s\S]*?\b\1\s*:=\s*prevrandao\s*\(\s*\)/
  );
  if (assembly) {
    return { name: assembly[1], source: "prevrandao", kind: "assembly" };
  }

  return null;
}

function sinkForFunction(text, binding) {
  const hasLoop = /\b(?:for|while|do)\b/.test(text);
  const sourcePattern = "(?:block\\s*\\.\\s*(?:prevrandao|difficulty))";
  const bindingPattern = binding ? escapeRegExp(binding.name) : null;
  const dependent = bindingPattern
    ? `(?:${sourcePattern}|\\b${bindingPattern}\\b)`
    : sourcePattern;

  if (hasLoop && new RegExp(dependent).test(text)) {
    return { sinkClass: "unsupported", reason: "loop" };
  }

  if (
    /\b(?:uint256|uint)\s+length\s*=\s*[A-Za-z_$][\w$]*\.length\s*;/.test(
      text
    ) &&
    new RegExp(`${dependent}\\s*%\\s*length\\b`).test(text)
  ) {
    return { sinkClass: "unsupported", reason: "indirect-length" };
  }

  const directCollectionModulo = new RegExp(
    `${dependent}\\s*%\\s*([A-Za-z_$][\\w$]*)\\.length`
  ).test(text);
  const indexFromDirectModulo = new RegExp(
    `\\b(?:u?int(?:8|16|32|64|128|256)?)\\s+([A-Za-z_$][\\w$]*)\\s*=\\s*[^;]*${dependent}[^;]*%\\s*([A-Za-z_$][\\w$]*)\\.length\\s*;[\\s\\S]*?\\b\\2\\s*\\[\\s*\\1\\s*\\]`
  ).test(text);
  const indexWithModulo = new RegExp(
    `\\b([A-Za-z_$][\\w$]*)\\s*\\[\\s*[^\\]]*${dependent}[^\\]]*%\\s*\\1\\.length\\s*\\]`
  ).test(text);

  if (indexWithModulo || indexFromDirectModulo || directCollectionModulo) {
    return { sinkClass: "selection", reason: "collection-selection" };
  }

  if (
    new RegExp(
      `\\breturn\\s+(?:${dependent}\\s*==\\s*0|0\\s*==\\s*${dependent})\\s*;`
    ).test(text)
  ) {
    return { sinkClass: "safe-observation", reason: "zero-check" };
  }

  if (
    new RegExp(
      `\\breturn\\b[^;]*(?:${dependent}[^;]*(?:==|!=|<|>|<=|>=)|(?:==|!=|<|>|<=|>=)[^;]*${dependent})[^;]*;`
    ).test(text) ||
    new RegExp(`\\bif\\s*\\([^)]*${dependent}[^)]*\\)`).test(text)
  ) {
    return { sinkClass: "authorization", reason: "decision" };
  }

  if (
    new RegExp(`\\bkeccak256\\s*\\([\\s\\S]*?${dependent}[\\s\\S]*?\\)`).test(
      text
    ) &&
    /\b(?:orderingKey|sort|order|shuffle)\b/i.test(text)
  ) {
    return { sinkClass: "ordering", reason: "ordering-key" };
  }

  if (/\bemit\b/.test(text) && new RegExp(dependent).test(text)) {
    return { sinkClass: "safe-observation", reason: "event" };
  }

  if (
    /\brequire\s*\(/.test(text) &&
    new RegExp(`${dependent}\\s*==\\s*0|0\\s*==\\s*${dependent}`).test(text)
  ) {
    return { sinkClass: "safe-observation", reason: "zero-check" };
  }

  if (
    new RegExp(`\\breturn\\s+${dependent}\\s*;`).test(text) &&
    !/\b(?:select|pick|eligible|ordering|winner|relay|shuffle)\b/i.test(text)
  ) {
    return { sinkClass: "safe-observation", reason: "diagnostic-return" };
  }

  if (/\bkeccak256\s*\(/.test(text) && new RegExp(dependent).test(text)) {
    return { sinkClass: "none", reason: "hash-only" };
  }

  return { sinkClass: "none", reason: "none" };
}

function functionRecords(ast, source) {
  const records = [];
  walk(ast, [], (node, ancestors) => {
    if (node.type !== "FunctionDefinition" || !node.body) return;
    const text = sliceNode(source, node);
    records.push({
      node,
      contract: nearest(ancestors, "ContractDefinition"),
      text,
      code: maskNonCode(text)
    });
  });
  return records;
}

function sourceOccurrences(ast) {
  const occurrences = [];
  walk(ast, [], (node, ancestors) => {
    if (
      node.type === "MemberAccess" &&
      node.expression?.type === "Identifier" &&
      node.expression.name === "block" &&
      (node.memberName === "prevrandao" || node.memberName === "difficulty")
    ) {
      occurrences.push({
        kind:
          node.memberName === "prevrandao"
            ? "direct-prevrandao"
            : "difficulty-post-paris",
        node,
        contract: nearest(ancestors, "ContractDefinition"),
        function: nearest(ancestors, "FunctionDefinition")
      });
    }
    if (
      node.type === "AssemblyCall" &&
      (node.functionName === "prevrandao" || node.functionName === "difficulty")
    ) {
      const nestedAssemblyFunction = Boolean(
        nearest(ancestors, "AssemblyFunctionDefinition")
      );
      occurrences.push({
        kind:
          node.functionName === "prevrandao" && !nestedAssemblyFunction
            ? "assembly-prevrandao"
            : "unsupported-source",
        node,
        contract: nearest(ancestors, "ContractDefinition"),
        function: nearest(ancestors, "FunctionDefinition"),
        nestedAssemblyFunction
      });
    }
  });
  return occurrences;
}

function hasPotentialSelection(text) {
  return (
    /\b[A-Za-z_$][\w$]*\s*\[[^\]]*%[^\]]*\]/.test(text) ||
    /\b(?:select|pick|eligible|ordering|winner|relay|shuffle)\b/i.test(text)
  );
}

function unsupportedResult(parseStatus = "parseable") {
  return {
    parseStatus,
    sourceClass: "unsupported-source",
    contractOwnership: "ambiguous",
    functionOwnership: "ambiguous",
    bindingClass: "unsupported",
    sinkClass: "unsupported",
    arcDeploymentOwnership: "synthetic-r3a",
    publicEmissionEligibility: "blocked-unsupported"
  };
}

export function analyzeC09Source(parser, source, metadata = {}) {
  const sourceCode = maskNonCode(source);
  const unsupportedFutureSyntax = /pragma\s+solidity\s+[^;]*\b0\.9\./.test(
    sourceCode
  );

  let ast;
  try {
    ast = parser.parse(source, { tolerant: false, loc: true, range: true });
  } catch (error) {
    if (error instanceof parser.ParserError || error?.name === "ParserError") {
      return unsupportedResult("malformed");
    }
    throw error;
  }

  const contracts =
    ast.children?.filter((node) => node.type === "ContractDefinition") ?? [];
  const functions = functionRecords(ast, source);
  const occurrences = sourceOccurrences(ast);

  if (unsupportedFutureSyntax) {
    return {
      ...unsupportedResult("unsupported-syntax"),
      contractOwnership:
        contracts.length === 1 ? "single-contract" : "ambiguous",
      functionOwnership: functions.length === 1 ? "same-function" : "ambiguous"
    };
  }

  if (occurrences.length === 0) {
    const emptyGuidanceContract =
      contracts.length === 1 && (contracts[0].subNodes?.length ?? 0) === 0;
    const contractOwnership =
      contracts.length === 0 || emptyGuidanceContract
        ? "none"
        : contracts.length === 1
          ? "single-contract"
          : "multiple-contracts";
    const functionOwnership =
      contracts.length === 0 || emptyGuidanceContract
        ? "none"
        : "same-function";
    return {
      parseStatus: "parseable",
      sourceClass: "no-source",
      contractOwnership,
      functionOwnership,
      bindingClass: "none",
      sinkClass: "none",
      arcDeploymentOwnership: "synthetic-r3a",
      publicEmissionEligibility: "not-applicable"
    };
  }

  if (occurrences.some((item) => item.kind === "unsupported-source")) {
    const first = occurrences[0];
    return {
      ...unsupportedResult("parseable"),
      contractOwnership: first.contract ? "single-contract" : "ambiguous",
      functionOwnership: first.function ? "same-function" : "ambiguous"
    };
  }

  const sourceContracts = new Set(
    occurrences.map((item) => item.contract?.name).filter(Boolean)
  );
  const sinkFunctions = functions.filter((record) =>
    hasPotentialSelection(record.code)
  );
  const sinkContracts = new Set(
    sinkFunctions.map((record) => record.contract?.name).filter(Boolean)
  );

  let contractOwnership = "single-contract";
  let functionOwnership = "same-function";
  if (sourceContracts.size > 1 || sinkContracts.size > 1) {
    contractOwnership = "multiple-contracts";
  }
  const contractIntersection = [...sourceContracts].some((name) =>
    sinkContracts.has(name)
  );
  if (
    sourceContracts.size > 0 &&
    sinkContracts.size > 0 &&
    !contractIntersection
  ) {
    const crossCall = sinkFunctions.some((record) =>
      /\b[A-Za-z_$][\w$]*\.seed\s*\(/.test(record.code)
    );
    contractOwnership = crossCall ? "cross-contract" : "multiple-contracts";
    functionOwnership = crossCall ? "cross-function" : "ambiguous";
  } else {
    const sourceFunctionNodes = new Set(
      occurrences.map((item) => item.function).filter(Boolean)
    );
    const sinkFunctionNodes = new Set(sinkFunctions.map((item) => item.node));
    const sameFunction = [...sourceFunctionNodes].some((node) =>
      sinkFunctionNodes.has(node)
    );
    if (!sameFunction && sinkFunctionNodes.size > 0) {
      functionOwnership = "cross-function";
    }
  }

  if (
    contractOwnership !== "single-contract" ||
    functionOwnership !== "same-function"
  ) {
    const sourceFunctionNames = occurrences
      .map((item) => item.function?.name)
      .filter(Boolean);
    const sinkCallsSource = sinkFunctions.some((record) =>
      sourceFunctionNames.some((name) =>
        new RegExp(`\\b${escapeRegExp(name)}\\s*\\(`).test(record.code)
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

  const candidateFunctions = functions.filter((record) =>
    occurrences.some((item) => item.function === record.node)
  );

  let selected = null;
  for (const record of candidateFunctions) {
    const binding = sourceBinding(record.code);
    const sink = sinkForFunction(record.code, binding);
    const sourceKind = occurrences.find(
      (item) => item.function === record.node
    )?.kind;

    let bindingClass = "direct";
    if (binding?.kind === "branch") bindingClass = "branch-join";
    else if (binding) {
      const assignments = identifierAssignments(record.code, binding.name);
      const declarations = declarationCount(record.code, binding.name);
      const multiHop = new RegExp(
        `\\b(?:u?int(?:8|16|32|64|128|256)?|bytes32)\\s+[A-Za-z_$][\\w$]*\\s*=\\s*${escapeRegExp(binding.name)}\\s*;`
      ).test(record.code);
      if (declarations > 1) bindingClass = "unsupported";
      else if (multiHop) bindingClass = "multi-hop";
      else if (
        assignments > 1 ||
        (/\bunchecked\s*\{[\s\S]*?\b/.test(record.code) &&
          new RegExp(`\\b${escapeRegExp(binding.name)}\\s*\\+=`).test(
            record.code
          ))
      ) {
        bindingClass = "reassigned";
      } else bindingClass = "single-assignment";
    }

    if (functionOwnership === "cross-function") {
      bindingClass = binding ? "unsupported" : "none";
    }
    if (sink.reason === "indirect-length" || sink.reason === "loop") {
      selected = {
        sourceKind,
        bindingClass,
        sinkClass: "unsupported",
        supported: false
      };
      break;
    }
    if (
      ["reassigned", "multi-hop", "branch-join", "unsupported"].includes(
        bindingClass
      )
    ) {
      selected = {
        sourceKind,
        bindingClass,
        sinkClass: "unsupported",
        supported: false
      };
      break;
    }

    const supported = ["selection", "authorization", "ordering"].includes(
      sink.sinkClass
    );
    const directReportableSource =
      supported &&
      (/block\s*\.\s*(?:prevrandao|difficulty)[^;]*%\s*[A-Za-z_$][\w$]*\.length/.test(
        record.code
      ) ||
        /\b(?:u?int(?:8|16|32|64|128|256)?)\s+[A-Za-z_$][\w$]*\s*=\s*[^;]*block\s*\.\s*(?:prevrandao|difficulty)[^;]*%\s*[A-Za-z_$][\w$]*\.length\s*;[\s\S]*?\b[A-Za-z_$][\w$]*\s*\[/.test(
          record.code
        ));
    const recordResult = {
      sourceKind,
      bindingClass: directReportableSource
        ? "direct"
        : sink.sinkClass === "safe-observation" &&
            sink.reason === "diagnostic-return"
          ? "none"
          : bindingClass,
      sinkClass: sink.sinkClass,
      supported
    };
    if (supported) {
      selected = recordResult;
      break;
    }
    if (!selected) selected = recordResult;
  }

  if (!selected) {
    selected = {
      sourceKind: occurrences[0].kind,
      bindingClass: "direct",
      sinkClass: "none",
      supported: false
    };
  }

  if (
    selected.sourceKind === "difficulty-post-paris" &&
    metadata.evmTargetEvidence !== "paris-or-later-required"
  ) {
    return {
      parseStatus: "parseable",
      sourceClass: "difficulty-post-paris",
      contractOwnership,
      functionOwnership,
      bindingClass: selected.bindingClass,
      sinkClass: selected.sinkClass,
      arcDeploymentOwnership: "synthetic-r3a",
      publicEmissionEligibility: "blocked-unsupported"
    };
  }

  const publicEmissionEligibility = selected.supported
    ? "r3a-candidate-only"
    : selected.sinkClass === "safe-observation" || selected.sinkClass === "none"
      ? "not-applicable"
      : "blocked-unsupported";

  return {
    parseStatus: "parseable",
    sourceClass: selected.sourceKind,
    contractOwnership,
    functionOwnership,
    bindingClass: selected.bindingClass,
    sinkClass: selected.sinkClass,
    arcDeploymentOwnership: "synthetic-r3a",
    publicEmissionEligibility
  };
}
