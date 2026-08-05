import { describe, expect, it } from "vitest";

import { C08_R2_CASES } from "../../../docs/research/fixtures/c08-r2-corpus.mjs";
import { classifyC08R3Source } from "./c08-r3-attestation-prototype.mjs";

function filePathFor(caseId) {
  if (caseId === "R2-S08") return "fixture.js";
  if (caseId === "R2-X26") return "fixture.tsx";
  return "fixture.ts";
}

describe("C08-R3 disposable control-flow prototype", () => {
  it.each(C08_R2_CASES)(
    "$id matches the pinned C08-R2 classification",
    (entry) => {
      const actual = classifyC08R3Source(filePathFor(entry.id), entry.source);

      expect(actual.controlFlowClass).toBe(entry.controlFlowClass);
      expect(actual.publicFindingEligibility).toBe(
        entry.publicFindingEligibility
      );
    }
  );

  it("keeps every unsafe control-flow candidate blocked from public emission", () => {
    const unsafeResults = C08_R2_CASES.filter(
      (entry) => entry.controlFlowClass === "unsafe-candidate"
    ).map((entry) =>
      classifyC08R3Source(filePathFor(entry.id), entry.source)
    );

    expect(unsafeResults).toHaveLength(11);
    expect(
      unsafeResults.every(
        (entry) =>
          entry.publicFindingEligibility === "blocked-unvalidated-burn"
      )
    ).toBe(true);
  });
});
