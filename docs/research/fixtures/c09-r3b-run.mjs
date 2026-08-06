import process from "node:process";
import { projectCases } from "./c09-r2-corpus.mjs";
import { classifyFoundryArcAssociation } from "./c09-r3b-foundry-prototype.mjs";

const EXPECTED = new Map([
  ["C09-P01", "arc-foundry"],
  ["C09-P02", "non-arc"],
  ["C09-P03", "ambiguous"],
  ["C09-P04", "conflict"],
  ["C09-P05", "unknown"],
  ["C09-P06", "unknown"],
  ["C09-P07", "ambiguous"],
  ["C09-P08", "unknown"],
  ["C09-P09", "unknown"],
  ["C09-P10", "unknown"],
  ["C09-P11", "unknown"],
  ["C09-P12", "unsupported-adapter"],
  ["C09-P13", "unsupported-adapter"],
  ["C09-P14", "unsupported-adapter"],
  ["C09-P15", "unsupported-adapter"],
  ["C09-P16", "unsupported-adapter"]
]);

function run() {
  const results = [];
  const failures = [];

  for (const projectCase of projectCases) {
    const expected = EXPECTED.get(projectCase.id);
    if (!expected) {
      failures.push(`${projectCase.id}: missing R3-B expected adapter status`);
      continue;
    }

    const actual = classifyFoundryArcAssociation(projectCase);
    results.push({
      id: projectCase.id,
      expected,
      actual: actual.status,
      foundryVersion: actual.foundryVersion,
      reason: actual.reason
    });

    if (actual.status !== expected) {
      failures.push(
        `${projectCase.id}: expected ${expected}, received ${actual.status}`
      );
    }
  }

  if (results.length !== 16) {
    failures.push(`expected 16 project results, received ${results.length}`);
  }

  const counts = Object.fromEntries(
    [...new Set(results.map((result) => result.actual))]
      .sort()
      .map((status) => [
        status,
        results.filter((result) => result.actual === status).length
      ])
  );

  const summary = {
    total: results.length,
    matched: results.filter((result) => result.expected === result.actual).length,
    counts,
    failures,
    results
  };

  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);

  if (failures.length > 0) {
    process.exitCode = 1;
  }
}

run();
