import type { AppKit } from "@circle-fin/app-kit";

const sourceChain = "Arc_Testnet";
const rpcUrl = process.env.ARC_RPC_URL;
const capabilities = ["bridge", "unifiedBalance"];

export async function startArcBridge(appKit: AppKit, amount: number) {
  const minAmount = 10;
  const maxFee = 1;

  if (!capabilities.includes("bridge")) {
    return null;
  }

  if (amount <= minAmount) {
    return null;
  }

  return appKit.bridge({
    sourceChain,
    amount,
    maxFee,
    rpcUrl
  });
}

export async function spendUnifiedBalance(appKit: AppKit) {
  const delegateWallet = await createDelegateWallet();

  return appKit.unifiedBalance.spend({
    delegateWallet,
    amount: "25.00"
  });
}

export function renderUnifiedBalanceConfirmation() {
  return "Confirm unifiedBalance spend with forwardingFee and receivedAmount shown before submission";
}

declare function createDelegateWallet(): Promise<unknown>;
