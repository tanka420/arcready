# Rule Catalog

ArcReady currently includes the first wallet rule set. App Kit and bridge rules
are still placeholders.

Planned rule groups:

- `rules/wallet`
- `rules/app-kit`
- `rules/bridge`

Planned preset groups:

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

Rules produce structured findings that reporters can later render in terminal,
Markdown, JSON, and HTML formats.
