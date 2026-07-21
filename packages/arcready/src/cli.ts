import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  loadConfig,
  type ArcReadyFailLevel
} from "../core/config/index.js";
import type { ScanResultV2 } from "../core/contracts/v2/model.js";
import type { ScanSummary } from "../core/findings/index.js";
import { runInternalScanV2 } from "../core/scan-v2/index.js";
import { getReporter } from "../reporters/index.js";
import type { ReporterFormat } from "../reporters/index.js";
import { runScan } from "./report.js";

export interface CliIo {
  cwd: string;
  stdout: Pick<NodeJS.WriteStream, "write">;
  stderr: Pick<NodeJS.WriteStream, "write">;
}

const FAIL_LEVELS: readonly ArcReadyFailLevel[] = [
  "critical",
  "warning",
  "info",
  "none"
];

const HELP_TEXT = `ArcReady

Usage:
  arcready <command>

Commands:
  arcready init        Create a minimal ArcReady config file
  arcready scan        Run ArcReady scan
  arcready help        Show this help message

Options:
  --format <format>    Render scan as terminal, json, markdown, or html
  --out <path>         Write scan output to a file
  --fail-on <level>    Override config failOn: critical, warning, info, or none
  --json-v2           Emit experimental canonical ScanResultV2 JSON to stdout
  -h, --help           Show this help message
`;

const JSON_V2_OPTION_CONFLICT =
  "--json-v2 cannot be combined with --format, --out, or --fail-on";
const JSON_V2_CONFIG_ERROR =
  "ArcReady json-v2 error: invalid configuration.\n";
const JSON_V2_PRODUCTION_ERROR =
  "ArcReady json-v2 error: unable to produce canonical scan output.\n";
const JSON_V2_WRITE_ERROR =
  "ArcReady json-v2 error: unable to write canonical scan output.\n";

export async function runCli(argv: string[], io: CliIo): Promise<number> {
  const [command] = argv;

  if (
    !command ||
    command === "help" ||
    command === "--help" ||
    command === "-h"
  ) {
    io.stdout.write(HELP_TEXT);
    return 0;
  }

  if (command === "init") {
    return runInit(io);
  }

  if (command === "scan") {
    let scanOptions: ScanOptions;

    try {
      scanOptions = parseScanOptions(argv.slice(1));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      io.stderr.write(`${message}\n`);
      return 1;
    }

    if (scanOptions.jsonV2) {
      return runJsonV2(io);
    }

    let report: Awaited<ReturnType<typeof runScan>>["report"];
    let config: Awaited<ReturnType<typeof runScan>>["config"];

    try {
      ({ report, config } = await runScan(io.cwd));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      io.stderr.write(`ArcReady error: ${message}\n`);
      return 2;
    }

    const reporter = getReporter(scanOptions.format);
    const renderedReport = reporter.render(report);

    if (scanOptions.out) {
      const outputPath = join(io.cwd, scanOptions.out);
      mkdirSync(dirname(outputPath), { recursive: true });
      writeFileSync(outputPath, renderedReport);
    } else {
      io.stdout.write(renderedReport);
    }

    const failOn = scanOptions.failOn ?? config.failOn;
    return shouldFail(report.summary, failOn) ? 1 : 0;
  }

  io.stderr.write(`Unknown command: ${command}\n\n${HELP_TEXT}`);
  return 1;
}

interface ScanOptions {
  format: "terminal" | "json" | "markdown" | "html";
  jsonV2: boolean;
  out?: string;
  failOn?: ArcReadyFailLevel;
}

export interface ScanOptionPresence {
  readonly jsonV2: boolean;
  readonly format: boolean;
  readonly out: boolean;
  readonly failOn: boolean;
}

function parseScanOptions(argv: string[]): ScanOptions {
  const presence = inspectScanOptionPresence(argv);
  if (presence.jsonV2 && (presence.format || presence.out || presence.failOn)) {
    throw new Error(JSON_V2_OPTION_CONFLICT);
  }

  const options: ScanOptions = {
    format: "terminal",
    jsonV2: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--format") {
      const value = argv[index + 1];

      if (!isImplementedFormat(value)) {
        throw new Error("--format must be terminal, json, markdown, or html");
      }

      options.format = value;
      index += 1;
      continue;
    }

    if (arg === "--json-v2") {
      options.jsonV2 = true;
      continue;
    }

    if (arg === "--out") {
      const value = argv[index + 1];

      if (!value) {
        throw new Error("--out requires a file path");
      }

      options.out = value;
      index += 1;
      continue;
    }

    if (arg === "--fail-on") {
      const value = argv[index + 1];

      if (!isFailLevel(value)) {
        throw new Error(
          "--fail-on must be critical, warning, info, or none"
        );
      }

      options.failOn = value;
      index += 1;
      continue;
    }

    throw new Error(`Unknown scan option: ${arg}`);
  }

  return options;
}

export function inspectScanOptionPresence(
  argv: readonly string[]
): ScanOptionPresence {
  const presence = {
    jsonV2: false,
    format: false,
    out: false,
    failOn: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--json-v2") {
      presence.jsonV2 = true;
      continue;
    }

    if (arg === "--format" || arg === "--out" || arg === "--fail-on") {
      if (arg === "--format") presence.format = true;
      if (arg === "--out") presence.out = true;
      if (arg === "--fail-on") presence.failOn = true;
      if (argv[index + 1] !== undefined) index += 1;
    }
  }

  return presence;
}

async function runJsonV2(io: CliIo): Promise<number> {
  let config: ReturnType<typeof loadConfig>;

  try {
    config = loadConfig(io.cwd);
  } catch {
    io.stderr.write(JSON_V2_CONFIG_ERROR);
    return 2;
  }

  let output: string;

  try {
    const scanResult = await runInternalScanV2({
      projectRoot: io.cwd,
      config
    });
    output = serializeScanResultV2(scanResult);
  } catch {
    io.stderr.write(JSON_V2_PRODUCTION_ERROR);
    return 2;
  }

  try {
    io.stdout.write(output);
  } catch {
    io.stderr.write(JSON_V2_WRITE_ERROR);
    return 2;
  }

  return 0;
}

function serializeScanResultV2(scanResult: ScanResultV2): string {
  return `${JSON.stringify(scanResult, null, 2)}\n`;
}

function isImplementedFormat(value: unknown): value is ScanOptions["format"] {
  const implementedFormats: ReporterFormat[] = [
    "terminal",
    "json",
    "markdown",
    "html"
  ];
  return (
    typeof value === "string" &&
    implementedFormats.includes(value as ReporterFormat)
  );
}

function isFailLevel(value: unknown): value is ArcReadyFailLevel {
  return typeof value === "string" && FAIL_LEVELS.includes(value as ArcReadyFailLevel);
}

function shouldFail(summary: ScanSummary, failOn: ArcReadyFailLevel): boolean {
  if (failOn === "none") return false;
  if (summary.critical > 0) return true;
  if (failOn === "critical") return false;
  if (summary.warning > 0) return true;
  if (failOn === "warning") return false;
  return summary.info > 0;
}

function runInit(io: CliIo): number {
  const configPath = join(io.cwd, "arcready.config.json");

  if (!existsSync(configPath)) {
    writeFileSync(
      configPath,
      `${JSON.stringify(
        {
          $schema: "https://arcready.dev/config.schema.json",
          presets: ["wallet"]
        },
        null,
        2
      )}\n`
    );
  }

  io.stdout.write(`ArcReady config ready: ${configPath}\n`);
  return 0;
}
