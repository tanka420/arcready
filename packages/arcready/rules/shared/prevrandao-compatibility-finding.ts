import { resolve } from "node:path";
import type { Finding } from "../../core/findings/index.js";
import type { Rule, RuleContext } from "../../core/rules/index.js";
import {
  requestPrevrandaoEligibleRecords,
  type PrevrandaoEligibleRecord
} from "./prevrandao-analysis.js";

const SINK_LABELS = {
  authorization: "authorization decision",
  "collection-selection": "collection selection",
  ordering: "ordering decision"
} as const satisfies Record<PrevrandaoEligibleRecord["sinkKind"], string>;

export function requestPrevrandaoCompatibilityRecords(context: RuleContext) {
  return requestPrevrandaoEligibleRecords({
    ...context,
    projectRoot: resolve(context.projectRoot)
  });
}

export function createPrevrandaoCompatibilityFinding(
  rule: Rule,
  record: PrevrandaoEligibleRecord
): Finding {
  const sinkLabel = SINK_LABELS[record.sinkKind];
  const identity = `${record.contractName}.${record.functionName}`;

  return {
    ruleId: rule.id,
    severity: rule.defaultSeverity,
    message:
      `Static source analysis ties ${identity} to a PREVRANDAO-dependent ${sinkLabel}. ` +
      `Foundry artifact ${record.foundryArtifactPath} associates that exact concrete contract name and address ${record.contractAddress} with Arc Testnet (chain ${record.chainId}), where PREVRANDAO returns zero. ` +
      "This is static artifact evidence, not live deployment, bytecode, runtime, or transaction-success verification.",
    files: [record.sourceFile],
    suggestedFix:
      `Replace the PREVRANDAO-dependent ${sinkLabel} in ${identity} with deterministic logic or an external randomness source appropriate to the application. ` +
      "Verify the actual deployment and runtime behavior independently.",
    docs: rule.docs[0],
    preset: rule.preset
  };
}
