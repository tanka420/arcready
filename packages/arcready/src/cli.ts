import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ArcReadyFailLevel } from "../core/config/index.js";
import type { ScanSummary } from "../core/findings/index.js";
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
  -h, --help           Show this help message
`;

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
  out?: string;
  failOn?: ArcReadyFailLevel;
}

function parseScanOptions(argv: string[]): ScanOptions {
  const options: ScanOptions = {
    format: "terminal"
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
