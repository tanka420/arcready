import type { ScanReport } from "../core/findings/index.js";
import { htmlReporter } from "./html/index.js";
import { jsonReporter } from "./json/index.js";
import { markdownReporter } from "./markdown/index.js";
import { terminalReporter } from "./terminal/index.js";

export type ReporterFormat = "terminal" | "json" | "markdown" | "html";

export interface Reporter {
  format: ReporterFormat;
  render(report: ScanReport): string;
}

export function getReporter(format: ReporterFormat): Reporter {
  if (format === "terminal") {
    return terminalReporter;
  }

  if (format === "json") {
    return jsonReporter;
  }

  if (format === "markdown") {
    return markdownReporter;
  }

  if (format === "html") {
    return htmlReporter;
  }

  throw new Error(`Reporter format "${format}" is not implemented yet.`);
}
