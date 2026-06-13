import { existsSync, lstatSync, readdirSync } from "node:fs";
import { extname, isAbsolute, join, relative, resolve } from "node:path";

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
  const projectRoot = resolve(options.projectRoot);
  const excludeMatchers = options.exclude.map((pattern) =>
    createGlobMatcher(pattern)
  );
  const files = new Set<string>();

  for (const includePath of options.paths) {
    const absolutePath = resolve(projectRoot, includePath);

    if (!isInsideRoot(projectRoot, absolutePath) || !existsSync(absolutePath)) {
      continue;
    }

    collectFiles(projectRoot, absolutePath, excludeMatchers, files);
  }

  return [...files].sort((left, right) => left.localeCompare(right));
}

function collectFiles(
  projectRoot: string,
  currentPath: string,
  excludeMatchers: Array<(path: string) => boolean>,
  files: Set<string>
): void {
  const currentStat = lstatSync(currentPath);

  if (currentStat.isSymbolicLink()) {
    return;
  }

  const relativePath = toPosixPath(relative(projectRoot, currentPath));

  if (relativePath && isExcluded(relativePath, excludeMatchers)) {
    return;
  }

  if (currentStat.isDirectory()) {
    const directoryName = toPosixPath(relative(projectRoot, currentPath))
      .split("/")
      .at(-1);

    if (directoryName && SKIPPED_DIRECTORIES.has(directoryName)) {
      return;
    }

    for (const entry of readdirSync(currentPath)) {
      collectFiles(
        projectRoot,
        join(currentPath, entry),
        excludeMatchers,
        files
      );
    }

    return;
  }

  if (
    !currentStat.isFile() ||
    !SUPPORTED_EXTENSIONS.has(extname(currentPath))
  ) {
    return;
  }

  files.add(currentPath);
}

function isExcluded(
  relativePath: string,
  excludeMatchers: Array<(path: string) => boolean>
): boolean {
  return excludeMatchers.some((matcher) => matcher(relativePath));
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
