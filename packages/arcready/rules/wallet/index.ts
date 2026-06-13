import { arcChainMetadataRule } from "./arc-chain-metadata.js";
import { noBlobTxOnArcRule } from "./no-blob-tx-on-arc.js";
import { noEthGasLabelRule } from "./no-eth-gas-label.js";
import { oneConfirmationFinalRule } from "./one-confirmation-final.js";
import { prevrandaoNotSupportedRule } from "./prevrandao-not-supported.js";
import { walletNativeUsdcDisplayRule } from "./wallet-native-usdc-display.js";

export {
  arcChainMetadataRule,
  noBlobTxOnArcRule,
  noEthGasLabelRule,
  oneConfirmationFinalRule,
  prevrandaoNotSupportedRule,
  walletNativeUsdcDisplayRule
};

export const walletRules = [
  arcChainMetadataRule,
  walletNativeUsdcDisplayRule,
  noEthGasLabelRule,
  oneConfirmationFinalRule,
  prevrandaoNotSupportedRule,
  noBlobTxOnArcRule
];
