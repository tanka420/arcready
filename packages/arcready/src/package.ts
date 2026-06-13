import { readFileSync } from "node:fs";

interface PackageMetadata {
  version: string;
}

const packageJsonUrl = new URL("../package.json", import.meta.url);

export const PACKAGE_VERSION = readPackageVersion();

function readPackageVersion(): string {
  const metadata = JSON.parse(
    readFileSync(packageJsonUrl, "utf8")
  ) as PackageMetadata;

  return metadata.version;
}
