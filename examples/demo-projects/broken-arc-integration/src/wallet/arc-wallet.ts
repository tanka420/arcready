export const arcWalletChain = {
  name: "Arc Testnet",
  chainId: 1,
  nativeCurrency: {
    name: "ETH",
    symbol: "ETH",
    decimals: 18
  },
  rpcUrls: {
    default: {
      http: ["https://mainnet.infura.io/v3/demo"]
    }
  },
  blockExplorers: {
    default: {
      url: "https://etherscan.io"
    }
  }
};

export const walletCopy = {
  networkFeeLabel: "Network fee: 0.01 ETH",
  pendingState: "Waiting for 6 confirmations before release"
};

export async function waitForArcTransfer(hash: string) {
  return waitForTransactionReceipt({
    hash,
    confirmations: 6
  });
}

export function pickWalletOffer(block: { prevrandao: bigint }) {
  return Number(block.prevrandao % 4n);
}

export function buildArcPaymentTransaction() {
  return {
    chainId: 5042002,
    to: "0x0000000000000000000000000000000000000000",
    value: 0n,
    type: 3,
    maxFeePerBlobGas: 1n
  };
}

declare function waitForTransactionReceipt(input: {
  hash: string;
  confirmations: number;
}): Promise<unknown>;
