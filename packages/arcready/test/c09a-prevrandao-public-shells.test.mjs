import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import process from "node:process";
import { afterEach, describe, expect, it } from "vitest";

import { DEFAULT_CONFIG } from "../core/config/index.ts";
import { runRulesInstrumented } from "../core/rules/instrumentation.ts";
import { runRules } from "../core/rules/index.ts";
import { noPrevrandaoRelaySelectionRule } from "../rules/bridge/no-prevrandao-relay-selection.ts";
import { prevrandaoNotSupportedRule } from "../rules/wallet/prevrandao-not-supported.ts";

const ARC_ADDRESS = "0x1111111111111111111111111111111111111111";
const BRIDGE_SOURCE = `
pragma solidity ^0.8.24;
contract RelaySelector {
  address[] internal relayers;
  function selectRelay() external view returns (address) {
    return relayers[block.prevrandao % relayers.length];
  }
}`;
const WALLET_SOURCE = `
pragma solidity ^0.8.24;
contract WinnerSelector {
  address[] internal winners;
  function chooseWinner() external view returns (address) {
    return winners[block.prevrandao % winners.length];
  }
}`;
const RECIPIENT_SOURCE = `
pragma solidity ^0.8.24;
contract RecipientSelector {
  address[] internal recipients;
  function chooseRecipient() external view returns (address) {
    return recipients[block.prevrandao % recipients.length];
  }
}`;

const tempDirs = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("C09A-E4 PREVRANDAO compatibility shells", () => {
  it("emits a wallet-owned record only through the wallet shell", async () => {
    const context = createContext({
      "src/WinnerSelector.sol": WALLET_SOURCE,
      "broadcast/Deploy.s.sol/5042002/run-latest.json":
        broadcast("WinnerSelector")
    });

    await expect(
      runRules([noPrevrandaoRelaySelectionRule], context)
    ).resolves.toEqual([]);
    const wallet = await runRules([prevrandaoNotSupportedRule], context);
    const both = await runRules(
      [prevrandaoNotSupportedRule, noPrevrandaoRelaySelectionRule],
      context
    );

    expect(wallet).toHaveLength(1);
    expect(both).toEqual(wallet);
    expect(wallet[0]).toEqual({
      ruleId: "wallet/PREVRANDAO_NOT_SUPPORTED",
      severity: "critical",
      message:
        "Static source analysis ties WinnerSelector.chooseWinner to a PREVRANDAO-dependent collection selection. Foundry artifact broadcast/Deploy.s.sol/5042002/run-latest.json associates that exact concrete contract name and address 0x1111111111111111111111111111111111111111 with Arc Testnet (chain 5042002), where PREVRANDAO returns zero. This is static artifact evidence, not live deployment, bytecode, runtime, or transaction-success verification.",
      files: ["src/WinnerSelector.sol"],
      suggestedFix:
        "Replace the PREVRANDAO-dependent collection selection in WinnerSelector.chooseWinner with deterministic logic or an external randomness source appropriate to the application. Verify the actual deployment and runtime behavior independently.",
      docs: "arc-prevrandao",
      preset: "wallet"
    });
  });

  it("emits a bridge-owned record only through the bridge shell", async () => {
    const context = createContext({
      "src/RelaySelector.sol": BRIDGE_SOURCE,
      "broadcast/Deploy.s.sol/5042002/run-latest.json":
        broadcast("RelaySelector")
    });

    await expect(
      runRules([prevrandaoNotSupportedRule], context)
    ).resolves.toEqual([]);
    const bridge = await runRules([noPrevrandaoRelaySelectionRule], context);
    const both = await runRules(
      [prevrandaoNotSupportedRule, noPrevrandaoRelaySelectionRule],
      context
    );

    expect(bridge).toHaveLength(1);
    expect(both).toEqual(bridge);
    expect(bridge[0]).toMatchObject({
      ruleId: "bridge/NO_PREVRANDAO_RELAY_SELECTION",
      severity: "critical",
      files: ["src/RelaySelector.sol"],
      preset: "bridge",
      message: expect.stringContaining("RelaySelector.selectRelay")
    });
  });

  it("preserves deterministic rule and record order without cross-shell duplication", async () => {
    const context = createContext({
      "src/RelaySelector.sol": BRIDGE_SOURCE,
      "src/WinnerSelector.sol": WALLET_SOURCE,
      "broadcast/A.s.sol/5042002/run-latest.json": broadcast(
        "RelaySelector",
        "0x2222222222222222222222222222222222222222"
      ),
      "broadcast/B.s.sol/5042002/run-latest.json": broadcast("WinnerSelector")
    });

    const findings = await runRules(
      [prevrandaoNotSupportedRule, noPrevrandaoRelaySelectionRule],
      context
    );

    expect(findings.map((finding) => finding.ruleId)).toEqual([
      "wallet/PREVRANDAO_NOT_SUPPORTED",
      "bridge/NO_PREVRANDAO_RELAY_SELECTION"
    ]);
    expect(findings.map((finding) => finding.files[0])).toEqual([
      "src/WinnerSelector.sol",
      "src/RelaySelector.sol"
    ]);
  });

  it("keeps multiple same-owner records instead of coalescing by shell", async () => {
    const context = createContext({
      "src/RecipientSelector.sol": RECIPIENT_SOURCE,
      "src/WinnerSelector.sol": WALLET_SOURCE,
      "broadcast/A.s.sol/5042002/run-latest.json": broadcast(
        "RecipientSelector",
        "0x2222222222222222222222222222222222222222"
      ),
      "broadcast/B.s.sol/5042002/run-latest.json": broadcast("WinnerSelector")
    });

    const findings = await runRules([prevrandaoNotSupportedRule], context);

    expect(findings.map((finding) => finding.files[0])).toEqual([
      "src/RecipientSelector.sol",
      "src/WinnerSelector.sol"
    ]);
  });

  it("shares one instrumented analysis across both scheduled shells", async () => {
    const context = createContext({
      "src/RelaySelector.sol": BRIDGE_SOURCE,
      "src/WinnerSelector.sol": WALLET_SOURCE,
      "broadcast/A.s.sol/5042002/run-latest.json": broadcast(
        "RelaySelector",
        "0x2222222222222222222222222222222222222222"
      ),
      "broadcast/B.s.sol/5042002/run-latest.json": broadcast("WinnerSelector")
    });

    const result = await runRulesInstrumented(
      [prevrandaoNotSupportedRule, noPrevrandaoRelaySelectionRule],
      context
    );

    expect(result.findings).toHaveLength(2);
    expect(result.instrumentation.rules[0].readAttempts).toHaveLength(4);
    expect(result.instrumentation.rules[1].readAttempts).toEqual([]);
  });

  it("preserves runtime severity overrides and off scheduling", async () => {
    const files = {
      "src/WinnerSelector.sol": WALLET_SOURCE,
      "broadcast/Deploy.s.sol/5042002/run-latest.json":
        broadcast("WinnerSelector")
    };
    const warning = await runRules(
      [prevrandaoNotSupportedRule],
      createContext(files, {
        "wallet/PREVRANDAO_NOT_SUPPORTED": "warning"
      })
    );
    const off = await runRules(
      [prevrandaoNotSupportedRule],
      createContext(files, { "wallet/PREVRANDAO_NOT_SUPPORTED": "off" })
    );

    expect(warning[0].severity).toBe("warning");
    expect(off).toEqual([]);
  });

  it("normalizes the relative project root accepted by runScan", async () => {
    const context = createContext({
      "src/WinnerSelector.sol": WALLET_SOURCE,
      "broadcast/Deploy.s.sol/5042002/run-latest.json":
        broadcast("WinnerSelector")
    });
    context.projectRoot = relative(process.cwd(), context.projectRoot);

    await expect(
      runRules([prevrandaoNotSupportedRule], context)
    ).resolves.toHaveLength(1);
  });

  it.each([
    ["missing Foundry association", WALLET_SOURCE],
    ["mixHash lookalike", "contract WinnerSelector { bytes32 mixHash; }"],
    [
      "comment and string",
      'contract WinnerSelector { string constant TEXT = "block.prevrandao"; } // block.prevrandao'
    ],
    [
      "unsupported unused read",
      "contract WinnerSelector { function source() external view returns (uint256) { return block.prevrandao; } }"
    ]
  ])("does not emit for %s", async (label, source) => {
    const files = { "src/WinnerSelector.sol": source };
    if (label !== "missing Foundry association") {
      files["broadcast/Deploy.s.sol/5042002/run-latest.json"] =
        broadcast("WinnerSelector");
    }

    await expect(
      runRules([prevrandaoNotSupportedRule], createContext(files))
    ).resolves.toEqual([]);
  });
});

function broadcast(contractName, contractAddress = ARC_ADDRESS) {
  return JSON.stringify({
    chain: 5042002,
    transactions: [{ transactionType: "CREATE", contractName, contractAddress }]
  });
}

function createContext(files, rules = {}) {
  const projectRoot = mkdtempSync(join(tmpdir(), "arcready-c09a-e4-"));
  tempDirs.push(projectRoot);
  for (const [filePath, content] of Object.entries(files)) {
    const absolutePath = join(projectRoot, filePath);
    mkdirSync(dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, content);
  }
  return {
    projectRoot,
    config: { ...DEFAULT_CONFIG, rules },
    files: Object.keys(files)
      .filter((filePath) => filePath.startsWith("src/"))
      .map((filePath) => join(projectRoot, filePath)),
    detectedPresets: {
      detectedPresets: ["wallet", "bridge"],
      confidence: "high",
      reasons: ["C09A-E4 shell test"]
    },
    readFile: (filePath) => readFile(filePath, "utf8")
  };
}
