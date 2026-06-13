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
  },
  confirmations: 1
};
