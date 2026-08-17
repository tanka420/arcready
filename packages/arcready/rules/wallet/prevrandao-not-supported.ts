import type { Rule } from "../../core/rules/index.js";
import {
  createPrevrandaoCompatibilityFinding,
  requestPrevrandaoCompatibilityRecords
} from "../shared/prevrandao-compatibility-finding.js";
import { WALLET_DOCS } from "./helpers.js";

export const prevrandaoNotSupportedRule: Rule = {
  id: "wallet/PREVRANDAO_NOT_SUPPORTED",
  name: "PREVRANDAO not supported",
  description:
    "Detects supported PREVRANDAO behavior dependencies in Foundry-associated Arc contracts.",
  preset: "wallet",
  defaultSeverity: "critical",
  docs: [WALLET_DOCS.prevrandao],
  async run(context) {
    const records = await requestPrevrandaoCompatibilityRecords(context);
    return records
      .filter((record) => record.shellOwner === "wallet-compatibility")
      .map((record) =>
        createPrevrandaoCompatibilityFinding(prevrandaoNotSupportedRule, record)
      );
  }
};
