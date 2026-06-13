import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { runScan } from "../packages/arcready/src/index.js";
import type { FindingStatus } from "../packages/arcready/src/index.js";

export interface FixtureExpectation {
  name: string;
  shouldPass: boolean;
}

export interface FixtureValidationResult {
  fixture: string;
  status: FindingStatus | "error";
  score: number;
  critical: number;
  warning: number;
  info: number;
  findings: number;
  expected: "pass" | "findings";
  matched: boolean;
  error?: string;
}

export const FIXTURES: FixtureExpectation[] = [
  { name: "wallet-good", shouldPass: true },
  { name: "wallet-bad", shouldPass: false },
  { name: "bridge-good", shouldPass: true },
  { name: "bridge-bad", shouldPass: false },
  { name: "app-kit-good", shouldPass: true },
  { name: "app-kit-bad", shouldPass: false }
];

export async function runFixtureDemo(
  repoRoot = process.cwd()
): Promise<FixtureValidationResult[]> {
  const results: FixtureValidationResult[] = [];

  for (const fixture of FIXTURES) {
    results.push(await scanFixture(repoRoot, fixture));
  }

  return results;
}

export function fixtureMatchesExpectation(
  result: FixtureValidationResult
): boolean {
  if (result.expected === "pass") {
    return result.status === "pass" && result.findings === 0;
  }

  return result.findings > 0;
}

export function renderSummary(results: FixtureValidationResult[]): string {
  const rows = [
    [
      "Fixture",
      "Status",
      "Score",
      "Critical",
      "Warning",
      "Info",
      "Findings",
      "Expected",
      "Result"
    ],
    ...results.map((result) => [
      result.fixture,
      result.status,
      String(result.score),
      String(result.critical),
      String(result.warning),
      String(result.info),
      String(result.findings),
      result.expected,
      result.matched ? "OK" : "UNEXPECTED"
    ])
  ];
  const widths = rows[0].map((_, columnIndex) =>
    Math.max(...rows.map((row) => row[columnIndex].length))
  );

  return rows
    .map((row) =>
      row
        .map((cell, columnIndex) => cell.padEnd(widths[columnIndex]))
        .join("   ")
    )
    .join("\n");
}

async function scanFixture(
  repoRoot: string,
  fixture: FixtureExpectation
): Promise<FixtureValidationResult> {
  const expected = fixture.shouldPass ? "pass" : "findings";

  try {
    const { report } = await runScan(join(repoRoot, "fixtures", fixture.name));
    const result: FixtureValidationResult = {
      fixture: fixture.name,
      status: report.status,
      score: report.score,
      critical: report.summary.critical,
      warning: report.summary.warning,
      info: report.summary.info,
      findings: report.findings.length,
      expected,
      matched: false
    };

    return {
      ...result,
      matched: fixtureMatchesExpectation(result)
    };
  } catch (error) {
    return {
      fixture: fixture.name,
      status: "error",
      score: 0,
      critical: 0,
      warning: 0,
      info: 0,
      findings: 0,
      expected,
      matched: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

async function main(): Promise<number> {
  try {
    const results = await runFixtureDemo();
    const passed = results.every((result) => result.matched);

    console.log("ArcReady Fixture Validation\n");
    console.log(renderSummary(results));

    for (const result of results) {
      if (result.error) {
        console.log(`\n${result.fixture}: ${result.error}`);
      }
    }

    console.log(`\nResult: ${passed ? "PASS" : "FAIL"}`);
    return passed ? 0 : 1;
  } catch (error) {
    console.error(
      `ArcReady Fixture Validation setup error: ${error instanceof Error ? error.message : String(error)}`
    );
    return 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
    .then((exitCode) => {
      process.exitCode = exitCode;
    })
    .catch((error: unknown) => {
      console.error(
        `ArcReady Fixture Validation setup error: ${error instanceof Error ? error.message : String(error)}`
      );
      process.exitCode = 2;
    });
}
