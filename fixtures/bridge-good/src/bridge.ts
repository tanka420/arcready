export const ARC_DOMAIN = 26;

export const arcBridgeRoute = {
  chain: "Arc Testnet",
  cctp: true,
  token: "USDC",
  requiredConfirmations: 1,
  relayerGasToken: "USDC"
};

export function describeRelayerFunding() {
  return "Arc relayer wallets use USDC for gas.";
}
