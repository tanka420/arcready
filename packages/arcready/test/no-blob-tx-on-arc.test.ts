import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_CONFIG,
  createScanReport,
  getRulesForPresets,
  jsonReporter,
  noBlobTxOnArcRule,
  runRules,
  terminalReporter
} from "../src/index.js";
import type { Finding, RuleContext } from "../src/index.js";
import {
  selectEarliestC07BViolation,
  selectEarliestC07CViolation
} from "../rules/wallet/no-blob-tx-on-arc.js";
import type { EthersTransactionSubmission } from "../rules/wallet/arc-transaction-submission-analyzer.js";
import type { ViemTransactionSubmission } from "../rules/wallet/viem-transaction-submission-analyzer.js";

const ARC_RPC = "https://rpc.testnet.arc.network";
const ADDRESS = "0x1111111111111111111111111111111111111111";
const MESSAGE =
  "Arc transaction submission uses EIP-4844 transaction type 3, which Arc does not support.";
const SUGGESTED_FIX =
  "Submit a type-2 EIP-1559 transaction on Arc instead (`type: 2`) and remove any blob-only fields present in the submitted transaction.";

function walletSource(
  transaction: string,
  setup = "",
  sink = "signer.sendTransaction(tx);"
): string {
  return `import { JsonRpcProvider, Wallet } from "ethers";
const provider = new JsonRpcProvider("${ARC_RPC}");
const signer = new Wallet(key, provider);
${setup}
const tx = ${transaction};
${sink}`;
}

function jsonRpcSignerSource(transaction: string, setup = ""): string {
  return `import { JsonRpcProvider } from "ethers";
const provider = new JsonRpcProvider("${ARC_RPC}");
const signer = await provider.getSigner();
${setup}
signer.sendTransaction(${transaction});`;
}

function viemJsonRpcSource(
  request = `{ type: "eip4844" }`,
  transport = "http()",
  clientReceiver = "client"
): string {
  const client =
    clientReceiver === "client"
      ? `const client = createWalletClient({ chain: arcTestnet, transport: ${transport}, account: "${ADDRESS}" });
client`
      : `createWalletClient({ chain: arcTestnet, transport: ${transport}, account: "${ADDRESS}" })`;
  return `import { createWalletClient, http } from "viem";
import { arcTestnet } from "viem/chains";
${client}.sendTransaction(${request});`;
}

function viemPrivateKeySource(request = `{ type: "eip4844" }`): string {
  return `import { createWalletClient, http } from "viem";
import { arcTestnet } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
const account = privateKeyToAccount(secret);
const client = createWalletClient({ chain: arcTestnet, transport: http("${ARC_RPC}"), account: account });
client.sendTransaction(${request});`;
}

async function runRule(
  source: string,
  options: {
    readonly filePath?: string;
    readonly files?: readonly string[];
    readonly sources?: Readonly<Record<string, string>>;
    readonly rules?: RuleContext["config"]["rules"];
    readonly readFile?: RuleContext["readFile"];
  } = {}
): Promise<Finding[]> {
  const filePath = options.filePath ?? "src/submit.ts";
  const files = [...(options.files ?? [filePath])];
  const sources = options.sources ?? { [filePath]: source };
  return runRules([noBlobTxOnArcRule], {
    projectRoot: "/fixture",
    config: { ...DEFAULT_CONFIG, rules: options.rules ?? {} },
    files,
    detectedPresets: {
      detectedPresets: ["wallet"],
      confidence: "high",
      reasons: ["test"]
    },
    readFile:
      options.readFile ??
      (async (requestedPath) => sources[requestedPath] ?? source)
  });
}

function expectExactFinding(
  finding: Finding | undefined,
  filePath = "src/submit.ts",
  severity: Finding["severity"] = "critical"
): void {
  expect(finding).toEqual({
    ruleId: "wallet/NO_BLOB_TX_ON_ARC",
    severity,
    message: MESSAGE,
    files: [filePath],
    suggestedFix: SUGGESTED_FIX,
    docs: "arc-blob-transactions",
    preset: "wallet"
  });
}

function submission(
  callOffset: number,
  overrides: Partial<EthersTransactionSubmission> = {}
): EthersTransactionSubmission {
  return {
    provenance: "ethers-wallet",
    sink: "sendTransaction",
    ownership: "proven-arc",
    callOffset,
    transaction: {
      objectOffset: callOffset + 1,
      safe: true,
      chainId: "omitted",
      kind: "proven-blob",
      exactTypeToken: 3,
      supportedBlobFields: []
    },
    ...overrides
  };
}

function viemSubmission(
  callOffset: number,
  overrides: Partial<ViemTransactionSubmission> = {}
): ViemTransactionSubmission {
  return {
    provenance: "viem-wallet-client",
    sink: "sendTransaction",
    structuralSafety: "proven-safe",
    ownership: "proven-arc",
    accountRoute: "json-rpc-address",
    transactionKind: "proven-blob",
    evidenceToken: "eip4844",
    callOffset,
    ...overrides
  };
}

function viemSubmissionWithInvalidField(
  key: keyof ViemTransactionSubmission,
  value: unknown
): ViemTransactionSubmission {
  return {
    ...viemSubmission(1),
    [key]: value
  } as ViemTransactionSubmission;
}

describe("wallet/NO_BLOB_TX_ON_ARC C07C-B acceptance", () => {
  describe("B01-B02, B07, and R06 exact positive submissions", () => {
    it("B01 finds an Arc Wallet direct exact type-3 transaction", async () => {
      const findings = await runRule(
        `import { JsonRpcProvider, Wallet } from "ethers";
const provider = new JsonRpcProvider("${ARC_RPC}");
const signer = new Wallet(key, provider);
signer.sendTransaction({ type: 3 });`
      );
      expect(findings).toHaveLength(1);
      expectExactFinding(findings[0]);
    });

    it("B01/P03 finds a Wallet through supported Arc network proof", async () => {
      const findings = await runRule(
        `import { JsonRpcProvider, Wallet } from "ethers";
const provider = new JsonRpcProvider("https://rpc.example", 5042002);
const signer = new Wallet(key, provider);
signer.sendTransaction({ type: 3 });`
      );
      expect(findings).toHaveLength(1);
      expectExactFinding(findings[0]);
    });

    it("B02 finds an awaited Arc JsonRpcSigner exact type-3 transaction", async () => {
      const findings = await runRule(
        jsonRpcSignerSource("{ type: 3, blobVersionedHashes: [hash] }")
      );
      expect(findings).toHaveLength(1);
      expectExactFinding(findings[0]);
    });

    it("B01/C07 finds the one immutable transaction binding", async () => {
      const findings = await runRule(
        walletSource("{ type: 3, blobs: [blob], maxFeePerBlobGas: 1n }")
      );
      expect(findings).toHaveLength(1);
      expectExactFinding(findings[0]);
    });

    it("B07/R06 keeps both ethers signer subtypes independently supported", async () => {
      const wallet = await runRule(walletSource("{ type: 3 }"));
      const jsonRpcSigner = await runRule(jsonRpcSignerSource("{ type: 3 }"));
      expect(wallet).toHaveLength(1);
      expect(jsonRpcSigner).toHaveLength(1);
      expectExactFinding(wallet[0]);
      expectExactFinding(jsonRpcSigner[0]);
    });

    it("W01 accepts approved balanced parentheses", async () => {
      const findings = await runRule(
        `import { JsonRpcProvider, Wallet } from "ethers";
const provider = ((new JsonRpcProvider((("${ARC_RPC}")))));
const signer = (new Wallet(key, (provider)));
(signer).sendTransaction((({ type: ((3)) })));`
      );
      expect(findings).toHaveLength(1);
      expectExactFinding(findings[0]);
    });
  });

  describe("C07C-B viem public integration positives", () => {
    it("finds a direct Arc wallet client with a JSON-RPC account and http()", async () => {
      const findings = await runRule(
        viemJsonRpcSource(`{ type: "eip4844" }`, "http()", "direct")
      );
      expect(findings).toHaveLength(1);
      expectExactFinding(findings[0]);
    });

    it("finds one bound Arc wallet client with a private-key account and exact Arc RPC", async () => {
      const findings = await runRule(viemPrivateKeySource());
      expect(findings).toHaveLength(1);
      expectExactFinding(findings[0]);
    });

    it("reports a viem-only source when the ethers analyzer contributes no records", async () => {
      const findings = await runRule(viemJsonRpcSource());
      expect(findings).toHaveLength(1);
      expectExactFinding(findings[0]);
    });

    it("keeps an unsupported viem near-match silent", async () => {
      const findings = await runRule(viemJsonRpcSource(`{ type: "eip1559" }`));
      expect(findings).toEqual([]);
    });
  });

  describe("B03-B06 and B08-B13 exact transaction-kind boundary", () => {
    it.each([
      ["omitted", "{ blobs: [blob], blobVersionedHashes: [hash] }"],
      ["type 2", "{ type: 2, blobs: [blob], maxFeePerBlobGas: 1n }"],
      ["string", '{ type: "3" }'],
      ["bigint", "{ type: 3n }"],
      ["fractional spelling", "{ type: 3.0 }"],
      ["exponent spelling", "{ type: 3e0 }"],
      ["hex spelling", "{ type: 0x3 }"],
      ["identifier", "{ type: kind }"],
      ["computed key", "{ [kind]: 3 }"],
      ["assertion wrapper", "{ type: 3 as number }"]
    ])("B03-B05/B08/B12 ignores %s transaction kind", async (_label, tx) => {
      await expect(runRule(walletSource(tx))).resolves.toEqual([]);
    });

    it.each([
      ["spread", "{ ...base, type: 3 }"],
      ["duplicate critical key", "{ type: 3, type: 2 }"],
      ["shorthand critical key", "{ type }"],
      ["getter", "{ get type() { return 3; } }"],
      ["non-critical setter", "{ type: 3, set memo(value) {} }"],
      ["non-critical method", "{ type: 3, memo() {} }"],
      ["__proto__", "{ __proto__: { type: 3 } }"]
    ])("B06 rejects unsafe %s object shape", async (_label, tx) => {
      await expect(runRule(walletSource(tx))).resolves.toEqual([]);
    });

    it.each(["[]", "[,]", "[blob,,]", "[...blobs]", "[null]"])(
      "B09-B10 never promotes unsupported supporting array %s",
      async (array) => {
        await expect(
          runRule(
            walletSource(`{ blobVersionedHashes: ${array}, blobs: ${array} }`)
          )
        ).resolves.toEqual([]);
      }
    );

    it("B09-B10 keeps exact type 3 sufficient despite unsupported supporting arrays", async () => {
      const findings = await runRule(
        walletSource("{ type: 3, blobs: [], blobVersionedHashes: [hash,,] }")
      );
      expect(findings).toHaveLength(1);
      expectExactFinding(findings[0]);
    });

    it("B11 rejects transaction binding reassignment", async () => {
      const source = `import { JsonRpcProvider, Wallet } from "ethers";
const provider = new JsonRpcProvider("${ARC_RPC}");
const signer = new Wallet(key, provider);
const tx = { type: 3 };
tx = other;
signer.sendTransaction(tx);
`;
      await expect(runRule(source)).resolves.toEqual([]);
    });

    it.each([
      ["transaction property mutation before sink", "tx.type = 2;", ""],
      ["transaction property mutation after sink", "", "tx.type = 2;"]
    ])("B11 rejects %s", async (_label, before, after) => {
      const source = `import { JsonRpcProvider, Wallet } from "ethers";
const provider = new JsonRpcProvider("${ARC_RPC}");
const signer = new Wallet(key, provider);
const tx = { type: 3 };
${before}
signer.sendTransaction(tx);
${after}`;
      await expect(runRule(source)).resolves.toEqual([]);
    });

    it("B11 rejects supporting array mutation", async () => {
      const source = `import { JsonRpcProvider, Wallet } from "ethers";
const provider = new JsonRpcProvider("${ARC_RPC}");
const signer = new Wallet(key, provider);
const hashes = [hash];
const tx = { type: 3, blobVersionedHashes: hashes };
hashes.push(other);
signer.sendTransaction(tx);`;
      await expect(runRule(source)).resolves.toEqual([]);
    });

    it("B13 finds exact type 3 without borrowing unsupported supporting values", async () => {
      const findings = await runRule(
        walletSource(
          "{ type: 3, blobs: toBlobs(data), kzg: kzg, maxFeePerBlobGas: fee }"
        )
      );
      expect(findings).toHaveLength(1);
      expectExactFinding(findings[0]);
    });
  });

  describe("ownership, provenance, sink, and analyzer outcome negatives", () => {
    it.each([
      [
        "proven non-Arc provider",
        `import { JsonRpcProvider, Wallet } from "ethers";
const provider = new JsonRpcProvider("https://cloudflare-eth.com");
const signer = new Wallet(key, provider);
signer.sendTransaction({ type: 3 });`
      ],
      [
        "unknown provider",
        `import { JsonRpcProvider, Wallet } from "ethers";
const provider = new JsonRpcProvider(rpc);
const signer = new Wallet(key, provider);
signer.sendTransaction({ type: 3 });`
      ],
      [
        "conflicting RPC and network",
        `import { JsonRpcProvider, Wallet } from "ethers";
const provider = new JsonRpcProvider("${ARC_RPC}", 1);
const signer = new Wallet(key, provider);
signer.sendTransaction({ type: 3 });`
      ],
      [
        "unknown transaction chain evidence",
        walletSource("{ chainId, type: 3 }")
      ],
      [
        "unrelated Arc and Ethereum sibling flows",
        `import { JsonRpcProvider, Wallet } from "ethers";
const arcProvider = new JsonRpcProvider("${ARC_RPC}");
const ethProvider = new JsonRpcProvider("https://cloudflare-eth.com");
const signer = new Wallet(key, ethProvider);
signer.sendTransaction({ type: 3 });`
      ],
      ["Arc-like text only", "const docs = 'Arc EIP-4844 blob type: 3';"]
    ])("O01-O13/R04 ignores %s", async (_label, source) => {
      await expect(runRule(source)).resolves.toEqual([]);
    });

    it.each([
      [
        "generic signer lookalike",
        `const arc = "${ARC_RPC}"; signer.sendTransaction({ type: 3 });`
      ],
      [
        "wrong package",
        `import { JsonRpcProvider, Wallet } from "ethers-wrapper";
const provider = new JsonRpcProvider("${ARC_RPC}");
const signer = new Wallet(key, provider);
signer.sendTransaction({ type: 3 });`
      ],
      [
        "shadowed import",
        `import { JsonRpcProvider, Wallet } from "ethers";
function submit(Wallet) {
  const provider = new JsonRpcProvider("${ARC_RPC}");
  const signer = new Wallet(key, provider);
  signer.sendTransaction({ type: 3 });
}`
      ],
      [
        "unsupported namespace mutation",
        `import * as ethers from "ethers";
ethers.Wallet = CustomWallet;
const provider = new ethers.JsonRpcProvider("${ARC_RPC}");
const signer = new ethers.Wallet(key, provider);
signer.sendTransaction({ type: 3 });`
      ],
      [
        "Wallet without provider",
        `import { Wallet } from "ethers";
const signer = new Wallet(key);
signer.sendTransaction({ type: 3 });`
      ],
      [
        "unawaited getSigner",
        `import { JsonRpcProvider } from "ethers";
const provider = new JsonRpcProvider("${ARC_RPC}");
const signer = provider.getSigner();
signer.sendTransaction({ type: 3 });`
      ],
      [
        "element sink",
        walletSource("{ type: 3 }", "", 'signer["sendTransaction"](tx);')
      ],
      [
        "optional sink",
        walletSource("{ type: 3 }", "", "signer?.sendTransaction(tx);")
      ],
      [
        "detached sink",
        walletSource(
          "{ type: 3 }",
          "const send = signer.sendTransaction;",
          "send(tx);"
        )
      ],
      [
        "call sink",
        walletSource(
          "{ type: 3 }",
          "",
          "signer.sendTransaction.call(signer, tx);"
        )
      ],
      [
        "imported signer",
        `import { signer } from "./signer.js";
const arc = "${ARC_RPC}";
signer.sendTransaction({ type: 3 });`
      ]
    ])("C03-C08/D03-D05 ignores %s", async (_label, source) => {
      await expect(runRule(source)).resolves.toEqual([]);
    });

    it.each([
      ["malformed syntax", "src/submit.ts", "const tx = { type: ;"],
      ["unsupported extension", "src/submit.tsx", walletSource("{ type: 3 }")],
      ["unsupported test path", "tests/submit.ts", walletSource("{ type: 3 }")],
      [
        "whole-file dynamic barrier",
        "src/submit.ts",
        walletSource("{ type: 3 }", "eval('code');")
      ],
      [
        "whole-file prototype barrier",
        "src/submit.ts",
        walletSource("{ type: 3 }", "const proto = Object.prototype;")
      ]
    ])(
      "M01-M02/E/T ignores %s without crashing",
      async (_label, path, source) => {
        await expect(runRule(source, { filePath: path })).resolves.toEqual([]);
      }
    );

    it("F03 skips an earlier unsupported candidate and finds the later supported violation", async () => {
      const findings = await runRule(
        `import { JsonRpcProvider, Wallet } from "ethers";
const provider = new JsonRpcProvider("${ARC_RPC}");
const signer = new Wallet(key, provider);
lookalike.sendTransaction({ type: 3 });
signer.sendTransaction({ type: 2 });
signer.sendTransaction({ type: 3 });`
      );
      expect(findings).toHaveLength(1);
      expectExactFinding(findings[0]);
    });

    it("candidate-specific invalidation preserves a valid sibling submission", async () => {
      const findings = await runRule(
        `import { JsonRpcProvider, Wallet } from "ethers";
const provider = new JsonRpcProvider("${ARC_RPC}");
const first = new Wallet(key, provider);
const second = new Wallet(key, provider);
first.sendTransaction({ type: 3 });
second.sendTransaction({ type: 3 });
second.sendTransaction = replacement;`
      );
      expect(findings).toHaveLength(1);
      expectExactFinding(findings[0]);
    });
  });

  describe("C07C-B mixed-family aggregation and combined selection", () => {
    it("emits one finding for valid ethers and viem sinks in one file after one read", async () => {
      const source = `${walletSource("{ type: 3 }")}
${viemJsonRpcSource()}`;
      const readFile = vi.fn(async () => source);
      const findings = await runRule(source, { readFile });
      expect(findings).toHaveLength(1);
      expectExactFinding(findings[0]);
      expect(readFile).toHaveBeenCalledTimes(1);
      expect(readFile).toHaveBeenCalledWith("src/submit.ts");
    });

    it("emits one finding for multiple valid viem sinks", async () => {
      const source = `import { createWalletClient, http } from "viem";
import { arcTestnet } from "viem/chains";
const first = createWalletClient({ chain: arcTestnet, transport: http(), account: "${ADDRESS}" });
first.sendTransaction({ type: "eip4844" });
const second = createWalletClient({ chain: arcTestnet, transport: http("${ARC_RPC}"), account: "${ADDRESS}" });
second.sendTransaction({ type: "eip4844" });`;
      const findings = await runRule(source);
      expect(findings).toHaveLength(1);
      expectExactFinding(findings[0]);
    });

    it("reports later valid viem when an earlier ethers sink is invalid", async () => {
      const source = `${walletSource("{ type: 2 }")}
${viemJsonRpcSource()}`;
      const findings = await runRule(source);
      expect(findings).toHaveLength(1);
      expectExactFinding(findings[0]);
    });

    it("reports later valid ethers when an earlier viem sink is invalid", async () => {
      const source = `${viemJsonRpcSource(`{ type: "eip1559" }`)}
${walletSource("{ type: 3 }")}`;
      const findings = await runRule(source);
      expect(findings).toHaveLength(1);
      expectExactFinding(findings[0]);
    });

    it("selects valid viem-only and delegates ethers-only behavior", () => {
      const ethers = submission(20);
      const viemRecord = viemSubmission(10);
      expect(selectEarliestC07CViolation([], [viemRecord])).toBe(viemRecord);
      expect(selectEarliestC07CViolation([ethers], [])).toBe(ethers);
      expect(selectEarliestC07CViolation([ethers], [])).toBe(
        selectEarliestC07BViolation([ethers])
      );
    });

    it("selects the globally earliest valid record without depending on input order", () => {
      const ethersEarly = submission(20);
      const ethersLate = submission(80);
      const viemEarly = viemSubmission(10);
      const viemLate = viemSubmission(90);
      const permutations = [
        {
          ethers: [ethersLate, ethersEarly],
          viem: [viemLate, viemEarly]
        },
        {
          ethers: [ethersEarly, ethersLate],
          viem: [viemEarly, viemLate]
        },
        {
          ethers: [ethersLate, ethersEarly],
          viem: [viemEarly, viemLate]
        }
      ];

      for (const candidates of permutations) {
        const ethersBefore = [...candidates.ethers];
        const viemBefore = [...candidates.viem];
        expect(
          selectEarliestC07CViolation(candidates.ethers, candidates.viem)
        ).toBe(viemEarly);
        expect(candidates.ethers).toEqual(ethersBefore);
        expect(candidates.viem).toEqual(viemBefore);
      }
    });

    it("skips invalid earlier records from both families", () => {
      const invalidEthers = submission(1, { ownership: "proven-non-arc" });
      const invalidViem = viemSubmissionWithInvalidField(
        "transactionKind",
        "proven-non-blob"
      );
      const validViem = viemSubmission(30);
      const validEthers = submission(40);
      expect(
        selectEarliestC07CViolation(
          [invalidEthers, validEthers],
          [invalidViem, validViem]
        )
      ).toBe(validViem);
    });

    it("keeps the ethers record by object identity on an exact offset tie", () => {
      const ethers = submission(10);
      const viemRecord = viemSubmission(10);
      expect(selectEarliestC07CViolation([ethers], [viemRecord])).toBe(ethers);
    });

    it.each([
      ["provenance", "lookalike-client"],
      ["sink", "writeContract"],
      ["structuralSafety", "unknown"],
      ["ownership", "proven-non-arc"],
      ["accountRoute", "custom-account"],
      ["transactionKind", "proven-non-blob"],
      ["evidenceToken", "eip1559"]
    ] as const)("rejects a viem record with mutated %s", (field, value) => {
      const invalid = viemSubmissionWithInvalidField(field, value);
      expect(selectEarliestC07CViolation([], [invalid])).toBeUndefined();
    });

    it("accepts both exact viem account routes", () => {
      const jsonRpc = viemSubmission(20);
      const privateKey = viemSubmission(10, {
        accountRoute: "private-key-local-account"
      });
      expect(selectEarliestC07CViolation([], [jsonRpc, privateKey])).toBe(
        privateKey
      );
    });
  });

  describe("F01-F08 exact finding, aggregation, and observable boundaries", () => {
    it("F01/R07 locks the exact message, fix, identity, severity, docs, and file", async () => {
      const findings = await runRule(walletSource("{ type: 3 }"));
      expect(findings).toHaveLength(1);
      expectExactFinding(findings[0]);
    });

    it("F02 emits one finding for multiple supported violating sinks", async () => {
      const findings = await runRule(
        `import { JsonRpcProvider, Wallet } from "ethers";
const provider = new JsonRpcProvider("${ARC_RPC}");
const signer = new Wallet(key, provider);
signer.sendTransaction({ type: 3 });
signer.sendTransaction({ type: 3, blobs: [blob] });`
      );
      expect(findings).toHaveLength(1);
      expectExactFinding(findings[0]);
    });

    it("F02 selects the smallest violating callOffset independent of input order", () => {
      const invalid = submission(5, { ownership: "proven-non-arc" });
      const permutations = [
        [submission(90), invalid, submission(10), submission(40)],
        [submission(40), submission(10), submission(90), invalid],
        [invalid, submission(90), submission(10), submission(40)]
      ];
      for (const candidates of permutations) {
        expect(selectEarliestC07BViolation(candidates)?.callOffset).toBe(10);
      }
    });

    it("F03 skips earlier invalid candidates when selecting callOffset", () => {
      const candidates = [
        submission(1, {
          transaction: {
            objectOffset: 2,
            safe: true,
            chainId: "omitted",
            kind: "proven-non-blob",
            exactTypeToken: 2,
            supportedBlobFields: []
          }
        }),
        submission(20)
      ];
      expect(selectEarliestC07BViolation(candidates)?.callOffset).toBe(20);
    });

    it("F04 preserves file order and repeated deterministic output", async () => {
      const files = ["src/z-submit.ts", "src/a-submit.ts"];
      const sources = {
        [files[0]]: viemJsonRpcSource(),
        [files[1]]: jsonRpcSignerSource("{ type: 3 }")
      };
      const first = await runRule("", { files, sources });
      const second = await runRule("", { files, sources });
      expect(first).toEqual(second);
      expect(first.map(({ files: findingFiles }) => findingFiles)).toEqual([
        [files[0]],
        [files[1]]
      ]);
      expectExactFinding(first[0], files[0]);
      expectExactFinding(first[1], files[1]);
    });

    it.each(["info", "warning", "critical"] as const)(
      "F05 honors %s severity override without changing the contract",
      async (severity) => {
        const findings = await runRule(viemJsonRpcSource(), {
          rules: { "wallet/NO_BLOB_TX_ON_ARC": severity }
        });
        expect(findings).toHaveLength(1);
        expectExactFinding(findings[0], "src/submit.ts", severity);
      }
    );

    it("F06 does not read or analyze files when explicitly disabled", async () => {
      const readFile = vi.fn(async () => viemJsonRpcSource());
      const findings = await runRule("", {
        rules: { "wallet/NO_BLOB_TX_ON_ARC": "off" },
        readFile
      });
      expect(findings).toEqual([]);
      expect(readFile).not.toHaveBeenCalled();
    });

    it("F07 remains in wallet preset and absent from bridge-only preset", () => {
      const walletRules = getRulesForPresets(["wallet"]);
      expect(walletRules).toHaveLength(7);
      expect(walletRules.map(({ id }) => id)).toContain(
        "wallet/NO_BLOB_TX_ON_ARC"
      );
      expect(getRulesForPresets(["bridge"]).map(({ id }) => id)).not.toContain(
        "wallet/NO_BLOB_TX_ON_ARC"
      );
      expect(getRulesForPresets(["wallet", "bridge", "app-kit"])).toHaveLength(
        17
      );
    });

    it("F08/R04-R05 keeps reporter schemas while intended results change", async () => {
      const falsePositive = await runRule(
        `const chainId = 5042002;
const docs = "Arc EIP-4844 blob transaction type: 3";`
      );
      const violation = await runRule(viemJsonRpcSource());
      const cleanReport = createScanReport("clean", falsePositive);
      const violationReport = createScanReport("violation", violation);
      expect(cleanReport).toMatchObject({
        score: 100,
        status: "pass",
        summary: { critical: 0, warning: 0, info: 0 }
      });
      expect(violationReport).toMatchObject({
        score: 75,
        status: "fail",
        summary: { critical: 1, warning: 0, info: 0 }
      });
      const json = JSON.parse(jsonReporter.render(violationReport));
      expect(Object.keys(json)).toEqual([
        "project",
        "score",
        "status",
        "summary",
        "findings"
      ]);
      expect(json.findings).toEqual(violation);
      expect(terminalReporter.render(violationReport)).toContain(MESSAGE);
    });
  });

  describe("V01-V06 unsupported viem boundaries and legacy fallback removal", () => {
    it.each([
      [
        "V01 viem sendTransaction",
        `import { createWalletClient, http } from "viem";
const client = createWalletClient({ chain: { id: 5042002 }, transport: http("${ARC_RPC}") });
client.sendTransaction({ type: "eip4844", blobs: [blob] });`
      ],
      [
        "V02 viem writeContract",
        `import { createWalletClient, http } from "viem";
const client = createWalletClient({ chain: { id: 5042002 }, transport: http("${ARC_RPC}") });
client.writeContract({ type: "eip4844", blobs: [blob] });`
      ],
      [
        "V03 custom account",
        `const account = { signTransaction() {} };
const arc = "${ARC_RPC}";
account.sendTransaction({ type: 3 });`
      ],
      [
        "V04 matching viem method names",
        `import { createWalletClient, custom } from "viem";
const client = createWalletClient({ chain: { id: 5042002 }, transport: custom(provider) });
client.sendTransaction({ type: 3 });`
      ],
      [
        "V05 JSON-RPC-looking viem account",
        `import { createWalletClient, http } from "viem";
const client = createWalletClient({ account: "0xabc", chain: { id: 5042002 }, transport: http("${ARC_RPC}") });
client.sendTransaction({ type: "eip4844" });`
      ],
      [
        "V06 viem prototype counterexample",
        `import { createWalletClient, http } from "viem";
Object.prototype.type = "eip4844";
const client = createWalletClient({ chain: { id: 5042002 }, transport: http("${ARC_RPC}") });
client.sendTransaction({});`
      ],
      [
        "comments and documentation",
        `// Arc blob transaction type: 3 maxFeePerBlobGas
const docs = "EIP-4844 blobVersionedHashes on Arc";`
      ],
      [
        "generic Arc marker plus blob words",
        `const chainId = 5042002;
const tx = { type: 3, maxFeePerBlobGas: 1n };`
      ]
    ])("ignores %s", async (_label, source) => {
      await expect(runRule(source)).resolves.toEqual([]);
    });
  });
});
