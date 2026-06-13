# ArcReady Rule Quality Audit

## Summary

This Phase 3A audit covered 21 `Rule` objects: 18 active static validation rules and 3 placeholder/internal no-op rules that were still present in the default preset registry and public exports at the time of the audit.

Phase 3B cleanup note: the placeholder/internal no-op rules have now been removed from the package entrypoint and from the default preset registry. Active wallet, App Kit, and bridge rules remain available through their presets.

Phase 3C-1 cleanup note: wallet rule precision has been improved for documentation/comment guidance, generic chain docs, explanatory USDC copy, confirmation guidance, PREVRANDAO warnings, and blob-transaction warnings. Wallet rules now have additional negative tests for these false-positive cases.

Phase 3C-2 cleanup note: bridge rule precision has been improved for documentation/comment guidance around confirmations, CCTP domains, wrapped USDC, relayer ETH gas funding, attestation 404 handling, and PREVRANDAO relay selection. Bridge tests now include additional false-positive guards and explicit relayer gas-token config coverage.

Phase 3C-3 cleanup note: App Kit rule precision has been improved for documentation/comment guidance around chain identifiers, capability checks, custom RPC recommendations, Unified Balance delegate handling, Unified Balance fee explanation, and bridge minimum amount notes. App Kit tests now include additional false-positive guards for these cases.

Phase 3C-4 cleanup note: cross-preset regression coverage was added to verify preset boundaries, placeholder removal, fixture stability, selected-preset isolation, and report summary consistency.

ArcReady has a useful rule foundation for v0.2.0. The active rules are Arc-specific in intent, have direct unit coverage, and are backed by smoke fixtures for wallet, bridge, and App Kit presets. The main v0.3.0 risk is not missing product breadth; it is rule precision. Most current rules rely on regex and line-level text matching, which is acceptable for an early static CI gate but creates false positive risk in comments, docs, unrelated helper code, split configuration files, and variable-derived values.

The recommended next implementation order is:

1. Phase 3B: public API cleanup.
2. Phase 3C: rule precision and fixture hardening.
3. Phase 3D: finding message and suggestion improvements.
4. Phase 3E: v0.3.0 release gate.

Phase 3 should remain static and CLI-first. SaaS, dashboards, authentication, databases, telemetry, live Arc RPC checks, on-chain simulation, and bridge runtime simulation are non-goals.

## Current Rule Inventory

| Rule ID | Exported symbol | Preset | Severity | Current detection | Tested in | Fixture coverage | Scope | Rating | Disposition |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `wallet/ARC_CHAIN_METADATA` | `arcChainMetadataRule` | wallet | critical | Arc-related chain config with missing Arc chain ID `5042002`, or obvious non-Arc RPC/explorer metadata. | `wallet-rules.test.ts`, `fixtures.test.ts` indirectly through good wallet pass. | `wallet-good` avoids it; `wallet-bad` does not target it. | Arc-specific | Good | Keep, then harden precision around multi-file and framework chain configs. |
| `wallet/WALLET_NATIVE_USDC_DISPLAY` | `walletNativeUsdcDisplayRule` | wallet | critical | Arc wallet config that presents ETH/Ethereum as the native currency, gas token, or fee token instead of USDC. | `wallet-rules.test.ts` | `wallet-good` avoids it; no bad fixture target. | Arc-specific | Needs improvement | Keep, but narrow the broad ETH/native-token matching. |
| `wallet/NO_ETH_GAS_LABEL` | `noEthGasLabelRule` | wallet | critical | Arc-related content that labels gas or fees as ETH/gwei. | `wallet-rules.test.ts` | `wallet-good` avoids it; no bad fixture target. | Arc-specific | Needs improvement | Keep, but reduce line-level false positives in comments, copy, and non-UI strings. |
| `wallet/ONE_CONFIRMATION_FINAL` | `oneConfirmationFinalRule` | wallet | critical | Arc wallet flow waiting for more than one confirmation or showing generic confirming copy. | `wallet-rules.test.ts`, `fixtures.test.ts` | `wallet-bad` targets it; `wallet-good` avoids it. | Arc-specific | Needs improvement | Keep, but split numeric confirmation checks from UI-copy heuristics. |
| `wallet/PREVRANDAO_NOT_SUPPORTED` | `prevrandaoNotSupportedRule` | wallet | critical | Arc-related wallet content using `block.prevrandao`, `PREVRANDAO`, or `mixHash`. | `wallet-rules.test.ts` | No dedicated bad fixture target. | Arc-specific / EVM-specific | Needs improvement | Keep, but require stronger usage context and avoid documentation/comment hits. |
| `wallet/NO_BLOB_TX_ON_ARC` | `noBlobTxOnArcRule` | wallet | critical | Arc-related wallet content using blob transaction fields, EIP-4844 terms, or transaction type 3. | `wallet-rules.test.ts` | No dedicated bad fixture target. | Arc-specific / EVM-specific | Needs improvement | Keep, but distinguish executable transaction config from explanatory text. |
| `bridge/BRIDGE_CONFIRMATIONS_ONE` | `bridgeConfirmationsOneRule` | bridge | critical | Arc bridge route or relayer config requiring more than one confirmation/finality block. | `bridge-rules.test.ts`, `fixtures.test.ts` | `bridge-bad` targets it; `bridge-good` avoids it. | Arc-specific | Good | Keep, but add realistic route and relayer fixtures. |
| `bridge/CCTP_DOMAIN_26` | `cctpDomain26Rule` | bridge | critical | Arc CCTP config where the Arc domain is not `26`. | `bridge-rules.test.ts` | No dedicated bad fixture target; `bridge-good` includes `ARC_DOMAIN = 26`. | Arc-specific | Good | Keep, but support more real config shapes. |
| `bridge/NO_WRAPPED_USDC_ON_ARC` | `noWrappedUsdcOnArcRule` | bridge | critical | Arc bridge content that refers to `USDC.e`, `wUSDC`, wrapped USDC, or bridged USDC. | `bridge-rules.test.ts` | `bridge-good` avoids it; no bad fixture target. | Arc-specific | Good | Keep, but add comment/doc and token-list edge cases. |
| `bridge/RELAYER_USES_USDC_FOR_GAS` | `relayerUsesUsdcForGasRule` | bridge | critical | Arc bridge relayer content that says relayers are funded with ETH. | `bridge-rules.test.ts`, `fixtures.test.ts` | `bridge-bad` may target it; `bridge-good` avoids it. | Arc-specific | Weak | Keep concept, but rewrite detection around relayer gas-token config and realistic phrases. |
| `bridge/ATTESTATION_404_NOT_FATAL` | `attestation404NotFatalRule` | bridge | critical | CCTP attestation handling that treats HTTP 404 as fatal instead of retryable/pending. | `bridge-rules.test.ts` | No dedicated bad fixture target. | Arc-specific CCTP integration | Needs improvement | Keep, but test structured error handling and retry branches. |
| `bridge/NO_PREVRANDAO_RELAY_SELECTION` | `noPrevrandaoRelaySelectionRule` | bridge | critical | Arc bridge relay selection, shuffle, or randomness logic based on prevrandao or mixHash. | `bridge-rules.test.ts` | No dedicated bad fixture target. | Arc-specific / EVM-specific | Needs improvement | Keep, but require executable selection context. |
| `app-kit/APPKIT_CHAIN_IDENTIFIER_VALID` | `appKitChainIdentifierValidRule` | app-kit | critical | Invalid App Kit Arc chain strings such as `Arc`, `arc`, `ArcTestnet`, `arc_testnet`, or `Arc Testnet`. | `app-kit-rules.test.ts`, `fixtures.test.ts` | `app-kit-bad` targets it; `app-kit-good` avoids it. | Arc-specific App Kit | Good | Keep, but add variable/env/config variants. |
| `app-kit/APPKIT_CAPABILITY_SUPPORTED` | `appKitCapabilitySupportedRule` | app-kit | warning | App Kit send/bridge/swap/unified balance operations without an apparent capability guard or try block. | `app-kit-rules.test.ts` | `app-kit-good` avoids it through `capabilities.includes`; `app-kit-bad` does not target it. | Arc-specific App Kit | Weak | Keep concept, but make guards and operation calls less heuristic. |
| `app-kit/APPKIT_CUSTOM_RPC_RECOMMENDED` | `appKitCustomRpcRecommendedRule` | app-kit | warning | Arc App Kit usage without an apparent custom RPC/provider/client/transport configuration. | `app-kit-rules.test.ts` | `app-kit-good` avoids it through `rpcUrl`; `app-kit-bad` may also lack custom RPC but targets chain ID. | Arc-specific App Kit | Needs improvement | Keep, but reduce false positives when config is imported or initialized elsewhere. |
| `app-kit/UB_DELEGATE_REQUIRED` | `ubDelegateRequiredRule` | app-kit | warning | Unified Balance spend flows from server-wallet or developer-controlled contexts without delegate language. | `app-kit-rules.test.ts` | No dedicated bad fixture target. | Arc-specific App Kit / Unified Balance | Weak | Keep concept if product guidance is correct, but improve context and fixtures before relying on it. |
| `app-kit/UB_FEE_EXPLANATION_PRESENT` | `ubFeeExplanationPresentRule` | app-kit | warning | Unified Balance payment/checkout flows without fee, estimate, forwarding-fee, or received-amount language. | `app-kit-rules.test.ts` | No dedicated bad fixture target. | Arc-specific App Kit / Unified Balance | Weak | Keep concept, but this needs realistic UI fixtures and clearer expected wording. |
| `app-kit/APPKIT_BRIDGE_MIN_AMOUNT_NOTE` | `appKitBridgeMinAmountNoteRule` | app-kit | warning | App Kit bridge calls from Arc with an amount but no minimum amount or max-fee handling. | `app-kit-rules.test.ts` | `app-kit-good` avoids it through `minAmount` and `maxFee`; `app-kit-bad` may also match but targets chain ID. | Arc-specific App Kit | Needs improvement | Keep, but improve source-chain and amount detection. |
| `wallet/placeholder` | `walletPlaceholderRule` | wallet | info | No-op placeholder rule. | Covered only by preset construction behavior, not meaningful rule behavior. | Included in default wallet preset; produces no fixture finding. | Placeholder/internal | Placeholder/internal | Hide, deprecate, or remove from public API/default registry in Phase 3B if semver plan allows. |
| `app-kit/placeholder` | `appKitPlaceholderRule` | app-kit | info | No-op placeholder rule. | Covered only by preset construction behavior, not meaningful rule behavior. | Included in default App Kit preset; produces no fixture finding. | Placeholder/internal | Placeholder/internal | Hide, deprecate, or remove from public API/default registry in Phase 3B if semver plan allows. |
| `bridge/placeholder` | `bridgePlaceholderRule` | bridge | info | No-op placeholder rule. | Covered only by preset construction behavior, not meaningful rule behavior. | Included in default bridge preset; produces no fixture finding. | Placeholder/internal | Placeholder/internal | Hide, deprecate, or remove from public API/default registry in Phase 3B if semver plan allows. |

## Highest Priority Improvements

1. Keep the public API surface clean before improving behavior. Phase 3B removed the placeholder rules from the package entrypoint and default preset registry because they were not useful to external users and made the product look unfinished.
2. Harden fixture realism before broad rule rewrites. Current fixtures are good smoke tests, but most bad fixtures trigger only one representative rule. They do not cover many active rules or realistic framework layouts.
3. Reduce brittle string matching. Most active rules scan raw text with regexes and coarse context checks. That creates avoidable false positives in comments, README content, tests, and unrelated helper strings.
4. Improve App Kit warnings first. App Kit warning rules have the highest heuristic risk because they infer missing capability guards, RPC setup, delegate handling, fees, and minimum amounts from broad keyword absence.
5. Make finding suggestions more concrete. Some suggestions explain the policy but do not show the expected value, code shape, or static-analysis limitation clearly enough.

## Rules to Keep As-Is

The current rule concepts should remain in the product roadmap. The strongest concepts are:

- `wallet/ARC_CHAIN_METADATA`
- `wallet/WALLET_NATIVE_USDC_DISPLAY`
- `wallet/NO_ETH_GAS_LABEL`
- `wallet/ONE_CONFIRMATION_FINAL`
- `bridge/BRIDGE_CONFIRMATIONS_ONE`
- `bridge/CCTP_DOMAIN_26`
- `bridge/NO_WRAPPED_USDC_ON_ARC`
- `bridge/ATTESTATION_404_NOT_FATAL`
- `app-kit/APPKIT_CHAIN_IDENTIFIER_VALID`
- `app-kit/APPKIT_CUSTOM_RPC_RECOMMENDED`

These rules map to clear Arc-specific integration guidance and belong in ArcReady. "Keep as-is" here means keep the concept and current public behavior until Phase 3B API cleanup is complete. It does not mean the implementations should avoid later precision hardening.

## Rules That Need Precision Improvements

- `wallet/WALLET_NATIVE_USDC_DISPLAY`: Broad ETH/native-token matching may catch unrelated explanatory text near an Arc chain object.
- `wallet/NO_ETH_GAS_LABEL`: Line-level matching can flag comments, docs, tests, or non-user-facing strings.
- `wallet/ONE_CONFIRMATION_FINAL`: Numeric confirmation detection is useful, but generic "confirming" copy is too broad for a critical finding.
- `wallet/PREVRANDAO_NOT_SUPPORTED`: Should distinguish executable usage from references in docs, comments, or defensive checks.
- `wallet/NO_BLOB_TX_ON_ARC`: `type: 3` and blob-field detection should require stronger transaction context.
- `bridge/RELAYER_USES_USDC_FOR_GAS`: Current phrase matching is narrow and likely misses realistic relayer gas-token configuration mistakes.
- `bridge/ATTESTATION_404_NOT_FATAL`: Needs stronger modeling of retryable 404 handling versus logging or typed error branches.
- `bridge/NO_PREVRANDAO_RELAY_SELECTION`: Should require actual relay selection/randomness usage, not only nearby words.
- `app-kit/APPKIT_CAPABILITY_SUPPORTED`: A `try` block is not necessarily a capability guard, and send/bridge/swap method names can appear in unrelated code.
- `app-kit/APPKIT_CUSTOM_RPC_RECOMMENDED`: Missing-RPC checks can false positive when custom RPC setup is imported from another file.
- `app-kit/UB_DELEGATE_REQUIRED`: Needs a more concrete definition of delegated spend setup before it can be treated as reliable.
- `app-kit/UB_FEE_EXPLANATION_PRESENT`: Absence of fee-related words is weak evidence without a UI confirmation or checkout context.
- `app-kit/APPKIT_BRIDGE_MIN_AMOUNT_NOTE`: Source-chain and amount detection should cover more object shapes without overmatching.

## Rules That Need Better Fixtures

- `wallet/ARC_CHAIN_METADATA`: Add fixtures for a real `defineChain` or wagmi/viem-style Arc chain object and a bad chain object copied from another network.
- `wallet/WALLET_NATIVE_USDC_DISPLAY`: Add a bad fixture where only native currency metadata is wrong, without also triggering gas-label rules.
- `wallet/NO_ETH_GAS_LABEL`: Add UI-copy fixtures that separate real user-facing labels from comments and test data.
- `wallet/PREVRANDAO_NOT_SUPPORTED`: Add an executable randomness usage fixture and a non-finding documentation/comment fixture.
- `wallet/NO_BLOB_TX_ON_ARC`: Add a fixture with blob transaction config and a non-finding fixture mentioning EIP-4844 in documentation.
- `bridge/CCTP_DOMAIN_26`: Add realistic CCTP domain maps and constants imported into route config.
- `bridge/RELAYER_USES_USDC_FOR_GAS`: Add relayer config fixtures using gas-token fields, environment variables, and setup docs.
- `bridge/ATTESTATION_404_NOT_FATAL`: Add fixtures for retry loops, polling, typed HTTP errors, and fatal 404 handling.
- `app-kit/APPKIT_CAPABILITY_SUPPORTED`: Add fixtures for actual capability APIs, missing guards, and unrelated method names.
- `app-kit/UB_DELEGATE_REQUIRED`: Add realistic server-wallet/developer-controlled spend flows.
- `app-kit/UB_FEE_EXPLANATION_PRESENT`: Add checkout/confirmation UI fixtures with and without fee explanation copy.
- `app-kit/APPKIT_BRIDGE_MIN_AMOUNT_NOTE`: Add realistic bridge form and route fixtures with minimum amount and max fee handling.

## Rules That Need Better Messages

- `wallet/ARC_CHAIN_METADATA`: The message should identify whether the issue is missing `5042002`, wrong RPC metadata, or wrong explorer metadata.
- `wallet/ONE_CONFIRMATION_FINAL`: The finding should separate "more than one confirmation" from generic pending UI copy, because the fixes differ.
- `wallet/NO_BLOB_TX_ON_ARC`: The suggestion should mention the exact detected blob field or transaction type.
- `bridge/RELAYER_USES_USDC_FOR_GAS`: The message should explicitly say Arc relayers should account for USDC gas, and the suggestion should point to the config field or setup text that needs changing.
- `bridge/ATTESTATION_404_NOT_FATAL`: The suggestion should say that CCTP attestation 404s should be handled as pending/retryable, not fatal.
- `app-kit/APPKIT_CAPABILITY_SUPPORTED`: The message should name the operation and the expected capability check pattern.
- `app-kit/APPKIT_CUSTOM_RPC_RECOMMENDED`: The suggestion should show accepted evidence, such as `rpcUrl`, `rpcUrls`, `transport`, `provider`, `client`, or `ARC_RPC_URL`.
- `app-kit/UB_DELEGATE_REQUIRED`: The message should avoid overclaiming if static analysis only sees ambiguous server-wallet language.
- `app-kit/UB_FEE_EXPLANATION_PRESENT`: The suggestion should state the user-facing fee or received-amount detail expected.
- `app-kit/APPKIT_BRIDGE_MIN_AMOUNT_NOTE`: The message should distinguish missing minimum-amount handling from missing max-fee handling.

## Public API Cleanup Candidates

The package entrypoint exports more than a CLI-oriented public API normally needs. Cleanup should happen deliberately in Phase 3B, with a semver-compatible plan.

Highest priority cleanup candidates addressed in Phase 3B:

- `walletPlaceholderRule`
- `appKitPlaceholderRule`
- `bridgePlaceholderRule`
- Inclusion of the three placeholder rules in `defaultPresetRegistry`

Other exports to classify as public, experimental, or internal:

- Preset registry internals: `createPresetRegistry`, `defaultPresetRegistry`, `getRulesForPresets`, `getRulesForScan`.
- Low-level scanner internals: `discoverFiles`, `detectProject`, `readProjectName`, `createRuleContext`, `runRules`.
- Scoring internals: `calculateScore`, `getStatusForScore`, `DEFAULT_SCORE_WEIGHTS`.
- Reporter implementation exports: `htmlReporter`, `jsonReporter`, `markdownReporter`, `terminalReporter`, `getReporter`.
- Individual rule exports and grouped rule arrays such as `walletRules`, `bridgeRules`, and `appKitRules`.
- `runCli`, which may be useful for tests but should be classified before becoming a stable public API promise.

Likely stable public API candidates:

- `runScan`
- `PACKAGE_VERSION`
- Public config, report, finding, severity, preset, and scan result types.

Do not remove any export in this audit task.

## Fixture Coverage Gaps

The existing fixtures are effective package and CLI smoke fixtures:

- `wallet-good` is a compact Arc chain object with chain ID `5042002`, USDC native currency, Arc RPC/explorer metadata, and one confirmation.
- `wallet-bad` is a compact Arc wallet flow with `confirmations: 3`, intentionally triggering `wallet/ONE_CONFIRMATION_FINAL`.
- `bridge-good` includes CCTP domain `26`, one confirmation, canonical USDC, and USDC relayer gas language.
- `bridge-bad` uses `finalityBlocks: 6` and ETH relayer setup text, intentionally triggering bridge validation.
- `app-kit-good` uses `Arc_Testnet`, `ARC_RPC_URL`, capability checking, `minAmount`, and `maxFee`.
- `app-kit-bad` uses `arc_testnet` and a bridge call without supporting safeguards, intentionally triggering `app-kit/APPKIT_CHAIN_IDENTIFIER_VALID`.

Fixture gaps:

- Bad fixtures do not cover every active rule.
- The fixtures are minimal TypeScript snippets, not realistic wallet, bridge, or App Kit projects.
- Good fixtures prove a happy path but do not stress false positive boundaries in comments, README files, tests, examples, or unrelated code.
- There are no multi-file fixtures where config values are imported from constants or environment helpers.
- There are no realistic framework layouts such as Next.js App Kit components, viem/wagmi chain definitions, token lists, CCTP route maps, relayer config files, or checkout UI copy.
- There are no targeted fixtures proving that each bad fixture only triggers one intended rule.

Recommended Phase 3C fixture additions:

- One good and one bad focused fixture per active rule.
- At least one realistic project-shaped fixture per preset.
- Non-finding edge fixtures for comments, documentation, tests, and non-Arc EVM code.
- Split-config fixtures where Arc values are imported from constants.

## Test Coverage Gaps

Current rule tests are useful but shallow. Wallet, bridge, and App Kit rule suites generally include direct positive and negative tests, severity override/disable behavior, and scan-pipeline coverage. Fixture tests verify that good fixtures pass and bad fixtures fail with representative findings.

Gaps:

- Most tests use short synthetic snippets rather than realistic file shapes.
- Edge cases for comments, documentation strings, test files, examples, and generated files are limited.
- Variable-derived values, imported constants, object spreads, arrays, and multi-file project patterns are mostly untested.
- App Kit tests lock in weak behavior such as treating any `try` block as sufficient capability handling.
- Bridge tests need more realistic CCTP attestation and relayer configuration examples.
- Wallet tests need stronger negative coverage around generic EVM references in Arc-adjacent files.
- Placeholder rules have no meaningful behavior tests because they intentionally return no findings.

Rules with stronger current tests:

- `wallet/ARC_CHAIN_METADATA`
- `wallet/ONE_CONFIRMATION_FINAL`
- `bridge/BRIDGE_CONFIRMATIONS_ONE`
- `bridge/CCTP_DOMAIN_26`
- `app-kit/APPKIT_CHAIN_IDENTIFIER_VALID`

Rules with shallow or high-risk tests:

- `bridge/RELAYER_USES_USDC_FOR_GAS`
- `bridge/ATTESTATION_404_NOT_FATAL`
- `app-kit/APPKIT_CAPABILITY_SUPPORTED`
- `app-kit/UB_DELEGATE_REQUIRED`
- `app-kit/UB_FEE_EXPLANATION_PRESENT`
- `app-kit/APPKIT_BRIDGE_MIN_AMOUNT_NOTE`

## Recommended Phase 3B Tasks

Phase 3B should be public API cleanup only.

Recommended tasks:

1. Define the intended stable public API for `arcready@0.3.0`.
2. Remove, hide, or deprecate `walletPlaceholderRule`, `appKitPlaceholderRule`, and `bridgePlaceholderRule` from the public API and default presets according to the chosen semver plan.
3. Classify low-level exports as stable, experimental, or internal.
4. Update documentation to describe the supported API surface.
5. Add API-surface tests if the package should guarantee specific exports.

Do not change scanner behavior, rule behavior, reporter behavior, or fixtures in Phase 3B unless the task explicitly scopes that change.

## Recommended Phase 3C Tasks

Phase 3C should focus on rule precision and fixture hardening.

Recommended tasks:

1. Add focused good/bad fixtures for each active rule.
2. Add realistic project-shaped fixtures for wallet, bridge, and App Kit integrations.
3. Add false positive guard fixtures for comments, docs, tests, non-Arc code, and unrelated helper strings.
4. Tighten the highest-risk rules first: App Kit capability, Unified Balance delegate, Unified Balance fees, relayer gas token, attestation 404 handling, one confirmation UI copy, and blob transaction detection.
5. Keep rule changes static and deterministic. Do not add live RPC, on-chain simulation, bridge runtime simulation, or hosted checks.

## Recommended Phase 3D Tasks

Phase 3D should improve finding messages and suggestions after precision work has stabilized.

Recommended tasks:

1. Update messages to name the detected value or missing evidence when possible.
2. Make suggestions show concrete expected values such as Arc chain ID `5042002`, CCTP domain `26`, one confirmation, and USDC gas-token handling.
3. Clarify static-analysis limitations where a rule is heuristic.
4. Keep terminal, JSON, Markdown, and HTML reporter behavior compatible with existing structured finding fields.
5. Add tests that assert important message content only where it represents a public contract.

## Non-goals

This audit does not recommend and did not implement:

- Scanner logic changes.
- Rule logic changes.
- Reporter logic changes.
- Fixture changes.
- Test changes.
- New rules.
- Removed rules.
- Removed exports.
- npm publishing.
- Version bumps.
- Git tags.
- GitHub releases.
- GitHub Action behavior changes.
- SaaS, dashboard, database, authentication, or telemetry.
- Live Arc RPC checks.
- On-chain simulation.
- Bridge runtime simulation.
- Any claim that ArcReady is an official Circle or Arc product.
