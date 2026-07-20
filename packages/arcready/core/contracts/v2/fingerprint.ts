import { createHash } from "node:crypto";
import {
  ContractV2ValidationError,
  type ExactFindingFingerprintInputV1,
  type FindingFingerprintV1
} from "./model.js";
import {
  normalizeRepositoryRelativePath,
  validateSourceRegionV2
} from "./source-location.js";

export const EXACT_LOCATION_FINGERPRINT_SCHEME =
  "arcready/exact-location/v1" as const;
export const PROJECT_LEVEL_FINGERPRINT_MARKER = "<project>" as const;
export const MAX_DETECTOR_DISCRIMINATOR_LENGTH = 256;

export function createExactFindingFingerprint(
  input: ExactFindingFingerprintInputV1
): FindingFingerprintV1 {
  validateExactFindingFingerprintInput(input);

  const discriminator = input.detectorDiscriminator.trim();
  const location = input.primaryLocation;
  const path = location
    ? normalizeRepositoryRelativePath(location.path)
    : PROJECT_LEVEL_FINGERPRINT_MARKER;
  const start = location?.region?.start;
  const end = location?.region?.end;
  const canonicalInput = [
    EXACT_LOCATION_FINGERPRINT_SCHEME,
    input.ruleId,
    path,
    start?.line ?? 0,
    start?.column ?? 0,
    end?.line ?? 0,
    end?.column ?? 0,
    discriminator
  ] as const;
  const digest = createHash("sha256")
    .update(JSON.stringify(canonicalInput), "utf8")
    .digest("hex");

  return {
    scheme: EXACT_LOCATION_FINGERPRINT_SCHEME,
    algorithm: "sha256",
    value: `sha256:${digest}`,
    stability: "exact"
  };
}

export function validateExactFindingFingerprintInput(
  value: unknown
): asserts value is ExactFindingFingerprintInputV1 {
  assertRecord(value, "fingerprint input");
  assertOnlyKeys(
    value,
    ["ruleId", "primaryLocation", "detectorDiscriminator"],
    "fingerprint input"
  );
  assertStableIdentifier(value.ruleId, "fingerprint ruleId", 256);
  if (value.primaryLocation !== undefined) {
    assertRecord(value.primaryLocation, "fingerprint primaryLocation");
    assertOnlyKeys(
      value.primaryLocation,
      ["path", "region"],
      "fingerprint primaryLocation"
    );
    if (typeof value.primaryLocation.path !== "string") {
      fail("fingerprint primaryLocation path must be a string");
    }
    normalizeRepositoryRelativePath(value.primaryLocation.path);
    if (value.primaryLocation.region !== undefined) {
      validateSourceRegionV2(value.primaryLocation.region);
    }
  }
  if (typeof value.detectorDiscriminator !== "string") {
    fail("detectorDiscriminator must be a string");
  }
  const discriminator = value.detectorDiscriminator.trim();
  if (discriminator.length === 0) {
    fail("detectorDiscriminator must not be empty");
  }
  if (value.detectorDiscriminator.length > MAX_DETECTOR_DISCRIMINATOR_LENGTH) {
    fail(
      `detectorDiscriminator must not exceed ${MAX_DETECTOR_DISCRIMINATOR_LENGTH} characters`
    );
  }
  if (containsControlCharacter(value.detectorDiscriminator)) {
    fail("detectorDiscriminator must not contain control characters");
  }
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

function assertStableIdentifier(
  value: unknown,
  label: string,
  maximumLength: number
): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    fail(`${label} must be a non-empty string`);
  }
  if (value.length > maximumLength) {
    fail(`${label} must not exceed ${maximumLength} characters`);
  }
  if (value !== value.trim()) {
    fail(`${label} must not contain surrounding whitespace`);
  }
  if (containsControlCharacter(value)) {
    fail(`${label} must not contain control characters`);
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
