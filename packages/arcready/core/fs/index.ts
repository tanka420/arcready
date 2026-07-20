import { extname, isAbsolute, join, relative, resolve } from "node:path";
import {
  defaultDiscoveryFileSystem,
  DiscoveryInstrumentationRecorder,
  representNativeDiscoveryPath,
  type DiscoveryEntryTypeV1,
  type DiscoveryFileSystem,
  type InstrumentedDiscoveryResult
} from "./instrumentation.js";

export interface DiscoverFilesOptions {
  projectRoot: string;
  paths: string[];
  exclude: string[];
}

const SKIPPED_DIRECTORIES = new Set([
  "node_modules",
  "dist",
  "coverage",
  ".next",
  ".git"
]);

const SUPPORTED_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".json",
  ".md",
  ".mdx",
  ".sol",
  ".yaml",
  ".yml"
]);

export function discoverFiles(options: DiscoverFilesOptions): string[] {
  const result = collectDiscovery(options, defaultDiscoveryFileSystem);

  if (result.fatalFailure) {
    throw result.fatalFailure.error;
  }

  return sortLegacyFiles(result.files);
}

export function discoverFilesInstrumented(
  options: DiscoverFilesOptions,
  fileSystem: DiscoveryFileSystem = defaultDiscoveryFileSystem
): InstrumentedDiscoveryResult {
  const recorder = new DiscoveryInstrumentationRecorder();
  const result = collectDiscovery(options, fileSystem, recorder);

  return {
    files: sortLegacyFiles(result.files),
    instrumentation: recorder.build(result.fatalFailure === undefined)
  };
}

interface DiscoveryCollectorResult {
  files: Set<string>;
  fatalFailure?: { error: unknown };
}

function collectDiscovery(
  options: DiscoverFilesOptions,
  fileSystem: DiscoveryFileSystem,
  recorder?: DiscoveryInstrumentationRecorder
): DiscoveryCollectorResult {
  const projectRoot = resolve(options.projectRoot);
  const excludeMatchers = options.exclude.map((pattern) =>
    createGlobMatcher(pattern)
  );
  const files = new Set<string>();
  const result: DiscoveryCollectorResult = { files };

  for (const [requestIndex, includePath] of options.paths.entries()) {
    const absolutePath = resolve(projectRoot, includePath);
    const insideRoot = isInsideRoot(projectRoot, absolutePath);

    if (!insideRoot) {
      recorder?.recordRoot({
        requestIndex,
        path: { kind: "unrepresentable" },
        disposition: "outside-project-root"
      });
      continue;
    }

    if (!fileSystem.exists(absolutePath)) {
      recorder?.recordRoot({
        requestIndex,
        path: representCurrentPath(projectRoot, absolutePath),
        disposition: "unavailable"
      });
      continue;
    }

    recorder?.recordRoot({
      requestIndex,
      path: representCurrentPath(projectRoot, absolutePath),
      disposition: "accepted"
    });
    collectFiles(
      projectRoot,
      absolutePath,
      excludeMatchers,
      files,
      fileSystem,
      result,
      recorder
    );

    if (result.fatalFailure) {
      break;
    }
  }

  return result;
}

function collectFiles(
  projectRoot: string,
  currentPath: string,
  excludeMatchers: Array<(path: string) => boolean>,
  files: Set<string>,
  fileSystem: DiscoveryFileSystem,
  result: DiscoveryCollectorResult,
  recorder?: DiscoveryInstrumentationRecorder
): void {
  let currentStat: ReturnType<DiscoveryFileSystem["lstat"]>;

  try {
    currentStat = fileSystem.lstat(currentPath);
  } catch (error) {
    result.fatalFailure = { error };
    recorder?.recordFatalDiagnostic(
      "lstat",
      representCurrentPath(projectRoot, currentPath)
    );
    return;
  }

  if (currentStat.isSymbolicLink()) {
    recorder?.recordEntry(currentPath, {
      path: representCurrentPath(projectRoot, currentPath),
      entryType: "symlink",
      exclusionReason: "symlink-not-followed",
      extensionSupport: "not-evaluated",
      candidate: false
    });
    return;
  }

  const nativeRelativePath = relative(projectRoot, currentPath);
  const relativePath = toPosixPath(nativeRelativePath);
  const discoveryPath = representNativeDiscoveryPath(nativeRelativePath);
  const configuredPatternIndex = relativePath
    ? findExcludedPatternIndex(relativePath, excludeMatchers)
    : undefined;

  if (relativePath && configuredPatternIndex !== undefined) {
    recorder?.recordEntry(currentPath, {
      path: discoveryPath,
      entryType: classifyEntryType(currentStat),
      exclusionReason: "configured-pattern",
      configuredPatternIndex,
      extensionSupport: "not-evaluated",
      candidate: false
    });
    return;
  }

  if (currentStat.isDirectory()) {
    const directoryName = relativePath.split("/").at(-1);

    if (directoryName && SKIPPED_DIRECTORIES.has(directoryName)) {
      recorder?.recordEntry(currentPath, {
        path: discoveryPath,
        entryType: "directory",
        exclusionReason: "scanner-directory",
        extensionSupport: "not-evaluated",
        candidate: false
      });
      return;
    }

    recorder?.recordEntry(currentPath, {
      path: discoveryPath,
      entryType: "directory",
      extensionSupport: "not-evaluated",
      candidate: false
    });

    let entries: string[];
    try {
      entries = fileSystem.readDirectory(currentPath);
    } catch (error) {
      result.fatalFailure = { error };
      recorder?.recordFatalDiagnostic("read-directory", discoveryPath);
      return;
    }

    for (const entry of entries) {
      collectFiles(
        projectRoot,
        join(currentPath, entry),
        excludeMatchers,
        files,
        fileSystem,
        result,
        recorder
      );

      if (result.fatalFailure) {
        return;
      }
    }

    return;
  }

  if (!currentStat.isFile()) {
    recorder?.recordEntry(currentPath, {
      path: discoveryPath,
      entryType: "other",
      extensionSupport: "not-evaluated",
      candidate: false
    });
    return;
  }

  const extensionSupported = SUPPORTED_EXTENSIONS.has(extname(currentPath));

  if (!extensionSupported) {
    recorder?.recordEntry(currentPath, {
      path: discoveryPath,
      entryType: "file",
      extensionSupport: "unsupported",
      candidate: false
    });
    return;
  }

  files.add(currentPath);
  recorder?.recordEntry(currentPath, {
    path: discoveryPath,
    entryType: "file",
    extensionSupport: "supported",
    candidate: true
  });
}

function findExcludedPatternIndex(
  relativePath: string,
  excludeMatchers: Array<(path: string) => boolean>
): number | undefined {
  const index = excludeMatchers.findIndex((matcher) => matcher(relativePath));
  return index === -1 ? undefined : index;
}

function createGlobMatcher(pattern: string): (path: string) => boolean {
  const normalizedPattern = toPosixPath(pattern).replace(/^\/+/, "");

  if (normalizedPattern.endsWith("/**")) {
    const directoryPrefix = normalizedPattern.slice(0, -3);
    return (path) =>
      path === directoryPrefix || path.startsWith(`${directoryPrefix}/`);
  }

  const regex = new RegExp(`^${globToRegex(normalizedPattern)}$`);

  return (path) => regex.test(path);
}

function isInsideRoot(projectRoot: string, absolutePath: string): boolean {
  const relativePath = relative(projectRoot, absolutePath);
  return (
    relativePath === "" ||
    (!relativePath.startsWith("..") && !isAbsolute(relativePath))
  );
}

function toPosixPath(path: string): string {
  return path.replaceAll("\\", "/");
}

function representCurrentPath(
  projectRoot: string,
  currentPath: string
): ReturnType<typeof representNativeDiscoveryPath> {
  return representNativeDiscoveryPath(relative(projectRoot, currentPath));
}

function classifyEntryType(
  stat: ReturnType<DiscoveryFileSystem["lstat"]>
): DiscoveryEntryTypeV1 {
  if (stat.isDirectory()) {
    return "directory";
  }
  if (stat.isFile()) {
    return "file";
  }
  return "other";
}

function sortLegacyFiles(files: Set<string>): string[] {
  return [...files].sort((left, right) => left.localeCompare(right));
}

function globToRegex(pattern: string): string {
  let regex = "";

  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index];
    const nextCharacter = pattern[index + 1];

    if (character === "*" && nextCharacter === "*") {
      regex += ".*";
      index += 1;
      continue;
    }

    if (character === "*") {
      regex += "[^/]*";
      continue;
    }

    regex += escapeRegexCharacter(character);
  }

  return regex;
}

function escapeRegexCharacter(value: string): string {
  return /[.+?^${}()|[\]\\]/.test(value) ? `\\${value}` : value;
}
