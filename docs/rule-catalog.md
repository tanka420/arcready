# Rule Catalog

ArcReady currently includes wallet, bridge, and App Kit rule packs.

Rule groups:

- `rules/wallet`
- `rules/app-kit`
- `rules/bridge`

Preset groups:

- `presets/wallet`
- `presets/app-kit`
- `presets/bridge`

## Wallet Rules

| Rule ID                             | Severity | Docs Slug               |
| ----------------------------------- | -------- | ----------------------- |
| `wallet/ARC_CHAIN_METADATA`         | critical | `arc-chain-metadata`    |
| `wallet/WALLET_NATIVE_USDC_DISPLAY` | critical | `arc-usdc-gas`          |
| `wallet/NO_ETH_GAS_LABEL`           | critical | `arc-usdc-gas`          |
| `wallet/ONE_CONFIRMATION_FINAL`     | critical | `arc-finality`          |
| `wallet/PREVRANDAO_NOT_SUPPORTED`   | critical | `arc-prevrandao`        |
| `wallet/NO_BLOB_TX_ON_ARC`          | critical | `arc-blob-transactions` |

## Bridge Rules

| Rule ID                                      | Severity | Docs Slug              |
| -------------------------------------------- | -------- | ---------------------- |
| `bridge/BRIDGE_CONFIRMATIONS_ONE`            | critical | `arc-finality`         |
| `bridge/CCTP_DOMAIN_26`                      | critical | `arc-cctp-domain`      |
| `bridge/NO_WRAPPED_USDC_ON_ARC`              | critical | `arc-canonical-usdc`   |
| `bridge/RELAYER_USES_USDC_FOR_GAS`           | critical | `arc-usdc-gas`         |
| `bridge/ATTESTATION_404_NOT_FATAL`           | critical | `arc-cctp-attestation` |
| `bridge/NO_PREVRANDAO_RELAY_SELECTION`       | critical | `arc-prevrandao`       |

## App Kit Rules

| Rule ID                                      | Severity | Docs Slug                         |
| -------------------------------------------- | -------- | --------------------------------- |
| `app-kit/APPKIT_CHAIN_IDENTIFIER_VALID`      | critical | `arc-appkit-chain-identifier`     |
| `app-kit/APPKIT_CAPABILITY_SUPPORTED`        | warning  | `arc-appkit-capabilities`         |
| `app-kit/APPKIT_CUSTOM_RPC_RECOMMENDED`      | warning  | `arc-appkit-custom-rpc`           |
| `app-kit/UB_DELEGATE_REQUIRED`               | warning  | `arc-unified-balance-delegate`    |
| `app-kit/UB_FEE_EXPLANATION_PRESENT`         | warning  | `arc-unified-balance-fees`        |
| `app-kit/APPKIT_BRIDGE_MIN_AMOUNT_NOTE`      | warning  | `arc-appkit-bridge-min-amount`    |

Rules produce structured findings that terminal, JSON, Markdown, and HTML
reporters can render.
