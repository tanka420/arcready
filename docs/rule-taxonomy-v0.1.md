# ArcReady Rule Taxonomy v0.1

Status: internal policy metadata for Milestone 1

This document defines how ArcReady describes detector maturity, the impact of a
proven violation, expected detector reliability, and implementation lifecycle.
The catalog is internal and is not part of the public JavaScript API.

The catalog is policy-only. Its `recommendedDefaultEnabled` and
`recommendedCiFailureEligible` values are future recommendations and do not
currently affect rule execution, severity, scoring, status calculation,
presets, configuration, CLI exit behavior, reporters, or the GitHub Action.

ArcReady identifies known static compatibility risks. It does not certify that
an integration is complete, correct, secure, deployable, or compatible with
Arc, Circle products, or any specific network or SDK version.

## Taxonomy

Taxonomy describes detector maturity and product posture. It does not describe
the consequence of an underlying requirement by itself.

| Taxonomy                     | Meaning                                                                                                                              | Recommended posture                                                                                        |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| `stable-compatibility`       | A precise, validated detector for a documented Arc-specific requirement, supported by direct official evidence and corpus validation | May be enabled by default and may become CI-failure eligible when its impact is Blocker or Required change |
| `experimental-compatibility` | A credible compatibility concern whose applicability or current detector precision is not sufficiently validated                     | May be enabled for visibility; never recommended for CI failure                                            |
| `advice`                     | UX, reliability, or operational guidance rather than a compatibility requirement                                                     | Recommended disabled/opt-in; never recommended for CI failure                                              |
| `needs-research`             | A plausible concern without enough evidence or a defensible detector contract                                                        | Recommended disabled; requires an explicit research gap                                                    |
| `remove-or-replace`          | An unsupported, contradicted, or misleading current rule concept or implementation                                                   | Recommended disabled; deprecated with replacement direction or an explicit no-replacement reason           |

No current ArcReady detector is classified as Stable. No current rule is
recommended to fail CI. This is intentional: several underlying requirements
can have Blocker impact while their current regex detectors remain
Experimental and ineligible for recommended CI failure.

## Impact, confidence, and maturity

Impact describes the consequence only after applicability and a violation are
proven:

- `blocker`: the applicable integration or operation is invalid or unsupported.
- `required-change`: the applicable behavior is materially incorrect or likely
  to fail and must be changed.
- `recommendation`: UX, reliability, or operational guidance.
- `not-applicable-until-researched`: no defensible impact assertion should be
  made for the current rule.

Confidence (`low`, `medium`, or `high`) describes expected detector reliability.
Maturity (`prototype`, `validated`, or `deprecated`) describes the detector's
implementation lifecycle. These dimensions remain separate so that a severe
underlying requirement does not overstate confidence in a heuristic detector.

## Classification catalog

| Rule ID                                 | Taxonomy                   | Impact                          | Recommended default | Recommended CI failure | Rule packs                          |
| --------------------------------------- | -------------------------- | ------------------------------- | ------------------- | ---------------------- | ----------------------------------- |
| `app-kit/APPKIT_BRIDGE_MIN_AMOUNT_NOTE` | Remove or replace          | Not applicable until researched | No                  | No                     | App Kit advice                      |
| `app-kit/APPKIT_CAPABILITY_SUPPORTED`   | Remove or replace          | Not applicable until researched | No                  | No                     | App Kit compatibility               |
| `app-kit/APPKIT_CHAIN_IDENTIFIER_VALID` | Experimental compatibility | Blocker                         | Yes                 | No                     | App Kit compatibility               |
| `app-kit/APPKIT_CUSTOM_RPC_RECOMMENDED` | Advice                     | Recommendation                  | No                  | No                     | App Kit advice                      |
| `app-kit/UB_DELEGATE_REQUIRED`          | Experimental compatibility | Required change                 | No                  | No                     | App Kit compatibility               |
| `app-kit/UB_FEE_EXPLANATION_PRESENT`    | Advice                     | Recommendation                  | No                  | No                     | App Kit advice                      |
| `bridge/ATTESTATION_404_NOT_FATAL`      | Experimental compatibility | Required change                 | Yes                 | No                     | Bridge/CCTP, indexer/infrastructure |
| `bridge/BRIDGE_CONFIRMATIONS_ONE`       | Advice                     | Recommendation                  | No                  | No                     | Bridge/CCTP, indexer/infrastructure |
| `bridge/CCTP_DOMAIN_26`                 | Experimental compatibility | Blocker                         | Yes                 | No                     | Bridge/CCTP, core compatibility     |
| `bridge/NO_PREVRANDAO_RELAY_SELECTION`  | Experimental compatibility | Required change                 | Yes                 | No                     | Bridge/CCTP, Solidity               |
| `bridge/NO_WRAPPED_USDC_ON_ARC`         | Experimental compatibility | Required change                 | Yes                 | No                     | Bridge/CCTP                         |
| `bridge/RELAYER_USES_USDC_FOR_GAS`      | Experimental compatibility | Required change                 | Yes                 | No                     | Bridge/CCTP, indexer/infrastructure |
| `wallet/ARC_CHAIN_METADATA`             | Experimental compatibility | Blocker                         | Yes                 | No                     | Core compatibility, wallet          |
| `wallet/ARC_USDC_AMOUNT_CONVERSION`     | Experimental compatibility | Blocker                         | Yes                 | No                     | Core compatibility, wallet          |
| `wallet/NO_BLOB_TX_ON_ARC`              | Experimental compatibility | Blocker                         | Yes                 | No                     | Core compatibility                  |
| `wallet/NO_ETH_GAS_LABEL`               | Experimental compatibility | Required change                 | Yes                 | No                     | Wallet                              |
| `wallet/ONE_CONFIRMATION_FINAL`         | Advice                     | Recommendation                  | No                  | No                     | Wallet, indexer/infrastructure      |
| `wallet/PREVRANDAO_NOT_SUPPORTED`       | Experimental compatibility | Required change                 | Yes                 | No                     | Solidity, core compatibility        |
| `wallet/WALLET_NATIVE_USDC_DISPLAY`     | Experimental compatibility | Required change                 | Yes                 | No                     | Core compatibility, wallet          |

Totals:

- Stable compatibility: 0
- Experimental compatibility: 13
- Advice: 4
- Needs research: 0
- Remove or replace: 2

## Important classification rationale

`bridge/ATTESTATION_404_NOT_FATAL` is Experimental compatibility rather than
Advice. A valid CCTP polling flow can stop incorrectly if it treats an expected
pending HTTP 404 as an immediate terminal failure. It is not Stable because a
404 can also indicate incorrect parameters, and the current regex cannot
reliably distinguish those cases.

`app-kit/APPKIT_CAPABILITY_SUPPORTED` is Remove or replace. Official App Kit
documentation currently lists Arc Testnet support for Send, Bridge, Swap, and
Unified Balance, with operation and token constraints. The current rule's
invented generic guard-string contract is unsupported. A replacement should
use official, versioned chain, operation, token, adapter, and SDK compatibility
information.

`app-kit/APPKIT_BRIDGE_MIN_AMOUNT_NOTE` is Remove or replace. Official App Kit
documentation describes bridge amounts, estimation, optional maximum fees, and
fee disclosure, but does not establish a universal Arc-specific bridge minimum.
A separately identified future Advice rule may cover fee estimation or
confirmation disclosure.

The two PREVRANDAO compatibility shells now use medium-confidence private
records that require bounded same-function value flow and exact retained
Foundry JSON association with Arc Testnet. The former keyword and blanket
`mixHash` matching is removed. Coverage remains Foundry-only and fail-closed;
it does not establish live deployment, bytecode identity, runtime behavior, or
transaction success.

`UB_DELEGATE_REQUIRED` is conditional. Delegation is required when a delegate
spends for an owner; owner-controlled spending does not establish the same
requirement.

## Documentation provenance

Every catalog reference records:

- the official URL, title, and publisher;
- the precise claim used by the classification;
- whether the source directly supports, partially supports, or contradicts the
  current claim;
- the date the source was verified;
- network or SDK version context when relevant; and
- whether the claim is stable, versioned, ambiguous, or potentially outdated.

Only official Arc documentation under `docs.arc.io` and official Circle
developer documentation under `developers.circle.com` are accepted in this
catalog. References were verified on 2026-07-20.

A Stable rule must have at least one direct official reference, high default
confidence, validated maturity, and Blocker or Required change impact. Partial
or contradicted evidence cannot independently support Stable classification.

App Kit, CCTP, and Arc Testnet documentation is version-sensitive. Provenance
must be reviewed when the relevant network, SDK, API, or support matrix changes.

## Migration boundary

The catalog remains policy-only and is not consumed as runtime configuration.
The default App Kit preset now manually excludes the two `remove-or-replace`
rules as a focused compatibility mitigation. Their IDs, implementations,
individual exports, and known-inventory membership remain available; direct
invocation is unchanged.

All other catalog recommendations for default selection, opt-in policy,
severity, scoring, findings, reporter output, CLI exit behavior, or GitHub
Actions remain deferred to separately reviewed behavior and compatibility work.
