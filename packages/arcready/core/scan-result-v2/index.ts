import {
  ARCREADY_CONTRACT_VERSION,
  ContractV2ValidationError,
  type CoverageV2,
  type FindingV2,
  type ScanDiagnosticV2,
  type ScanResultV2
} from "../contracts/v2/model.js";
import {
  validateCoverageV2,
  validateFindingV2,
  validateScanDiagnosticV2,
  validateScanResultV2
} from "../contracts/v2/validate.js";

export interface BuildScanResultV2Input {
  coverage: CoverageV2;
  findings: readonly FindingV2[];
  diagnostics: readonly ScanDiagnosticV2[];
}

export function buildScanResultV2(
  input: BuildScanResultV2Input
): ScanResultV2 {
  validateCoverageV2(input.coverage);
  assertArray(input.findings, "BuildScanResultV2Input findings");
  for (const finding of input.findings) {
    assertPlainRecord(finding, "BuildScanResultV2Input finding");
    validateFindingV2(finding);
  }
  assertArray(input.diagnostics, "BuildScanResultV2Input diagnostics");
  for (const diagnostic of input.diagnostics) {
    assertPlainRecord(diagnostic, "BuildScanResultV2Input diagnostic");
    validateScanDiagnosticV2(diagnostic);
  }

  const snapshot = structuredClone({
    coverage: input.coverage,
    findings: input.findings,
    diagnostics: input.diagnostics
  });
  const findings = [...snapshot.findings].sort(compareExactFingerprint);
  const result: ScanResultV2 = {
    contractVersion: ARCREADY_CONTRACT_VERSION,
    coverage: snapshot.coverage,
    findings,
    diagnostics: snapshot.diagnostics
  };

  validateScanResultV2(result);
  return result;
}

function compareExactFingerprint(left: FindingV2, right: FindingV2): number {
  const leftValue = left.fingerprints.exact.value;
  const rightValue = right.fingerprints.exact.value;
  return leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0;
}

function assertArray(
  value: unknown,
  label: string
): asserts value is readonly unknown[] {
  if (!Array.isArray(value)) {
    fail(`${label} must be an array`);
  }
}

function assertPlainRecord(value: unknown, label: string): void {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail(`${label} must be an object`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    fail(`${label} must be a plain object`);
  }
}

function fail(message: string): never {
  throw new ContractV2ValidationError(message);
}
