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

function findTopLevelLet(sourceFile, name) {
  const matches = [];
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    if ((statement.declarationList.flags & ts.NodeFlags.Let) === 0) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && declaration.name.text === name) {
        matches.push(declaration);
      }
    }
  }
  return matches.length === 1 ? matches[0] : undefined;
}

function positiveTopLevelNumericConst(sourceFile, name) {
  const declaration = findTopLevelConst(sourceFile, name);
  if (declaration?.initializer === undefined) return false;
  const value = numericLiteralValue(declaration.initializer);
  return value !== undefined && Number.isFinite(value) && value > 0;
}

function isDateNowCall(expression) {
  const current = unwrap(expression);
  return (
    ts.isCallExpression(current) &&
    current.arguments.length === 0 &&
    ts.isPropertyAccessExpression(current.expression) &&
    ts.isIdentifier(current.expression.expression) &&
    current.expression.expression.text === "Date" &&
    current.expression.name.text === "now"
  );
}

function deadlineConstSupported(sourceFile) {
  const declaration = findTopLevelConst(sourceFile, "DEADLINE_MS");
  if (declaration?.initializer === undefined) return false;
  const initializer = unwrap(declaration.initializer);
  if (
    !ts.isBinaryExpression(initializer) ||
    initializer.operatorToken.kind !== ts.SyntaxKind.PlusToken
  ) {
    return false;
  }
  const pair = (dateSide, offsetSide) => {
    const offset = numericLiteralValue(offsetSide);
    return (
      isDateNowCall(dateSide) &&
      offset !== undefined &&
      Number.isFinite(offset) &&
      offset > 0
    );
  };
  return (
    pair(initializer.left, initializer.right) ||
    pair(initializer.right, initializer.left)
  );
}

function exactAttemptCondition(expression) {
  const current = unwrap(expression);
  return (
    ts.isBinaryExpression(current) &&
    current.operatorToken.kind === ts.SyntaxKind.LessThanToken &&
    ts.isIdentifier(unwrap(current.left)) &&
    unwrap(current.left).text === "attempt" &&
    ts.isIdentifier(unwrap(current.right)) &&
    unwrap(current.right).text === "MAX_ATTEMPTS"
  );
}

function exactDeadlineCondition(expression) {
  const current = unwrap(expression);
  return (
    ts.isBinaryExpression(current) &&
    current.operatorToken.kind === ts.SyntaxKind.LessThanToken &&
    isDateNowCall(current.left) &&
    ts.isIdentifier(unwrap(current.right)) &&
    unwrap(current.right).text === "DEADLINE_MS"
  );
}

function exactAttemptInitializer(initializer) {
  if (
    initializer === undefined ||
    !ts.isVariableDeclarationList(initializer) ||
    (initializer.flags & ts.NodeFlags.Let) === 0 ||
    initializer.declarations.length !== 1
  ) {
    return false;
  }
  const declaration = initializer.declarations[0];
  return (
    ts.isIdentifier(declaration.name) &&
    declaration.name.text === "attempt" &&
    declaration.initializer !== undefined &&
    numericLiteralValue(declaration.initializer) === 0
  );
}

function isAttemptIncrementExpression(expression) {
  const current = unwrap(expression);
  if (
    (ts.isPostfixUnaryExpression(current) ||
      ts.isPrefixUnaryExpression(current)) &&
    current.operator === ts.SyntaxKind.PlusPlusToken &&
    ts.isIdentifier(current.operand) &&
    current.operand.text === "attempt"
  ) {
    return true;
  }
  return (
    ts.isBinaryExpression(current) &&
    current.operatorToken.kind === ts.SyntaxKind.PlusEqualsToken &&
    ts.isIdentifier(unwrap(current.left)) &&
    unwrap(current.left).text === "attempt" &&
    numericLiteralValue(current.right) === 1
  );
}

function topLevelAttemptSupported(sourceFile) {
  const declaration = findTopLevelLet(sourceFile, "attempt");
  return (
    declaration?.initializer !== undefined &&
    numericLiteralValue(declaration.initializer) === 0
  );
}

function directAttemptIncrementCount(loop) {
  return loop.statement.statements.filter(
    (statement) =>
      ts.isExpressionStatement(statement) &&
      isAttemptIncrementExpression(statement.expression)
  ).length;
}

function findFunction(sourceFile) {
  const matches = [];
  function visit(node) {
    if (
      ts.isFunctionDeclaration(node) &&
      node.parent === sourceFile &&
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

function findExactlyOne(items, predicate) {
  const matches = items.filter(predicate);
  return matches.length === 1 ? matches[0] : undefined;
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

function hasShadowedFetch(sourceFile) {
  return (
    collectNodes(
      sourceFile,
      (node) =>
        ((ts.isVariableDeclaration(node) || ts.isParameter(node)) &&
          ts.isIdentifier(node.name) &&
          node.name.text === "fetch") ||
        (ts.isFunctionDeclaration(node) &&
          node.name !== undefined &&
          node.name.text === "fetch")
    ).length > 0
  );
}

function classifyLoop(functionNode, sourceFile) {
  const loops = collectNodes(
    functionNode.body,
    (node) => ts.isForStatement(node) || ts.isWhileStatement(node)
  );
  if (loops.length !== 1) return { supported: false };
  const loop = loops[0];
  if (loop.parent !== functionNode.body) return { supported: false };
  if (!ts.isBlock(loop.statement)) return { supported: false };

  if (ts.isForStatement(loop)) {
    const bounded =
      exactAttemptInitializer(loop.initializer) &&
      loop.condition !== undefined &&
      exactAttemptCondition(loop.condition) &&
      loop.incrementor !== undefined &&
      isAttemptIncrementExpression(loop.incrementor) &&
      positiveTopLevelNumericConst(sourceFile, "MAX_ATTEMPTS");
    return bounded
      ? { supported: true, bounded: true, loop }
      : { supported: false };
  }

  if (loop.expression.kind === ts.SyntaxKind.TrueKeyword) {
    return { supported: true, bounded: false, loop };
  }

  if (exactAttemptCondition(loop.expression)) {
    const bounded =
      positiveTopLevelNumericConst(sourceFile, "MAX_ATTEMPTS") &&
      topLevelAttemptSupported(sourceFile) &&
      directAttemptIncrementCount(loop) === 1;
    return bounded
      ? { supported: true, bounded: true, loop }
      : { supported: false };
  }

  if (exactDeadlineCondition(loop.expression)) {
    return deadlineConstSupported(sourceFile)
      ? { supported: true, bounded: true, loop }
      : { supported: false };
  }

  return { supported: false };
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
  const text = expression.getText().replaceAll(/\s+/g, "");
  const patterns = [
    /^`https:\/\/iris-api(?:-sandbox)?\.circle\.com\/v2\/messages\/\$\{SOURCE\.domain\}`\+`\?transactionHash=\$\{([A-Za-z_$][\w$]*)\}`$/,
    /^`https:\/\/iris-api(?:-sandbox)?\.circle\.com\/v2\/messages\/\$\{SOURCE\.domain\}\?transactionHash=\$\{([A-Za-z_$][\w$]*)\}`$/
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match !== null) return hashBindingSupported(functionNode, match[1]);
  }
  return false;
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
  if (!ts.isExpressionStatement(statement)) return undefined;
  const expression = unwrap(statement.expression);
  if (!ts.isAwaitExpression(expression)) return undefined;
  const text = expression.expression.getText().replaceAll(/\s+/g, "");
  const patterns = [
    /^newPromise\(\(resolve\)=>setTimeout\(resolve,(\d[\d_]*)\)\)$/,
    /^newPromise\(resolve=>setTimeout\(resolve,(\d[\d_]*)\)\)$/
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match !== null) return Number(match[1].replaceAll("_", ""));
  }
  return undefined;
}

function directReturnAction(statement) {
  if (statement.expression === undefined) return "return";
  const expression = unwrap(statement.expression);
  if (ts.isIdentifier(expression) && expression.text === "message") {
    return "return-message";
  }
  if (
    ts.isPropertyAccessExpression(expression) &&
    isIdentifierNamed(expression.expression, "message") &&
    expression.name.text === "attestation"
  ) {
    return "return-attestation";
  }
  return "return";
}

function branchAction(ifStatement) {
  const statements = directStatements(ifStatement.thenStatement);
  let hasDelay = false;
  let hasZeroDelay = false;
  let hasContinue = false;
  let terminal;
  for (const statement of statements) {
    const delay = directNumericDelay(statement);
    if (delay !== undefined) {
      if (delay > 0) hasDelay = true;
      else hasZeroDelay = true;
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
      terminal = directReturnAction(statement);
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
  if (
    hasContinue &&
    (hasZeroDelay || (!hasDelay && statements.length === 1)) &&
    statements.length <= 2
  ) {
    return "retry-tight";
  }
  return "unsupported";
}

function classifyBranch(action, safeAction) {
  if (action === "unsupported") return UNSUPPORTED;
  const safeActions = Array.isArray(safeAction) ? safeAction : [safeAction];
  return safeActions.includes(action) ? SAFE : UNSAFE;
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

function isMessageDeclaration(statement) {
  if (!ts.isVariableStatement(statement)) return false;
  if ((statement.declarationList.flags & ts.NodeFlags.Const) === 0)
    return false;
  if (statement.declarationList.declarations.length !== 1) return false;
  const declaration = statement.declarationList.declarations[0];
  if (
    !ts.isIdentifier(declaration.name) ||
    declaration.name.text !== "message" ||
    declaration.initializer === undefined
  ) {
    return false;
  }
  const initializer = unwrap(declaration.initializer);
  return (
    ts.isElementAccessExpression(initializer) &&
    initializer.argumentExpression !== undefined &&
    numericLiteralValue(initializer.argumentExpression) === 0 &&
    ts.isPropertyAccessExpression(unwrap(initializer.expression)) &&
    ts.isIdentifier(unwrap(initializer.expression).expression) &&
    unwrap(initializer.expression).expression.text === "body" &&
    unwrap(initializer.expression).name.text === "messages"
  );
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
  if (hasShadowedFetch(sourceFile))
    return result(UNSUPPORTED, "shadowed-fetch");

  const loopInfo = classifyLoop(functionNode, sourceFile);
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
  const combinedMatches = ifStatements.filter((statement) =>
    isCombined404And429(statement.expression)
  );
  const status404Matches = ifStatements.filter((statement) =>
    isResponseStatusAccess(statement.expression, 404)
  );
  const status429Matches = ifStatements.filter((statement) =>
    isResponseStatusAccess(statement.expression, 429)
  );
  if (
    combinedMatches.length > 1 ||
    (combinedMatches.length === 1 &&
      (status404Matches.length > 0 || status429Matches.length > 0))
  ) {
    return result(UNSUPPORTED, "duplicate-combined-status");
  }
  const combined = combinedMatches[0];
  if (combined !== undefined) {
    const action = branchAction(combined);
    return result(
      action === "retry-delay" ? UNSAFE : UNSUPPORTED,
      "404-429-conflation"
    );
  }

  const branch404 =
    status404Matches.length === 1 ? status404Matches[0] : undefined;
  const branch429 =
    status429Matches.length === 1 ? status429Matches[0] : undefined;
  const branchOther = findExactlyOne(ifStatements, (statement) =>
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
  const messageDeclarations = statements.filter(isMessageDeclaration);
  if (messageDeclarations.length !== 1) {
    return result(UNSUPPORTED, "message-binding");
  }
  const emptyBranch = findExactlyOne(ifStatements, (statement) =>
    isBodyEmpty(statement.expression)
  );
  const pendingBranch = findExactlyOne(ifStatements, (statement) =>
    isMessagePending(statement.expression)
  );
  const completeBranch = findExactlyOne(ifStatements, (statement) =>
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
    classifyBranch(branchAction(completeBranch), [
      "return-message",
      "return-attestation"
    ])
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
