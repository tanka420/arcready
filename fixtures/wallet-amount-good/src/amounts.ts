import { createPublicClient, formatUnits, http } from "viem";

const client = createPublicClient({
  chain: { id: 5042002 },
  transport: http("https://rpc.testnet.arc.network")
});

const nativeBalance = await client.getBalance({
  address: "0x1111111111111111111111111111111111111111"
});

export const displayBalance = formatUnits(nativeBalance, 18);
