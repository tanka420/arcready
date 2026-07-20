import type { AppKit } from "@circle-fin/app-kit";

const displayChain = "arc-testnet";
const sourceChain = "Arc_Testnet";

export async function startArcBridge(appKit: AppKit, amount: number) {
  return appKit.bridge({
    sourceChain,
    displayChain,
    amount
  });
}

export async function spendUnifiedBalance(appKit: AppKit) {
  return appKit.unifiedBalance.spend({
    provider: "Circle Wallets",
    wallet: "server wallet",
    amount: "25.00"
  });
}

export function renderUnifiedBalanceConfirmation() {
  return "Confirm unifiedBalance spend payment";
}
