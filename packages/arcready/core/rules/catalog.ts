import type { RuleMetadata } from "./taxonomy.js";

const VERIFIED_AT = "2026-07-20";

/**
 * Internal policy metadata for active rules. Nothing in the runtime registry
 * consumes this catalog, and its recommendations do not affect execution,
 * severity, scoring, presets, reports, CLI behavior, or CI failures.
 */
export const ruleTaxonomyCatalog = [
  {
    id: "app-kit/APPKIT_BRIDGE_MIN_AMOUNT_NOTE",
    category: "app-kit",
    rulePacks: ["app-kit-advice"],
    taxonomy: "remove-or-replace",
    impact: "not-applicable-until-researched",
    defaultConfidence: "low",
    maturity: "deprecated",
    recommendedDefaultEnabled: false,
    recommendedCiFailureEligible: false,
    appliesTo: ["app-kit-sdk"],
    documentation: [
      {
        url: "https://docs.arc.io/app-kit/references/sdk-reference",
        title: "App Kit SDK Reference",
        publisher: "Arc",
        claim:
          "Bridge operations accept an amount, support estimation, and may use an optional maxFee configuration, but this reference does not establish a universal Arc-specific bridge minimum.",
        support: "partial",
        verifiedAt: VERIFIED_AT,
        network: "Arc Testnet",
        stability: "versioned",
        notes:
          "The documented estimateBridge and maxFee APIs support a different future advice concept than the current minimum-amount rule."
      }
    ],
    researchGap:
      "No official source establishes a universal Arc-specific App Kit bridge minimum.",
    rationale:
      "The current minimum-amount premise is unsupported and conflates minimum amounts with fee estimation and disclosure.",
    detectorLimitations: [
      "The detector infers a missing requirement from the absence of minimum or fee keywords.",
      "It cannot determine whether estimation or validation occurs in another module."
    ],
    deprecated: true,
    replacement:
      "Create a separately identified advice rule for bridge fee estimation or confirmation disclosure."
  },
  {
    id: "app-kit/APPKIT_CAPABILITY_SUPPORTED",
    category: "app-kit",
    rulePacks: ["app-kit-compatibility"],
    taxonomy: "remove-or-replace",
    impact: "not-applicable-until-researched",
    defaultConfidence: "low",
    maturity: "deprecated",
    recommendedDefaultEnabled: false,
    recommendedCiFailureEligible: false,
    appliesTo: ["app-kit-sdk"],
    documentation: [
      {
        url: "https://docs.arc.io/app-kit/references/supported-blockchains",
        title: "App Kit supported blockchains and tokens",
        publisher: "Arc",
        claim:
          "Arc Testnet currently supports Send, Bridge, Swap, and Unified Balance, subject to operation-specific token support.",
        support: "contradicts",
        verifiedAt: VERIFIED_AT,
        network: "Arc Testnet",
        stability: "versioned",
        notes:
          "The current detector treats these operation calls as requiring invented generic guard strings."
      },
      {
        url: "https://docs.arc.io/app-kit/references/sdk-reference",
        title: "App Kit SDK Reference",
        publisher: "Arc",
        claim:
          "The SDK documents getSupportedChains for operation compatibility discovery rather than the detector's guard-string contract.",
        support: "contradicts",
        verifiedAt: VERIFIED_AT,
        version: "Current App Kit SDK documentation",
        stability: "versioned"
      }
    ],
    researchGap:
      "A replacement needs versioned chain, operation, token, adapter, and SDK applicability semantics.",
    rationale:
      "The invented guard-string contract is unsupported and the current Arc capability premise is contradicted by official support tables.",
    detectorLimitations: [
      "The detector accepts undocumented guard identifiers as proof of compatibility.",
      "It does not validate the operation, token, adapter, network, or SDK version."
    ],
    deprecated: true,
    replacement:
      "Implement versioned chain, operation, token, and SDK compatibility validation based on official App Kit APIs."
  },
  {
    id: "app-kit/APPKIT_CHAIN_IDENTIFIER_VALID",
    category: "app-kit",
    rulePacks: ["app-kit-compatibility"],
    taxonomy: "experimental-compatibility",
    impact: "blocker",
    defaultConfidence: "low",
    maturity: "prototype",
    recommendedDefaultEnabled: true,
    recommendedCiFailureEligible: false,
    appliesTo: ["app-kit-sdk"],
    documentation: [
      {
        url: "https://docs.arc.io/app-kit/references/supported-blockchains",
        title: "App Kit supported blockchains and tokens",
        publisher: "Arc",
        claim:
          "App Kit chain identifiers are case-sensitive and Arc Testnet uses Arc_Testnet.",
        support: "direct",
        verifiedAt: VERIFIED_AT,
        network: "Arc Testnet",
        stability: "versioned"
      }
    ],
    rationale:
      "An incorrect SDK chain identifier can prevent an operation, but the current detector cannot prove that an arbitrary string is used as an identifier.",
    detectorLimitations: [
      "Literal matching can flag user-facing labels and unrelated text.",
      "The detector does not resolve enum values or argument positions."
    ],
    deprecated: false
  },
  {
    id: "app-kit/APPKIT_CUSTOM_RPC_RECOMMENDED",
    category: "app-kit",
    rulePacks: ["app-kit-advice"],
    taxonomy: "advice",
    impact: "recommendation",
    defaultConfidence: "low",
    maturity: "prototype",
    recommendedDefaultEnabled: false,
    recommendedCiFailureEligible: false,
    appliesTo: ["app-kit-sdk"],
    documentation: [
      {
        url: "https://docs.arc.io/app-kit/quickstarts/unified-balance-deposit-and-spend",
        title: "Quickstart: Deposit and spend a Unified Balance",
        publisher: "Arc",
        claim:
          "Built-in public RPC URLs work but may be rate-limited or unreliable, so a custom RPC can provide a more stable connection.",
        support: "direct",
        verifiedAt: VERIFIED_AT,
        network: "Arc Testnet",
        stability: "versioned"
      }
    ],
    rationale:
      "Custom RPC configuration is operational reliability advice rather than a compatibility requirement.",
    detectorLimitations: [
      "Absence of RPC-related keywords does not prove that the application uses only a public endpoint.",
      "Configuration may be injected through an adapter, environment, or another module."
    ],
    deprecated: false
  },
  {
    id: "app-kit/UB_DELEGATE_REQUIRED",
    category: "app-kit",
    rulePacks: ["app-kit-compatibility"],
    taxonomy: "experimental-compatibility",
    impact: "required-change",
    defaultConfidence: "low",
    maturity: "prototype",
    recommendedDefaultEnabled: false,
    recommendedCiFailureEligible: false,
    appliesTo: ["unified-balance", "app-kit-sdk"],
    documentation: [
      {
        url: "https://docs.arc.io/app-kit/tutorials/unified-balance/manage-delegates",
        title: "How-to: Manage delegates",
        publisher: "Arc",
        claim:
          "A delegate must be active and authorized before that delegate spends for an owner, and delegation is blockchain-specific.",
        support: "direct",
        verifiedAt: VERIFIED_AT,
        stability: "versioned"
      }
    ],
    rationale:
      "Missing delegation can block a delegate-controlled spend, but owner-initiated spends do not establish that requirement.",
    detectorLimitations: [
      "Keywords cannot establish whether the caller is an owner or a delegate.",
      "The detector cannot determine delegate readiness or chain-specific authorization."
    ],
    deprecated: false
  },
  {
    id: "app-kit/UB_FEE_EXPLANATION_PRESENT",
    category: "app-kit",
    rulePacks: ["app-kit-advice"],
    taxonomy: "advice",
    impact: "recommendation",
    defaultConfidence: "low",
    maturity: "prototype",
    recommendedDefaultEnabled: false,
    recommendedCiFailureEligible: false,
    appliesTo: ["unified-balance", "wallet-ui"],
    documentation: [
      {
        url: "https://docs.arc.io/app-kit/concepts/unified-balance-fees",
        title: "How Unified Balance fees work",
        publisher: "Arc",
        claim:
          "Before confirmation, applications should show the spend amount, applicable fees, destination amount, and resulting balance.",
        support: "direct",
        verifiedAt: VERIFIED_AT,
        stability: "versioned"
      }
    ],
    rationale:
      "Fee disclosure is documented UX guidance and should not be treated as a compatibility failure.",
    detectorLimitations: [
      "Absence of fee keywords does not prove that confirmation UI omits fee information.",
      "The detector cannot identify component boundaries or rendered content."
    ],
    deprecated: false
  },
  {
    id: "bridge/ATTESTATION_404_NOT_FATAL",
    category: "bridge",
    rulePacks: ["bridge-cctp", "indexer-infrastructure"],
    taxonomy: "experimental-compatibility",
    impact: "required-change",
    defaultConfidence: "low",
    maturity: "prototype",
    recommendedDefaultEnabled: true,
    recommendedCiFailureEligible: false,
    appliesTo: ["attestation-poller"],
    documentation: [
      {
        url: "https://developers.circle.com/cctp/howtos/resolve-stuck-attestation",
        title: "Resolve attestation issues",
        publisher: "Circle",
        claim:
          "An attestation API 404 can be an expected pending response that should continue polling, but it can also indicate incorrect request parameters.",
        support: "direct",
        verifiedAt: VERIFIED_AT,
        stability: "versioned"
      }
    ],
    rationale:
      "Treating a valid pending 404 as terminal can stop a CCTP flow, while the conditional meaning of 404 prevents the current detector from being Stable.",
    detectorLimitations: [
      "The regex cannot distinguish a pending attestation from incorrect domains or transaction identifiers.",
      "Nearby retry words do not prove correct polling or terminal-error handling."
    ],
    deprecated: false
  },
  {
    id: "bridge/BRIDGE_CONFIRMATIONS_ONE",
    category: "bridge",
    rulePacks: ["bridge-cctp", "indexer-infrastructure"],
    taxonomy: "advice",
    impact: "recommendation",
    defaultConfidence: "medium",
    maturity: "prototype",
    recommendedDefaultEnabled: false,
    recommendedCiFailureEligible: false,
    appliesTo: ["transaction-confirmation", "bridge-configuration"],
    documentation: [
      {
        url: "https://docs.arc.io/integrate/infrastructure/bridges",
        title: "How to: Add Arc to Your Bridge Protocol",
        publisher: "Arc",
        claim:
          "Bridge integrations should use one Arc confirmation because committed Arc blocks have deterministic finality.",
        support: "direct",
        verifiedAt: VERIFIED_AT,
        network: "Arc Testnet",
        stability: "versioned"
      }
    ],
    rationale:
      "Extra confirmations usually add latency rather than make an otherwise valid bridge operation incompatible.",
    detectorLimitations: [
      "Numeric confirmation values may apply to another chain in a multichain configuration.",
      "The detector does not resolve shared defaults or per-chain overrides."
    ],
    deprecated: false
  },
  {
    id: "bridge/CCTP_DOMAIN_26",
    category: "bridge",
    rulePacks: ["bridge-cctp", "core-compatibility"],
    taxonomy: "experimental-compatibility",
    impact: "blocker",
    defaultConfidence: "medium",
    maturity: "prototype",
    recommendedDefaultEnabled: true,
    recommendedCiFailureEligible: false,
    appliesTo: ["bridge-configuration"],
    documentation: [
      {
        url: "https://developers.circle.com/cctp/concepts/supported-chains-and-domains",
        title: "Supported blockchains and domains",
        publisher: "Circle",
        claim: "Arc uses CCTP domain 26.",
        support: "direct",
        verifiedAt: VERIFIED_AT,
        network: "Arc Testnet",
        stability: "versioned"
      }
    ],
    rationale:
      "An incorrect applicable CCTP domain prevents correct message routing, while computed and structurally complex domain maps remain outside this text-based detector.",
    detectorLimitations: [
      "Named-map matching is limited to direct unquoted Arc keys in flat braced or directly indented YAML maps.",
      "The detector cannot resolve computed domain maps."
    ],
    deprecated: false
  },
  {
    id: "bridge/NO_PREVRANDAO_RELAY_SELECTION",
    category: "bridge",
    rulePacks: ["bridge-cctp", "solidity"],
    taxonomy: "experimental-compatibility",
    impact: "required-change",
    defaultConfidence: "low",
    maturity: "prototype",
    recommendedDefaultEnabled: true,
    recommendedCiFailureEligible: false,
    appliesTo: ["relayer", "smart-contract"],
    documentation: [
      {
        url: "https://docs.arc.io/integrate/infrastructure",
        title: "Infrastructure Integration",
        publisher: "Arc",
        claim:
          "PREVRANDAO always returns zero on Arc and therefore cannot supply entropy for relay selection.",
        support: "direct",
        verifiedAt: VERIFIED_AT,
        network: "Arc Testnet",
        stability: "versioned"
      }
    ],
    rationale:
      "Selection logic that depends on PREVRANDAO entropy can malfunction on Arc, but keyword proximity cannot prove that data flow.",
    detectorLimitations: [
      "Same-line randomness and relay keywords do not establish a selection dependency.",
      "The mixHash equivalence included by the detector is not sufficiently documented."
    ],
    deprecated: false
  },
  {
    id: "bridge/NO_WRAPPED_USDC_ON_ARC",
    category: "bridge",
    rulePacks: ["bridge-cctp"],
    taxonomy: "experimental-compatibility",
    impact: "required-change",
    defaultConfidence: "medium",
    maturity: "prototype",
    recommendedDefaultEnabled: true,
    recommendedCiFailureEligible: false,
    appliesTo: ["bridge-configuration"],
    documentation: [
      {
        url: "https://docs.arc.io/integrate/infrastructure/bridges",
        title: "How to: Add Arc to Your Bridge Protocol",
        publisher: "Arc",
        claim:
          "Arc bridge integrations should use native canonical USDC through CCTP rather than deploy wrapped USDC on Arc.",
        support: "direct",
        verifiedAt: VERIFIED_AT,
        network: "Arc Testnet",
        stability: "versioned"
      }
    ],
    rationale:
      "Using a wrapped representation on Arc conflicts with its canonical USDC model, but text mentions may describe source-chain assets or migration guidance.",
    detectorLimitations: [
      "Token-name matching cannot establish deployment or destination-chain usage.",
      "Multichain source logic and documentation can produce false positives."
    ],
    deprecated: false
  },
  {
    id: "bridge/RELAYER_USES_USDC_FOR_GAS",
    category: "bridge",
    rulePacks: ["bridge-cctp", "indexer-infrastructure"],
    taxonomy: "experimental-compatibility",
    impact: "required-change",
    defaultConfidence: "medium",
    maturity: "prototype",
    recommendedDefaultEnabled: true,
    recommendedCiFailureEligible: false,
    appliesTo: ["relayer"],
    documentation: [
      {
        url: "https://docs.arc.io/integrate/infrastructure/bridges",
        title: "How to: Add Arc to Your Bridge Protocol",
        publisher: "Arc",
        claim: "Relayers submitting transactions on Arc need USDC for gas.",
        support: "direct",
        verifiedAt: VERIFIED_AT,
        network: "Arc Testnet",
        stability: "versioned"
      }
    ],
    rationale:
      "An Arc relayer funded only with ETH cannot pay Arc gas, but the current detector cannot reliably associate funding configuration with a specific chain.",
    detectorLimitations: [
      "ETH funding may apply to a source chain in a multichain relayer.",
      "USDC funding can be configured outside the scanned file."
    ],
    deprecated: false
  },
  {
    id: "wallet/ARC_CHAIN_METADATA",
    category: "wallet",
    rulePacks: ["core-compatibility", "wallet"],
    taxonomy: "experimental-compatibility",
    impact: "blocker",
    defaultConfidence: "medium",
    maturity: "prototype",
    recommendedDefaultEnabled: true,
    recommendedCiFailureEligible: false,
    appliesTo: ["chain-configuration"],
    documentation: [
      {
        url: "https://docs.arc.io/integrate/wallets",
        title: "How to: Add Arc to a Wallet",
        publisher: "Arc",
        claim:
          "Arc Testnet wallet metadata uses chain ID 5042002 and Arc-specific RPC and explorer information.",
        support: "direct",
        verifiedAt: VERIFIED_AT,
        network: "Arc Testnet",
        stability: "versioned"
      }
    ],
    rationale:
      "Incorrect applicable network metadata can connect a wallet to the wrong network; bounded object-local scanning makes direct literal contradictions actionable without borrowing sibling context.",
    detectorLimitations: [
      "The bounded detector supports plain .js and .ts configuration files containing const, defineChain, and one-direct-Arc-child objects while isolating multichain siblings.",
      "It declines imports, computed metadata, JSON, arrays, deep wrappers, spreads, duplicate or conflicting fields, and malformed candidates; its explicit Ethereum endpoint list leaves unknown custom endpoints silent."
    ],
    deprecated: false
  },
  {
    id: "wallet/ARC_USDC_AMOUNT_CONVERSION",
    category: "wallet",
    rulePacks: ["core-compatibility", "wallet"],
    taxonomy: "experimental-compatibility",
    impact: "blocker",
    defaultConfidence: "medium",
    maturity: "prototype",
    recommendedDefaultEnabled: true,
    recommendedCiFailureEligible: false,
    appliesTo: ["wallet-ui"],
    documentation: [
      {
        url: "https://docs.arc.io/arc/concepts/stablecoin-native-model",
        title: "Stablecoin-native model",
        publisher: "Arc",
        claim:
          "Arc native USDC uses 18-decimal accounting while the ERC-20 interface uses six decimals for the same underlying balance, with a 10^12 conversion boundary.",
        support: "direct",
        verifiedAt: VERIFIED_AT,
        network: "Arc Testnet",
        stability: "versioned"
      },
      {
        url: "https://docs.arc.io/integrate/wallets",
        title: "How to: Add Arc to a Wallet",
        publisher: "Arc",
        claim:
          "Wallet integrations must account for Arc's native USDC and its ERC-20 interface as representations of the same underlying balance.",
        support: "direct",
        verifiedAt: VERIFIED_AT,
        network: "Arc Testnet",
        stability: "versioned"
      },
      {
        url: "https://docs.arc.io/arc/references/contract-addresses",
        title: "Contract addresses",
        publisher: "Arc",
        claim:
          "The Arc Testnet USDC ERC-20 interface is 0x3600000000000000000000000000000000000000.",
        support: "direct",
        verifiedAt: VERIFIED_AT,
        network: "Arc Testnet",
        stability: "versioned"
      }
    ],
    rationale:
      "A proven 10^12 interpretation mismatch can materially misstate an Arc USDC balance even though the native and ERC-20 interfaces represent the same underlying balance.",
    detectorLimitations: [
      "Analysis is limited to same-file .js and .ts direct or one-binding reads with bounded viem and ethers import and initialization recognition.",
      "The detector does not analyze writes, events, imported ownership, runtime values, or inter-file, branch, reassignment, and general value flow."
    ],
    deprecated: false
  },
  {
    id: "wallet/NO_BLOB_TX_ON_ARC",
    category: "wallet",
    rulePacks: ["core-compatibility"],
    taxonomy: "experimental-compatibility",
    impact: "blocker",
    defaultConfidence: "medium",
    maturity: "prototype",
    recommendedDefaultEnabled: true,
    recommendedCiFailureEligible: false,
    appliesTo: ["transaction-submission"],
    documentation: [
      {
        url: "https://docs.arc.io/integrate/infrastructure",
        title: "Infrastructure Integration",
        publisher: "Arc",
        claim: "Arc does not support blob transactions.",
        support: "direct",
        verifiedAt: VERIFIED_AT,
        network: "Arc Testnet",
        stability: "versioned"
      }
    ],
    rationale:
      "An exact ethers type-3 transaction submitted through a proven Arc-owned provider is unsupported; exact ownership and sink evidence prevent sibling or prose-only context from creating a blocker.",
    detectorLimitations: [
      "Analysis is limited to bounded same-file .js and .ts ethers v6 Wallet and awaited JsonRpcSigner flows with exact supported construction and sendTransaction grammar.",
      "Imported or cross-file values, wrappers, inferred transaction type, JSX/TSX, runtime state, and all viem/C07C flows remain unsupported; supporting blob fields never independently prove transaction kind."
    ],
    deprecated: false
  },
  {
    id: "wallet/NO_ETH_GAS_LABEL",
    category: "wallet",
    rulePacks: ["wallet"],
    taxonomy: "experimental-compatibility",
    impact: "required-change",
    defaultConfidence: "low",
    maturity: "prototype",
    recommendedDefaultEnabled: true,
    recommendedCiFailureEligible: false,
    appliesTo: ["wallet-ui"],
    documentation: [
      {
        url: "https://docs.arc.io/integrate/wallets/fee-display",
        title: "How to: Display Transaction Fees",
        publisher: "Arc",
        claim:
          "Arc wallet UI should display fees in USDC or dollar terms rather than as ETH or Gwei.",
        support: "direct",
        verifiedAt: VERIFIED_AT,
        network: "Arc Testnet",
        stability: "versioned"
      }
    ],
    rationale:
      "ETH or Gwei user-facing labels misrepresent Arc fees, but those terms remain valid in internal EVM units and non-Arc contexts.",
    detectorLimitations: [
      "Line-level matching cannot distinguish rendered UI from internal calculations.",
      "Multichain labels and documentation can be flagged."
    ],
    deprecated: false
  },
  {
    id: "wallet/ONE_CONFIRMATION_FINAL",
    category: "wallet",
    rulePacks: ["wallet", "indexer-infrastructure"],
    taxonomy: "advice",
    impact: "recommendation",
    defaultConfidence: "medium",
    maturity: "prototype",
    recommendedDefaultEnabled: false,
    recommendedCiFailureEligible: false,
    appliesTo: ["transaction-confirmation"],
    documentation: [
      {
        url: "https://docs.arc.io/arc/concepts/deterministic-finality",
        title: "Deterministic finality",
        publisher: "Arc",
        claim:
          "A committed Arc block is final without a probabilistic confirmation window.",
        support: "direct",
        verifiedAt: VERIFIED_AT,
        stability: "stable"
      }
    ],
    rationale:
      "Waiting for additional confirmations normally adds latency rather than making the integration incompatible.",
    detectorLimitations: [
      "A confirmation value may apply to another network in a multichain application.",
      "The detector cannot distinguish finality policy from unrelated numeric settings."
    ],
    deprecated: false
  },
  {
    id: "wallet/PREVRANDAO_NOT_SUPPORTED",
    category: "wallet",
    rulePacks: ["solidity", "core-compatibility"],
    taxonomy: "experimental-compatibility",
    impact: "required-change",
    defaultConfidence: "low",
    maturity: "prototype",
    recommendedDefaultEnabled: true,
    recommendedCiFailureEligible: false,
    appliesTo: ["smart-contract"],
    documentation: [
      {
        url: "https://docs.arc.io/integrate/infrastructure",
        title: "Infrastructure Integration",
        publisher: "Arc",
        claim:
          "PREVRANDAO always returns zero on Arc; the page does not establish the detector's blanket mixHash equivalence.",
        support: "partial",
        verifiedAt: VERIFIED_AT,
        network: "Arc Testnet",
        stability: "versioned"
      }
    ],
    rationale:
      "Logic that expects PREVRANDAO entropy must change for Arc, while the current broad symbol matching and mixHash equivalence are not sufficiently precise.",
    detectorLimitations: [
      "Symbol presence does not prove that the value affects application behavior.",
      "The current mixHash equivalence is not sufficiently supported by official documentation."
    ],
    deprecated: false
  },
  {
    id: "wallet/WALLET_NATIVE_USDC_DISPLAY",
    category: "wallet",
    rulePacks: ["core-compatibility", "wallet"],
    taxonomy: "experimental-compatibility",
    impact: "required-change",
    defaultConfidence: "medium",
    maturity: "prototype",
    recommendedDefaultEnabled: true,
    recommendedCiFailureEligible: false,
    appliesTo: ["chain-configuration"],
    documentation: [
      {
        url: "https://docs.arc.io/integrate/wallets",
        title: "How to: Add Arc to a Wallet",
        publisher: "Arc",
        claim:
          "Arc chain metadata identifies USDC, rather than ETH, as Arc's native currency and gas token.",
        support: "direct",
        verifiedAt: VERIFIED_AT,
        network: "Arc Testnet",
        stability: "versioned"
      }
    ],
    rationale:
      "Explicit ETH, Ethereum, or non-USDC native-currency labels on a bounded Arc-owned chain object misrepresent Arc's native asset; object-local ownership prevents Ethereum siblings from lending evidence.",
    detectorLimitations: [
      "The bounded detector supports plain .js and .ts direct objects, direct defineChain objects, and one direct Arc-named wrapper child.",
      "Imports, computed metadata, arrays, deep wrappers, spreads, duplicate fields, malformed syntax, and runtime values remain unresolved.",
      "The detector intentionally does not interpret decimals because native accounting and display precision depend on the integration surface."
    ],
    deprecated: false
  }
] as const satisfies readonly RuleMetadata[];
