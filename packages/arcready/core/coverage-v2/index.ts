import {
  ARCREADY_CONTRACT_VERSION,
  type CoverageV2,
  type DiscoveryCoverageV2,
  type ObservedRuleReadEvidenceV2,
  type RuleExecutionCoverageV2,
  type ScanScopeV2
} from "../contracts/v2/model.js";
import { validateCoverageV2 } from "../contracts/v2/validate.js";
import type { DiscoveryInstrumentationV1 } from "../fs/instrumentation.js";
import type { RuleExecutionInstrumentationV1 } from "../rules/instrumentation.js";

export interface DeriveCoverageV2Input {
  discovery: DiscoveryInstrumentationV1;
  ruleExecution: RuleExecutionInstrumentationV1;
}

export function deriveCoverageV2({
  discovery,
  ruleExecution
}: DeriveCoverageV2Input): CoverageV2 {
  const scope = deriveScope(discovery);
  const coverage: CoverageV2 = {
    contractVersion: ARCREADY_CONTRACT_VERSION,
    scope,
    discovery: deriveDiscoveryCoverage(discovery, scope),
    ruleExecution: deriveRuleExecutionCoverage(ruleExecution),
    analysis: {
      state: "unknown",
      applicability: "unknown",
      reason: "analysis-acknowledgements-unavailable"
    },
    evidence: {
      ruleContextReads: deriveReadEvidence(ruleExecution)
    }
  };

  validateCoverageV2(coverage);
  return coverage;
}

function deriveScope(discovery: DiscoveryInstrumentationV1): ScanScopeV2 {
  let acceptedRootOutcomes = 0;
  let unavailableRootOutcomes = 0;
  let outsideProjectRootOutcomes = 0;

  for (const root of discovery.roots) {
    switch (root.disposition) {
      case "accepted":
        acceptedRootOutcomes += 1;
        break;
      case "unavailable":
        unavailableRootOutcomes += 1;
        break;
      case "outside-project-root":
        outsideProjectRootOutcomes += 1;
        break;
    }
  }

  let excludedEntries = 0;
  let extensionSupportedRegularFiles = 0;
  let extensionUnsupportedRegularFiles = 0;
  let candidateFiles = 0;
  let unrepresentableEntries = 0;

  for (const entry of discovery.entries) {
    if (entry.exclusionReason !== undefined) {
      excludedEntries += 1;
    }
    if (entry.entryType === "file") {
      if (entry.extensionSupport === "supported") {
        extensionSupportedRegularFiles += 1;
      } else if (entry.extensionSupport === "unsupported") {
        extensionUnsupportedRegularFiles += 1;
      }
    }
    if (entry.candidate) {
      candidateFiles += 1;
    }
    if (entry.path.kind === "unrepresentable") {
      unrepresentableEntries += 1;
    }
  }

  return {
    roots: {
      requested: discovery.complete
        ? { state: "known", count: discovery.roots.length }
        : { state: "unknown" },
      observedRootOutcomes: discovery.roots.length,
      acceptedRootOutcomes,
      unavailableRootOutcomes,
      outsideProjectRootOutcomes
    },
    entries: {
      observation: discovery.complete ? "complete" : "truncated",
      uniqueEncounteredEntries: discovery.entries.length,
      excludedEntries,
      extensionSupportedRegularFiles,
      extensionUnsupportedRegularFiles,
      candidateFiles,
      unrepresentableEntries
    }
  };
}

function deriveDiscoveryCoverage(
  discovery: DiscoveryInstrumentationV1,
  scope: ScanScopeV2
): DiscoveryCoverageV2 {
  if (!discovery.complete) {
    return { state: "failed" };
  }

  const requested = scope.roots.requested;
  if (requested.state !== "known") {
    throw new Error(
      "Complete discovery must have a known requested-root count."
    );
  }
  if (requested.count === 0 || scope.roots.acceptedRootOutcomes === 0) {
    return { state: "insufficient" };
  }
  if (scope.roots.acceptedRootOutcomes === requested.count) {
    return { state: "complete" };
  }
  return { state: "partial" };
}

function deriveRuleExecutionCoverage(
  ruleExecution: RuleExecutionInstrumentationV1
): RuleExecutionCoverageV2 {
  let disabledOccurrences = 0;
  let scheduledOccurrences = 0;
  let completedOccurrences = 0;
  let failedOccurrences = 0;
  let completedWithFindingsOccurrences = 0;
  let completedWithNoFindingsOccurrences = 0;
  let normalizedDetectorFindings = 0;
  let unrepresentableRuleOccurrences = 0;

  for (const outcome of ruleExecution.rules) {
    if (outcome.scheduling === "disabled") {
      disabledOccurrences += 1;
    } else {
      scheduledOccurrences += 1;
    }
    if (outcome.execution === "completed") {
      completedOccurrences += 1;
    } else if (outcome.execution === "failed") {
      failedOccurrences += 1;
    }
    if (outcome.findingEmission === "emitted-findings") {
      completedWithFindingsOccurrences += 1;
    } else if (outcome.findingEmission === "emitted-no-findings") {
      completedWithNoFindingsOccurrences += 1;
    }
    normalizedDetectorFindings += outcome.normalizedFindingCount;
    if (outcome.rule.kind === "unrepresentable") {
      unrepresentableRuleOccurrences += 1;
    }
  }

  const state =
    scheduledOccurrences === 0
      ? "insufficient"
      : failedOccurrences === 0
        ? "complete"
        : completedOccurrences === 0
          ? "failed"
          : "partial";

  return {
    state,
    counts: {
      selectedOccurrences: ruleExecution.rules.length,
      disabledOccurrences,
      scheduledOccurrences,
      completedOccurrences,
      failedOccurrences,
      completedWithFindingsOccurrences,
      completedWithNoFindingsOccurrences,
      normalizedDetectorFindings,
      unrepresentableRuleOccurrences
    }
  };
}

function deriveReadEvidence(
  ruleExecution: RuleExecutionInstrumentationV1
): ObservedRuleReadEvidenceV2 {
  let attempts = 0;
  let succeeded = 0;
  let failed = 0;
  let unsettled = 0;
  let representablePaths = 0;
  let unrepresentablePaths = 0;

  for (const rule of ruleExecution.rules) {
    for (const attempt of rule.readAttempts) {
      attempts += 1;
      switch (attempt.outcome) {
        case "succeeded":
          succeeded += 1;
          break;
        case "failed":
          failed += 1;
          break;
        case "unsettled":
          unsettled += 1;
          break;
      }
      if (attempt.path.kind === "unrepresentable") {
        unrepresentablePaths += 1;
      } else {
        representablePaths += 1;
      }
    }
  }

  return {
    attempts,
    succeeded,
    failed,
    unsettled,
    representablePaths,
    unrepresentablePaths
  };
}
