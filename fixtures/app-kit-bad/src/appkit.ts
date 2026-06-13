import type { AppKit } from "@circle-fin/app-kit";

const chain = "arc_testnet";

export async function bridgeFromArc(appKit: AppKit, amount: number) {
  return appKit.bridge({
    sourceChain: chain,
    amount
  });
}
