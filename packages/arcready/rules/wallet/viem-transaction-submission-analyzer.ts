/* eslint-disable @typescript-eslint/consistent-type-imports -- compiler loading must remain runtime-lazy */
import { buildViemLexicalIndex } from "./viem-transaction-submission-lexical.js";

type TypeScript = typeof import("typescript");
type SourceFile = import("typescript").SourceFile;

export type ViemTransactionSubmissionAnalysisStatus =
  | "analyzed"
  | "unsupported-file"
  | "compiler-unavailable"
  | "malformed"
  | "unsupported-source";

export interface ViemTransactionSubmissionAnalysis {
  readonly status: ViemTransactionSubmissionAnalysisStatus;
  readonly submissions: readonly never[];
}

const REQUIRED_COMPILER_FUNCTIONS = [
  "createSourceFile",
  "forEachChild",
  "isArrayLiteralExpression",
  "isBinaryExpression",
  "isBlock",
  "isCaseBlock",
  "isCatchClause",
  "isClassDeclaration",
  "isClassExpression",
  "isDeleteExpression",
  "isEnumDeclaration",
  "isForInStatement",
  "isForOfStatement",
  "isForStatement",
  "isFunctionDeclaration",
  "isFunctionExpression",
  "isFunctionLike",
  "isIdentifier",
  "isImportDeclaration",
  "isImportEqualsDeclaration",
  "isModuleBlock",
  "isModuleDeclaration",
  "isNamedImports",
  "isNamespaceImport",
  "isNonNullExpression",
  "isObjectLiteralExpression",
  "isOmittedExpression",
  "isParameter",
  "isParenthesizedExpression",
  "isPostfixUnaryExpression",
  "isPrefixUnaryExpression",
  "isPropertyAssignment",
  "isShorthandPropertyAssignment",
  "isSourceFile",
  "isSpreadAssignment",
  "isSpreadElement",
  "isStringLiteral",
  "isVariableDeclaration",
  "isVariableDeclarationList"
] as const;

export function supportsViemTransactionSubmissionPath(
  filePath: string
): boolean {
  const normalized = filePath.replaceAll("\\", "/");
  const fileName = normalized.slice(normalized.lastIndexOf("/") + 1);
  return (
    /\.[jt]s$/i.test(fileName) &&
    !/\.d\.ts$/i.test(fileName) &&
    !/\.(?:test|spec)\.[jt]s$/i.test(fileName) &&
    !/\.generated\.[jt]s$/i.test(fileName) &&
    !/(?:^|\/)(?:test|tests|__tests__|generated|dist|build|coverage)(?:\/|$)/i.test(
      normalized
    )
  );
}

export async function analyzeViemTransactionSubmissionFile(
  filePath: string,
  source: string,
  compilerLoader: () => Promise<unknown> = () => import("typescript")
): Promise<ViemTransactionSubmissionAnalysis> {
  if (!supportsViemTransactionSubmissionPath(filePath)) {
    return { status: "unsupported-file", submissions: [] };
  }

  const ts = await loadCompiler(compilerLoader);
  if (ts === null) {
    return { status: "compiler-unavailable", submissions: [] };
  }

  try {
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
    if (!isSourceFileShape(sourceFile)) {
      return { status: "compiler-unavailable", submissions: [] };
    }
    if (sourceFile.isDeclarationFile || sourceFile.parseDiagnostics.length > 0) {
      return { status: "malformed", submissions: [] };
    }

    buildViemLexicalIndex(ts, sourceFile);
    return { status: "analyzed", submissions: [] };
  } catch {
    return { status: "compiler-unavailable", submissions: [] };
  }
}

async function loadCompiler(
  compilerLoader: () => Promise<unknown>
): Promise<TypeScript | null> {
  let loaded: unknown;
  try {
    loaded = await compilerLoader();
  } catch {
    return null;
  }

  for (const candidate of compilerCandidates(loaded)) {
    if (hasCompilerShape(candidate)) {
      return candidate;
    }
  }
  return null;
}

function compilerCandidates(value: unknown): readonly unknown[] {
  if (typeof value !== "object" || value === null) return [value];
  const defaultValue = (value as { readonly default?: unknown }).default;
  return defaultValue === undefined ? [value] : [value, defaultValue];
}

function hasCompilerShape(value: unknown): value is TypeScript {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  for (const name of REQUIRED_COMPILER_FUNCTIONS) {
    if (typeof record[name] !== "function") return false;
  }

  const scriptKind = record.ScriptKind as Record<string, unknown> | undefined;
  const scriptTarget = record.ScriptTarget as Record<string, unknown> | undefined;
  const nodeFlags = record.NodeFlags as Record<string, unknown> | undefined;
  const syntaxKind = record.SyntaxKind as Record<string, unknown> | undefined;
  return (
    typeof scriptKind?.JS === "number" &&
    typeof scriptKind.TS === "number" &&
    typeof scriptTarget?.Latest === "number" &&
    typeof nodeFlags?.Const === "number" &&
    typeof nodeFlags.BlockScoped === "number" &&
    typeof syntaxKind?.FirstAssignment === "number" &&
    typeof syntaxKind.LastAssignment === "number" &&
    typeof syntaxKind.PlusPlusToken === "number" &&
    typeof syntaxKind.MinusMinusToken === "number"
  );
}

function isSourceFileShape(value: unknown): value is SourceFile & {
  readonly parseDiagnostics: readonly import("typescript").Diagnostic[];
} {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.isDeclarationFile === "boolean" &&
    Array.isArray(record.parseDiagnostics)
  );
}
