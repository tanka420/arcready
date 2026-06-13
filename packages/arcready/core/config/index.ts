import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const CONFIG_FILE_NAME = "arcready.config.json";

export type ArcReadyPreset = "wallet" | "app-kit" | "bridge";
export type ArcReadyReporter = "terminal" | "markdown" | "json" | "html";
export type ArcReadyFailLevel = "info" | "warning" | "critical" | "none";
export type ArcReadyRuleLevel = "off" | "info" | "warning" | "critical";

export interface ArcReadyConfig {
  presets: ArcReadyPreset[];
  paths: string[];
  exclude: string[];
  reporters: ArcReadyReporter[];
  failOn: ArcReadyFailLevel;
  rpc: {
    arcTestnetHttp?: string;
    arcTestnetWs?: string;
  };
  rules: Record<string, ArcReadyRuleLevel>;
}

export const DEFAULT_CONFIG: ArcReadyConfig = {
  presets: ["wallet"],
  paths: ["src", "app", "components", "lib", "package.json"],
  exclude: ["dist/**", "coverage/**", ".next/**", "node_modules/**"],
  reporters: ["terminal"],
  failOn: "critical",
  rpc: {},
  rules: {}
};

const PRESETS: readonly ArcReadyPreset[] = ["wallet", "app-kit", "bridge"];
const REPORTERS: readonly ArcReadyReporter[] = [
  "terminal",
  "markdown",
  "json",
  "html"
];
const FAIL_LEVELS: readonly ArcReadyFailLevel[] = [
  "info",
  "warning",
  "critical",
  "none"
];
const RULE_LEVELS: readonly ArcReadyRuleLevel[] = [
  "off",
  "info",
  "warning",
  "critical"
];

export function loadConfig(projectRoot: string): ArcReadyConfig {
  const configPath = join(projectRoot, CONFIG_FILE_NAME);

  if (!existsSync(configPath)) {
    return cloneConfig(DEFAULT_CONFIG);
  }

  let rawConfig: unknown;

  try {
    rawConfig = JSON.parse(readFileSync(configPath, "utf8"));
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "unknown parse error";
    throw new Error(`Invalid ArcReady config at ${configPath}: ${message}`);
  }

  return validateConfig(rawConfig, configPath);
}

const KNOWN_CONFIG_KEYS = new Set([
  "$schema",
  "presets",
  "paths",
  "exclude",
  "reporters",
  "failOn",
  "rpc",
  "rules"
]);

function validateConfig(
  rawConfig: unknown,
  configPath: string
): ArcReadyConfig {
  if (!isRecord(rawConfig)) {
    throwConfigError(configPath, "config must be a JSON object");
  }

  for (const key of Object.keys(rawConfig)) {
    if (!KNOWN_CONFIG_KEYS.has(key)) {
      const known = [...KNOWN_CONFIG_KEYS]
        .filter((k) => k !== "$schema")
        .join(", ");
      throwConfigError(
        configPath,
        `unknown config key "${key}"; expected one of: ${known}`
      );
    }
  }

  const config = rawConfig;

  return {
    presets: readEnumArray(
      config,
      "presets",
      PRESETS,
      DEFAULT_CONFIG.presets,
      configPath
    ),
    paths: readStringArray(config, "paths", DEFAULT_CONFIG.paths, configPath),
    exclude: readStringArray(
      config,
      "exclude",
      DEFAULT_CONFIG.exclude,
      configPath
    ),
    reporters: readEnumArray(
      config,
      "reporters",
      REPORTERS,
      DEFAULT_CONFIG.reporters,
      configPath
    ),
    failOn: readEnum(
      config,
      "failOn",
      FAIL_LEVELS,
      DEFAULT_CONFIG.failOn,
      configPath
    ),
    rpc: readRpc(config, configPath),
    rules: readRules(config, configPath)
  };
}

function readStringArray(
  config: Record<string, unknown>,
  key: string,
  defaultValue: string[],
  configPath: string
): string[] {
  const value = config[key];

  if (value === undefined) {
    return [...defaultValue];
  }

  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throwConfigError(configPath, `${key} must be an array of strings`);
  }

  return [...value];
}

function readEnumArray<T extends string>(
  config: Record<string, unknown>,
  key: string,
  allowedValues: readonly T[],
  defaultValue: T[],
  configPath: string
): T[] {
  const value = config[key];

  if (value === undefined) {
    return [...defaultValue];
  }

  if (!Array.isArray(value)) {
    throwConfigError(
      configPath,
      `${key} must be an array of: ${allowedValues.join(", ")}`
    );
  }

  for (const item of value) {
    if (!isAllowedValue(item, allowedValues)) {
      throwConfigError(
        configPath,
        `${key} contains invalid value "${String(item)}"; expected one of: ${allowedValues.join(", ")}`
      );
    }
  }

  return [...value];
}

function readEnum<T extends string>(
  config: Record<string, unknown>,
  key: string,
  allowedValues: readonly T[],
  defaultValue: T,
  configPath: string
): T {
  const value = config[key];

  if (value === undefined) {
    return defaultValue;
  }

  if (!isAllowedValue(value, allowedValues)) {
    throwConfigError(
      configPath,
      `${key} must be one of: ${allowedValues.join(", ")}`
    );
  }

  return value;
}

function readRpc(
  config: Record<string, unknown>,
  configPath: string
): ArcReadyConfig["rpc"] {
  const value = config.rpc;

  if (value === undefined) {
    return {};
  }

  if (!isRecord(value)) {
    throwConfigError(configPath, "rpc must be an object");
  }

  const rpc: ArcReadyConfig["rpc"] = {};

  if (value.arcTestnetHttp !== undefined) {
    if (typeof value.arcTestnetHttp !== "string") {
      throwConfigError(configPath, "rpc.arcTestnetHttp must be a string");
    }

    rpc.arcTestnetHttp = value.arcTestnetHttp;
  }

  if (value.arcTestnetWs !== undefined) {
    if (typeof value.arcTestnetWs !== "string") {
      throwConfigError(configPath, "rpc.arcTestnetWs must be a string");
    }

    rpc.arcTestnetWs = value.arcTestnetWs;
  }

  return rpc;
}

function readRules(
  config: Record<string, unknown>,
  configPath: string
): ArcReadyConfig["rules"] {
  const value = config.rules;

  if (value === undefined) {
    return {};
  }

  if (!isRecord(value)) {
    throwConfigError(configPath, "rules must be an object");
  }

  const rules: ArcReadyConfig["rules"] = {};

  for (const [ruleId, level] of Object.entries(value)) {
    if (!isAllowedValue(level, RULE_LEVELS)) {
      throwConfigError(
        configPath,
        `rules.${ruleId} must be one of: ${RULE_LEVELS.join(", ")}`
      );
    }

    rules[ruleId] = level;
  }

  return rules;
}

function cloneConfig(config: ArcReadyConfig): ArcReadyConfig {
  return {
    presets: [...config.presets],
    paths: [...config.paths],
    exclude: [...config.exclude],
    reporters: [...config.reporters],
    failOn: config.failOn,
    rpc: { ...config.rpc },
    rules: { ...config.rules }
  };
}

function isAllowedValue<T extends string>(
  value: unknown,
  allowedValues: readonly T[]
): value is T {
  return typeof value === "string" && allowedValues.includes(value as T);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function throwConfigError(configPath: string, message: string): never {
  throw new Error(`Invalid ArcReady config at ${configPath}: ${message}`);
}
