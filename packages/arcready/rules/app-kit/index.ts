import { appKitBridgeMinAmountNoteRule } from "./appkit-bridge-min-amount-note.js";
import { appKitCapabilitySupportedRule } from "./appkit-capability-supported.js";
import { appKitChainIdentifierValidRule } from "./appkit-chain-identifier-valid.js";
import { appKitCustomRpcRecommendedRule } from "./appkit-custom-rpc-recommended.js";
import { ubDelegateRequiredRule } from "./ub-delegate-required.js";
import { ubFeeExplanationPresentRule } from "./ub-fee-explanation-present.js";

export {
  appKitBridgeMinAmountNoteRule,
  appKitCapabilitySupportedRule,
  appKitChainIdentifierValidRule,
  appKitCustomRpcRecommendedRule,
  ubDelegateRequiredRule,
  ubFeeExplanationPresentRule
};

export const appKitRules = [
  appKitChainIdentifierValidRule,
  appKitCapabilitySupportedRule,
  appKitCustomRpcRecommendedRule,
  ubDelegateRequiredRule,
  ubFeeExplanationPresentRule,
  appKitBridgeMinAmountNoteRule
];
