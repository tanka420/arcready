import type { Rule } from "../../core/rules/index.js";
import {
  createPrevrandaoCompatibilityFinding,
  requestPrevrandaoCompatibilityRecords
} from "../shared/prevrandao-compatibility-finding.js";
import { BRIDGE_DOCS } from "./helpers.js";

export const noPrevrandaoRelaySelectionRule: Rule = {
  id: "bridge/NO_PREVRANDAO_RELAY_SELECTION",
  name: "No PREVRANDAO relay selection",
  description:
    "Detects supported PREVRANDAO relay behavior in Foundry-associated Arc contracts.",
  preset: "bridge",
  defaultSeverity: "critical",
  docs: [BRIDGE_DOCS.prevrandao],
  async run(context) {
    const records = await requestPrevrandaoCompatibilityRecords(context);
    return records
      .filter((record) => record.shellOwner === "bridge-relay")
      .map((record) =>
        createPrevrandaoCompatibilityFinding(
          noPrevrandaoRelaySelectionRule,
          record
        )
      );
  }
};
