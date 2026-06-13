import { attestation404NotFatalRule } from "./attestation-404-not-fatal.js";
import { bridgeConfirmationsOneRule } from "./bridge-confirmations-one.js";
import { cctpDomain26Rule } from "./cctp-domain-26.js";
import { noPrevrandaoRelaySelectionRule } from "./no-prevrandao-relay-selection.js";
import { noWrappedUsdcOnArcRule } from "./no-wrapped-usdc-on-arc.js";
import { relayerUsesUsdcForGasRule } from "./relayer-uses-usdc-for-gas.js";

export {
  attestation404NotFatalRule,
  bridgeConfirmationsOneRule,
  cctpDomain26Rule,
  noPrevrandaoRelaySelectionRule,
  noWrappedUsdcOnArcRule,
  relayerUsesUsdcForGasRule
};

export const bridgeRules = [
  bridgeConfirmationsOneRule,
  cctpDomain26Rule,
  noWrappedUsdcOnArcRule,
  relayerUsesUsdcForGasRule,
  attestation404NotFatalRule,
  noPrevrandaoRelaySelectionRule
];
