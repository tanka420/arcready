import { describe, expect, it } from "vitest";
import {
  analyzeArcTransactionSubmissionFile,
  supportsArcTransactionSubmissionPath
} from "../rules/wallet/arc-transaction-submission-analyzer.js";
import type {
  ArcTransactionSubmissionAnalysis,
  EthersOwnershipState,
  EthersSignerProvenance
} from "../rules/wallet/arc-transaction-submission-analyzer.js";

const ARC_RPC = "https://rpc.testnet.arc.network";
const ETH_RPC = "https://mainnet.infura.io/v3/key";
const IMPORTS = 'import { JsonRpcProvider, Wallet } from "ethers";';

const walletSource = (
  providerArguments: string,
  transaction: string,
  before = "",
  after = ""
) => `${IMPORTS}
const provider = new JsonRpcProvider(${providerArguments});
const signer = new Wallet(privateKey, provider);
${before}
signer.sendTransaction(${transaction});
${after}`;

const rpcSignerSource = (
  providerArguments: string,
  transaction: string,
  before = "",
  after = ""
) => `${IMPORTS}
const provider = new JsonRpcProvider(${providerArguments});
const signer = await provider.getSigner();
${before}
signer.sendTransaction(${transaction});
${after}`;

async function analyze(
  source: string,
  filePath = "src/submit.ts"
): Promise<ArcTransactionSubmissionAnalysis> {
  return analyzeArcTransactionSubmissionFile(filePath, source);
}

async function expectOne(
  source: string,
  ownership: EthersOwnershipState,
  provenance: EthersSignerProvenance = "ethers-wallet"
): Promise<void> {
  const first = await analyze(source);
  const second = await analyze(source);
  expect(first.status).toBe("analyzed");
  expect(first.submissions).toHaveLength(1);
  expect(first.submissions[0]).toMatchObject({
    provenance,
    sink: "sendTransaction",
    ownership,
    callOffset: source.indexOf("signer.sendTransaction")
  });
  expect(second).toEqual(first);
}

async function expectNone(source: string): Promise<void> {
  expect((await analyze(source)).submissions).toEqual([]);
}

async function expectInvalidCandidate(source: string): Promise<void> {
  const first = await analyze(source);
  const second = await analyze(source);
  expect(first).toEqual({ status: "analyzed", submissions: [] });
  expect(second).toEqual(first);
}

describe("Arc transaction-submission analyzer", () => {
  describe("P01-P09 positive provenance, ownership, and deterministic sinks", () => {
    it("P01 supports exact Arc Wallet provenance and a direct transaction", async () => {
      await expectOne(
        walletSource(`"${ARC_RPC}"`, "{ type: 3 }"),
        "proven-arc"
      );
    });

    it("P02 supports an awaited JsonRpcSigner", async () => {
      await expectOne(
        rpcSignerSource(`"${ARC_RPC}"`, "{ type: 3 }"),
        "proven-arc",
        "ethers-json-rpc-signer"
      );
    });

    it.each(["5042002", "5042002n", "0x4cef52", "0x4cef52n"])(
      "P03 supports Arc provider network %s with a neutral RPC",
      async (network) => {
        await expectOne(
          walletSource(`"https://example.invalid", ${network}`, "{ type: 3 }"),
          "proven-arc"
        );
      }
    );

    it("P04 lets a direct own Arc chainId own a neutral provider", async () => {
      await expectOne(
        walletSource(
          '"https://example.invalid"',
          "{ chainId: 5042002, type: 3 }"
        ),
        "proven-arc"
      );
    });

    it("P05 retains named import aliases", async () => {
      const source = `import { JsonRpcProvider as Provider, Wallet as EthersWallet } from "ethers";
const provider = new Provider("${ARC_RPC}");
const signer = new EthersWallet(privateKey, provider);
signer.sendTransaction({ type: 3 });`;
      await expectOne(source, "proven-arc");
    });

    it("P06 retains namespace dot constructor identities", async () => {
      const source = `import * as ethers from "ethers";
const provider = new ethers.JsonRpcProvider("${ARC_RPC}");
const signer = new ethers.Wallet(privateKey, provider);
signer.sendTransaction({ type: 3 });`;
      await expectOne(source, "proven-arc");
    });

    it.each([
      "ethers.Wallet = LocalWallet;",
      'ethers["JsonRpcProvider"] = LocalProvider;',
      "ethers.Wallet ||= LocalWallet;",
      "ethers.JsonRpcProvider += replacement;",
      "delete ethers.Wallet;",
      "ethers.JsonRpcProvider++;",
      "--ethers.Wallet;"
    ])(
      "rejects exact ethers namespace constructor mutation: %s",
      async (mutation) => {
        for (const afterSink of [false, true]) {
          const source = `import * as ethers from "ethers";
${afterSink ? "" : mutation}
const provider = new ethers.JsonRpcProvider("${ARC_RPC}");
const signer = new ethers.Wallet(privateKey, provider);
signer.sendTransaction({ type: 3 });
${afterSink ? mutation : ""}`;
          await expectInvalidCandidate(source);
        }
      }
    );

    it("keeps unrelated, wrong-module, and shadow-only namespace mutations unrelated", async () => {
      await expectOne(
        `import * as ethers from "ethers";
import * as other from "ethers-wrapper";
const provider = new ethers.JsonRpcProvider("${ARC_RPC}");
const signer = new ethers.Wallet(privateKey, provider);
ethers.Other = replacement;
other.Wallet = LocalWallet;
function unrelated() {
  const ethers = { Wallet: LocalWallet };
  ethers.Wallet = replacement;
}
signer.sendTransaction({ type: 3 });`,
        "proven-arc"
      );
    });

    it("invalidates only the mutated namespace constructor identity", async () => {
      const source = `import * as ethers from "ethers";
ethers.Wallet = LocalWallet;
const provider = new ethers.JsonRpcProvider("${ARC_RPC}");
const signer = await provider.getSigner();
signer.sendTransaction({ type: 3 });`;
      await expectOne(source, "proven-arc", "ethers-json-rpc-signer");
    });

    it("P07 observes the cumulative per-slot binding budget", async () => {
      const source = `${IMPORTS}
const rpc = "${ARC_RPC}";
const network = 5042002;
const provider = new JsonRpcProvider(rpc, network);
const signer = new Wallet(privateKey, provider);
const hashes = [hash];
const fee = 0n;
const tx = { chainId: 5042002, type: 3, blobVersionedHashes: hashes, maxFeePerBlobGas: fee };
signer.sendTransaction(tx);`;
      const result = await analyze(source);
      expect(result.submissions[0]).toMatchObject({
        ownership: "proven-arc",
        transaction: {
          kind: "proven-blob",
          supportedBlobFields: ["blobVersionedHashes", "maxFeePerBlobGas"]
        }
      });
    });

    it("P08 treats quoted own critical keys like identifier keys", async () => {
      const result = await analyze(
        walletSource(`"${ARC_RPC}"`, '{ "chainId": 5042002, "type": 3 }')
      );
      expect(result.submissions[0]?.transaction).toMatchObject({
        chainId: "proven-arc",
        kind: "proven-blob",
        exactTypeToken: 3
      });
    });

    it("P09 retains Wallet and JsonRpcSigner siblings independently", async () => {
      const source = `${IMPORTS}
const provider = new JsonRpcProvider("${ARC_RPC}");
const wallet = new Wallet(privateKey, provider);
const rpcSigner = await provider.getSigner();
wallet.sendTransaction({ type: 3 });
rpcSigner.sendTransaction({ type: 3 });`;
      const result = await analyze(source);
      expect(result.submissions.map(({ provenance }) => provenance)).toEqual([
        "ethers-wallet",
        "ethers-json-rpc-signer"
      ]);
      expect(result.submissions.map(({ callOffset }) => callOffset)).toEqual([
        source.indexOf("wallet.sendTransaction"),
        source.indexOf("rpcSigner.sendTransaction")
      ]);
    });
  });

  describe("O01-O13 four-state ownership and exact provenance", () => {
    it.each([
      [
        "O01 Arc RPC conflicts with a non-Arc provider network",
        walletSource(`"${ARC_RPC}", 1`, "{ type: 3 }"),
        "conflicting"
      ],
      [
        "O02 non-Arc provider conflicts with own Arc chainId",
        walletSource(`"${ETH_RPC}"`, "{ chainId: 5042002, type: 3 }"),
        "conflicting"
      ],
      [
        "O03 Arc provider conflicts with own non-Arc chainId",
        walletSource(`"${ARC_RPC}"`, "{ chainId: 1, type: 3 }"),
        "conflicting"
      ],
      [
        "O04 omitted transaction chainId preserves Arc",
        walletSource(`"${ARC_RPC}"`, "{ type: 3 }"),
        "proven-arc"
      ],
      [
        "O05 unknown-present chainId suppresses Arc proof",
        walletSource(`"${ARC_RPC}"`, "{ chainId: chain, type: 3 }"),
        "unknown"
      ],
      [
        "O06 neutral provider plus non-Arc chainId is non-Arc",
        walletSource('"https://example.invalid"', "{ chainId: 1, type: 3 }"),
        "proven-non-arc"
      ],
      [
        "O07 provider-network decimal string is sticky unknown",
        walletSource(`"${ARC_RPC}", "5042002"`, "{ type: 3 }"),
        "unknown"
      ],
      [
        "O08 provider-network hex string cannot be rescued by transaction",
        walletSource(
          `"https://example.invalid", "0x4cef52"`,
          '{ chainId: "0x4cef52", type: 3 }'
        ),
        "unknown"
      ]
    ] as const)("%s", async (_name, source, ownership) => {
      await expectOne(source, ownership);
    });

    it.each([
      [
        "BrowserProvider",
        `import { BrowserProvider, Wallet } from "ethers";
const provider = new BrowserProvider(injected);
const signer = new Wallet(key, provider);
signer.sendTransaction({ type: 3 });`
      ],
      [
        "wrong package",
        `import { JsonRpcProvider, Wallet } from "ethers-wrapper";
const provider = new JsonRpcProvider("${ARC_RPC}");
const signer = new Wallet(key, provider);
signer.sendTransaction({ type: 3 });`
      ],
      [
        "subclass",
        `${IMPORTS}
class Provider extends JsonRpcProvider {}
const provider = new Provider("${ARC_RPC}");
const signer = new Wallet(key, provider);
signer.sendTransaction({ type: 3 });`
      ],
      [
        "imported signer",
        `${IMPORTS}
import { signer } from "./signer.js";
signer.sendTransaction({ type: 3 });`
      ]
    ])("O09 rejects %s provenance", async (_kind, source) => {
      await expectNone(source);
    });

    it.each([
      [
        "Wallet without provider",
        `${IMPORTS}
const signer = new Wallet(key);
signer.sendTransaction({ type: 3 });`
      ],
      [
        "unawaited getSigner",
        `${IMPORTS}
const provider = new JsonRpcProvider("${ARC_RPC}");
const signer = provider.getSigner();
signer.sendTransaction({ type: 3 });`
      ],
      [
        "invalid await context",
        `${IMPORTS}
const provider = new JsonRpcProvider("${ARC_RPC}");
function submit() {
  const signer = await provider.getSigner();
  signer.sendTransaction({ type: 3 });
}`
      ]
    ])("O10 rejects %s", async (_kind, source) => {
      await expectNone(source);
    });

    it.each([
      "0",
      "-5042002",
      "5042002.0",
      "5.042002e6",
      "0b10011001110111101010010",
      "5_042_002",
      "null",
      "network"
    ])(
      "O11 treats unsupported provider network %s as sticky unknown",
      async (network) => {
        await expectOne(
          walletSource(`"${ARC_RPC}", ${network}`, "{ type: 3 }"),
          "unknown"
        );
      }
    );

    it.each([
      "5042002",
      "5042002n",
      "0x4cef52",
      "0x4cef52n",
      '"5042002"',
      '"0x4cEf52"'
    ])("O12 supports Arc transaction chainId %s", async (chainId) => {
      await expectOne(
        walletSource(
          '"https://example.invalid"',
          `{ chainId: ${chainId}, type: 3 }`
        ),
        "proven-arc"
      );
    });

    it.each([
      ETH_RPC,
      "https://RPC.MAINNET.INFURA.IO./v3/key",
      "https://eth-mainnet.g.alchemy.com/v2/key",
      "https://my-ethereum-rpc.example",
      "https://rpc.ankr.com/ETH_SEPOLIA"
    ])("O13 recognizes exact non-Arc RPC family %s", async (rpc) => {
      await expectOne(
        walletSource(`"${rpc}"`, "{ type: 3 }"),
        "proven-non-arc"
      );
    });
  });

  describe("C01-C08 exact call grammar", () => {
    it("C01 and C02 support exact arity and trailing commas", async () => {
      const source = `${IMPORTS}
const provider = new JsonRpcProvider("${ARC_RPC}",);
const signer = new Wallet(key, provider,);
const tx = { type: 3, };
signer.sendTransaction(tx,);`;
      await expectOne(source, "proven-arc");
    });

    it.each([
      "new JsonRpcProvider()",
      `new JsonRpcProvider("${ARC_RPC}", 5042002, extra)`,
      `new JsonRpcProvider(...["${ARC_RPC}"])`
    ])("C03 rejects provider grammar %s", async (construction) => {
      const source = `${IMPORTS}
const provider = ${construction};
const signer = new Wallet(key, provider);
signer.sendTransaction({ type: 3 });`;
      await expectNone(source);
    });

    it.each([
      'signer["sendTransaction"]({ type: 3 });',
      "signer?.sendTransaction({ type: 3 });",
      "signer.sendTransaction?.({ type: 3 });",
      "signer.sendTransaction.call(signer, { type: 3 });",
      "const send = signer.sendTransaction; send({ type: 3 });",
      "signer.sendTransaction({ type: 3 }, extra);",
      "signer.sendTransaction(...[{ type: 3 }]);"
    ])("C04 rejects sink variant %s", async (sink) => {
      const source = `${IMPORTS}
const provider = new JsonRpcProvider("${ARC_RPC}");
const signer = new Wallet(key, provider);
${sink}`;
      await expectNone(source);
    });

    it("C05 rejects getSigner arguments", async () => {
      await expectNone(
        `${IMPORTS}
const provider = new JsonRpcProvider("${ARC_RPC}");
const signer = await provider.getSigner(account);
signer.sendTransaction({ type: 3 });`
      );
    });

    it.each([
      'import Ethers from "ethers";',
      'import { JsonRpcProvider, Wallet } from "ethers@6.17.0";',
      'import { JsonRpcProvider, Wallet } from "ethers/providers";'
    ])("C06 rejects unsupported import %s", async (imports) => {
      await expectNone(
        `${imports}
const provider = new JsonRpcProvider("${ARC_RPC}");
const signer = new Wallet(key, provider);
signer.sendTransaction({ type: 3 });`
      );
    });

    it("C07 supports direct and one-bound transaction objects", async () => {
      const source = `${IMPORTS}
const provider = new JsonRpcProvider("${ARC_RPC}");
const signer = new Wallet(key, provider);
signer.sendTransaction({ type: 3 });
const tx = { type: 3 };
signer.sendTransaction(tx);`;
      expect((await analyze(source)).submissions).toHaveLength(2);
    });

    it.each([
      "signer.populateTransaction({ type: 3 });",
      "signer.signTransaction({ type: 3 });",
      "signer.estimateGas({ type: 3 });",
      "provider.broadcastTransaction(raw);",
      "contract.send({ type: 3 });"
    ])("C08 does not treat non-sink %s as a submission", async (operation) => {
      const source = `${IMPORTS}
const provider = new JsonRpcProvider("${ARC_RPC}");
const signer = new Wallet(key, provider);
${operation}`;
      await expectNone(source);
    });
  });

  describe("D01-D05 binding, lexical, and direct-only critical values", () => {
    it("D01 supports one immutable binding in every enabled slot", async () => {
      const source = `${IMPORTS}
const rpc = "${ARC_RPC}";
const network = 5042002;
const provider = new JsonRpcProvider(rpc, network);
const signer = new Wallet(key, provider);
const tx = { chainId: 5042002, type: 3 };
signer.sendTransaction(tx);`;
      await expectOne(source, "proven-arc");
    });

    it.each([
      `${IMPORTS}
const rpc1 = "${ARC_RPC}"; const rpc2 = rpc1;
const provider = new JsonRpcProvider(rpc2);
const signer = new Wallet(key, provider);
signer.sendTransaction({ type: 3 });`,
      `${IMPORTS}
const provider1 = new JsonRpcProvider("${ARC_RPC}"); const provider2 = provider1;
const signer = new Wallet(key, provider2);
signer.sendTransaction({ type: 3 });`,
      `${IMPORTS}
const provider = new JsonRpcProvider("${ARC_RPC}");
const signer1 = new Wallet(key, provider); const signer2 = signer1;
signer2.sendTransaction({ type: 3 });`,
      `${IMPORTS}
const provider = new JsonRpcProvider("${ARC_RPC}");
const signer = new Wallet(key, provider);
const tx1 = { type: 3 }; const tx2 = tx1;
signer.sendTransaction(tx2);`
    ])("D02 rejects depth + 1", async (source) => {
      await expectNone(source);
    });

    it.each([
      "const tx = importedTx;",
      "const tx = condition ? { type: 3 } : { type: 2 };",
      "const tx = makeTransaction();"
    ])("D03 rejects critical initializer: %s", async (declaration) => {
      await expectNone(
        `${IMPORTS}
const provider = new JsonRpcProvider("${ARC_RPC}");
const signer = new Wallet(key, provider);
${declaration}
signer.sendTransaction(tx);`
      );
    });

    it("D04 resolves nearest lexical shadow without outer leakage", async () => {
      const source = `${IMPORTS}
const provider = new JsonRpcProvider("${ARC_RPC}");
const signer = new Wallet(key, provider);
{
  const signer = { sendTransaction() {} };
  signer.sendTransaction({ type: 3 });
}`;
      await expectNone(source);
    });

    it.each([
      "const kind = 3; signer.sendTransaction({ type: kind });",
      "const chain = 5042002; signer.sendTransaction({ chainId: chain, type: 3 });"
    ])(
      "D05 keeps transaction chainId/type identifier direct-only",
      async (sink) => {
        const result = await analyze(
          `${IMPORTS}
const provider = new JsonRpcProvider("${ARC_RPC}");
const signer = new Wallet(key, provider);
${sink}`
        );
        expect(result.submissions[0]).toMatchObject({
          ownership: sink.includes("chainId") ? "unknown" : "proven-arc",
          transaction: {
            kind: sink.includes("type: kind") ? "unknown" : "proven-blob"
          }
        });
      }
    );
  });

  describe("U01-U15 mutation, alias, and unknown-target barriers", () => {
    it.each([
      "tx.type = 2;",
      'tx["type"] ||= 2;',
      "tx.count++;",
      "delete tx.type;",
      "signer.sendTransaction = replacement;",
      "provider.getSigner = replacement;"
    ])(
      "U01 and U09 invalidate direct/property writes: %s",
      async (mutation) => {
        await expectNone(
          walletSource(
            `"${ARC_RPC}"`,
            "tx",
            "const tx = { type: 3 };",
            mutation
          )
        );
      }
    );

    it.each([
      "[tx] = values;",
      "({ tx } = values);",
      "({ value: tx.type } = values);",
      "for (tx of values) {}"
    ])(
      "U02 invalidates destructuring/loop-target write: %s",
      async (mutation) => {
        const supported = walletSource(
          `"${ARC_RPC}"`,
          "tx",
          "const tx = { type: 3 };"
        );
        await expectOne(supported, "proven-arc");
        await expectInvalidCandidate(
          walletSource(
            `"${ARC_RPC}"`,
            "tx",
            "const tx = { type: 3 };",
            mutation
          )
        );
      }
    );

    it.each([
      "unknown(tx);",
      "new Unknown(tx);",
      "unknown.call(null, tx);",
      "tag`${tx}`;",
      "const detached = tx.toJSON;",
      "const box = { tx };",
      "Object.assign({}, tx);",
      "unknown(...tx);",
      "export { tx };"
    ])("U03 and U08 reject critical escape: %s", async (escape) => {
      await expectInvalidCandidate(
        walletSource(`"${ARC_RPC}"`, "tx", "const tx = { type: 3 };", escape)
      );
    });

    it.each([
      ["direct element write", "", 'hashes["0"] = other;'],
      ["direct property", "", "hashes.length = 0;"],
      ["direct built-in", "", "Object.assign(hashes, other);"],
      [
        "direct defineProperties",
        "",
        "Object.defineProperties(hashes, descriptors);"
      ],
      ["direct setPrototypeOf", "", "Reflect.setPrototypeOf(hashes, proto);"],
      ["direct escape", "", "unknown(hashes);"],
      ["direct spread escape", "", "unknown(...hashes);"],
      ["alias property", "const alias = hashes;", "alias.length = 0;"],
      ["alias element delete", "const alias = hashes;", 'delete alias["0"];'],
      [
        "alias built-in",
        "const alias = hashes;",
        "Object.defineProperty(alias, '0', { value: other });"
      ],
      [
        "alias setPrototypeOf",
        "const alias = hashes;",
        "Object.setPrototypeOf(alias, proto);"
      ],
      ["alias escape", "const alias = hashes;", "unknown(alias);"],
      ["alias spread escape", "const alias = hashes;", "unknown(...alias);"],
      ["alias reassignment", "const alias = hashes;", "alias = other;"]
    ])(
      "U04/U05/U13 reject supporting-array %s mutation or escape",
      async (_label, alias, mutation) => {
        for (const afterSink of [false, true]) {
          const setup = `const hashes = [hash]; const tx = { type: 3, blobVersionedHashes: hashes }; ${alias}`;
          await expectInvalidCandidate(
            walletSource(
              `"${ARC_RPC}"`,
              "tx",
              afterSink ? setup : `${setup} ${mutation}`,
              afterSink ? mutation : ""
            )
          );
        }
      }
    );

    it.each([
      ["push", "<target>.push(other);"],
      ["pop", "<target>.pop();"],
      ["shift", "<target>.shift();"],
      ["unshift", "<target>.unshift(other);"],
      ["splice", "<target>.splice(0, 1);"],
      ["sort", "<target>.sort();"],
      ["reverse", "<target>.reverse();"],
      ["fill", "<target>.fill(other);"],
      ["copyWithin", "<target>.copyWithin(0, 1);"]
    ])(
      "U04 rejects listed supporting-array mutator %s through direct and alias names",
      async (_method, mutationTemplate) => {
        for (const useAlias of [false, true]) {
          for (const afterSink of [false, true]) {
            const alias = useAlias ? "const alias = hashes;" : "";
            const mutation = mutationTemplate.replace(
              "<target>",
              useAlias ? "alias" : "hashes"
            );
            const setup = `const hashes = [hash]; const tx = { type: 3, blobVersionedHashes: hashes }; ${alias}`;
            await expectInvalidCandidate(
              walletSource(
                `"${ARC_RPC}"`,
                "tx",
                afterSink ? setup : `${setup} ${mutation}`,
                afterSink ? mutation : ""
              )
            );
          }
        }
      }
    );

    it("rejects reassigned ownership and supporting bindings file-globally", async () => {
      await expectNone(`${IMPORTS}
let rpc = "${ARC_RPC}";
const provider = new JsonRpcProvider(rpc);
const signer = new Wallet(key, provider);
rpc = otherRpc;
signer.sendTransaction({ type: 3 });`);
      await expectNone(`${IMPORTS}
const provider = new JsonRpcProvider("${ARC_RPC}");
const signer = new Wallet(key, provider);
let hashes = [hash];
const tx = { type: 3, blobVersionedHashes: hashes };
signer.sendTransaction(tx);
hashes = [otherHash];`);
    });

    it.each([
      "alias.type = 2;",
      "Object.assign(alias, { type: 2 });",
      "Object.defineProperty(alias, 'type', { value: 2 });",
      "Object.setPrototypeOf(alias, proto);"
    ])(
      "U05 and U13 invalidate through one approved alias: %s",
      async (mutation) => {
        await expectInvalidCandidate(
          walletSource(
            `"${ARC_RPC}"`,
            "tx",
            "const tx = { type: 3 }; const alias = tx;",
            mutation
          )
        );
      }
    );

    it.each([
      "const alias = signer as any;",
      "const alias = signer satisfies Signer;",
      "const alias = signer!;",
      "const alias = <Signer>signer;",
      "let alias = signer;",
      "const { sendTransaction } = signer;",
      "function receive(value = signer) {}",
      "class Holder { value = signer; }",
      "const values = [signer];",
      "const values = { signer };",
      "const tx = { type: 3, metadata: signer };"
    ])("rejects unsupported alias or storage topology: %s", async (storage) => {
      await expectInvalidCandidate(
        walletSource(`"${ARC_RPC}"`, "{ type: 3 }", storage)
      );
    });

    it("rejects a supported sink followed by an unsupported sink or escape", async () => {
      await expectInvalidCandidate(
        walletSource(
          `"${ARC_RPC}"`,
          "{ type: 3 }",
          "",
          "signer.sendTransaction(provider);"
        )
      );
      await expectInvalidCandidate(
        walletSource(`"${ARC_RPC}"`, "{ type: 3 }", "", "unknown(signer);")
      );
    });

    it("rejects critical data in unsafe Wallet argument placement", async () => {
      await expectInvalidCandidate(
        walletSource(
          `"${ARC_RPC}"`,
          "tx",
          "const tx = { type: 3 };",
          "new Wallet(tx, provider);"
        )
      );
      await expectInvalidCandidate(`${IMPORTS}
const provider = new JsonRpcProvider("${ARC_RPC}");
const tx = { type: 3 };
const signer = new Wallet(tx, provider);
signer.sendTransaction(tx);`);
    });

    it("U06 applies mutation before and after the sink", async () => {
      await expectNone(
        walletSource(
          `"${ARC_RPC}"`,
          "tx",
          "const tx = { type: 3 }; Object.assign(tx, {});"
        )
      );
      await expectNone(
        walletSource(
          `"${ARC_RPC}"`,
          "tx",
          "const tx = { type: 3 };",
          "Object.assign(tx, {});"
        )
      );
    });

    it("U07 ignores a nested write that resolves only to a shadow", async () => {
      await expectOne(
        walletSource(
          `"${ARC_RPC}"`,
          "tx",
          "const tx = { type: 3 }; function unrelated() { let tx = {}; tx.type = 2; }"
        ),
        "proven-arc"
      );
    });

    it.each([
      "Object.defineProperty(provider, 'getSigner', { value: replacement });",
      "Object.defineProperties(signer, { sendTransaction: { value: replacement } });",
      "Object.setPrototypeOf(tx, proto);",
      "Reflect.setPrototypeOf(signer, proto);",
      "Object.assign(provider, replacement);"
    ])(
      "U10-U12 invalidate all critical built-in targets: %s",
      async (mutation) => {
        await expectNone(
          walletSource(
            `"${ARC_RPC}"`,
            "tx",
            "const tx = { type: 3 };",
            mutation
          )
        );
      }
    );

    it.each([
      "Object.assign(dynamicTarget, value);",
      "Object.assign();",
      "Object.assign(...args);"
    ])(
      "U14 rejects unknown/missing/spread built-in target: %s",
      async (mutation) => {
        const result = await analyze(
          walletSource(`"${ARC_RPC}"`, "{ type: 3 }", mutation)
        );
        expect(result).toEqual({
          status: "unsupported-source",
          submissions: []
        });
      }
    );

    it.each([
      "Object.assign({}, value);",
      "const unrelated = {}; Object.defineProperty(unrelated, 'x', { value: 1 });"
    ])("U15 ignores a proven fresh unrelated target: %s", async (mutation) => {
      await expectOne(
        walletSource(`"${ARC_RPC}"`, "{ type: 3 }", mutation),
        "proven-arc"
      );
    });

    it.each([
      ["Object.assign signer", "Object.assign(signer1, replacement);"],
      [
        "Object.defineProperty signer",
        "Object.defineProperty(signer1, 'sendTransaction', { value: replacement });"
      ],
      [
        "Object.defineProperties signer",
        "Object.defineProperties(signer1, { sendTransaction: { value: replacement } });"
      ],
      [
        "Object.setPrototypeOf provider",
        "Object.setPrototypeOf(provider1, replacement);"
      ],
      [
        "Reflect.setPrototypeOf provider",
        "Reflect.setPrototypeOf(provider1, replacement);"
      ],
      [
        "legacy __defineGetter__ signer",
        "signer1.__defineGetter__('sendTransaction', getter);"
      ],
      [
        "legacy __defineSetter__ signer",
        "signer1.__defineSetter__('sendTransaction', setter);"
      ],
      [
        "approved signer alias",
        "const signer1Alias = signer1; Object.assign(signer1Alias, replacement);"
      ],
      [
        "approved provider alias",
        "const provider1Alias = provider1; Object.defineProperty(provider1Alias, 'getSigner', { value: replacement });"
      ]
    ])(
      "C07A correction isolates a resolved sibling %s target before and after sinks",
      async (_label, mutation) => {
        for (const afterSinks of [false, true]) {
          const source = `${IMPORTS}
const provider1 = new JsonRpcProvider("${ARC_RPC}");
const signer1 = new Wallet(key1, provider1);
const provider2 = new JsonRpcProvider("${ARC_RPC}");
const signer2 = new Wallet(key2, provider2);
${afterSinks ? "" : mutation}
signer1.sendTransaction({ type: 3 });
signer2.sendTransaction({ type: 3 });
${afterSinks ? mutation : ""}`;
          const first = await analyze(source);
          const second = await analyze(source);
          expect(first).toEqual({
            status: "analyzed",
            submissions: [
              {
                provenance: "ethers-wallet",
                sink: "sendTransaction",
                ownership: "proven-arc",
                callOffset: source.indexOf("signer2.sendTransaction"),
                transaction: {
                  objectOffset: source.lastIndexOf("{ type: 3 }"),
                  safe: true,
                  chainId: "omitted",
                  kind: "proven-blob",
                  exactTypeToken: 3,
                  supportedBlobFields: []
                }
              }
            ]
          });
          expect(second).toEqual(first);
        }
      }
    );

    it("C07A correction combines P09 subtype isolation with a resolved U12 target", async () => {
      const source = `${IMPORTS}
const provider1 = new JsonRpcProvider("${ARC_RPC}");
const wallet = new Wallet(key, provider1);
const provider2 = new JsonRpcProvider("${ARC_RPC}");
const rpcSigner = await provider2.getSigner();
Object.assign(wallet, replacement);
wallet.sendTransaction({ type: 3 });
rpcSigner.sendTransaction({ type: 3 });`;
      const first = await analyze(source);
      const second = await analyze(source);
      expect(first).toEqual({
        status: "analyzed",
        submissions: [
          {
            provenance: "ethers-json-rpc-signer",
            sink: "sendTransaction",
            ownership: "proven-arc",
            callOffset: source.indexOf("rpcSigner.sendTransaction"),
            transaction: {
              objectOffset: source.lastIndexOf("{ type: 3 }"),
              safe: true,
              chainId: "omitted",
              kind: "proven-blob",
              exactTypeToken: 3,
              supportedBlobFields: []
            }
          }
        ]
      });
      expect(second).toEqual(first);
    });

    it("C07A correction invalidates two independently resolved mutated siblings", async () => {
      const source = `${IMPORTS}
const provider1 = new JsonRpcProvider("${ARC_RPC}");
const signer1 = new Wallet(key1, provider1);
const provider2 = new JsonRpcProvider("${ARC_RPC}");
const signer2 = new Wallet(key2, provider2);
Object.assign(signer1, replacement);
Object.defineProperty(signer2, 'sendTransaction', { value: replacement });
signer1.sendTransaction({ type: 3 });
signer2.sendTransaction({ type: 3 });`;
      const first = await analyze(source);
      const second = await analyze(source);
      expect(first).toEqual({ status: "analyzed", submissions: [] });
      expect(second).toEqual(first);
    });

    it("C07A correction keeps a truly unresolved built-in target file-global", async () => {
      const source = `${IMPORTS}
const provider1 = new JsonRpcProvider("${ARC_RPC}");
const signer1 = new Wallet(key1, provider1);
const provider2 = new JsonRpcProvider("${ARC_RPC}");
const signer2 = new Wallet(key2, provider2);
Object.assign(selectTarget(), replacement);
signer1.sendTransaction({ type: 3 });
signer2.sendTransaction({ type: 3 });`;
      const first = await analyze(source);
      const second = await analyze(source);
      expect(first).toEqual({
        status: "unsupported-source",
        submissions: []
      });
      expect(second).toEqual(first);
    });

    it("C07A correction retains both siblings for a proven unrelated built-in target", async () => {
      const source = `${IMPORTS}
const provider1 = new JsonRpcProvider("${ARC_RPC}");
const signer1 = new Wallet(key1, provider1);
const provider2 = new JsonRpcProvider("${ARC_RPC}");
const signer2 = new Wallet(key2, provider2);
const unrelated = {};
Object.defineProperties(unrelated, descriptors);
signer1.sendTransaction({ type: 3 });
signer2.sendTransaction({ type: 3 });`;
      const first = await analyze(source);
      const second = await analyze(source);
      expect(first.status).toBe("analyzed");
      expect(first.submissions).toHaveLength(2);
      expect(first.submissions).toEqual([
        expect.objectContaining({
          provenance: "ethers-wallet",
          ownership: "proven-arc",
          callOffset: source.indexOf("signer1.sendTransaction"),
          transaction: expect.objectContaining({
            kind: "proven-blob",
            exactTypeToken: 3
          })
        }),
        expect.objectContaining({
          provenance: "ethers-wallet",
          ownership: "proven-arc",
          callOffset: source.indexOf("signer2.sendTransaction"),
          transaction: expect.objectContaining({
            kind: "proven-blob",
            exactTypeToken: 3
          })
        })
      ]);
      expect(second).toEqual(first);
    });

    it.each([
      ["direct before sink", "const count = hashes.length;", ""],
      ["parenthesized before sink", "const count = (hashes).length;", ""],
      [
        "local scalar arithmetic",
        "const count = hashes.length; const doubled = (count + 1) * 2;",
        ""
      ],
      [
        "approved one-hop alias",
        "const lengthAlias = hashes; const count = lengthAlias.length;",
        ""
      ],
      ["scalar unknown-call argument", "unknown(hashes.length);", ""],
      ["direct after sink", "", "const count = hashes.length;"],
      ["parenthesized after sink", "", "const count = (hashes).length;"]
    ])(
      "C07A correction preserves supporting-array .length as a benign %s read",
      async (_label, before, after) => {
        const source = walletSource(
          `"${ARC_RPC}"`,
          "tx",
          `const hashes = [hash];
const tx = { type: 3, blobVersionedHashes: hashes };
${before}`,
          after
        );
        const first = await analyze(source);
        const second = await analyze(source);
        expect(first).toEqual({
          status: "analyzed",
          submissions: [
            {
              provenance: "ethers-wallet",
              sink: "sendTransaction",
              ownership: "proven-arc",
              callOffset: source.indexOf("signer.sendTransaction"),
              transaction: {
                objectOffset: source.indexOf(
                  "{ type: 3, blobVersionedHashes: hashes }"
                ),
                safe: true,
                chainId: "omitted",
                kind: "proven-blob",
                exactTypeToken: 3,
                supportedBlobFields: ["blobVersionedHashes"]
              }
            }
          ]
        });
        expect(second).toEqual(first);
      }
    );

    it("C07A correction isolates benign reads across two supporting arrays", async () => {
      const source = walletSource(
        `"${ARC_RPC}"`,
        "tx",
        `const blobs = [blob];
const hashes = [hash];
const count = hashes.length;
const tx = { type: 3, blobs: blobs, blobVersionedHashes: hashes };`
      );
      const first = await analyze(source);
      const second = await analyze(source);
      expect(first).toEqual({
        status: "analyzed",
        submissions: [
          expect.objectContaining({
            provenance: "ethers-wallet",
            ownership: "proven-arc",
            callOffset: source.indexOf("signer.sendTransaction"),
            transaction: expect.objectContaining({
              kind: "proven-blob",
              exactTypeToken: 3,
              supportedBlobFields: ["blobs", "blobVersionedHashes"]
            })
          })
        ]
      });
      expect(second).toEqual(first);
    });

    it.each([
      [
        "dynamic element read",
        "const value = hashes[index];",
        "unsupported-source"
      ],
      [
        "static __proto__ read",
        'const value = hashes["__proto__"];',
        "unsupported-source"
      ],
      [
        "computed static length read",
        'const value = hashes["length"];',
        "analyzed"
      ],
      ["optional length read", "const value = hashes?.length;", "analyzed"],
      ["constructor read", "const value = hashes.constructor;", "analyzed"],
      ["method extraction", "const map = hashes.map;", "analyzed"],
      ["mutator extraction", "const push = hashes.push;", "analyzed"],
      ["direct identity alias", "const escaped = hashes;", "analyzed"],
      ["aggregate storage", "const box = { hashes };", "analyzed"],
      ["unknown-call escape", "unknown(hashes);", "analyzed"],
      ["spread escape", "unknown(...hashes);", "analyzed"]
    ])(
      "C07A correction rejects supporting-array %s",
      async (_label, use, status) => {
        const source = walletSource(
          `"${ARC_RPC}"`,
          "tx",
          `const hashes = [hash];
const tx = { type: 3, blobVersionedHashes: hashes };
${use}`
        );
        const first = await analyze(source);
        const second = await analyze(source);
        expect(first).toEqual({ status, submissions: [] });
        expect(second).toEqual(first);
      }
    );

    it.each([
      ["before", "hashes.push(other);", ""],
      ["after", "", "hashes.push(other);"],
      ["property write before", "hashes.length = 0;", ""],
      ["property write after", "", "hashes.length = 0;"]
    ])(
      "C07A correction keeps supporting-array %s mutation fail-closed",
      async (_label, before, after) => {
        const source = walletSource(
          `"${ARC_RPC}"`,
          "tx",
          `const hashes = [hash];
const tx = { type: 3, blobVersionedHashes: hashes };
${before}`,
          after
        );
        const first = await analyze(source);
        const second = await analyze(source);
        expect(first).toEqual({ status: "analyzed", submissions: [] });
        expect(second).toEqual(first);
      }
    );
  });

  describe("W01-W02 and T01-T18 wrapper/prototype/own-property safety", () => {
    it("W01 treats balanced parentheses as transparent", async () => {
      const source = `${IMPORTS}
const provider = ((new JsonRpcProvider((("${ARC_RPC}")))));
const signer = (new Wallet(key, (provider)));
signer.sendTransaction((({ type: ((3)) })));`;
      await expectOne(source, "proven-arc");
    });

    it("W01 parenthesizes exact getSigner and sink receivers", async () => {
      const source = `${IMPORTS}
const provider = new JsonRpcProvider("${ARC_RPC}");
const signer = await (provider).getSigner();
(signer).sendTransaction({ type: 3 });`;
      const first = await analyze(source);
      const second = await analyze(source);
      expect(first).toEqual({
        status: "analyzed",
        submissions: [
          expect.objectContaining({
            provenance: "ethers-json-rpc-signer",
            sink: "sendTransaction",
            ownership: "proven-arc",
            callOffset: source.indexOf("(signer).sendTransaction")
          })
        ]
      });
      expect(second).toEqual(first);
    });

    it.each([
      "{ type: 3 as number }",
      "{ type: 3 satisfies number }",
      "{ type: 3! }",
      "{ type: <number>3 }"
    ])("W02 rejects assertion wrapper %s", async (transaction) => {
      const result = await analyze(walletSource(`"${ARC_RPC}"`, transaction));
      expect(result.submissions[0]?.transaction.kind).toBe("unknown");
    });

    it.each([
      "(signer as Signer).sendTransaction({ type: 3 });",
      "(signer satisfies Signer).sendTransaction({ type: 3 });",
      "signer!.sendTransaction({ type: 3 });",
      "(<Signer>signer).sendTransaction({ type: 3 });"
    ])(
      "W02 rejects TypeScript wrapper around sink receiver: %s",
      async (sink) => {
        const source = `${IMPORTS}
const provider = new JsonRpcProvider("${ARC_RPC}");
const signer = new Wallet(key, provider);
${sink}`;
        await expectInvalidCandidate(source);
      }
    );

    it.each([
      'await provider["getSigner"]()',
      "await provider?.getSigner()",
      "await provider.getSigner?.()",
      "await (provider as Provider).getSigner()",
      "await (provider satisfies Provider).getSigner()",
      "await provider!.getSigner()",
      "await (<Provider>provider).getSigner()",
      "await provider.getSigner.call(provider)",
      "await provider.getSigner.apply(provider)",
      "await provider.getSigner.bind(provider)()"
    ])(
      "W02 rejects unsupported getSigner receiver/call form: %s",
      async (getSigner) => {
        const source = `${IMPORTS}
const provider = new JsonRpcProvider("${ARC_RPC}");
const signer = ${getSigner};
signer.sendTransaction({ type: 3 });`;
        await expectInvalidCandidate(source);
      }
    );

    it("T01 accepts own identifier and quoted type", async () => {
      expect(
        (await analyze(walletSource(`"${ARC_RPC}"`, "{ type: 3 }")))
          .submissions[0]?.transaction.kind
      ).toBe("proven-blob");
      expect(
        (await analyze(walletSource(`"${ARC_RPC}"`, '{ "type": 3 }')))
          .submissions[0]?.transaction.kind
      ).toBe("proven-blob");
    });

    it.each([
      '"3"',
      "3n",
      "3.0",
      "3e0",
      "0x3",
      "0b11",
      "0o3",
      "3_0",
      "-3",
      "kind",
      "getType()",
      "condition ? 3 : 2"
    ])("keeps runtime-equivalent or dynamic type %s unknown", async (type) => {
      const result = await analyze(
        walletSource(`"${ARC_RPC}"`, `{ type: ${type} }`)
      );
      expect(result.submissions[0]?.transaction.kind).toBe("unknown");
    });

    it("records exact decimal non-blob tokens without upgrading blob-looking fields", async () => {
      const result = await analyze(
        walletSource(
          `"${ARC_RPC}"`,
          "{ type: 2, blobs: [blob], blobVersionedHashes: [hash] }"
        )
      );
      expect(result.submissions[0]?.transaction).toMatchObject({
        kind: "proven-non-blob",
        exactTypeToken: 2,
        supportedBlobFields: ["blobs", "blobVersionedHashes"]
      });
    });

    it.each(["[]", "[,]", "[blob,,]", "[...blobs]", "[null]", "[undefined]"])(
      "does not treat unsupported supporting array %s as evidence",
      async (array) => {
        const result = await analyze(
          walletSource(
            `"${ARC_RPC}"`,
            `{ type: 3, blobVersionedHashes: ${array} }`
          )
        );
        expect(result.submissions[0]?.transaction).toMatchObject({
          kind: "proven-blob",
          supportedBlobFields: []
        });
      }
    );

    it.each([
      "Object.create({ type: 3 })",
      "{ __proto__: { type: 3 } }",
      '{ "__proto__": { type: 3 } }',
      "{ get type() { return 3; } }",
      "{ set other(value) {} , type: 3 }",
      "{ other() {}, type: 3 }",
      "{ ...other, type: 3 }",
      "{ [kind]: 3 }",
      "{ type }",
      "{ type: 3, type: 2 }"
    ])("T02-T04 rejects unsafe transaction shape %s", async (transaction) => {
      await expectNone(walletSource(`"${ARC_RPC}"`, transaction));
    });

    it.each([
      "Object.setPrototypeOf(tx, proto);",
      "Reflect.setPrototypeOf(tx, proto);",
      "Object.defineProperty(tx, 'type', { value: 2 });",
      "tx.__defineGetter__('type', getter);"
    ])(
      "T05-T10 rejects transaction/prototype mutation %s",
      async (mutation) => {
        await expectNone(
          walletSource(
            `"${ARC_RPC}"`,
            "tx",
            "const tx = { type: 3 };",
            `if (false) { ${mutation} }`
          )
        );
      }
    );

    it("T11 and T12 allow no same-file pollution and ordinary own data", async () => {
      await expectOne(
        walletSource(`"${ARC_RPC}"`, "{ type: 3, memo: 'ok' }"),
        "proven-arc"
      );
    });

    it.each([
      "tx.__proto__ = proto;",
      'tx["__proto__"] = proto;',
      "const alias = tx; alias.__proto__ = proto;"
    ])("T13 rejects explicit __proto__ mutation %s", async (mutation) => {
      const result = await analyze(
        walletSource(`"${ARC_RPC}"`, "tx", "const tx = { type: 3 };", mutation)
      );
      expect(result.status).toBe("unsupported-source");
      expect(result.submissions).toEqual([]);
    });

    it.each([
      "const proto = Object.prototype;",
      "Object.getPrototypeOf(tx);",
      "const builtIn = Object;",
      "Object?.assign({}, {});",
      "globalThis.Object.assign(tx, {});",
      "const value = item[key];",
      "const value = tx.prototype;"
    ])(
      "T14/T16-T18 reject global/prototype/dynamic access %s",
      async (barrier) => {
        const result = await analyze(
          walletSource(`"${ARC_RPC}"`, "{ type: 3 }", barrier)
        );
        expect(result.status).toBe("unsupported-source");
      }
    );

    it("T15 permits shadowed Object/Reflect lookalikes without critical escape", async () => {
      await expectOne(
        walletSource(
          `"${ARC_RPC}"`,
          "{ type: 3 }",
          "const Object = { assign() {} }; const Reflect = { get() {} }; Object.assign({}, {});"
        ),
        "proven-arc"
      );
    });
  });

  describe("E01-E11 dynamic-execution barriers", () => {
    it.each([
      "eval('code');",
      "(0, eval)('code');",
      "const execute = eval;",
      "consume(eval);",
      "Function('code');",
      "new Function('code');",
      "const Constructor = Function;",
      "(() => {}).constructor('code')();",
      "(function () {}).constructor('code');",
      "new object['constructor']('code');",
      "Reflect.construct(Function, ['code']);"
    ])("E01-E03/E05-E09 reject dynamic form %s", async (barrier) => {
      const result = await analyze(
        walletSource(`"${ARC_RPC}"`, "{ type: 3 }", barrier)
      );
      expect(result).toEqual({
        status: "unsupported-source",
        submissions: []
      });
    });

    it("E04 and E10 permit shadowed local eval/Function lookalikes", async () => {
      await expectOne(
        walletSource(
          `"${ARC_RPC}"`,
          "{ type: 3 }",
          "const eval = localEval; const Function = LocalFunction; eval('x'); new Function('x');"
        ),
        "proven-arc"
      );
    });

    it("does not treat binding keys, class fields, enum members, or labels as global references", async () => {
      const source = walletSource(
        `"${ARC_RPC}"`,
        "{ type: 3 }",
        `const {
  Function: localFunction,
  eval: localEval,
  Object: localObject,
  Reflect: localReflect,
  globalThis: localGlobalThis,
  window: localWindow,
  self: localSelf,
  global: localGlobal
} = helpers;
class Ordinary {
  Function = 1;
  eval = 2;
  Object = 3;
  Reflect = 4;
  globalThis = 5;
  window = 6;
  self = 7;
  global = 8;
}
const ordinaryObject = {
  Function: 1,
  eval() {},
  get Object() { return 1; },
  set Reflect(value) {}
};
class OrdinaryMethods {
  Function() {}
  eval() {}
  get Object() { return 1; }
  set Reflect(value) {}
}
enum OrdinaryNames {
  Function,
  eval,
  Object,
  Reflect,
  globalThis,
  window,
  self,
  global
}
export { localFunction as Function, localEval as eval };
Function: { break Function; }
eval: { break eval; }
Object: { break Object; }
Reflect: { break Reflect; }
globalThis: { break globalThis; }
window: { break window; }
self: { break self; }
global: { break global; }`
      );
      await expectOne(source, "proven-arc");
    });

    it.each([
      "consume(eval);",
      "consume(Function);",
      "consume(Object);",
      "consume(Reflect);",
      "consume(globalThis);",
      "consume(window);",
      "consume(self);",
      "consume(global);"
    ])(
      "keeps true global identifier reference %s fail-closed",
      async (barrier) => {
        const result = await analyze(
          walletSource(`"${ARC_RPC}"`, "{ type: 3 }", barrier)
        );
        expect(result).toEqual({
          status: "unsupported-source",
          submissions: []
        });
      }
    );

    it("E11 keeps ordinary code eligible", async () => {
      await expectOne(
        walletSource(`"${ARC_RPC}"`, "{ type: 3 }", "const ordinary = 1;"),
        "proven-arc"
      );
    });
  });

  describe("M01-M02 parser, compiler, file, and private result boundaries", () => {
    it("M01 fails closed for malformed syntax", async () => {
      expect(await analyze(`${IMPORTS}\nconst tx = { type: ;`)).toEqual({
        status: "malformed",
        submissions: []
      });
    });

    it("returns a deterministic compiler-unavailable internal outcome", async () => {
      const loader = async (): Promise<unknown> => {
        throw new Error("compiler unavailable");
      };
      expect(
        await analyzeArcTransactionSubmissionFile(
          "src/submit.ts",
          walletSource(`"${ARC_RPC}"`, "{ type: 3 }"),
          loader
        )
      ).toEqual({ status: "compiler-unavailable", submissions: [] });
    });

    it.each([
      "src/submit.d.ts",
      "src/submit.tsx",
      "src/submit.jsx",
      "src/submit.mjs",
      "src/submit.cjs",
      "src/submit.test.ts",
      "tests/submit.ts",
      "src/generated/submit.ts",
      "src/submit.generated.ts"
    ])("M02 excludes %s", async (filePath) => {
      expect(supportsArcTransactionSubmissionPath(filePath)).toBe(false);
      expect(
        await analyzeArcTransactionSubmissionFile(filePath, "not valid")
      ).toEqual({ status: "unsupported-file", submissions: [] });
    });

    it("M02 ignores ambient and type-only surfaces", async () => {
      await expectNone(`declare module "ambient" {
  const signer: { sendTransaction(tx: unknown): void };
  signer.sendTransaction({ type: 3 });
}
import type { JsonRpcProvider, Wallet } from "ethers";`);
    });

    it("does not treat global names in type annotations as executable barriers", async () => {
      await expectOne(
        walletSource(
          `"${ARC_RPC}"`,
          "{ type: 3 }",
          "const callback: typeof Function | undefined = undefined;"
        ),
        "proven-arc"
      );
    });

    it("returns multiple supported sinks in stable callOffset order", async () => {
      const source = `${IMPORTS}
const provider = new JsonRpcProvider("${ARC_RPC}");
const signer = new Wallet(key, provider);
signer.sendTransaction({ type: 3 });
signer.sendTransaction({ type: 2 });
signer.sendTransaction({ chainId: 1, type: 3 });`;
      const first = await analyze(source);
      const second = await analyze(source);
      expect(first.submissions.map(({ callOffset }) => callOffset)).toEqual(
        [...source.matchAll(/signer\.sendTransaction/g)].map(
          (match) => match.index
        )
      );
      expect(second).toEqual(first);
    });
  });
});
