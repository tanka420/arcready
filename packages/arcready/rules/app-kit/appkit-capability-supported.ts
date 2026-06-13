import type { Rule } from "../../core/rules/index.js";
import {
  APP_KIT_DOCS,
  createAppKitFinding,
  getActiveContent,
  isAppKitRelated,
  isArcRelated,
  readAppKitFiles
} from "./helpers.js";

const SUGGESTED_FIX =
  "Check supported App Kit capabilities for Arc_Testnet and guard send, bridge, swap, or Unified Balance paths before calling them.";

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
            "App Kit Arc capability call appears to run without a supported-capability guard.",
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
  const activeContent = getActiveContent(
    content,
    /\b(send|bridge|swap|unifiedBalance|capabilit(?:y|ies))\b/i
  );

  return (
    /\b(?:appKit\.)?(send|bridge|swap)\s*\(/i.test(activeContent) ||
    /\bappKit\.unifiedBalance\b/i.test(activeContent)
  );
}

function hasCapabilityGuard(content: string): boolean {
  const activeContent = getActiveContent(content);

  return (
    /\bcapabilities\.includes\s*\(/.test(activeContent) ||
    /\bisCapabilitySupported\s*\(/.test(activeContent) ||
    /\bsupportedCapabilities\b/i.test(activeContent) ||
    /\btry\s*{[\s\S]{0,600}\b(send|bridge|swap|unifiedBalance)\s*\(/i.test(
      activeContent
    )
  );
}
