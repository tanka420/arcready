export const ARC_DOMAIN = 6;

export const arcCctpRoute = {
  chain: "Arc Testnet",
  cctp: true,
  depositForBurn: true,
  token: "USDC.e",
  requiredConfirmations: 6,
  relayerGasToken: "ETH"
};

export async function pollCctpAttestation(response: Response) {
  if (response.status === 404) {
    throw new Error("attestation failed");
  }

  return response.json();
}

export function chooseRelayer(block: { prevrandao: bigint }, relayers: string[]) {
  const relaySelection = Number(block.prevrandao % BigInt(relayers.length));
  return relayers[relaySelection];
}
