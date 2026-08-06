import {
  ContractV2ValidationError,
  type SourceLocationV2,
  type SourcePositionV2,
  type SourceRegionV2
} from "./model.js";

const MAX_REPOSITORY_PATH_LENGTH = 4_096;

export function normalizeRepositoryRelativePath(input: string): string {
  if (typeof input !== "string") {
    fail("source path must be a string");
  }
  if (containsControlCharacter(input)) {
    fail("source path must not contain control characters");
  }
  if (input.length > MAX_REPOSITORY_PATH_LENGTH) {
    fail(
      `source path must not exceed ${MAX_REPOSITORY_PATH_LENGTH} characters`
    );
  }

  const slashPath = input.replaceAll("\\", "/");
  if (slashPath.startsWith("/")) {
    fail("source path must be repository-relative");
  }
  if (/^[A-Za-z]:/.test(slashPath)) {
    fail("source path must not be drive-qualified");
  }
  if (/^[A-Za-z][A-Za-z\d+.-]*:/.test(slashPath)) {
    fail("source path must not be URL-like");
  }

  const normalizedSegments: string[] = [];
  for (const segment of slashPath.split("/")) {
    if (segment === "" || segment === ".") {
      continue;
    }
    if (segment === "..") {
      fail("source path must not contain parent traversal");
    }
    normalizedSegments.push(segment);
  }

  const normalized = normalizedSegments.join("/");
  if (normalized.length === 0) {
    fail("source path must not be empty");
  }
  return normalized;
}

function containsControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit <= 31 || codeUnit === 127) {
      return true;
    }
  }
  return false;
}

export function validateSourcePositionV2(
  value: unknown
): asserts value is SourcePositionV2 {
  assertRecord(value, "source position");
  assertOnlyKeys(value, ["line", "column"], "source position");
  assertPositiveInteger(value.line, "source position line");
  assertPositiveInteger(value.column, "source position column");
}

export function validateSourceRegionV2(
  value: unknown
): asserts value is SourceRegionV2 {
  assertRecord(value, "source region");
  assertOnlyKeys(value, ["start", "end"], "source region");
  validateSourcePositionV2(value.start);
  if (value.end !== undefined) {
    validateSourcePositionV2(value.end);
    if (positionPrecedes(value.end, value.start)) {
      fail("source region end must not precede its start");
    }
  }
}

export function validateSourceLocationV2(
  value: unknown
): asserts value is SourceLocationV2 {
  assertRecord(value, "source location");
  assertOnlyKeys(value, ["path", "region"], "source location");
  if (typeof value.path !== "string") {
    fail("source location path must be a string");
  }
  const normalized = normalizeRepositoryRelativePath(value.path);
  if (value.path !== normalized) {
    fail("source location path must already be normalized");
  }
  if (value.region !== undefined) {
    validateSourceRegionV2(value.region);
  }
}

function positionPrecedes(
  candidate: SourcePositionV2,
  reference: SourcePositionV2
): boolean {
  return (
    candidate.line < reference.line ||
    (candidate.line === reference.line && candidate.column < reference.column)
  );
}

function assertPositiveInteger(value: unknown, label: string): void {
  if (!Number.isInteger(value) || (value as number) < 1) {
    fail(`${label} must be a one-based positive integer`);
  }
}

function assertRecord(
  value: unknown,
  label: string
): asserts value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail(`${label} must be an object`);
  }
}

function assertOnlyKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  label: string
): void {
  const unknownKey = Object.keys(value).find((key) => !allowed.includes(key));
  if (unknownKey !== undefined) {
    fail(`${label} contains unsupported field "${unknownKey}"`);
  }
}

function fail(message: string): never {
  throw new ContractV2ValidationError(message);
}
