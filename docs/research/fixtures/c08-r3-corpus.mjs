import { C08_R2_CASES } from "./c08-r2-corpus.mjs";

export const C08_R3_ERRATA = Object.freeze([
  Object.freeze({
    id: "R2-X25",
    reason: "optional-semicolon-is-valid",
    explanation:
      "R2-X25 removed only an optional semicolon, which remains valid through automatic semicolon insertion. R3 appends an unmatched parenthesis to exercise an actual parse failure."
  })
]);

const ERRATA_BY_ID = new Map(C08_R3_ERRATA.map((entry) => [entry.id, entry]));

export const C08_R3_CASES = Object.freeze(
  C08_R2_CASES.map((entry) => {
    const erratum = ERRATA_BY_ID.get(entry.id);
    if (erratum === undefined) return entry;
    return Object.freeze({
      ...entry,
      source: `${entry.source}(`,
      note: `${entry.note} R3 erratum: ${erratum.explanation}`
    });
  })
);

const corrected = C08_R3_CASES.filter(
  (entry, index) => entry.source !== C08_R2_CASES[index].source
);

if (corrected.length !== 1 || corrected[0].id !== "R2-X25") {
  throw new Error("C08-R3 corpus errata drift");
}
