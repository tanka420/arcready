import ts from "typescript";

const SAFE = "safe-candidate";
const UNSAFE = "unsafe-candidate";
const UNSUPPORTED = "unsupported";

function result(controlFlowClass, reason) {
  return {
    controlFlowClass,
    publicFindingEligibility:
      controlFlowClass === UNSAFE
        ? "blocked-unvalidated-burn"
        : "not-applicable",
    reason
  };
}

function isConstDeclaration(node) {
  return (
    ts.isVariableDeclaration(node) &&
    ts.isVariableDeclarationList(node.parent) &&
    (node.parent.flags & ts.NodeFlags.Const) !== 0
  );
}

function unwrap(expression) {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isNonNullExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function numericLiteralValue(expression) {
  const current = unwrap(expression);
  if (ts.isNumericLiteral(current))
    return Number(current.text.replaceAll("_", ""));
  if (
    ts.isPrefixUnaryExpression(current) &&
    current.operator === ts.SyntaxKind.MinusToken &&
    ts.isNumericLiteral(current.operand)
  ) {
    return -Number(current.operand.text.replaceAll("_", ""));
  }
  return undefined;
}

function propertyNameText(name) {
  if (ts.isIdentifier(name) || ts.isPrivateIdentifier(name)) return name.text;
  if (ts.isStringLiteralLike(name) || ts.isNumericLiteral(name))
    return name.text;
  return undefined;
}

function findTopLevelConst(sourceFile, name) {
  const matches = [];
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    if ((statement.declarationList.flags & ts.NodeFlags.Const) === 0) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && declaration.name.text === name) {
        matches.push(declaration);
      }
    }
  }
  return matches.length === 1 ? matches[0] : undefined;
}

function findFunction(sourceFile) {
  const matches = [];
  function visit(node) {
    if (
      ts.isFunctionDeclaration(node) &&
      node.name?.text === "pollArcAttestation" &&
      node.body !== undefined
    ) {
      matches.push(node);
      return;
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return matches.length === 1 ? matches[0] : undefined;
}

function containsImport(sourceFile) {
  return sourceFile.statements.some(
    (statement) =>
      ts.isImportDeclaration(statement) ||
      ts.isImportEqualsDeclaration(statement)
  );
}

function containsJsx(sourceFile) {
  let found = false;
  function visit(node) {
    if (
      ts.isJsxElement(node) ||
      ts.isJsxSelfClosingElement(node) ||
      ts.isJsxFragment(node)
    ) {
      found = true;
      return;
    }
    if (!found) ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return found;
}

function sourcePairSupported(sourceFile) {
  const declaration = findTopLevelConst(sourceFile, "SOURCE");
  if (declaration?.initializer === undefined) return false;
  const initializer = unwrap(declaration.initializer);
  if (!ts.isObjectLiteralExpression(initializer)) return false;
  let chainId;
  let domain;
  for (const property of initializer.properties) {
    if (!ts.isPropertyAssignment(property)) return false;
    const name = propertyNameText(property.name);
    if (name === "chainId") chainId = numericLiteralValue(property.initializer);
    if (name === "domain") domain = numericLiteralValue(property.initializer);
  }
  return (
    (chainId === 5042002 && domain === 26) || (chainId === 1 && domain === 0)
  );
}

function directStatements(block) {
  return ts.isBlock(block) ? [...block.statements] : [block];
}

function collectNodes(root, predicate) {
  const matches = [];
  function visit(node) {
    if (predicate(node)) matches.push(node);
    ts.forEachChild(node, visit);
  }
  visit(root);
  return matches;
}

function isIdentifierNamed(node, name) {
  return ts.isIdentifier(node) && node.text === name;
}

function resolveFunctionConst(functionNode, name) {
  const matches = [];
  for (const statement of functionNode.body.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    if ((statement.declarationList.flags & ts.NodeFlags.Const) === 0) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (
        ts.isIdentifier(declaration.name) &&
        declaration.name.text === name &&
        declaration.initializer !== undefined
      ) {
        matches.push(declaration);
      }
    }
  }
  return matches.length === 1 ? matches[0] : undefined;
}

function hasShadowedFetch(functionNode) {
  return (
    collectNodes(
      functionNode,
      (node) =>
        (ts.isVariableDeclaration(node) || ts.isParameter(node)) &&
        ts.isIdentifier(node.name) &&
        node.name.text === "fetch"
    ).length > 0
  );
}

function classifyLoop(functionNode) {
  const loops = collectNodes(
    functionNode.body,
    (node) => ts.isForStatement(node) || ts.isWhileStatement(node)
  );
  if (loops.length !== 1) return { supported: false };
  const loop = loops[0];
  if (loop.parent !== functionNode.body) return { supported: false };
  if (!ts.isBlock(loop.statement)) return { supported: false };

  if (ts.isForStatement(loop)) {
    const conditionText = loop.condition?.getText() ?? "";
    const incrementText = loop.incrementor?.getText() ?? "";
    const initializerText = loop.initializer?.getText() ?? "";
    const bounded =
      /\battempt\s*=\s*0\b/.test(initializerText) &&
      /\battempt\s*<\s*MAX_ATTEMPTS\b/.test(conditionText) &&
      /(?:attempt\s*\+=\s*1|attempt\+\+|\+\+attempt)/.test(incrementText);
    return bounded
      ? { supported: true, bounded: true, loop }
      : { supported: false };
  }

  const conditionText = loop.expression.getText();
  if (conditionText === "true") {
    return { supported: true, bounded: false, loop };
  }
  const boundedAttempt = /\battempt\s*<\s*MAX_ATTEMPTS\b/.test(conditionText);
  const boundedDeadline = /Date\.now\(\)\s*<\s*DEADLINE_MS/.test(conditionText);
  if (!boundedAttempt && !boundedDeadline) return { supported: false };
  if (boundedAttempt) {
    const bodyText = loop.statement.getText();
    if (!/(?:attempt\s*\+=\s*1|attempt\+\+|\+\+attempt)/.test(bodyText)) {
      return { supported: false };
    }
  }
  return { supported: true, bounded: true, loop };
}

function findFetchBinding(loop) {
  const fetchCalls = collectNodes(
    loop.statement,
    (node) =>
      ts.isCallExpression(node) && isIdentifierNamed(node.expression, "fetch")
  );
  if (fetchCalls.length !== 1) return undefined;
  const call = fetchCalls[0];
  if (call.arguments.length !== 1) return undefined;
  const awaited = call.parent;
  if (!ts.isAwaitExpression(awaited)) return undefined;
  const declaration = awaited.parent;
  if (
    !ts.isVariableDeclaration(declaration) ||
    !isConstDeclaration(declaration) ||
    !ts.isIdentifier(declaration.name) ||
    declaration.name.text !== "response"
  ) {
    return undefined;
  }
  return { call, argument: call.arguments[0], declaration };
}

function urlExpression(functionNode, fetchArgument) {
  const current = unwrap(fetchArgument);
  if (!ts.isIdentifier(current)) return current;
  const declaration = resolveFunctionConst(functionNode, current.text);
  return declaration?.initializer === undefined
    ? undefined
    : unwrap(declaration.initializer);
}

function hashBindingSupported(functionNode, hashName) {
  if (hashName === "transactionHash") {
    return functionNode.parameters.some(
      (parameter) =>
        ts.isIdentifier(parameter.name) &&
        parameter.name.text === "transactionHash"
    );
  }
  const declaration = resolveFunctionConst(functionNode, hashName);
  return (
    declaration?.initializer !== undefined &&
    ts.isIdentifier(unwrap(declaration.initializer)) &&
    unwrap(declaration.initializer).text === "transactionHash"
  );
}

function urlSupported(functionNode, expression) {
  if (expression === undefined) return false;
  const text = expression.getText();
  if (!/iris-api(?:-sandbox)?\.circle\.com/.test(text)) return false;
  if (!/\/v2\/messages\//.test(text)) return false;
  if (!/SOURCE\.domain/.test(text)) return false;
  if (!/\?transactionHash=/.test(text)) return false;
  if (/process\.env|IRIS_API_URL|CHAIN_CONFIGS|\/v1\/|\?nonce=/.test(text)) {
    return false;
  }
  const hashMatch = text.match(/\?transactionHash=\\?\$\{([A-Za-z_$][\w$]*)\}/);
  if (hashMatch === null) return false;
  return hashBindingSupported(functionNode, hashMatch[1]);
}

function isResponseStatusAccess(expression, status) {
  const current = unwrap(expression);
  if (!ts.isBinaryExpression(current)) return false;
  if (
    current.operatorToken.kind !== ts.SyntaxKind.EqualsEqualsEqualsToken &&
    current.operatorToken.kind !== ts.SyntaxKind.EqualsEqualsToken
  ) {
    return false;
  }
  const check = (left, right) => {
    const property = unwrap(left);
    return (
      ts.isPropertyAccessExpression(property) &&
      isIdentifierNamed(property.expression, "response") &&
      property.name.text === "status" &&
      numericLiteralValue(right) === status
    );
  };
  return (
    check(current.left, current.right) || check(current.right, current.left)
  );
}

function isCombined404And429(expression) {
  const current = unwrap(expression);
  if (
    !ts.isBinaryExpression(current) ||
    current.operatorToken.kind !== ts.SyntaxKind.BarBarToken
  ) {
    return false;
  }
  return (
    (isResponseStatusAccess(current.left, 404) &&
      isResponseStatusAccess(current.right, 429)) ||
    (isResponseStatusAccess(current.left, 429) &&
      isResponseStatusAccess(current.right, 404))
  );
}

function isResponseNotOk(expression) {
  const current = unwrap(expression);
  return (
    ts.isPrefixUnaryExpression(current) &&
    current.operator === ts.SyntaxKind.ExclamationToken &&
    ts.isPropertyAccessExpression(unwrap(current.operand)) &&
    isIdentifierNamed(unwrap(current.operand).expression, "response") &&
    unwrap(current.operand).name.text === "ok"
  );
}

function isBodyEmpty(expression) {
  const text = unwrap(expression).getText().replaceAll(/\s+/g, "");
  return (
    text === "body.messages.length===0" || text === "0===body.messages.length"
  );
}

function isMessagePending(expression) {
  const text = unwrap(expression).getText().replaceAll(/\s+/g, "");
  return (
    text === 'message.status==="pending"' ||
    text === '"pending"===message.status'
  );
}

function isMessageComplete(expression) {
  const text = unwrap(expression).getText().replaceAll(/\s+/g, "");
  return (
    text === 'message.status==="complete"&&message.attestation' ||
    text === 'message.attestation&&message.status==="complete"'
  );
}

function directNumericDelay(statement) {
  if (!ts.isExpressionStatement(statement)) return false;
  const expression = unwrap(statement.expression);
  if (!ts.isAwaitExpression(expression)) return false;
  const text = expression.expression.getText().replaceAll(/\s+/g, "");
  return (
    /^newPromise\(\(resolve\)=>setTimeout\(resolve,\d[\d_]*\)\)$/.test(text) ||
    /^newPromise\(resolve=>setTimeout\(resolve,\d[\d_]*\)\)$/.test(text)
  );
}

function branchAction(ifStatement) {
  const statements = directStatements(ifStatement.thenStatement);
  let hasDelay = false;
  let hasContinue = false;
  let terminal;
  for (const statement of statements) {
    if (directNumericDelay(statement)) {
      hasDelay = true;
      continue;
    }
    if (ts.isContinueStatement(statement)) {
      hasContinue = true;
      continue;
    }
    if (ts.isThrowStatement(statement)) {
      terminal = "throw";
      continue;
    }
    if (ts.isReturnStatement(statement)) {
      terminal = "return";
      continue;
    }
    if (ts.isBreakStatement(statement)) {
      terminal = "break";
      continue;
    }
    return "unsupported";
  }
  if (terminal !== undefined && statements.length === 1) return terminal;
  if (hasContinue && hasDelay && statements.length === 2) return "retry-delay";
  if (hasContinue && !hasDelay && statements.length === 1) return "retry-tight";
  return "unsupported";
}

function classifyBranch(action, safeAction) {
  if (action === "unsupported") return UNSUPPORTED;
  return action === safeAction ? SAFE : UNSAFE;
}

function isBodyDeclaration(statement) {
  if (!ts.isVariableStatement(statement)) return false;
  return statement.declarationList.declarations.some((declaration) => {
    if (
      !ts.isIdentifier(declaration.name) ||
      declaration.name.text !== "body"
    ) {
      return false;
    }
    if (declaration.initializer === undefined) return false;
    const initializer = unwrap(declaration.initializer);
    if (!ts.isAwaitExpression(initializer)) return false;
    const call = unwrap(initializer.expression);
    return (
      ts.isCallExpression(call) &&
      ts.isPropertyAccessExpression(call.expression) &&
      isIdentifierNamed(call.expression.expression, "response") &&
      call.expression.name.text === "json"
    );
  });
}

function hasEarlyResponseJson(loop, firstStatusStart) {
  return (
    collectNodes(
      loop.statement,
      (node) =>
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        isIdentifierNamed(node.expression.expression, "response") &&
        node.expression.name.text === "json" &&
        node.getStart() < firstStatusStart
    ).length > 0
  );
}

function hasFinalTimeout(functionNode, loop) {
  const statements = functionNode.body.statements;
  const index = statements.indexOf(loop);
  if (index < 0) return false;
  return statements
    .slice(index + 1)
    .some((statement) => ts.isThrowStatement(statement));
}

export function classifyC08R3Source(filePath, source) {
  if (
    !/\.(?:js|ts)$/i.test(filePath) ||
    /\.(?:jsx|tsx|d\.ts)$/i.test(filePath)
  ) {
    return result(UNSUPPORTED, "unsupported-file-kind");
  }
  const scriptKind = filePath.toLowerCase().endsWith(".js")
    ? ts.ScriptKind.JS
    : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKind
  );
  if (sourceFile.parseDiagnostics.length > 0 || containsJsx(sourceFile)) {
    return result(UNSUPPORTED, "parse-or-jsx");
  }
  if (containsImport(sourceFile))
    return result(UNSUPPORTED, "imported-evidence");
  if (!sourcePairSupported(sourceFile))
    return result(UNSUPPORTED, "source-pair");

  const functionNode = findFunction(sourceFile);
  if (functionNode === undefined) return result(UNSUPPORTED, "poll-function");
  if (hasShadowedFetch(functionNode))
    return result(UNSUPPORTED, "shadowed-fetch");

  const loopInfo = classifyLoop(functionNode);
  if (!loopInfo.supported) return result(UNSUPPORTED, "loop-ownership");
  const { loop } = loopInfo;
  const fetchBinding = findFetchBinding(loop);
  if (fetchBinding === undefined) return result(UNSUPPORTED, "fetch-ownership");
  if (
    !urlSupported(
      functionNode,
      urlExpression(functionNode, fetchBinding.argument)
    )
  ) {
    return result(UNSUPPORTED, "url-ownership");
  }

  const statements = [...loop.statement.statements];
  const ifStatements = statements.filter(ts.isIfStatement);
  const combined = ifStatements.find((statement) =>
    isCombined404And429(statement.expression)
  );
  if (combined !== undefined) {
    const action = branchAction(combined);
    return result(
      action === "retry-delay" ? UNSAFE : UNSUPPORTED,
      "404-429-conflation"
    );
  }

  const branch404 = ifStatements.find((statement) =>
    isResponseStatusAccess(statement.expression, 404)
  );
  const branch429 = ifStatements.find((statement) =>
    isResponseStatusAccess(statement.expression, 429)
  );
  const branchOther = ifStatements.find((statement) =>
    isResponseNotOk(statement.expression)
  );
  if (
    branch404 === undefined ||
    branch429 === undefined ||
    branchOther === undefined
  ) {
    return result(UNSUPPORTED, "status-model");
  }
  const firstStatusStart = Math.min(
    branch404.getStart(),
    branch429.getStart(),
    branchOther.getStart()
  );
  if (hasEarlyResponseJson(loop, firstStatusStart)) {
    return result(UNSUPPORTED, "json-before-status");
  }

  const bodyDeclarations = statements.filter(isBodyDeclaration);
  if (bodyDeclarations.length !== 1) return result(UNSUPPORTED, "body-binding");
  const emptyBranch = ifStatements.find((statement) =>
    isBodyEmpty(statement.expression)
  );
  const pendingBranch = ifStatements.find((statement) =>
    isMessagePending(statement.expression)
  );
  const completeBranch = ifStatements.find((statement) =>
    isMessageComplete(statement.expression)
  );
  if (
    emptyBranch === undefined ||
    pendingBranch === undefined ||
    completeBranch === undefined
  ) {
    return result(UNSUPPORTED, "body-model");
  }

  const checks = [
    classifyBranch(branchAction(branch404), "retry-delay"),
    classifyBranch(branchAction(branch429), "retry-delay"),
    classifyBranch(branchAction(branchOther), "throw"),
    classifyBranch(branchAction(emptyBranch), "retry-delay"),
    classifyBranch(branchAction(pendingBranch), "retry-delay"),
    classifyBranch(branchAction(completeBranch), "return")
  ];
  if (checks.includes(UNSUPPORTED)) return result(UNSUPPORTED, "branch-shape");
  if (checks.includes(UNSAFE)) return result(UNSAFE, "unsafe-owned-branch");

  if (!loopInfo.bounded) {
    return result(UNSAFE, "unbounded-loop");
  }
  if (!hasFinalTimeout(functionNode, loop)) {
    return result(UNSUPPORTED, "missing-bounded-exit");
  }
  return result(SAFE, "supported-safe-flow");
}
