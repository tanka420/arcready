import type { AppKit } from "@circle-fin/app-kit";

const chain = "Arc_Testnet";
const rpcUrl = process.env.ARC_RPC_URL;
const capabilities = ["bridge"];

export async function bridgeFromArc(appKit: AppKit, amount: number) {
  const minAmount = 10;
  const maxFee = 1;

  if (!capabilities.includes("bridge")) {
    return null;
  }

  if (amount <= minAmount) {
    return null;
  }

  return appKit.bridge({
    sourceChain: chain,
    amount,
    maxFee,
    rpcUrl
  });
}
