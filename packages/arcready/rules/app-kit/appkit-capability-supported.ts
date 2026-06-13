import type { Rule } from "../../core/rules/index.js";
import {
  APP_KIT_DOCS,
  createAppKitFinding,
  isAppKitRelated,
  isArcRelated,
  readAppKitFiles
} from "./helpers.js";

const SUGGESTED_FIX =
  "Check App Kit supported capabilities for the selected chain and guard unsupported capability paths before calling them.";

export const appKitCapabilitySupportedRule: Rule = {
  id: "app-kit/APPKIT_CAPABILITY_SUPPORTED",
  name: "App Kit capability supported",
  description:
    "Detects unguarded App Kit capability assumptions for Arc integrations.",
  preset: "app-kit",
  defaultSeverity: "warning",
  docs: [APP_KIT_DOCS.capabilities],
  async run(context) {
    const findings = [];

    for (const { filePath, content } of await readAppKitFiles(context)) {
      if (!isAppKitRelated(content) || !isArcRelated(content)) {
        continue;
      }

      if (hasCapabilityCall(content) && !hasCapabilityGuard(content)) {
        findings.push(
          createAppKitFinding(
            appKitCapabilitySupportedRule,
            filePath,
            "App Kit Arc capability usage appears to be unguarded.",
            SUGGESTED_FIX,
            APP_KIT_DOCS.capabilities
          )
        );
      }
    }

    return findings;
  }
};

function hasCapabilityCall(content: string): boolean {
  return /\b(send|bridge|swap|unifiedBalance)\s*\(/i.test(content);
}

function hasCapabilityGuard(content: string): boolean {
  return (
    /\bcapabilities\.includes\s*\(/.test(content) ||
    /\bisCapabilitySupported\s*\(/.test(content) ||
    /\bsupportedCapabilities\b/i.test(content) ||
    /\btry\s*{[\s\S]{0,600}\b(send|bridge|swap|unifiedBalance)\s*\(/i.test(
      content
    )
  );
}
