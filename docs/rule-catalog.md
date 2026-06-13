# ArcReady Rule Catalog

## Scope note

ArcReady is a static CI quality gate for Arc integration patterns. It checks source and configuration text for common wallet, bridge, and App Kit mistakes before release.

ArcReady does not perform live Arc RPC checks, Circle API checks, on-chain transaction simulation, contract deployment validation, bridge runtime simulation, real App Kit runtime validation, or SaaS/dashboard monitoring.

## Summary table

| Preset | Rule ID | Severity | Purpose |
| --- | --- | --- | --- |
| Wallet | `wallet/ARC_CHAIN_METADATA` | Critical | Checks Arc wallet chain metadata for Arc chain ID and Arc-specific RPC/explorer settings. |
| Wallet | `wallet/WALLET_NATIVE_USDC_DISPLAY` | Critical | Checks whether Arc native asset, gas-token, or fee-token display appears to use ETH instead of USDC. |
| Wallet | `wallet/NO_ETH_GAS_LABEL` | Critical | Checks Arc wallet fee UI text for ETH or gwei gas labels. |
| Wallet | `wallet/ONE_CONFIRMATION_FINAL` | Critical | Checks Arc wallet transaction flows for Ethereum-style multi-confirmation waits. |
| Wallet | `wallet/PREVRANDAO_NOT_SUPPORTED` | Critical | Checks Arc wallet code for active PREVRANDAO or mixHash assumptions. |
| Wallet | `wallet/NO_BLOB_TX_ON_ARC` | Critical | Checks Arc wallet flows for EIP-4844 blob transaction assumptions. |
| Bridge | `bridge/BRIDGE_CONFIRMATIONS_ONE` | Critical | Checks Arc bridge and relayer flows for more than one required confirmation. |
| Bridge | `bridge/CCTP_DOMAIN_26` | Critical | Checks Arc CCTP domain configuration for domain `26`. |
| Bridge | `bridge/NO_WRAPPED_USDC_ON_ARC` | Critical | Checks Arc bridge routes for wrapped or bridged USDC as the Arc-side asset. |
| Bridge | `bridge/RELAYER_USES_USDC_FOR_GAS` | Critical | Checks Arc relayer funding and gas-token config for ETH gas assumptions. |
| Bridge | `bridge/ATTESTATION_404_NOT_FATAL` | Critical | Checks CCTP attestation polling for fatal handling of retryable `404` responses. |
| Bridge | `bridge/NO_PREVRANDAO_RELAY_SELECTION` | Critical | Checks Arc relay selection for PREVRANDAO or mixHash randomness assumptions. |
| App Kit | `app-kit/APPKIT_CHAIN_IDENTIFIER_VALID` | Critical | Checks App Kit Arc chain identifiers for unsupported spellings. |
| App Kit | `app-kit/APPKIT_CAPABILITY_SUPPORTED` | Warning | Checks App Kit Arc capability calls for missing supported-capability guards. |
| App Kit | `app-kit/APPKIT_CUSTOM_RPC_RECOMMENDED` | Warning | Checks App Kit Arc Testnet usage for implicit or shared RPC configuration. |
| App Kit | `app-kit/UB_DELEGATE_REQUIRED` | Warning | Checks Unified Balance spend flows that may need delegate wallet handling. |
| App Kit | `app-kit/UB_FEE_EXPLANATION_PRESENT` | Warning | Checks Unified Balance confirmation UI for missing fee or received-amount context. |
| App Kit | `app-kit/APPKIT_BRIDGE_MIN_AMOUNT_NOTE` | Warning | Checks Arc-origin App Kit bridge flows for missing minimum amount or fee guardrails. |

## Wallet preset

### ARC_CHAIN_METADATA

- Preset: Wallet
- Severity: Critical
- What it detects: Arc-related wallet chain config that appears to omit Arc Testnet chain ID `5042002`, or mixes Arc metadata with obvious non-Arc RPC/explorer settings.
- Why it matters: Incorrect chain metadata can send users, RPC calls, or explorer links toward the wrong network context.
- Example bad pattern:

  ```ts
  export const arc = {
    name: "Arc Testnet",
    chainId: 1,
    rpcUrls: { default: { http: ["https://mainnet.infura.io"] } }
  };
  ```

- Suggested fix: Verify the Arc wallet chain config uses chain ID `5042002`, Arc RPC/explorer metadata, and USDC native asset display.
- Static-analysis limitation: ArcReady checks source/config patterns; it does not call RPC endpoints or verify live chain metadata.

### WALLET_NATIVE_USDC_DISPLAY

- Preset: Wallet
- Severity: Critical
- What it detects: Arc wallet native currency, gas-token, or fee-token display fields that appear to use `ETH` or `Ethereum`.
- Why it matters: Arc fee UX should not teach users to expect ETH as the native fee asset when fees should be shown as USDC.
- Example bad pattern:

  ```ts
  export const arc = {
    name: "Arc Testnet",
    chainId: 5042002,
    nativeCurrency: { name: "ETH", symbol: "ETH" }
  };
  ```

- Suggested fix: Check `nativeCurrency`, gas-token, and fee-token display fields; Arc fees should be shown as USDC.
- Static-analysis limitation: ArcReady looks for display/config patterns; it does not inspect wallet runtime state.

### NO_ETH_GAS_LABEL

- Preset: Wallet
- Severity: Critical
- What it detects: Arc wallet fee UI text that appears to label gas or network fees as `ETH` or `gwei`.
- Why it matters: User-facing fee labels should match Arc's USDC fee assumptions and avoid Ethereum-default language.
- Example bad pattern:

  ```ts
  const chainId = 5042002;
  const feeLabel = "Network fee: 0.01 ETH";
  ```

- Suggested fix: Update user-facing gas and network fee labels to show USDC, and verify no Arc fee UI still references ETH or gwei.
- Static-analysis limitation: ArcReady checks text patterns and skips obvious comments/guidance; it does not render or inspect a live UI.

### ONE_CONFIRMATION_FINAL

- Preset: Wallet
- Severity: Critical
- What it detects: Arc wallet transaction flows that appear to wait for more than one confirmation.
- Why it matters: Ethereum-style multi-confirmation waiting can unnecessarily delay Arc wallet UX.
- Example bad pattern:

  ```ts
  const chainId = 5042002;
  await waitForTransactionReceipt({ hash, confirmations: 12 });
  ```

- Suggested fix: Set Arc confirmation waits and release logic to `1` confirmation; avoid Ethereum-style multi-confirmation delays.
- Static-analysis limitation: ArcReady detects common source patterns; it does not observe actual transaction finality.

### PREVRANDAO_NOT_SUPPORTED

- Preset: Wallet
- Severity: Critical
- What it detects: Arc wallet code that appears to actively read `block.prevrandao`, `PREVRANDAO`, `prevrandao`, or `mixHash`.
- Why it matters: Wallet flows should not rely on unsupported randomness assumptions for Arc.
- Example bad pattern:

  ```ts
  const chainId = 5042002;
  const seed = block.prevrandao;
  ```

- Suggested fix: Replace PREVRANDAO or mixHash assumptions with deterministic logic or another randomness source documented for your Arc integration.
- Static-analysis limitation: ArcReady checks active-looking source references; it does not validate randomness quality at runtime.

### NO_BLOB_TX_ON_ARC

- Preset: Wallet
- Severity: Critical
- What it detects: Arc wallet transaction code that appears to assume EIP-4844 blob transaction support.
- Why it matters: Blob transaction assumptions can produce invalid transaction configuration for Arc wallet flows.
- Example bad pattern:

  ```ts
  const chainId = 5042002;
  const tx = { type: 3, maxFeePerBlobGas: 1n };
  ```

- Suggested fix: Remove EIP-4844 blob transaction fields from Arc wallet flows and use a normal EIP-1559 transaction configuration.
- Static-analysis limitation: ArcReady checks source patterns; it does not submit or simulate transactions.

## Bridge preset

### BRIDGE_CONFIRMATIONS_ONE

- Preset: Bridge
- Severity: Critical
- What it detects: Arc bridge or relayer flows that appear to require more than one confirmation or finality block.
- Why it matters: Extra confirmation waits can delay settlement or release logic in Arc bridge flows.
- Example bad pattern:

  ```ts
  export const arcBridge = {
    chain: "Arc Testnet",
    requiredConfirmations: 12
  };
  ```

- Suggested fix: Set Arc bridge confirmation or finality settings to `1`, and review any relayer release logic that waits for additional confirmations.
- Static-analysis limitation: ArcReady checks configuration/code patterns; it does not simulate bridge settlement.

### CCTP_DOMAIN_26

- Preset: Bridge
- Severity: Critical
- What it detects: Arc CCTP domain config that appears to use a value other than `26`.
- Why it matters: CCTP domain mismatches can route bridge logic to the wrong chain domain.
- Example bad pattern:

  ```ts
  export const ARC_DOMAIN = 6;
  ```

- Suggested fix: Check the CCTP domain map and set the Arc domain value to `26` wherever Arc routes are configured.
- Static-analysis limitation: ArcReady checks source/config patterns; it does not call Circle APIs or execute CCTP transfers.

### NO_WRAPPED_USDC_ON_ARC

- Preset: Bridge
- Severity: Critical
- What it detects: Arc bridge routes that appear to use `USDC.e`, `wUSDC`, wrapped USDC, or bridged USDC as the Arc-side asset.
- Why it matters: Arc bridge integrations should avoid modeling wrapped or bridged USDC as the Arc asset when canonical USDC is expected.
- Example bad pattern:

  ```ts
  export const route = {
    chain: "Arc Testnet",
    bridge: true,
    token: "USDC.e"
  };
  ```

- Suggested fix: Use canonical Arc USDC through the intended bridge route, and remove Arc-side `USDC.e`, `wUSDC`, or bridged-USDC asset mappings.
- Static-analysis limitation: ArcReady checks route and token text; it does not verify token contracts or bridge liquidity.

### RELAYER_USES_USDC_FOR_GAS

- Preset: Bridge
- Severity: Critical
- What it detects: Arc relayer funding or gas-token configuration that appears to assume ETH is used for gas.
- Why it matters: Relayer setup should model Arc gas as USDC to avoid funding and operations mistakes.
- Example bad pattern:

  ```ts
  export const arcRelayer = {
    chain: "Arc Testnet",
    relayerGasToken: "ETH"
  };
  ```

- Suggested fix: Check relayer funding and gas-token config; Arc relayer gas should be modeled as USDC rather than ETH.
- Static-analysis limitation: ArcReady checks config and setup text; it does not inspect relayer balances or execute relayer jobs.

### ATTESTATION_404_NOT_FATAL

- Preset: Bridge
- Severity: Critical
- What it detects: CCTP attestation polling code that appears to treat HTTP `404` as a fatal bridge error instead of a pending/retryable state.
- Why it matters: Early attestation polling can produce `404` while an attestation is not ready yet; treating it as terminal can break bridge UX.
- Example bad pattern:

  ```ts
  async function pollAttestation(response: Response) {
    if (response.status === 404) {
      throw new Error("attestation failed");
    }
  }
  ```

- Suggested fix: Treat CCTP attestation `404` as a retryable pending state while polling, not as a terminal bridge failure.
- Static-analysis limitation: ArcReady checks error-handling source patterns; it does not poll Circle services or validate bridge execution.

### NO_PREVRANDAO_RELAY_SELECTION

- Preset: Bridge
- Severity: Critical
- What it detects: Arc relay selection logic that appears to use PREVRANDAO, `prevrandao`, `block.prevrandao`, or `mixHash` randomness.
- Why it matters: Relay selection should not depend on unsupported randomness assumptions.
- Example bad pattern:

  ```ts
  const chain = "Arc Testnet";
  const relaySelection = block.prevrandao % relayers.length;
  ```

- Suggested fix: Replace PREVRANDAO or mixHash-based relay selection with deterministic selection, offchain coordination, or another documented randomness source.
- Static-analysis limitation: ArcReady checks source patterns; it does not evaluate relayer selection fairness or runtime execution.

## App Kit preset

### APPKIT_CHAIN_IDENTIFIER_VALID

- Preset: App Kit
- Severity: Critical
- What it detects: App Kit Arc chain identifiers that appear to use unsupported spellings such as `arc-testnet`, `arc_testnet`, `ArcTestnet`, `Arc Testnet`, `Arc`, `arc`, or `ARC`.
- Why it matters: App Kit configuration expects the case-sensitive Arc identifier shape used by the integration.
- Example bad pattern:

  ```ts
  import { AppKit } from "@circle-fin/app-kit";

  const chain = "arc-testnet";
  ```

- Suggested fix: Use the case-sensitive App Kit chain identifier `Arc_Testnet` wherever Arc is passed to App Kit configuration or calls.
- Static-analysis limitation: ArcReady checks source text; it does not initialize or call App Kit at runtime.

### APPKIT_CAPABILITY_SUPPORTED

- Preset: App Kit
- Severity: Warning
- What it detects: App Kit Arc capability calls such as send, bridge, swap, or Unified Balance paths that appear to run without a supported-capability guard.
- Why it matters: Capability support can differ by chain or context, so App Kit flows should guard unsupported paths before calling them.
- Example bad pattern:

  ```ts
  import { AppKit } from "@circle-fin/app-kit";

  const chain = "Arc_Testnet";
  await appKit.bridge({ amount });
  ```

- Suggested fix: Check supported App Kit capabilities for `Arc_Testnet` and guard send, bridge, swap, or Unified Balance paths before calling them.
- Static-analysis limitation: ArcReady checks for common guard patterns; it does not query App Kit capabilities at runtime.

### APPKIT_CUSTOM_RPC_RECOMMENDED

- Preset: App Kit
- Severity: Warning
- What it detects: App Kit Arc Testnet usage that appears to rely on implicit or shared RPC configuration.
- Why it matters: Explicit RPC configuration makes CI, staging, and production-like behavior easier to reason about.
- Example bad pattern:

  ```ts
  import { AppKit } from "@circle-fin/app-kit";

  const chain = "Arc_Testnet";
  ```

- Suggested fix: Add an explicit Arc RPC setting such as `rpcUrl`, `rpcUrls`, `transport`, `provider`, `client`, or `ARC_RPC_URL` for this App Kit integration.
- Static-analysis limitation: ArcReady checks local source/config evidence; it does not perform live RPC checks.

### UB_DELEGATE_REQUIRED

- Preset: App Kit
- Severity: Warning
- What it detects: Unified Balance spend flows that may be missing delegate wallet handling when provider/signing context suggests it could be needed.
- Why it matters: Some Unified Balance spend paths may need an explicit delegate wallet flow so spend approvals can be handled correctly.
- Example bad pattern:

  ```ts
  import { AppKit } from "@circle-fin/app-kit";

  await appKit.unifiedBalance.spend({
    provider: "Circle Wallets",
    wallet: "server wallet"
  });
  ```

- Suggested fix: Check whether this Unified Balance spend path needs a delegate wallet flow, and add explicit delegate handling when the signer cannot approve spends directly.
- Static-analysis limitation: ArcReady checks wording and code patterns; it does not validate signer capabilities or App Kit runtime behavior.

### UB_FEE_EXPLANATION_PRESENT

- Preset: App Kit
- Severity: Warning
- What it detects: Unified Balance confirmation UI that appears to omit fee or received-amount context.
- Why it matters: Users should understand spend amount, received amount, fees, and source gas before confirming a payment or checkout.
- Example bad pattern:

  ```ts
  import { AppKit } from "@circle-fin/app-kit";

  export function Confirm() {
    return "Confirm unifiedBalance spend payment";
  }
  ```

- Suggested fix: Add user-facing confirmation copy for spend amount, destination received amount, forwarding or protocol fees, and source gas before submission.
- Static-analysis limitation: ArcReady checks source text; it does not render the UI or inspect runtime checkout state.

### APPKIT_BRIDGE_MIN_AMOUNT_NOTE

- Preset: App Kit
- Severity: Warning
- What it detects: Arc-origin App Kit bridge flows that appear to omit minimum amount or fee guardrails.
- Why it matters: Users should see minimum amount and fee context before starting a bridge flow where fees may affect the effective transfer.
- Example bad pattern:

  ```ts
  import { AppKit } from "@circle-fin/app-kit";

  await appKit.bridge({
    sourceChain: "Arc_Testnet",
    amount
  });
  ```

- Suggested fix: Add user-facing minimum amount and fee guardrails before starting an Arc-origin App Kit bridge flow.
- Static-analysis limitation: ArcReady checks static bridge-flow patterns; it does not execute App Kit bridge calls or validate runtime fee quotes.

## Static analysis limitations

ArcReady favors conservative static checks. Findings mean the source code appears to contain a risky integration pattern, not that ArcReady has proven a runtime failure.

ArcReady does not:

- perform live Arc RPC checks
- call Circle APIs
- simulate on-chain transactions
- validate contract deployments
- simulate bridge execution
- run real App Kit runtime validation
- provide SaaS/dashboard monitoring

Use findings as developer-side release checks and review them alongside current Arc, Circle, and project-specific integration documentation.

## Independent disclaimer

ArcReady is an independent open-source developer tool. It is not an official Circle or Arc product.
