export const ARC_DOMAIN = 26;

export const arcCctpRoute = {
  chain: "Arc Testnet",
  cctp: true,
  depositForBurn: true,
  token: "USDC",
  requiredConfirmations: 1,
  relayerGasToken: "USDC"
};

export async function pollCctpAttestation(response: Response) {
  if (response.status === 404) {
    return {
      status: "pending",
      retry: true
    };
  }

  return response.json();
}

export function chooseRelayer(routeId: string, relayers: string[]) {
  const relaySelection = routeId.length % relayers.length;
  return relayers[relaySelection];
}
