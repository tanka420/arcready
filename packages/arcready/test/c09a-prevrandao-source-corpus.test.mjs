import { describe, expect, it } from "vitest";

import { sourceCases } from "../../../docs/research/fixtures/c09-r2-corpus.mjs";
import { analyzePrevrandaoSourceFile } from "../rules/shared/prevrandao-analysis.ts";

const BINDING_REJECTIONS = new Set([
  "C09-U01",
  "C09-U02",
  "C09-U03",
  "C09-A04",
  "C09-A05"
]);

const EXPECTED_SOURCE_COUNTS = new Map([
  ...sourceCases
    .filter(
      ({ id, expected }) =>
        expected.sourceClass === "direct-prevrandao" &&
        !BINDING_REJECTIONS.has(id)
    )
    .map(({ id }) => [id, id === "C09-A06" ? 2 : 1]),
  ["C09-S06", 1]
]);

describe("C09A-E1 R3-A source corpus", () => {
  for (const corpusCase of sourceCases) {
    it(`${corpusCase.id} preserves the reviewed source boundary`, async () => {
      const [filePath, source] = Object.entries(corpusCase.files)[0];
      const result = await analyzePrevrandaoSourceFile(filePath, source);
      const expectedCount = EXPECTED_SOURCE_COUNTS.get(corpusCase.id);

      if (expectedCount !== undefined) {
        expect(result.status).toBe("analyzed");
        expect(result.sources).toHaveLength(expectedCount);
        expect(result.sources.map(({ sourceOffset }) => sourceOffset)).toEqual(
          [...result.sources.map(({ sourceOffset }) => sourceOffset)].sort(
            (left, right) => left - right
          )
        );
        for (const record of result.sources) {
          expect(record.sourceFile).toBe(filePath);
          expect(record.contractName).not.toBe("");
          expect(record.functionName).not.toBe("");
          if (corpusCase.expected.sourceClass === "assembly-prevrandao") {
            expect(record.sourceKind).toBe("inline-assembly-prevrandao");
          } else {
            expect(record.sourceKind).toMatch(/^block-prevrandao/);
          }
        }
        return;
      }

      expect(result.sources).toEqual([]);
      if (BINDING_REJECTIONS.has(corpusCase.id)) {
        expect(result.status).toBe("unsupported-source");
      }
    });
  }
});
