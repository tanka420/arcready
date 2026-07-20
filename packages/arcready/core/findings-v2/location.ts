import { posix, win32 } from "node:path";
import type { SourceLocationV2 } from "../contracts/v2/model.js";
import { validateSourceLocationV2 } from "../contracts/v2/source-location.js";

export type SourceLocationResolutionRejectionReasonV2 =
  | "empty"
  | "outside-project-root"
  | "parent-traversal"
  | "drive-mismatch"
  | "url-like"
  | "control-character"
  | "unrepresentable";

export type SourceLocationResolutionV2 =
  | {
      readonly status: "resolved";
      readonly location: SourceLocationV2;
    }
  | {
      readonly status: "rejected";
      readonly reason: SourceLocationResolutionRejectionReasonV2;
    };

type PathFamily = "posix" | "windows";

interface TrustedRoot {
  readonly family: PathFamily;
  readonly path: string;
}

export function createRepositoryLocationResolver(
  projectRoot: string
): (legacyPath: string) => SourceLocationResolutionV2 {
  const trustedRoot = parseTrustedRoot(projectRoot);

  return (legacyPath) => resolveRepositoryLocation(trustedRoot, legacyPath);
}

function parseTrustedRoot(projectRoot: string): TrustedRoot {
  if (
    typeof projectRoot !== "string" ||
    projectRoot.trim().length === 0 ||
    containsControlCharacter(projectRoot) ||
    isUncPath(projectRoot) ||
    isUrlLike(projectRoot) ||
    containsParentTraversal(projectRoot)
  ) {
    throw new TypeError("projectRoot must be a safe absolute POSIX or Windows path");
  }

  if (isWindowsDriveAbsolute(projectRoot)) {
    return { family: "windows", path: win32.resolve(projectRoot) };
  }
  if (posix.isAbsolute(projectRoot)) {
    return { family: "posix", path: posix.resolve(projectRoot) };
  }

  throw new TypeError("projectRoot must be a safe absolute POSIX or Windows path");
}

function resolveRepositoryLocation(
  root: TrustedRoot,
  legacyPath: string
): SourceLocationResolutionV2 {
  if (typeof legacyPath !== "string" || legacyPath.trim().length === 0) {
    return rejected("empty");
  }
  if (containsControlCharacter(legacyPath)) {
    return rejected("control-character");
  }
  if (isUncPath(legacyPath)) {
    return rejected("unrepresentable");
  }
  if (isUrlLike(legacyPath)) {
    return rejected("url-like");
  }
  if (containsParentTraversal(legacyPath)) {
    return rejected("parent-traversal");
  }

  const kind = classifyPath(legacyPath);
  if (kind === "windows-drive-relative" || kind === "windows-root-relative") {
    return rejected("drive-mismatch");
  }

  let candidate: string;
  if (root.family === "windows") {
    if (kind === "posix-absolute") {
      return rejected("drive-mismatch");
    }
    if (kind === "windows-absolute") {
      const rootDrive = win32.parse(root.path).root.slice(0, 2);
      const candidateDrive = win32.parse(legacyPath).root.slice(0, 2);
      if (rootDrive.toLowerCase() !== candidateDrive.toLowerCase()) {
        return rejected("drive-mismatch");
      }
      candidate = win32.resolve(legacyPath);
    } else {
      candidate = win32.resolve(root.path, legacyPath.replaceAll("/", "\\"));
    }
  } else {
    if (kind === "windows-absolute") {
      return rejected("drive-mismatch");
    }
    candidate =
      kind === "posix-absolute"
        ? posix.resolve(legacyPath)
        : posix.resolve(root.path, legacyPath.replaceAll("\\", "/"));
  }

  const pathApi = root.family === "windows" ? win32 : posix;
  const relativePath = pathApi.relative(root.path, candidate);
  if (relativePath.length === 0) {
    return rejected("unrepresentable");
  }
  if (
    pathApi.isAbsolute(relativePath) ||
    relativePath === ".." ||
    relativePath.startsWith(`..${pathApi.sep}`)
  ) {
    return rejected("outside-project-root");
  }

  const location: SourceLocationV2 = {
    path: relativePath.split(pathApi.sep).join("/")
  };
  try {
    validateSourceLocationV2(location);
  } catch {
    return rejected("unrepresentable");
  }
  return { status: "resolved", location };
}

function classifyPath(
  value: string
):
  | "relative"
  | "posix-absolute"
  | "windows-absolute"
  | "windows-drive-relative"
  | "windows-root-relative" {
  if (isWindowsDriveAbsolute(value)) {
    return "windows-absolute";
  }
  if (/^[A-Za-z]:/.test(value)) {
    return "windows-drive-relative";
  }
  if (value.startsWith("/")) {
    return "posix-absolute";
  }
  if (value.startsWith("\\")) {
    return "windows-root-relative";
  }
  return "relative";
}

function isWindowsDriveAbsolute(value: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(value) && win32.isAbsolute(value);
}

function isUncPath(value: string): boolean {
  return /^[\\/]{2}/.test(value);
}

function isUrlLike(value: string): boolean {
  return (
    !/^[A-Za-z]:/.test(value) &&
    /^[A-Za-z][A-Za-z\d+.-]*:/.test(value)
  );
}

function containsParentTraversal(value: string): boolean {
  return value.split(/[\\/]+/).includes("..");
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

function rejected(
  reason: SourceLocationResolutionRejectionReasonV2
): SourceLocationResolutionV2 {
  return { status: "rejected", reason };
}
