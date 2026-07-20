import { existsSync, lstatSync, readdirSync } from "node:fs";
import type { Stats } from "node:fs";
import { sep } from "node:path";
import type { ScanDiagnosticV2 } from "../contracts/v2/model.js";
import { normalizeRepositoryRelativePath } from "../contracts/v2/source-location.js";
import { validateScanDiagnosticV2 } from "../contracts/v2/validate.js";

export type DiscoveryPathV1 =
  | { kind: "project-root" }
  | { kind: "repository-relative"; path: string }
  | { kind: "unrepresentable" };

export type DiscoveryRootDispositionV1 =
  | "accepted"
  | "outside-project-root"
  | "unavailable";

export interface DiscoveryRootOutcomeV1 {
  requestIndex: number;
  path: DiscoveryPathV1;
  disposition: DiscoveryRootDispositionV1;
}

export type DiscoveryEntryTypeV1 = "directory" | "file" | "symlink" | "other";

export type DiscoveryExclusionReasonV1 =
  | "configured-pattern"
  | "scanner-directory"
  | "symlink-not-followed";

export type DiscoveryExtensionSupportV1 =
  | "supported"
  | "unsupported"
  | "not-evaluated";

export interface DiscoveryEntryOutcomeV1 {
  path: DiscoveryPathV1;
  entryType: DiscoveryEntryTypeV1;
  exclusionReason?: DiscoveryExclusionReasonV1;
  configuredPatternIndex?: number;
  extensionSupport: DiscoveryExtensionSupportV1;
  candidate: boolean;
  encounterCount: number;
}

export interface DiscoveryInstrumentationV1 {
  roots: readonly DiscoveryRootOutcomeV1[];
  entries: readonly DiscoveryEntryOutcomeV1[];
  diagnostics: readonly ScanDiagnosticV2[];
  complete: boolean;
}

export interface InstrumentedDiscoveryResult {
  /**
   * Legacy operational candidate paths. These paths are absolute and are not
   * canonical instrumentation. They must not be serialized or persisted by a
   * future report, JSON, SARIF, telemetry, or baseline projection.
   */
  files: readonly string[];
  /** Canonical sanitized discovery facts suitable for future projection. */
  instrumentation: DiscoveryInstrumentationV1;
}

export interface DiscoveryFileSystem {
  exists(path: string): boolean;
  lstat(path: string): Pick<Stats, "isSymbolicLink" | "isDirectory" | "isFile">;
  readDirectory(path: string): string[];
}

export const defaultDiscoveryFileSystem: DiscoveryFileSystem = {
  exists: existsSync,
  lstat: lstatSync,
  readDirectory: readdirSync
};

interface StoredEntryOutcome {
  privateIdentity: string;
  outcome: DiscoveryEntryOutcomeV1;
}

export class DiscoveryInstrumentationRecorder {
  private readonly roots: DiscoveryRootOutcomeV1[] = [];
  private readonly entriesByIdentity = new Map<string, StoredEntryOutcome>();
  private readonly diagnostics: ScanDiagnosticV2[] = [];

  recordRoot(outcome: DiscoveryRootOutcomeV1): void {
    this.roots.push(outcome);
  }

  recordEntry(
    privateIdentity: string,
    outcome: Omit<DiscoveryEntryOutcomeV1, "encounterCount">
  ): void {
    const existing = this.entriesByIdentity.get(privateIdentity);

    if (existing) {
      existing.outcome.encounterCount += 1;
      existing.outcome.candidate ||= outcome.candidate;
      return;
    }

    this.entriesByIdentity.set(privateIdentity, {
      privateIdentity,
      outcome: { ...outcome, encounterCount: 1 }
    });
  }

  recordFatalDiagnostic(
    operation: "lstat" | "read-directory",
    path: DiscoveryPathV1
  ): void {
    const diagnostic: ScanDiagnosticV2 = {
      code:
        operation === "lstat"
          ? "DISCOVERY_LSTAT_FAILED"
          : "DISCOVERY_READ_DIRECTORY_FAILED",
      category: "discovery-error",
      level: "error",
      phase: "discovery",
      origin: "repository",
      message:
        operation === "lstat"
          ? "Filesystem entry metadata could not be read."
          : "Directory contents could not be read.",
      recoverable: false,
      ...(path.kind === "repository-relative"
        ? { location: { path: path.path } }
        : {})
    };

    validateScanDiagnosticV2(diagnostic);
    this.diagnostics.push(diagnostic);
  }

  build(complete: boolean): DiscoveryInstrumentationV1 {
    return {
      roots: [...this.roots].sort(
        (left, right) => left.requestIndex - right.requestIndex
      ),
      entries: [...this.entriesByIdentity.values()]
        .sort(compareStoredEntries)
        .map(({ outcome }) => ({ ...outcome })),
      diagnostics: [...this.diagnostics],
      complete
    };
  }
}

export function representNativeDiscoveryPath(
  nativeRelativePath: string,
  nativeSeparator: "/" | "\\" = sep === "\\" ? "\\" : "/"
): DiscoveryPathV1 {
  if (nativeRelativePath === "") {
    return { kind: "project-root" };
  }

  if (nativeSeparator === "/" && nativeRelativePath.includes("\\")) {
    return { kind: "unrepresentable" };
  }

  const canonicalInput =
    nativeSeparator === "\\"
      ? nativeRelativePath.replaceAll("\\", "/")
      : nativeRelativePath;

  try {
    return {
      kind: "repository-relative",
      path: normalizeRepositoryRelativePath(canonicalInput)
    };
  } catch {
    return { kind: "unrepresentable" };
  }
}

function compareStoredEntries(
  left: StoredEntryOutcome,
  right: StoredEntryOutcome
): number {
  const leftRank = pathKindRank(left.outcome.path);
  const rightRank = pathKindRank(right.outcome.path);

  if (leftRank !== rightRank) {
    return leftRank - rightRank;
  }

  if (
    left.outcome.path.kind === "repository-relative" &&
    right.outcome.path.kind === "repository-relative"
  ) {
    return compareCodeUnits(left.outcome.path.path, right.outcome.path.path);
  }

  if (
    left.outcome.path.kind === "unrepresentable" &&
    right.outcome.path.kind === "unrepresentable"
  ) {
    return compareCodeUnits(left.privateIdentity, right.privateIdentity);
  }

  return 0;
}

function pathKindRank(path: DiscoveryPathV1): number {
  switch (path.kind) {
    case "project-root":
      return 0;
    case "repository-relative":
      return 1;
    case "unrepresentable":
      return 2;
  }
}

function compareCodeUnits(left: string, right: string): number {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}
