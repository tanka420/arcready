import { describe, expect, it } from "vitest";

import { sourceCases } from "../../../docs/research/fixtures/c09-r2-corpus.mjs";
import { analyzePrevrandaoFlowFile } from "../rules/shared/prevrandao-analysis.ts";

const EXPECTED_FLOWS = new Map([
  ["C09-S01", ["collection-selection", "bridge-relay"]],
  ["C09-S02", ["collection-selection", "wallet-compatibility"]],
  ["C09-S03", ["collection-selection", "bridge-relay"]],
  ["C09-S04", ["authorization", "wallet-compatibility"]],
  ["C09-S06", ["collection-selection", "bridge-relay"]],
  ["C09-S08", ["collection-selection", "bridge-relay"]],
  ["C09-A06", ["collection-selection", "bridge-relay"]]
]);

describe("C09A-E2 R3-A private flow corpus", () => {
  for (const corpusCase of sourceCases) {
    it(`${corpusCase.id} preserves the reviewed flow boundary`, async () => {
      const [filePath, source] = Object.entries(corpusCase.files)[0];
      const result = await analyzePrevrandaoFlowFile(filePath, source);
      const expected = EXPECTED_FLOWS.get(corpusCase.id);

      if (expected === undefined) {
        expect(result.records).toEqual([]);
        return;
      }

      expect(result.status).toBe("analyzed");
      expect(result.records).toHaveLength(1);
      expect(result.records[0]).toMatchObject({
        sourceFile: filePath,
        sinkKind: expected[0],
        shellOwner: expected[1]
      });
      if (corpusCase.id === "C09-A06") {
        expect(result.records[0].sourceOffset).toBe(
          source.lastIndexOf("block.prevrandao")
        );
      }
    });
  }
});
