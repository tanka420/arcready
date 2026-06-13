import type { Rule } from "../../core/rules/index.js";
import {
  BRIDGE_DOCS,
  createBridgeFinding,
  isCctpRelated,
  isCommentOrDocumentationLine,
  isGuidanceAgainstUsage,
  readBridgeFiles
} from "./helpers.js";

const SUGGESTED_FIX =
  "Treat CCTP attestation 404 as a retryable pending state while polling, not as a terminal bridge failure.";

export const attestation404NotFatalRule: Rule = {
  id: "bridge/ATTESTATION_404_NOT_FATAL",
  name: "Attestation 404 not fatal",
  description: "Detects fatal 404 handling in CCTP attestation polling.",
  preset: "bridge",
  defaultSeverity: "critical",
  docs: [BRIDGE_DOCS.attestation],
  async run(context) {
    const findings = [];

    for (const { filePath, content } of await readBridgeFiles(context)) {
      if (!isCctpRelated(content)) {
        continue;
      }

      if (hasFatal404AttestationHandling(content)) {
        findings.push(
          createBridgeFinding(
            attestation404NotFatalRule,
            filePath,
            "Arc bridge attestation polling appears to treat HTTP 404 as a fatal error.",
            SUGGESTED_FIX,
            BRIDGE_DOCS.attestation
          )
        );
      }
    }

    return findings;
  }
};

function hasFatal404AttestationHandling(content: string): boolean {
  const activeContent = content
    .split(/\r?\n/)
    .filter(
      (line) =>
        !isCommentOrDocumentationLine(line) &&
        !isGuidanceAgainstUsage(line, /\b404\b/i)
    )
    .join("\n");

  const fatal404Blocks =
    /(response\.status|status)\s*={0,2}\s*={1,2}\s*404[\s\S]{0,180}\b(throw|fatal|failed|error)\b/i.test(
      activeContent
    ) ||
    /\b404\b[\s\S]{0,120}\b(throw|fatal|failed|error)\b/i.test(activeContent);

  if (!fatal404Blocks) {
    return false;
  }

  const hasPendingHandlingNear404 =
    /\b404\b[\s\S]{0,220}\b(retry|pending|not ready|processing|continue)\b/i.test(
      activeContent
    ) ||
    /\b(retry|pending|not ready|processing|continue)\b[\s\S]{0,220}\b404\b/i.test(
      activeContent
    );

  return !hasPendingHandlingNear404;
}
