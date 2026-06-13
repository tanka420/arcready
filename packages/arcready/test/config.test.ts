import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CONFIG_FILE_NAME, DEFAULT_CONFIG, loadConfig } from "../src/index.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("loadConfig", () => {
  it("returns default config when no config file exists", () => {
    const projectRoot = createTempProject();

    expect(loadConfig(projectRoot)).toEqual(DEFAULT_CONFIG);
  });

  it("loads a valid config file", () => {
    const projectRoot = createTempProject({
      presets: ["wallet", "app-kit", "bridge"],
      paths: ["src", "package.json"],
      exclude: ["dist/**"],
      reporters: ["terminal", "json"],
      failOn: "warning",
      rpc: {
        arcTestnetHttp: "https://rpc.example",
        arcTestnetWs: "wss://rpc.example"
      },
      rules: {
        "wallet/example": "critical",
        "bridge/example": "off"
      }
    });

    expect(loadConfig(projectRoot)).toEqual({
      presets: ["wallet", "app-kit", "bridge"],
      paths: ["src", "package.json"],
      exclude: ["dist/**"],
      reporters: ["terminal", "json"],
      failOn: "warning",
      rpc: {
        arcTestnetHttp: "https://rpc.example",
        arcTestnetWs: "wss://rpc.example"
      },
      rules: {
        "wallet/example": "critical",
        "bridge/example": "off"
      }
    });
  });

  it("throws a clear error for invalid config", () => {
    const projectRoot = createTempProject({
      presets: ["wallet", "not-a-preset"]
    });

    expect(() => loadConfig(projectRoot)).toThrow(
      /Invalid ArcReady config.*presets contains invalid value "not-a-preset"/
    );
  });
});

function createTempProject(config?: unknown): string {
  const projectRoot = mkdtempSync(join(tmpdir(), "arcready-config-"));
  tempDirs.push(projectRoot);

  if (config !== undefined) {
    writeFileSync(
      join(projectRoot, CONFIG_FILE_NAME),
      `${JSON.stringify(config, null, 2)}\n`
    );
  }

  return projectRoot;
}
