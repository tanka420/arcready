import type { Rule } from "../../core/rules/index.js";
import {
  APP_KIT_DOCS,
  createAppKitFinding,
  isAppKitRelated,
  readAppKitFiles
} from "./helpers.js";

const SUGGESTED_FIX =
  "Use the case-sensitive App Kit chain identifier Arc_Testnet.";

export const appKitChainIdentifierValidRule: Rule = {
  id: "app-kit/APPKIT_CHAIN_IDENTIFIER_VALID",
  name: "App Kit chain identifier valid",
  description: "Detects invalid Arc chain identifiers in App Kit integrations.",
  preset: "app-kit",
  defaultSeverity: "critical",
  docs: [APP_KIT_DOCS.chainIdentifier],
  async run(context) {
    const findings = [];

    for (const { filePath, content } of await readAppKitFiles(context)) {
      if (!isAppKitRelated(content)) {
        continue;
      }

      if (hasInvalidArcIdentifier(content)) {
        findings.push(
          createAppKitFinding(
            appKitChainIdentifierValidRule,
            filePath,
            "App Kit Arc chain identifier appears to be invalid.",
            SUGGESTED_FIX,
            APP_KIT_DOCS.chainIdentifier
          )
        );
      }
    }

    return findings;
  }
};

function hasInvalidArcIdentifier(content: string): boolean {
  return /["'`](Arc|arc|ARC|ArcTestnet|arc_testnet|arc-testnet|Arc Testnet)["'`]/.test(
    content
  );
}
