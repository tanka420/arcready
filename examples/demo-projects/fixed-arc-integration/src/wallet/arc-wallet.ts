export const arcWalletChain = {
  name: "Arc Testnet",
  chainId: 5042002,
  nativeCurrency: {
    name: "USDC",
    symbol: "USDC",
    decimals: 6
  },
  rpcUrls: {
    default: {
      http: ["https://rpc.arc.example"]
    }
  },
  blockExplorers: {
    default: {
      url: "https://explorer.arc.example"
    }
  }
};

export const walletCopy = {
  networkFeeLabel: "Network fee: 0.01 USDC",
  pendingState: "Final after 1 Arc confirmation"
};

export async function waitForArcTransfer(hash: string) {
  return waitForTransactionReceipt({
    hash,
    confirmations: 1
  });
}

export function pickWalletOffer(account: string, offerCount: number) {
  return account.length % offerCount;
}

export function buildArcPaymentTransaction() {
  return {
    chainId: 5042002,
    to: "0x0000000000000000000000000000000000000000",
    value: 0n,
    type: 2
  };
}

declare function waitForTransactionReceipt(input: {
  hash: string;
  confirmations: number;
}): Promise<unknown>;
