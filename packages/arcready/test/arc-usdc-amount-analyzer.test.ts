import { describe, expect, it } from "vitest";
import {
  DEFAULT_CONFIG,
  arcUsdcAmountConversionRule,
  runRules
} from "../src/index.js";
import type { RuleContext } from "../src/index.js";
import {
  analyzeArcUsdcAmountFile,
  supportsArcUsdcAmountPath
} from "../rules/wallet/arc-usdc-amount-analyzer.js";
import type { ArcUsdcAmountIssueKind } from "../rules/wallet/arc-usdc-amount-analyzer.js";

const RPC = "https://rpc.testnet.arc.network";
const USDC = "0x3600000000000000000000000000000000000000";
const VIEM_IMPORT =
  'import { createPublicClient, formatUnits, http } from "viem";';
const ARC_CLIENT = `${VIEM_IMPORT}
const client = createPublicClient({ chain: { id: 5042002 }, transport: http("${RPC}") });`;
const NATIVE = "await client.getBalance({ address: account })";
const ERC20 = `await client.readContract({ address: "${USDC}", functionName: "balanceOf", args: [account] })`;
const viemCase = (config: string, amount: string = NATIVE, decimals = 6) =>
  `${VIEM_IMPORT}\nconst client = createPublicClient(${config});\nformatUnits(${amount}, ${decimals});`;
const ethersCase = (
  providerArgs: string,
  amount = "await provider.getBalance(account)"
) =>
  `import { JsonRpcProvider, formatUnits } from "ethers";\nconst provider = new JsonRpcProvider(${providerArgs});\nformatUnits(${amount}, 6);`;
const balanceOf = (args: string) =>
  `await client.readContract({ address: "${USDC}", functionName: "balanceOf"${args} })`;

describe("Arc USDC amount analyzer", () => {
  const positives: readonly [string, string, ArcUsdcAmountIssueKind, string][] =
    [
      [
        "P01 proven viem bound native balance",
        `${ARC_CLIENT}\nconst balance = ${NATIVE};\nformatUnits(balance, 6);`,
        "native-read-as-erc20",
        "formatUnits(balance"
      ],
      [
        "P02 direct nested viem native source",
        `${ARC_CLIENT}\nformatUnits(${NATIVE}, 6);`,
        "native-read-as-erc20",
        "formatUnits("
      ],
      [
        "P03 proven ethers Arc provider",
        `import { JsonRpcProvider, formatUnits } from "ethers";
const provider = new JsonRpcProvider("${RPC}");
const balance = await provider.getBalance(account);
formatUnits(balance, 6);`,
        "native-read-as-erc20",
        "formatUnits(balance"
      ],
      [
        "P04 async function native balance",
        `${ARC_CLIENT}
async function render() {
  const balance = ${NATIVE};
  return formatUnits(balance, 6);
}`,
        "native-read-as-erc20",
        "formatUnits(balance"
      ],
      [
        "P05 one-hop chain and config ownership",
        `${VIEM_IMPORT}
const chain = { id: 5042002 };
const config = { chain: chain, transport: http("${RPC}") };
const client = createPublicClient(config);
formatUnits(${NATIVE}, 6);`,
        "native-read-as-erc20",
        "formatUnits("
      ],
      [
        "P06 exact Arc USDC balanceOf",
        `${ARC_CLIENT}\nformatUnits(${ERC20}, 18);`,
        "erc20-read-as-native",
        "formatUnits("
      ],
      [
        "P07 one-hop address and bound balance",
        `${ARC_CLIENT}
const ARC_USDC = "${USDC.toUpperCase()}";
const balance = await client.readContract({ address: ARC_USDC, functionName: "balanceOf", args: [account] });
formatUnits(balance, 18);`,
        "erc20-read-as-native",
        "formatUnits(balance"
      ],
      [
        "P08 aliased viem imports",
        `import { createPublicClient as createClient, formatUnits as format, http as transport } from "viem";
const client = createClient({ transport: transport("${RPC}") });
format(await client.getBalance({ address: account }), 6);`,
        "native-read-as-erc20",
        "format("
      ],
      [
        "P09 aliased ethers imports",
        `import { JsonRpcProvider as Provider, formatUnits as ethersFormat } from "ethers";
const provider = new Provider("${RPC}");
ethersFormat(await provider.getBalance(account), 6);`,
        "native-read-as-erc20",
        "ethersFormat("
      ],
      [
        "P10 namespace ethers formatter",
        `import * as ethers from "ethers";
const provider = new ethers.JsonRpcProvider("${RPC}");
ethers.formatUnits(await provider.getBalance(account), 6);`,
        "native-read-as-erc20",
        "ethers.formatUnits("
      ],
      [
        "P11 native decimal constant",
        `${ARC_CLIENT}\nconst DECIMALS = 6;\nformatUnits(${NATIVE}, DECIMALS);`,
        "native-read-as-erc20",
        "formatUnits("
      ],
      [
        "P11 ERC-20 decimal constant",
        `${ARC_CLIENT}\nconst DECIMALS = 18;\nformatUnits(${ERC20}, DECIMALS);`,
        "erc20-read-as-native",
        "formatUnits("
      ]
    ];

  it.each(positives)("%s", async (_name, source, kind, sink) => {
    const expected = [{ kind, offset: source.indexOf(sink) }];
    const first = await analyzeArcUsdcAmountFile("src/amounts.ts", source);
    const second = await analyzeArcUsdcAmountFile("src/amounts.ts", source);

    expect(first).toEqual(expected);
    expect(second).toEqual(first);
  });

  it("P12 and P13 returns both bad sinks in deterministic source order", async () => {
    const source = `${ARC_CLIENT}
formatUnits(${ERC20}, 18);
formatUnits(${NATIVE}, 6);`;
    const first = await analyzeArcUsdcAmountFile("src/amounts.ts", source);
    const second = await analyzeArcUsdcAmountFile("src/amounts.ts", source);
    const offsets = [...source.matchAll(/formatUnits\(/g)].map(
      (match) => match.index
    );

    expect(first).toEqual([
      { kind: "erc20-read-as-native", offset: offsets[0] },
      { kind: "native-read-as-erc20", offset: offsets[1] }
    ]);
    expect(second).toEqual(first);
  });

  const correctConversions: readonly [string, string][] = [
    [
      "C01 native formatted with 18",
      `${ARC_CLIENT}\nformatUnits(${NATIVE}, 18);`
    ],
    [
      "C02 native divided by power",
      `${ARC_CLIENT}\nformatUnits((${NATIVE}) / 10n ** 12n, 6);`
    ],
    [
      "C03 native divided by direct factor",
      `${ARC_CLIENT}\nformatUnits((${NATIVE}) / 1_000_000_000_000n, 6);`
    ],
    [
      "C04 native divided with OFFSET",
      `${ARC_CLIENT}\nconst OFFSET = 12n;\nformatUnits((${NATIVE}) / 10n ** OFFSET, 6);`
    ],
    ["C05 ERC-20 formatted with 6", `${ARC_CLIENT}\nformatUnits(${ERC20}, 6);`],
    [
      "C06 ERC-20 multiplied by power",
      `${ARC_CLIENT}\nformatUnits((${ERC20}) * 10n ** 12n, 18);`
    ],
    [
      "C07 ERC-20 multiplied by direct factor",
      `${ARC_CLIENT}\nformatUnits((${ERC20}) * 1_000_000_000_000n, 18);`
    ],
    [
      "C08 commuted ERC-20 multiplication",
      `${ARC_CLIENT}\nformatUnits(10n ** 12n * (${ERC20}), 18);`
    ],
    [
      "C09 one factor constant",
      `${ARC_CLIENT}\nconst FACTOR = 1_000_000_000_000n;\nformatUnits((${ERC20}) * FACTOR, 18);`
    ],
    [
      "C10 bound source converted directly in formatter",
      `${ARC_CLIENT}\nconst balance = ${NATIVE};\nformatUnits(balance / 10n ** 12n, 6);`
    ]
  ];

  it.each(correctConversions)("keeps %s silent", async (_name, source) => {
    await expect(
      analyzeArcUsdcAmountFile("src/amounts.ts", source)
    ).resolves.toEqual([]);
  });

  const negatives: readonly [string, string, string?][] = [
    [
      "N01 Ethereum provider formatted with 18",
      `import { JsonRpcProvider, formatUnits } from "ethers"; const provider = new JsonRpcProvider("https://cloudflare-eth.com"); formatUnits(await provider.getBalance(account), 18);`
    ],
    [
      "N02 Ethereum provider formatted with 6",
      `import { JsonRpcProvider, formatUnits } from "ethers"; const provider = new JsonRpcProvider("https://cloudflare-eth.com"); formatUnits(await provider.getBalance(account), 6);`
    ],
    [
      "N03 imported provider",
      `import { provider, formatUnits } from "ethers"; formatUnits(await provider.getBalance(account), 6);`
    ],
    [
      "N04 generic getBalance helper",
      `${VIEM_IMPORT}\nformatUnits(await getBalance(account), 6);`
    ],
    [
      "N05 generic transfer helper",
      `${ARC_CLIENT}\nformatUnits(await transfer(account), 6);`
    ],
    [
      "N06 arbitrary 18-decimal token",
      `${ARC_CLIENT}\nformatUnits(await client.readContract({ address: "0x1111111111111111111111111111111111111111", functionName: "balanceOf" }), 18);`
    ],
    [
      "N07 other six-decimal token",
      `${ARC_CLIENT}\nformatUnits(await client.readContract({ address: "0x2222222222222222222222222222222222222222", functionName: "balanceOf" }), 18);`
    ],
    [
      "N08 another-chain USDC",
      `${VIEM_IMPORT}\nconst client = createPublicClient({ chain: { id: 1 }, transport: customTransport });\nformatUnits(${ERC20}, 18);`
    ],
    [
      "N09 unresolved address constant",
      `${ARC_CLIENT}\nformatUnits(await client.readContract({ address: tokenAddress, functionName: "balanceOf" }), 18);`
    ],
    [
      "N10 imported Arc USDC address",
      `${ARC_CLIENT}\nimport { ARC_USDC } from "./tokens.js";\nformatUnits(await client.readContract({ address: ARC_USDC, functionName: "balanceOf" }), 18);`
    ],
    [
      "N11 lookalike Arc address",
      `${ARC_CLIENT}\nformatUnits(await client.readContract({ address: "${USDC.slice(0, -1)}1", functionName: "balanceOf" }), 18);`
    ],
    ["N12 comment", `${ARC_CLIENT}\n// formatUnits(${NATIVE}, 6);`],
    ["N13 string", `${ARC_CLIENT}\nconst example = "formatUnits(balance, 6)";`],
    [
      "N14 template",
      `${ARC_CLIENT}\nconst example = \`formatUnits(balance, 6)\`;`
    ],
    [
      "N15 regex",
      `${ARC_CLIENT}\nconst example = /formatUnits\\(balance, 6\\)/;`
    ],
    ["N16 JSX", `${ARC_CLIENT}\nformatUnits(${NATIVE}, 6);`, "src/amounts.jsx"],
    ["N16 TSX", `${ARC_CLIENT}\nformatUnits(${NATIVE}, 6);`, "src/amounts.tsx"],
    [
      "N17 test path",
      `${ARC_CLIENT}\nformatUnits(${NATIVE}, 6);`,
      "src/amounts.test.ts"
    ],
    [
      "N18 reassigned amount",
      `${ARC_CLIENT}\nlet balance = ${NATIVE};\nbalance = 1n;\nformatUnits(balance, 6);`
    ],
    [
      "N19 conditional amount",
      `${ARC_CLIENT}\nconst balance = enabled ? ${NATIVE} : 0n;\nformatUnits(balance, 6);`
    ],
    [
      "N20 two-hop amount alias",
      `${ARC_CLIENT}\nconst first = ${NATIVE};\nconst second = first;\nformatUnits(second, 6);`
    ],
    [
      "N21 Arc and Ethereum clients remain isolated",
      `${VIEM_IMPORT}
const arcClient = createPublicClient({ chain: { id: 5042002 } });
const ethClient = createPublicClient({ chain: { id: 1 } });
formatUnits(await arcClient.getBalance({ address: account }), 18);
formatUnits(await ethClient.getBalance({ address: account }), 6);`
    ],
    [
      "N22 valid Arc client and unrelated Ethereum sink",
      `${ARC_CLIENT}\nconst ethereum = createPublicClient({ chain: { id: 1 } });\nformatUnits(await ethereum.getBalance({ address: account }), 6);`
    ],
    [
      "N23 native and ERC-20 reads coexist safely",
      `${ARC_CLIENT}\nformatUnits(${NATIVE}, 18);\nformatUnits(${ERC20}, 6);`
    ],
    ["N24 decimal literal alone", `${ARC_CLIENT}\nconst decimals = 6;`],
    [
      "N25 unproven formatUnits",
      `${ARC_CLIENT}\nuserFormatUnits(${NATIVE}, 6);`
    ],
    ["N26 parseUnits", `${ARC_CLIENT}\nparseUnits("1", 6);`],
    [
      "N27 arithmetic without source",
      `${VIEM_IMPORT}\nformatUnits(value / 10n ** 12n, 6);`
    ],
    [
      "N28 optional chaining",
      `${ARC_CLIENT}\nformatUnits(await client?.getBalance({ address: account }), 6);`
    ],
    [
      "N29 destructured result",
      `${ARC_CLIENT}\nconst { balance } = await client.request({ method: "eth_getBalance" });\nformatUnits(balance, 6);`
    ],
    ["N30 malformed source", `${ARC_CLIENT}\nformatUnits(${NATIVE}, 6`],
    [
      "N31 decoded event value",
      `${ARC_CLIENT}\nformatUnits(decodedTransfer.args.value, 18);`
    ],
    [
      "N32 dynamic functionName",
      `${ARC_CLIENT}\nformatUnits(await client.readContract({ address: "${USDC}", functionName }), 18);`
    ],
    [
      "N33 computed address",
      `${ARC_CLIENT}\nconst address = getAddress();\nformatUnits(await client.readContract({ address, functionName: "balanceOf" }), 18);`
    ],
    [
      "N34 contract instance balanceOf",
      `${ARC_CLIENT}\nformatUnits(await contract.balanceOf(account), 18);`
    ],
    [
      "N35 unknown custom RPC",
      `${VIEM_IMPORT}\nconst client = createPublicClient({ transport: http("https://rpc.corp.example") });\nformatUnits(${NATIVE}, 6);`
    ],
    [
      "N36 Arc-looking receiver name",
      `${VIEM_IMPORT}\nformatUnits(await arcClient.getBalance({ address: account }), 6);`
    ],
    [
      "N37 non-Arc chain despite name",
      `${VIEM_IMPORT}\nconst arcClient = createPublicClient({ chain: { id: 1 } });\nformatUnits(await arcClient.getBalance({ address: account }), 6);`
    ],
    [
      "N37 reassigned local client",
      `${VIEM_IMPORT}\nlet client = createPublicClient({ chain: { id: 5042002 } });\nclient = other;\nformatUnits(${ERC20}, 18);`
    ],
    [
      "N38 multi-hop factor",
      `${ARC_CLIENT}\nconst BASE = 10n;\nconst OFFSET = 12n;\nconst FACTOR = BASE ** OFFSET;\nformatUnits((${NATIVE}) / FACTOR, 6);`
    ],
    [
      "N39 safe conversion beyond supported depth",
      `${ARC_CLIENT}\nconst balance = ${NATIVE};\nconst converted = balance / 10n ** 12n;\nformatUnits(converted, 6);`
    ],
    [
      "N40 native send write",
      `${ARC_CLIENT}\nawait client.sendTransaction({ value: 1_000_000n });`
    ],
    [
      "N41 ERC-20 transfer write",
      `${ARC_CLIENT}\nawait client.writeContract({ address: "${USDC}", functionName: "transfer", args: [account, 1n] });`
    ]
  ];

  it.each(negatives)("keeps %s silent", async (_name, source, path) => {
    await expect(
      analyzeArcUsdcAmountFile(path ?? "src/amounts.ts", source)
    ).resolves.toEqual([]);
  });

  const lexicalNegatives: readonly [string, string][] = [
    [
      "L01 sibling client does not establish ownership",
      `${VIEM_IMPORT}\nfunction setup() { const client = createPublicClient({ chain: { id: 5042002 } }); }\nasync function render() { return formatUnits(await client.getBalance({ address: account }), 6); }`
    ],
    [
      "L02 sibling amount does not establish provenance",
      `${ARC_CLIENT}\nasync function load() { const balance = ${NATIVE}; }\nfunction render() { return formatUnits(balance, 6); }`
    ],
    [
      "L03 child-scope client does not escape",
      `${VIEM_IMPORT}\nif (ready) { const client = createPublicClient({ chain: { id: 5042002 } }); }\nformatUnits(await client.getBalance({ address: account }), 6);`
    ],
    [
      "L05 local non-Arc client shadows outer Arc client",
      `${ARC_CLIENT}\nasync function render() { const client = createPublicClient({ chain: { id: 1 } }); return formatUnits(await client.getBalance({ address: account }), 6); }`
    ],
    [
      "L06 local formatter shadows imported formatUnits",
      `${ARC_CLIENT}\nfunction render(balance) { const formatUnits = customFormatter; return formatUnits(balance, 6); }`
    ],
    [
      "L08 local function shadows imported createPublicClient",
      `${VIEM_IMPORT}\nasync function render() { function createPublicClient(config) { return customClient(config); } const client = createPublicClient({ chain: { id: 5042002 } }); return formatUnits(await client.getBalance({ address: account }), 6); }`
    ],
    [
      "L09 local binding shadows ethers namespace import",
      `import * as ethers from "ethers";\nasync function render() { const ethers = customEthers; const provider = new ethers.JsonRpcProvider("${RPC}"); return ethers.formatUnits(await provider.getBalance(account), 6); }`
    ],
    [
      "L11 use before local const declaration is silent",
      `${ARC_CLIENT}\nasync function render() { const value = formatUnits(await client.getBalance({ address: account }), 6); const client = createPublicClient({ chain: { id: 5042002 } }); return value; }`
    ],
    [
      "L11 duplicate declarations in one scope are ambiguous",
      `${VIEM_IMPORT}\nasync function render() { const client = createPublicClient({ chain: { id: 5042002 } }); const client = createPublicClient({ chain: { id: 5042002 } }); return formatUnits(await client.getBalance({ address: account }), 6); }`
    ]
  ];

  it.each(lexicalNegatives)("%s", async (_name, source) => {
    await expect(
      analyzeArcUsdcAmountFile("src/lexical.ts", source)
    ).resolves.toEqual([]);
  });

  const lexicalPositives: readonly [
    string,
    string,
    ArcUsdcAmountIssueKind,
    string
  ][] = [
    [
      "L04 top-level Arc client remains visible in a nested function",
      `${ARC_CLIENT}\nasync function render() { return formatUnits(await client.getBalance({ address: account }), 6); }`,
      "native-read-as-erc20",
      "formatUnits("
    ],
    [
      "L07 unshadowed formatter import remains visible in a function",
      `${ARC_CLIENT}\nasync function render() { return formatUnits(${ERC20}, 18); }`,
      "erc20-read-as-native",
      "formatUnits("
    ],
    [
      "L10 unshadowed aliased imports remain supported",
      `import { createPublicClient as createClient, formatUnits as format } from "viem";\nconst client = createClient({ chain: { id: 5042002 }, transport: customTransport });\nasync function render() { return format(await client.getBalance({ address: account }), 6); }`,
      "native-read-as-erc20",
      "format("
    ],
    [
      "L12 same-name sibling bindings remain isolated",
      `${VIEM_IMPORT}\nasync function arc() { const client = createPublicClient({ chain: { id: 5042002 }, transport: customTransport }); return formatUnits(await client.getBalance({ address: account }), 6); }\nasync function eth() { const client = createPublicClient({ chain: { id: 1 }, transport: customTransport }); return formatUnits(await client.getBalance({ address: account }), 6); }`,
      "native-read-as-erc20",
      "formatUnits("
    ],
    [
      "L13 reassignment invalidates only its visible sibling binding",
      `${VIEM_IMPORT}\nasync function reassigned() { let client = createPublicClient({ chain: { id: 5042002 }, transport: customTransport }); client = other; return formatUnits(await client.getBalance({ address: account }), 6); }\nasync function retained() { const client = createPublicClient({ chain: { id: 5042002 }, transport: customTransport }); return formatUnits(await client.getBalance({ address: retainedAccount }), 6); }`,
      "native-read-as-erc20",
      "formatUnits(await client.getBalance({ address: retainedAccount })"
    ],
    [
      "L14 numeric lookup uses the visible declaration",
      `${ARC_CLIENT}\nconst DECIMALS = 18;\nasync function render() { const DECIMALS = 6; return formatUnits(await client.getBalance({ address: account }), DECIMALS); }`,
      "native-read-as-erc20",
      "formatUnits("
    ],
    [
      "L14 address lookup uses the visible declaration",
      `${ARC_CLIENT}\nconst TOKEN = "0x1111111111111111111111111111111111111111";\nasync function render() { const TOKEN = "${USDC}"; return formatUnits(await client.readContract({ address: TOKEN, functionName: "balanceOf", args: [account] }), 18); }`,
      "erc20-read-as-native",
      "formatUnits("
    ],
    [
      "L14 config lookup uses the visible declaration",
      `${VIEM_IMPORT}\nconst config = { chain: { id: 1 }, transport: customTransport };\nasync function render() { const config = { chain: { id: 5042002 }, transport: customTransport }; const client = createPublicClient(config); return formatUnits(await client.getBalance({ address: account }), 6); }`,
      "native-read-as-erc20",
      "formatUnits("
    ]
  ];

  it.each(lexicalPositives)("%s", async (_name, source, kind, sink) => {
    const expected = [{ kind, offset: source.indexOf(sink) }];
    const first = await analyzeArcUsdcAmountFile("src/lexical.ts", source);
    const second = await analyzeArcUsdcAmountFile("src/lexical.ts", source);
    expect(first).toEqual(expected);
    expect(second).toEqual(first);
  });

  const ambiguousObjects: readonly [string, string][] = [
    [
      "O01 spread after Arc chain in client config",
      `${VIEM_IMPORT}\nconst client = createPublicClient({ chain: { id: 5042002 }, ...otherConfig });\nformatUnits(await client.getBalance({ address: account }), 6);`
    ],
    [
      "O02 spread before Arc chain in client config",
      `${VIEM_IMPORT}\nconst client = createPublicClient({ ...otherConfig, chain: { id: 5042002 } });\nformatUnits(await client.getBalance({ address: account }), 6);`
    ],
    [
      "O03 spread in one-hop client config",
      `${VIEM_IMPORT}\nconst config = { chain: { id: 5042002 }, ...otherConfig };\nconst client = createPublicClient(config);\nformatUnits(await client.getBalance({ address: account }), 6);`
    ],
    [
      "O04 spread in nested chain config",
      `${VIEM_IMPORT}\nconst client = createPublicClient({ chain: { id: 5042002, ...otherChain } });\nformatUnits(await client.getBalance({ address: account }), 6);`
    ],
    [
      "O05 spread in eth_getBalance request",
      `${ARC_CLIENT}\nformatUnits(await client.request({ method: "eth_getBalance", ...overrides }), 6);`
    ],
    [
      "O06 spread after readContract evidence",
      `${ARC_CLIENT}\nformatUnits(await client.readContract({ address: "${USDC}", functionName: "balanceOf", args: [account], ...overrides }), 18);`
    ],
    [
      "O07 spread before readContract evidence",
      `${ARC_CLIENT}\nformatUnits(await client.readContract({ ...overrides, address: "${USDC}", functionName: "balanceOf", args: [account] }), 18);`
    ],
    [
      "O08 computed address override",
      `${ARC_CLIENT}\nformatUnits(await client.readContract({ address: "${USDC}", ["address"]: other, functionName: "balanceOf", args: [account] }), 18);`
    ],
    [
      "O09 computed functionName override",
      `${ARC_CLIENT}\nformatUnits(await client.readContract({ address: "${USDC}", functionName: "balanceOf", ["functionName"]: other, args: [account] }), 18);`
    ],
    [
      "O10 computed request method override",
      `${ARC_CLIENT}\nformatUnits(await client.request({ method: "eth_getBalance", ["method"]: other }), 6);`
    ],
    [
      "O11 computed client-config property",
      `${VIEM_IMPORT}\nconst client = createPublicClient({ chain: { id: 5042002 }, [dynamicKey]: value });\nformatUnits(await client.getBalance({ address: account }), 6);`
    ],
    [
      "O12 duplicate critical string-literal key",
      `${ARC_CLIENT}\nformatUnits(await client.readContract({ address: "${USDC}", "address": other, functionName: "balanceOf", args: [account] }), 18);`
    ],
    [
      "O13 duplicate critical getter",
      `${ARC_CLIENT}\nformatUnits(await client.readContract({ address: "${USDC}", get address() { return other; }, functionName: "balanceOf", args: [account] }), 18);`
    ]
  ];

  it.each(ambiguousObjects)("%s", async (_name, source) => {
    await expect(
      analyzeArcUsdcAmountFile("src/objects.ts", source)
    ).resolves.toEqual([]);
  });

  it("O14 unrelated abi remains supported", async () => {
    const source = `${ARC_CLIENT}\nconst abi = [];\nformatUnits(await client.readContract({ address: "${USDC}", abi, functionName: "balanceOf", args: [account] }), 18);`;
    const expected = [
      {
        kind: "erc20-read-as-native",
        offset: source.indexOf("formatUnits(")
      }
    ];
    const first = await analyzeArcUsdcAmountFile("src/objects.ts", source);
    expect(first).toEqual(expected);
    await expect(
      analyzeArcUsdcAmountFile("src/objects.ts", source)
    ).resolves.toEqual(first);
  });

  it("O15 normal client and readContract objects remain supported", async () => {
    const source = `${ARC_CLIENT}\nformatUnits(await client.getBalance({ address: account }), 6);\nformatUnits(await client.readContract({ address: "${USDC}", functionName: "balanceOf", args: [account] }), 18);`;
    const offsets = [...source.matchAll(/formatUnits\(/g)].map(
      (match) => match.index
    );
    const expected = [
      { kind: "native-read-as-erc20", offset: offsets[0] },
      { kind: "erc20-read-as-native", offset: offsets[1] }
    ];
    const first = await analyzeArcUsdcAmountFile("src/objects.ts", source);
    expect(first).toEqual(expected);
    await expect(
      analyzeArcUsdcAmountFile("src/objects.ts", source)
    ).resolves.toEqual(first);
  });

  const scopeNegatives: readonly [string, string][] = [
    [
      "S01 namespace-local Arc client does not leak outside",
      `${VIEM_IMPORT}\nnamespace Setup { export const client = createPublicClient({ transport: http("${RPC}") }); }\nformatUnits(await client.getBalance({ address: account }), 6);`
    ],
    [
      "S02 namespace-local amount does not leak outside",
      `${ARC_CLIENT}\nnamespace Load { export async function load() { const balance = await client.getBalance({ address: account }); return balance; } }\nformatUnits(balance, 6);`
    ],
    [
      "S06 identifier-named namespace shadows formatter import",
      `${ARC_CLIENT}\nnamespace formatUnits { export const version = 1; }\nformatUnits(await client.getBalance({ address: account }), 6);`
    ],
    [
      "S07 named class expression shadows formatUnits",
      `${ARC_CLIENT}\nconst Formatter = class formatUnits { static async render() { return formatUnits(await client.getBalance({ address: account }), 6); } };`
    ],
    [
      "S08 named class expression shadows client",
      `${ARC_CLIENT}\nconst Holder = class client { static async render() { return formatUnits(await client.getBalance({ address: account }), 6); } };`
    ],
    [
      "S09 named class expression shadows ethers namespace",
      `import * as ethers from "ethers";\nconst provider = new ethers.JsonRpcProvider("${RPC}");\nconst Holder = class ethers { static async render() { return ethers.formatUnits(await provider.getBalance(account), 6); } };`
    ],
    [
      "S11 import-equals shadows named formatter import",
      `${ARC_CLIENT}\nnamespace Internal { import formatUnits = Helpers.formatUnits; export async function render() { return formatUnits(await client.getBalance({ address: account }), 6); } }`
    ],
    [
      "S12 import-equals shadows createPublicClient",
      `${VIEM_IMPORT}\nnamespace Internal { import createPublicClient = Helpers.createPublicClient; const client = createPublicClient({ chain: { id: 5042002 }, transport: customTransport }); export async function render() { return formatUnits(await client.getBalance({ address: account }), 6); } }`
    ],
    [
      "S13 import-equals shadows ethers namespace",
      `import * as ethers from "ethers";\nnamespace Internal { import ethers = Helpers.ethers; const provider = new ethers.JsonRpcProvider("${RPC}"); export async function render() { return ethers.formatUnits(await provider.getBalance(account), 6); } }`
    ],
    [
      "S14 with-statement formatter call is skipped",
      `${ARC_CLIENT}\nwith (overrides) { formatUnits(await client.getBalance({ address: account }), 6); }`
    ]
  ];

  it.each(scopeNegatives)("%s", async (_name, source) => {
    await expect(
      analyzeArcUsdcAmountFile("src/scopes.ts", source)
    ).resolves.toEqual([]);
  });

  const scopePositives: readonly [
    string,
    string,
    ArcUsdcAmountIssueKind,
    string
  ][] = [
    [
      "S03 namespace formatter does not contaminate outer import",
      `${ARC_CLIENT}\nnamespace Helpers { const formatUnits = customFormatter; }\nformatUnits(${NATIVE}, 6);`,
      "native-read-as-erc20",
      "formatUnits("
    ],
    [
      "S04 client and formatter resolve inside one namespace",
      `${VIEM_IMPORT}\nnamespace Wallet { const client = createPublicClient({ transport: http("${RPC}") }); export async function render() { return formatUnits(${NATIVE}, 6); } }`,
      "native-read-as-erc20",
      "formatUnits("
    ],
    [
      "S05 same local names in two namespaces remain isolated",
      `${VIEM_IMPORT}\nnamespace ArcWallet { const client = createPublicClient({ chain: { id: 5042002 }, transport: customTransport }); export async function render() { return formatUnits(${NATIVE}, 6); } }\nnamespace EthWallet { const client = createPublicClient({ chain: { id: 1 }, transport: customTransport }); export async function render() { return formatUnits(await client.getBalance({ address: account }), 6); } }`,
      "native-read-as-erc20",
      "formatUnits("
    ],
    [
      "S10 anonymous class expression retains outer formatter",
      `${ARC_CLIENT}\nconst Formatter = class { static async render() { return formatUnits(${NATIVE}, 6); } };`,
      "native-read-as-erc20",
      "formatUnits("
    ],
    [
      "S15 positive outside a with statement still reports",
      `${ARC_CLIENT}\nwith (overrides) { formatUnits(client.getBalance({ address: hiddenAccount }), 6); }\nconst outside = formatUnits(await client.getBalance({ address: outsideAccount }), 6);`,
      "native-read-as-erc20",
      "formatUnits(await client.getBalance({ address: outsideAccount })"
    ],
    [
      "ambient namespace does not shadow runtime formatter",
      `${ARC_CLIENT}\ndeclare namespace formatUnits { const version: number; }\nformatUnits(${NATIVE}, 6);`,
      "native-read-as-erc20",
      "formatUnits("
    ],
    [
      "type-only import does not shadow runtime formatter",
      `${ARC_CLIENT}\nimport type { formatUnits } from "formatter-types";\nformatUnits(${NATIVE}, 6);`,
      "native-read-as-erc20",
      "formatUnits("
    ]
  ];

  it.each(scopePositives)("%s", async (_name, source, kind, sink) => {
    const expected = [{ kind, offset: source.indexOf(sink) }];
    const first = await analyzeArcUsdcAmountFile("src/scopes.ts", source);
    const second = await analyzeArcUsdcAmountFile("src/scopes.ts", source);
    expect(first).toEqual(expected);
    expect(second).toEqual(first);
  });

  it("S16 retained scope positives repeat deterministically", async () => {
    for (const [, source, kind, sink] of scopePositives) {
      const expected = [{ kind, offset: source.indexOf(sink) }];
      const first = await analyzeArcUsdcAmountFile("src/scopes.ts", source);
      expect(first).toEqual(expected);
      await expect(
        analyzeArcUsdcAmountFile("src/scopes.ts", source)
      ).resolves.toEqual(first);
    }
  });

  it("D01 declaration paths are unsupported", () => {
    for (const path of [
      "src/types.d.ts",
      "src/wallet.d.ts",
      "test/types.d.ts",
      "src/TYPES.D.TS"
    ])
      expect(supportsArcUsdcAmountPath(path)).toBe(false);
  });

  it.each([
    [
      "D02 declaration analysis",
      `${ARC_CLIENT}\nformatUnits(${NATIVE}, 6);`,
      "src/types.d.ts"
    ],
    [
      "D03 declared variable",
      `${ARC_CLIENT}\ndeclare const preview = formatUnits(${NATIVE}, 6);`
    ],
    [
      "D04 declared namespace",
      `${ARC_CLIENT}\ndeclare namespace Types { const preview = formatUnits(${NATIVE}, 6); }`
    ],
    [
      "D05 declared class",
      `${ARC_CLIENT}\ndeclare class Types { static preview = formatUnits(${NATIVE}, 6); }`
    ],
    [
      "D06 declared external module",
      `${ARC_CLIENT}\ndeclare module "wallet-types" { const preview = formatUnits(${NATIVE}, 6); }`
    ],
    [
      "D07 implicit ambient external module",
      `${ARC_CLIENT}\nmodule "wallet-types" { const preview = formatUnits(${NATIVE}, 6); }`
    ],
    [
      "A03 unawaited nested native",
      `${ARC_CLIENT}\nformatUnits(client.getBalance({ address: account }), 6);`
    ],
    [
      "A04 unawaited bound native",
      `${ARC_CLIENT}\nconst balance = client.getBalance({ address: account });\nformatUnits(balance, 6);`
    ],
    [
      "A05 formatter-only await",
      `${ARC_CLIENT}\nawait formatUnits(client.getBalance({ address: account }), 6);`
    ],
    [
      "A07 unawaited ethers native",
      `import { JsonRpcProvider, formatUnits } from "ethers";\nconst provider = new JsonRpcProvider("${RPC}");\nformatUnits(provider.getBalance(account), 6);`
    ],
    [
      "A09 unawaited request",
      `${ARC_CLIENT}\nformatUnits(client.request({ method: "eth_getBalance" }), 6);`
    ],
    [
      "A08 awaited raw request",
      `${ARC_CLIENT}\nformatUnits(await client.request({ method: "eth_getBalance" }), 6);`
    ],
    [
      "A11 unawaited ERC-20",
      `${ARC_CLIENT}\nformatUnits(client.readContract({ address: "${USDC}", functionName: "balanceOf", args: [account] }), 18);`
    ],
    [
      "A13 exact conversions",
      `${ARC_CLIENT}\nformatUnits((${NATIVE}) / 10n ** 12n, 6);\nformatUnits((${ERC20}) * 1_000_000_000_000n, 18);`
    ]
  ])("%s is silent", async (_name: string, source: string, path?: string) => {
    await expect(
      analyzeArcUsdcAmountFile(path ?? "src/v4.ts", source)
    ).resolves.toEqual([]);
  });

  it.each([
    [
      "D08 ambient assignment cannot invalidate runtime amount",
      `${ARC_CLIENT}\nconst balance = ${NATIVE};\ndeclare namespace Types { const reset = (balance = 0n); }\nformatUnits(balance, 6);`,
      "native-read-as-erc20"
    ],
    [
      "D09 ambient namespace cannot shadow formatter",
      `${ARC_CLIENT}\ndeclare namespace formatUnits { const version: number; }\nformatUnits(${NATIVE}, 6);`,
      "native-read-as-erc20"
    ],
    [
      "D10 runtime namespace",
      `${VIEM_IMPORT}\nnamespace Wallet { const client = createPublicClient({ transport: http("${RPC}") }); export async function render() { return formatUnits(${NATIVE}, 6); } }`,
      "native-read-as-erc20"
    ],
    [
      "N01 dotted formatUnits segment",
      `${ARC_CLIENT}\nnamespace A.formatUnits { export const version = 1; }\nformatUnits(${NATIVE}, 6);`,
      "native-read-as-erc20"
    ],
    [
      "N02 dotted client segment",
      `${ARC_CLIENT}\nnamespace A.client { export const version = 1; }\nformatUnits(${NATIVE}, 6);`,
      "native-read-as-erc20"
    ],
    [
      "N03 mismatch inside dotted namespace",
      `${VIEM_IMPORT}\nnamespace Wallet.Amounts { const client = createPublicClient({ transport: http("${RPC}") }); export async function render() { return formatUnits(${NATIVE}, 6); } }`,
      "native-read-as-erc20"
    ],
    [
      "N04 matching inner dotted names stay isolated",
      `${ARC_CLIENT}\nnamespace A.formatUnits { export const a = 1; }\nnamespace B.formatUnits { export const b = 1; }\nformatUnits(${NATIVE}, 6);`,
      "native-read-as-erc20"
    ],
    [
      "N05 nested module binding stays in its parent",
      `${VIEM_IMPORT}\nnamespace Parent { namespace Child.client { export const version = 1; } const client = createPublicClient({ transport: http("${RPC}") }); export async function render() { return formatUnits(${NATIVE}, 6); } }`,
      "native-read-as-erc20"
    ],
    [
      "A01 awaited nested native",
      `${ARC_CLIENT}\nformatUnits(${NATIVE}, 6);`,
      "native-read-as-erc20"
    ],
    [
      "A02 awaited bound native",
      `${ARC_CLIENT}\nconst balance = ${NATIVE};\nformatUnits(balance, 6);`,
      "native-read-as-erc20"
    ],
    [
      "A06 awaited ethers native",
      `import { JsonRpcProvider, formatUnits } from "ethers";\nconst provider = new JsonRpcProvider("${RPC}");\nformatUnits(await provider.getBalance(account), 6);`,
      "native-read-as-erc20"
    ],
    [
      "A10 awaited ERC-20",
      `${ARC_CLIENT}\nformatUnits(${ERC20}, 18);`,
      "erc20-read-as-native"
    ],
    [
      "A12 asserted awaited source",
      `${ARC_CLIENT}\nformatUnits((${NATIVE}) as bigint, 6);`,
      "native-read-as-erc20"
    ],
    [
      "A14 repeated awaited positive",
      `${ARC_CLIENT}\nformatUnits(${NATIVE}, 6);`,
      "native-read-as-erc20"
    ]
  ] as const)("%s reports exactly", async (_name, source, kind) => {
    const expected = [{ kind, offset: source.lastIndexOf("formatUnits(") }];
    const first = await analyzeArcUsdcAmountFile("src/v4.ts", source);
    expect(first).toEqual(expected);
    await expect(
      analyzeArcUsdcAmountFile("src/v4.ts", source)
    ).resolves.toEqual(first);
  });

  const v5Negatives: readonly [string, string][] = [
    [
      "E06 non-async function",
      `${ARC_CLIENT}\nfunction render() { return formatUnits(${NATIVE}, 6); }`
    ],
    [
      "E07 namespace-level initializer",
      `${ARC_CLIENT}\nnamespace Wallet { export const display = formatUnits(${NATIVE}, 6); }`
    ],
    [
      "E08 class-field initializer",
      `${ARC_CLIENT}\nclass Wallet { static display = formatUnits(${NATIVE}, 6); }`
    ],
    [
      "E09 static-block initializer",
      `${ARC_CLIENT}\nclass Wallet { static { formatUnits(${NATIVE}, 6); } }`
    ],
    [
      "E10 enum initializer",
      `${ARC_CLIENT}\nenum Wallet { Display = formatUnits(${NATIVE}, 6) }`
    ],
    [
      "E11 async parameter initializer",
      `${ARC_CLIENT}\nasync function render(display = formatUnits(${NATIVE}, 6)) {}`
    ],
    [
      "E12 nested non-async function",
      `${ARC_CLIENT}\nasync function outer() { function render() { return formatUnits(${NATIVE}, 6); } }`
    ],
    [
      "E13 non-async generator",
      `${ARC_CLIENT}\nfunction* render() { yield formatUnits(${NATIVE}, 6); }`
    ],
    [
      "R01 direct raw RPC",
      `${ARC_CLIENT}\nformatUnits(await client.request({ method: "eth_getBalance", params: [account, "latest"] }), 6);`
    ],
    [
      "R02 bound raw RPC",
      `${ARC_CLIENT}\nconst raw = await client.request({ method: "eth_getBalance", params: [account, "latest"] });\nformatUnits(raw, 6);`
    ],
    [
      "R03 BigInt raw RPC",
      `${ARC_CLIENT}\nformatUnits(BigInt(await client.request({ method: "eth_getBalance", params: [account, "latest"] })), 6);`
    ],
    [
      "R04 spread raw RPC",
      `${ARC_CLIENT}\nformatUnits(await client.request({ method: "eth_getBalance", ...request }), 6);`
    ],
    [
      "R05 computed raw method",
      `${ARC_CLIENT}\nformatUnits(await client.request({ ["method"]: "eth_getBalance" }), 6);`
    ],
    ["V01 root id", viemCase(`{ id: 5042002, transport: http(customRpc) }`)],
    [
      "V02 root chainId",
      viemCase(`{ chainId: 5042002, transport: http(customRpc) }`)
    ],
    [
      "V03 numeric chain",
      viemCase(`{ chain: 5042002, transport: http(customRpc) }`)
    ],
    [
      "V04 nested chainId",
      viemCase(`{ chain: { chainId: 5042002 }, transport: http(customRpc) }`)
    ],
    ["V09 missing transport", viemCase(`{ chain: { id: 5042002 } }`)],
    [
      "V10 contradictory viem evidence",
      viemCase(
        `{ chain: { id: 5042002 }, transport: http("https://cloudflare-eth.com") }`
      )
    ],
    [
      "V11 root id and custom RPC",
      viemCase(`{ id: 5042002, transport: http("https://custom.example") }`)
    ],
    [
      "V12 sibling viem chain isolation",
      `${VIEM_IMPORT}\nconst arcChain = { id: 5042002 };\nconst config = { transport: customTransport };\nconst client = createPublicClient(config);\nformatUnits(${NATIVE}, 6);`
    ],
    ["H05 ethers network id", ethersCase(`customRpc, { id: 5042002 }`)],
    [
      "H06 contradictory ethers evidence",
      ethersCase(`"https://cloudflare-eth.com", { chainId: 5042002 }`)
    ],
    ["H07 unknown ethers provider", ethersCase(`customRpc`)],
    [
      "S03 missing viem argument",
      viemCase(`{ transport: http("${RPC}") }`, `await client.getBalance()`)
    ],
    [
      "S04 empty viem options",
      viemCase(`{ transport: http("${RPC}") }`, `await client.getBalance({})`)
    ],
    [
      "S05 spread viem options",
      viemCase(
        `{ transport: http("${RPC}") }`,
        `await client.getBalance({ ...options, address: account })`
      )
    ],
    [
      "S06 computed or duplicate address",
      `${ARC_CLIENT}\nformatUnits(await client.getBalance({ address: account, ["address"]: other }), 6);\nformatUnits(await client.getBalance({ address: account, address: other }), 6);`
    ],
    [
      "S08 missing ethers account",
      ethersCase(`"${RPC}"`, `await provider.getBalance()`)
    ],
    [
      "S10 missing balanceOf args",
      viemCase(`{ transport: http("${RPC}") }`, balanceOf(""), 18)
    ],
    [
      "S11 empty balanceOf args",
      viemCase(`{ transport: http("${RPC}") }`, balanceOf(", args: []"), 18)
    ],
    [
      "S12 two balanceOf args",
      viemCase(
        `{ transport: http("${RPC}") }`,
        balanceOf(", args: [account, extra]"),
        18
      )
    ],
    [
      "S13 spread balanceOf args",
      viemCase(
        `{ transport: http("${RPC}") }`,
        balanceOf(", args: [...accounts]"),
        18
      )
    ],
    [
      "S14 duplicate or computed args",
      `${ARC_CLIENT}\nformatUnits(${balanceOf(', args: [account], ["args"]: other')}, 18);\nformatUnits(${balanceOf(", args: [account], args: [other]")}, 18);`
    ]
  ];

  it.each(v5Negatives)("%s is silent", async (_name, source) => {
    await expect(
      analyzeArcUsdcAmountFile("src/v5.ts", source)
    ).resolves.toEqual([]);
  });

  const v5Positives: readonly [string, string, ArcUsdcAmountIssueKind?][] = [
    ["E01 module top-level await", `${ARC_CLIENT}\nformatUnits(${NATIVE}, 6);`],
    [
      "E02 async function",
      `${ARC_CLIENT}\nasync function render() { return formatUnits(${NATIVE}, 6); }`
    ],
    [
      "E03 async arrow",
      `${ARC_CLIENT}\nconst render = async () => formatUnits(${NATIVE}, 6);`
    ],
    [
      "E04 async method",
      `${ARC_CLIENT}\nclass Wallet { static async render() { return formatUnits(${NATIVE}, 6); } }`
    ],
    [
      "E05 namespace async function",
      `${ARC_CLIENT}\nnamespace Wallet { export async function render() { return formatUnits(${NATIVE}, 6); } }`
    ],
    [
      "E14 async generator",
      `${ARC_CLIENT}\nasync function* render() { yield formatUnits(${NATIVE}, 6); }`
    ],
    [
      "V05 direct viem chain id",
      viemCase(`{ chain: { id: 5042002 }, transport: http(customRpc) }`)
    ],
    [
      "V06 bound viem chain object",
      `${VIEM_IMPORT}\nconst chain = { id: 5042002 };\nconst client = createPublicClient({ chain: chain, transport: customTransport });\nformatUnits(${NATIVE}, 6);`
    ],
    ["V07 exact viem RPC", viemCase(`{ transport: http("${RPC}") }`)],
    [
      "V08 unresolved direct transport",
      viemCase(`{ chain: { id: 5042002 }, transport: customTransport }`)
    ],
    ["H01 exact ethers RPC", ethersCase(`"${RPC}"`)],
    ["H02 numeric ethers chain", ethersCase(`customRpc, 5042002`)],
    [
      "H03 ethers network chainId",
      ethersCase(`customRpc, { chainId: 5042002, name: "arc-testnet" }`)
    ],
    [
      "H04 bound ethers network",
      `import { JsonRpcProvider, formatUnits } from "ethers";\nconst network = { chainId: 5042002 };\nconst provider = new JsonRpcProvider(customRpc, network);\nformatUnits(await provider.getBalance(account), 6);`
    ],
    ["S01 viem address property", viemCase(`{ transport: http("${RPC}") }`)],
    [
      "S02 viem shorthand address",
      `${VIEM_IMPORT}\nconst client = createPublicClient({ transport: http("${RPC}") });\nconst address = account;\nformatUnits(await client.getBalance({ address }), 6);`
    ],
    ["S07 ethers account argument", ethersCase(`"${RPC}"`)],
    [
      "S09 balanceOf one arg",
      viemCase(
        `{ transport: http("${RPC}") }`,
        balanceOf(", args: [account]"),
        18
      ),
      "erc20-read-as-native"
    ]
  ];

  it.each(v5Positives)("%s reports exactly", async (_name, source, kind) => {
    const expected = [
      {
        kind: kind ?? "native-read-as-erc20",
        offset: source.lastIndexOf("formatUnits(")
      }
    ];
    const first = await analyzeArcUsdcAmountFile("src/v5.ts", source);
    expect(first).toEqual(expected);
    await expect(
      analyzeArcUsdcAmountFile("src/v5.ts", source)
    ).resolves.toEqual(first);
  });

  it("E15 retained namespace and class positives use async bodies", () => {
    for (const [name, source] of scopePositives)
      if (["S04", "S05", "S10"].some((prefix) => name.startsWith(prefix)))
        expect(source).toContain("async");
  });

  it("R06 no positive table claims raw request support", () => {
    expect(
      [...positives, ...scopePositives, ...v5Positives].some(([, source]) =>
        source.includes(".request(")
      )
    ).toBe(false);
  });

  const v6Erc20 = (args: string) =>
    viemCase(`{ transport: http("${RPC}") }`, balanceOf(`, args: ${args}`), 18);
  const v6Ethers = (args: string) =>
    ethersCase(`"${RPC}"`, `await provider.getBalance(${args})`);
  const v6Negatives: readonly [string, string][] = [
    ["A03 empty args", v6Erc20("[]")],
    ["A04 sparse args", v6Erc20("[,]")],
    ["A05 omitted args", v6Erc20("[,,]")],
    ["A06 spread arg", v6Erc20("[...accounts]")],
    ["A07 normal and spread args", v6Erc20("[account, ...extra]")],
    ["E03 missing account", v6Ethers("")],
    ["E04 spread accounts", v6Ethers("...accounts")],
    ["E05 spread empty array", v6Ethers("...[]")],
    ["E06 spread singleton array", v6Ethers("...[account]")]
  ];

  it.each(v6Negatives)("%s is silent", async (_name, source) => {
    await expect(
      analyzeArcUsdcAmountFile("src/v6.ts", source)
    ).resolves.toEqual([]);
  });

  const v6Positives: readonly [string, string, ArcUsdcAmountIssueKind][] = [
    ["A01 normal account", v6Erc20("[account]"), "erc20-read-as-native"],
    [
      "A02 asserted account",
      v6Erc20("[account as `0x${string}`]"),
      "erc20-read-as-native"
    ],
    ["E01 normal account", v6Ethers("account"), "native-read-as-erc20"],
    [
      "E02 account and block",
      v6Ethers('account, "latest"'),
      "native-read-as-erc20"
    ],
    [
      "E07 uninterpreted expression",
      v6Ethers("resolveAccount()"),
      "native-read-as-erc20"
    ],
    [
      "E08 deterministic expression",
      v6Ethers("undefined"),
      "native-read-as-erc20"
    ]
  ];

  it.each(v6Positives)("%s reports exactly", async (_name, source, kind) => {
    const expected = [{ kind, offset: source.lastIndexOf("formatUnits(") }];
    const first = await analyzeArcUsdcAmountFile("src/v6.ts", source);
    expect(first).toEqual(expected);
    await expect(
      analyzeArcUsdcAmountFile("src/v6.ts", source)
    ).resolves.toEqual(first);
  });

  it("A08 retains ambiguous args-property negatives", () => {
    expect(ambiguousObjects.some(([name]) => name.startsWith("O06"))).toBe(
      true
    );
    expect(v5Negatives.some(([name]) => name.startsWith("S14"))).toBe(true);
  });

  it("P14 keeps an unreadable file non-fatal", async () => {
    await expect(
      runRule(["src/unreadable.ts"], async () => {
        throw new Error("unreadable");
      })
    ).resolves.toEqual([]);
  });

  it("P15 continues to a later readable file", async () => {
    const source = `${ARC_CLIENT}\nformatUnits(${NATIVE}, 6);`;
    const findings = await runRule(
      ["src/unreadable.ts", "src/readable.ts"],
      async (filePath) => {
        if (filePath.endsWith("unreadable.ts")) throw new Error("unreadable");
        return source;
      }
    );

    expect(findings).toHaveLength(1);
    expect(findings[0]?.files).toEqual(["src/readable.ts"]);
  });

  it.each([
    [
      "native-read-as-erc20",
      `${ARC_CLIENT}\nformatUnits(${NATIVE}, 6);`,
      "An Arc native USDC balance uses 18-decimal units but is being interpreted as a six-decimal ERC-20 amount.",
      "Format the raw Arc native balance with 18 decimals, or divide the native integer amount by 10^12 before treating it as a six-decimal USDC amount."
    ],
    [
      "erc20-read-as-native",
      `${ARC_CLIENT}\nformatUnits(${ERC20}, 18);`,
      "An Arc USDC ERC-20 amount uses six-decimal units but is being interpreted as an 18-decimal native amount.",
      "Format the Arc USDC ERC-20 balance with 6 decimals. Multiply by 10^12 only when converting it into an 18-decimal native amount."
    ]
  ])("emits exact rule policy for %s", async (_kind, source, message, fix) => {
    const findings = await runRule(["src/amounts.ts"], async () => source);

    expect(findings).toEqual([
      {
        ruleId: "wallet/ARC_USDC_AMOUNT_CONVERSION",
        severity: "critical",
        preset: "wallet",
        docs: "arc-usdc-amount-conversion",
        message,
        suggestedFix: fix,
        files: ["src/amounts.ts"]
      }
    ]);
  });

  it("emits at most one finding per file using the earliest issue", async () => {
    const source = `${ARC_CLIENT}\nformatUnits(${NATIVE}, 6);\nformatUnits(${ERC20}, 18);`;
    const findings = await runRule(["src/amounts.ts"], async () => source);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain("native USDC balance");
  });
});

function runRule(
  files: string[],
  readFile: RuleContext["readFile"],
  rules: RuleContext["config"]["rules"] = {}
) {
  return runRules([arcUsdcAmountConversionRule], {
    projectRoot: "/fixture",
    config: { ...DEFAULT_CONFIG, rules },
    files,
    detectedPresets: {
      detectedPresets: ["wallet"],
      confidence: "high",
      reasons: ["test"]
    },
    readFile
  });
}
