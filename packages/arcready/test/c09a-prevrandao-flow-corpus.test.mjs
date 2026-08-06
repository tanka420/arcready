import { describe, expect, it } from "vitest";

import { sourceCases } from "../../../docs/research/fixtures/c09-r2-corpus.mjs";
import { analyzePrevrandaoFlowFile } from "../rules/shared/prevrandao-analysis.ts";

const EXPECTED_SELECTION_OWNERS = new Map([
  ["C09-S01", "bridge-relay"],
  ["C09-S02", "wallet-compatibility"],
  ["C09-S03", "bridge-relay"],
  ["C09-S06", "bridge-relay"],
  ["C09-S08", "bridge-relay"],
  ["C09-A06", "bridge-relay"]
]);

describe("C09A-E2 R3-A collection-selection corpus", () => {
  for (const corpusCase of sourceCases) {
    it(`${corpusCase.id} preserves the reviewed selection boundary`, async () => {
      const [filePath, source] = Object.entries(corpusCase.files)[0];
      const result = await analyzePrevrandaoFlowFile(filePath, source);
      const expectedOwner = EXPECTED_SELECTION_OWNERS.get(corpusCase.id);

      if (expectedOwner === undefined) {
        expect(result.records).toEqual([]);
        return;
      }

      expect(result.status).toBe("analyzed");
      expect(result.records).toHaveLength(1);
      expect(result.records[0]).toMatchObject({
        sourceFile: filePath,
        sinkKind: "collection-selection",
        shellOwner: expectedOwner
      });
      if (corpusCase.id === "C09-A06") {
        expect(result.records[0].sourceOffset).toBe(
          source.lastIndexOf("block.prevrandao")
        );
      }
    });
  }
});
