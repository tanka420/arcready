import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_CONFIG,
  attestation404NotFatalRule,
  bridgeConfirmationsOneRule,
  cctpDomain26Rule,
  createStubReport,
  noPrevrandaoRelaySelectionRule,
  noWrappedUsdcOnArcRule,
  relayerUsesUsdcForGasRule,
  runRules
} from "../src/index.js";
import type { Rule, RuleContext } from "../src/index.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("bridge rules", () => {
  it("BRIDGE_CONFIRMATIONS_ONE flags multi-confirmation Arc bridge config", async () => {
    const findings = await runBridgeRule(
      bridgeConfirmationsOneRule,
      "export const arcBridge = { chain: 'Arc Testnet', requiredConfirmations: 12 };"
    );

    expect(findings[0]).toMatchObject({
      ruleId: "bridge/BRIDGE_CONFIRMATIONS_ONE",
      severity: "critical",
      docs: "arc-finality",
      preset: "bridge",
      message: expect.stringContaining("more than one confirmation"),
      suggestedFix: expect.stringContaining("1")
    });
  });

  it("BRIDGE_CONFIRMATIONS_ONE allows one confirmation", async () => {
    await expect(
      runBridgeRule(
        bridgeConfirmationsOneRule,
        "export const arcBridge = { chain: 'Arc Testnet', requiredConfirmations: 1 };"
      )
    ).resolves.toEqual([]);
  });

  it("BRIDGE_CONFIRMATIONS_ONE ignores guidance against slow finality", async () => {
    await expect(
      runBridgeRule(
        bridgeConfirmationsOneRule,
        "const chain = 'Arc Testnet';\nexport const docs = 'Do not wait for 12 confirmations in Arc bridge settlement.';"
      )
    ).resolves.toEqual([]);
  });

  it.each([
    ["ARC_DOMAIN", "const ARC_DOMAIN = 7;"],
    ["ARC_CCTP_DOMAIN", "const ARC_CCTP_DOMAIN = 7;"],
    ["case and whitespace variants", "const arc_cctp_domain : 7;"]
  ])("CCTP_DOMAIN_26 flags wrong explicit %s", async (_name, source) => {
    const findings = await runBridgeRule(
      cctpDomain26Rule,
      `Arc CCTP bridge\n${source}`
    );

    expect(findings[0]).toMatchObject({
      ruleId: "bridge/CCTP_DOMAIN_26",
      severity: "critical",
      docs: "arc-cctp-domain",
      message: expect.stringContaining("other than 26"),
      suggestedFix: expect.stringContaining("26")
    });
  });

  it.each([
    ["ARC_DOMAIN", "const ARC_DOMAIN = 26;"],
    ["ARC_CCTP_DOMAIN", "const ARC_CCTP_DOMAIN = 26;"]
  ])("CCTP_DOMAIN_26 allows correct explicit %s", async (_name, source) => {
    await expect(
      runBridgeRule(cctpDomain26Rule, `Arc CCTP bridge\n${source}`)
    ).resolves.toEqual([]);
  });

  it("CCTP_DOMAIN_26 flags an inline named domain map", async () => {
    const findings = await runBridgeRule(
      cctpDomain26Rule,
      "Arc CCTP bridge\nconst cctpDomains = { arc: 7 };"
    );

    expect(findings).toHaveLength(1);
    expect(findings[0]?.ruleId).toBe("bridge/CCTP_DOMAIN_26");
  });

  it("CCTP_DOMAIN_26 allows a correct inline named domain map", async () => {
    await expect(
      runBridgeRule(
        cctpDomain26Rule,
        "Arc CCTP bridge\nconst cctpDomains = { arc: 26 };"
      )
    ).resolves.toEqual([]);
  });

  it("CCTP_DOMAIN_26 flags a flat multiline named domain map", async () => {
    const findings = await runBridgeRule(
      cctpDomain26Rule,
      "Arc CCTP bridge\nconst cctpDomains = {\n  arc: 7\n};"
    );

    expect(findings).toHaveLength(1);
  });

  it("CCTP_DOMAIN_26 allows a correct flat multiline named domain map", async () => {
    await expect(
      runBridgeRule(
        cctpDomain26Rule,
        "Arc CCTP bridge\nconst cctpDomains = {\n  arc: 26\n};"
      )
    ).resolves.toEqual([]);
  });

  it("CCTP_DOMAIN_26 flags a directly indented YAML domain map", async () => {
    const findings = await runBridgeRule(
      cctpDomain26Rule,
      "Arc CCTP bridge\ncctpDomains:\n  arc: 7"
    );

    expect(findings).toHaveLength(1);
  });

  it("CCTP_DOMAIN_26 allows a correct directly indented YAML domain map", async () => {
    await expect(
      runBridgeRule(
        cctpDomain26Rule,
        "Arc CCTP bridge\ncctpDomains:\n  arc: 26"
      )
    ).resolves.toEqual([]);
  });

  it.each([
    ["braced", "const cctpDomains = {\r\n  arc: 7\r\n};"],
    ["YAML", "cctpDomains:\r\n  arc: 7"]
  ])(
    "CCTP_DOMAIN_26 supports CRLF in a multiline %s map",
    async (_name, source) => {
      const findings = await runBridgeRule(
        cctpDomain26Rule,
        `Arc CCTP bridge\r\n${source}`
      );

      expect(findings).toHaveLength(1);
    }
  );

  it("CCTP_DOMAIN_26 ignores an unrelated Arc chain ID", async () => {
    await expect(
      runBridgeRule(
        cctpDomain26Rule,
        "Arc CCTP bridge\nconst chainIds = { arc: 5042002 };"
      )
    ).resolves.toEqual([]);
  });

  it("CCTP_DOMAIN_26 ignores an Arc chain ID next to the correct domain", async () => {
    await expect(
      runBridgeRule(
        cctpDomain26Rule,
        "Arc CCTP bridge\nconst cctpDomains = { arc: 26 };\nconst chainIds = { arc: 5042002 };"
      )
    ).resolves.toEqual([]);
  });

  it("CCTP_DOMAIN_26 ignores unrelated Arc numeric configuration", async () => {
    await expect(
      runBridgeRule(
        cctpDomain26Rule,
        "Arc CCTP bridge\nconst retryByChain = { arc: 7 };"
      )
    ).resolves.toEqual([]);
  });

  it("CCTP_DOMAIN_26 ignores documentation warning about wrong domains", async () => {
    await expect(
      runBridgeRule(
        cctpDomain26Rule,
        "const chain = 'Arc Testnet';\n// CCTP note: do not set ARC_DOMAIN = 6; use 26."
      )
    ).resolves.toEqual([]);
  });

  it("CCTP_DOMAIN_26 ignores a commented incorrect named-map entry", async () => {
    await expect(
      runBridgeRule(
        cctpDomain26Rule,
        "Arc CCTP bridge\nconst cctpDomains = {\n  // arc: 7\n  arc: 26\n};"
      )
    ).resolves.toEqual([]);
  });

  it("CCTP_DOMAIN_26 ignores negative guidance about an incorrect domain", async () => {
    await expect(
      runBridgeRule(
        cctpDomain26Rule,
        "Arc CCTP bridge\nconst guidance = 'Do not use ARC_DOMAIN = 7 for the Arc CCTP domain.';"
      )
    ).resolves.toEqual([]);
  });

  it("NO_WRAPPED_USDC_ON_ARC flags a same-line Arc wrapped-USDC route", async () => {
    const findings = await runBridgeRule(
      noWrappedUsdcOnArcRule,
      "export const route = { chain: 'Arc Testnet', bridge: true, token: 'USDC.e' };"
    );

    expect(findings[0]).toMatchObject({
      ruleId: "bridge/NO_WRAPPED_USDC_ON_ARC",
      severity: "critical",
      docs: "arc-canonical-usdc",
      message: expect.stringContaining("wrapped or bridged USDC"),
      suggestedFix: expect.stringContaining("canonical Arc USDC")
    });
  });

  it.each([
    ["wUSDC token", "token", "wUSDC"],
    ["wrapped USDC asset", "asset", "wrapped USDC"],
    ["bridged USDC asset", "asset", "bridged USDC"],
    ["case-insensitive USDC.e token", "token", "usdc.E"],
    ["case-insensitive wUSDC token", "token", "Wusdc"]
  ])(
    "NO_WRAPPED_USDC_ON_ARC flags a generic Arc route with %s",
    async (_name, field, token) => {
      const findings = await runBridgeRule(
        noWrappedUsdcOnArcRule,
        `export const route = { chain: "Arc Testnet", bridge: true, ${field}: "${token}" };`
      );

      expect(findings).toHaveLength(1);
      expect(findings[0]?.ruleId).toBe("bridge/NO_WRAPPED_USDC_ON_ARC");
    }
  );

  it.each([
    ["ellipsis", 'note: "loading..."'],
    ["closing brace", 'note: "literal } brace"'],
    ["opening brace", 'note: "literal { brace"'],
    ["negative guidance", 'note: "This route should not be used."'],
    ["wrapped-USDC guidance", 'note: "Avoid USDC.e on Arc."']
  ])(
    "NO_WRAPPED_USDC_ON_ARC ignores a structural-looking %s in an irrelevant string",
    async (_name, member) => {
      await expect(
        runBridgeRule(
          noWrappedUsdcOnArcRule,
          `export const route = { chain: "Arc", ${member}, token: "USDC.e" };`
        )
      ).resolves.toHaveLength(1);
    }
  );

  it.each([
    [
      "line comment",
      'export const route = {\n  chain: "Arc", // loading... } {\n  token: "USDC.e"\n};'
    ],
    [
      "block comment",
      'export const route = {\n  chain: "Arc", /* loading... } { */\n  token: "USDC.e"\n};'
    ]
  ])(
    "NO_WRAPPED_USDC_ON_ARC allows a neutral %s between direct members",
    async (_name, source) => {
      await expect(
        runBridgeRule(noWrappedUsdcOnArcRule, source)
      ).resolves.toHaveLength(1);
    }
  );

  it("NO_WRAPPED_USDC_ON_ARC preserves executable code before trailing guidance", async () => {
    await expect(
      runBridgeRule(
        noWrappedUsdcOnArcRule,
        'export const route = { chain: "Arc", token: "USDC.e" }; // Do not use wrapped USDC on Arc.'
      )
    ).resolves.toHaveLength(1);
  });

  it("NO_WRAPPED_USDC_ON_ARC preserves executable code before trailing block guidance", async () => {
    await expect(
      runBridgeRule(
        noWrappedUsdcOnArcRule,
        'export const route = { chain: "Arc", token: "USDC.e" }; /* This route should not be used. */'
      )
    ).resolves.toHaveLength(1);
  });

  it.each([
    [
      "source string",
      'const example = \'{ chain: "Arc", token: "USDC.e", note: "... }" }\';\nexport const route = { chain: "Arc", token: "USDC.e" };'
    ],
    [
      "block comment",
      '/* { chain: "Arc", token: "USDC.e", note: "... }" } */\nexport const route = { chain: "Arc", token: "USDC.e" };'
    ]
  ])(
    "NO_WRAPPED_USDC_ON_ARC ignores object-looking text in a %s beside a live route",
    async (_name, source) => {
      await expect(
        runBridgeRule(noWrappedUsdcOnArcRule, source)
      ).resolves.toHaveLength(1);
    }
  );

  it.each([
    ["LF", "\n"],
    ["CRLF", "\r\n"]
  ])(
    "NO_WRAPPED_USDC_ON_ARC flags a flat multiline Arc route with %s",
    async (_name, newline) => {
      const source = [
        "export const route = {",
        '  chain: "Arc Testnet",',
        "  bridge: true,",
        '  token: "USDC.e"',
        "};"
      ].join(newline);

      await expect(
        runBridgeRule(noWrappedUsdcOnArcRule, source)
      ).resolves.toHaveLength(1);
    }
  );

  it("NO_WRAPPED_USDC_ON_ARC flags an Arc source token", async () => {
    await expect(
      runBridgeRule(
        noWrappedUsdcOnArcRule,
        'export const route = { bridge: true, sourceChain: "Arc Testnet", sourceToken: "USDC.e", destinationChain: "Ethereum", destinationToken: "USDC" };'
      )
    ).resolves.toHaveLength(1);
  });

  it("NO_WRAPPED_USDC_ON_ARC flags an Arc destination token", async () => {
    await expect(
      runBridgeRule(
        noWrappedUsdcOnArcRule,
        'export const route = { bridge: true, sourceChain: "Ethereum", sourceToken: "USDC", destinationChain: "Arc Testnet", destinationToken: "wUSDC" };'
      )
    ).resolves.toHaveLength(1);
  });

  it.each([
    ["Arc", '"Arc"'],
    ["case-insensitive Arc", '"arc"'],
    ["Arc_Testnet", '"Arc_Testnet"'],
    ["arcTestnet", '"arcTestnet"'],
    ["numeric Arc chain ID", "5042002"]
  ])(
    "NO_WRAPPED_USDC_ON_ARC supports the direct %s chain literal",
    async (_name, chain) => {
      await expect(
        runBridgeRule(
          noWrappedUsdcOnArcRule,
          `export const route = { chain: ${chain}, bridge: true, token: "USDC.e" };`
        )
      ).resolves.toHaveLength(1);
    }
  );

  it("NO_WRAPPED_USDC_ON_ARC allows canonical USDC routes", async () => {
    await expect(
      runBridgeRule(
        noWrappedUsdcOnArcRule,
        "export const route = { chain: 'Arc Testnet', bridge: true, token: 'USDC' };"
      )
    ).resolves.toEqual([]);
  });

  it("NO_WRAPPED_USDC_ON_ARC ignores wrapped USDC on a non-Arc source", async () => {
    await expect(
      runBridgeRule(
        noWrappedUsdcOnArcRule,
        'export const route = { bridge: true, sourceChain: "Ethereum", sourceToken: "USDC.e", destinationChain: "Arc Testnet", destinationToken: "USDC" };'
      )
    ).resolves.toEqual([]);
  });

  it("NO_WRAPPED_USDC_ON_ARC does not pair an Arc destination with a wrapped source token", async () => {
    await expect(
      runBridgeRule(
        noWrappedUsdcOnArcRule,
        'export const route = { bridge: true, sourceToken: "USDC.e", destinationChain: "Arc Testnet", destinationToken: "USDC" };'
      )
    ).resolves.toEqual([]);
  });

  it("NO_WRAPPED_USDC_ON_ARC ignores a non-Arc wrapped source without a destination", async () => {
    await expect(
      runBridgeRule(
        noWrappedUsdcOnArcRule,
        'export const arcBridge = { sourceChain: "Ethereum", sourceToken: "USDC.e" };'
      )
    ).resolves.toEqual([]);
  });

  it("NO_WRAPPED_USDC_ON_ARC keeps separate array route objects isolated", async () => {
    await expect(
      runBridgeRule(
        noWrappedUsdcOnArcRule,
        'export const routes = [{ chain: "Ethereum", bridge: true, token: "wUSDC" }, { chain: "Arc Testnet", bridge: true, token: "USDC" }];'
      )
    ).resolves.toEqual([]);
  });

  it("NO_WRAPPED_USDC_ON_ARC ignores an unrelated wrapped-token variable", async () => {
    await expect(
      runBridgeRule(
        noWrappedUsdcOnArcRule,
        'const wrappedToken = "USDC.e";\nexport const route = { chain: "Arc Testnet", bridge: true, token: "USDC" };'
      )
    ).resolves.toEqual([]);
  });

  it.each([
    [
      "aliased",
      'const wrappedToken = "USDC.e";\nexport const route = { chain: "Arc Testnet", bridge: true, token: wrappedToken };'
    ],
    [
      "computed",
      'export const route = { chain: "Arc Testnet", bridge: true, token: getToken("USDC.e") };'
    ],
    [
      "quoted-key",
      'export const route = { "chain": "Arc Testnet", bridge: true, token: "USDC.e" };'
    ],
    [
      "computed-key",
      'const chainKey = "chain";\nexport const route = { [chainKey]: "Arc Testnet", bridge: true, token: "USDC.e" };'
    ],
    [
      "spread",
      'const overrides = {};\nexport const route = { chain: "Arc Testnet", bridge: true, token: "USDC.e", ...overrides };'
    ]
  ])(
    "NO_WRAPPED_USDC_ON_ARC ignores an unsupported %s object form",
    async (_name, source) => {
      await expect(
        runBridgeRule(noWrappedUsdcOnArcRule, source)
      ).resolves.toEqual([]);
    }
  );

  it.each([
    [
      "duplicate chain fields",
      'export const route = { chain: "Arc", chain: "Ethereum", token: "USDC.e" };'
    ],
    [
      "duplicate token fields",
      'export const route = { chain: "Arc Testnet", bridge: true, token: "USDC.e", token: "USDC" };'
    ],
    [
      "comment-separated duplicate token fields",
      'export const route = { chain: "Arc", token: "USDC.e", /* override */ token: "USDC" };'
    ],
    [
      "literal and computed token fields",
      'export const route = { chain: "Arc Testnet", bridge: true, token: "USDC.e", token: getToken() };'
    ],
    [
      "generic token and asset fields",
      'export const route = { chain: "Arc Testnet", bridge: true, token: "USDC", asset: "USDC.e" };'
    ]
  ])("NO_WRAPPED_USDC_ON_ARC ignores ambiguous %s", async (_name, source) => {
    await expect(
      runBridgeRule(noWrappedUsdcOnArcRule, source)
    ).resolves.toEqual([]);
  });

  it.each([
    [
      "token shorthand",
      'const token = "USDC";\nexport const route = { chain: "Arc", token: "USDC.e", token };'
    ],
    [
      "asset shorthand",
      'const asset = "USDC";\nexport const route = { chain: "Arc", token: "USDC.e", asset };'
    ],
    [
      "sourceToken shorthand",
      'const sourceToken = "USDC";\nexport const route = { sourceChain: "Arc", sourceToken: "USDC.e", sourceToken };'
    ],
    [
      "destinationToken shorthand",
      'const destinationToken = "USDC";\nexport const route = { destinationChain: "Arc", destinationToken: "USDC.e", destinationToken };'
    ]
  ])(
    "NO_WRAPPED_USDC_ON_ARC treats relevant %s as ambiguity",
    async (_name, source) => {
      await expect(
        runBridgeRule(noWrappedUsdcOnArcRule, source)
      ).resolves.toEqual([]);
    }
  );

  it.each([
    [
      "interpolated template value",
      'const suffix = "e";\nexport const route = { chain: "Arc", token: `USDC.${suffix}` };'
    ],
    ["USDC.evil", 'export const route = { chain: "Arc", token: "USDC.evil" };'],
    [
      "prewrapped USDC",
      'export const route = { chain: "Arc", token: "prewrapped USDC" };'
    ],
    [
      "malformed object",
      'export const route = { chain: "Arc", token: "USDC.e";'
    ],
    [
      "nested split ownership",
      'export const route = { chain: "Arc", details: { token: "USDC.e" } };'
    ],
    [
      "object method",
      'export const route = { chain: "Arc", token: "USDC.e", resolve() { return true; } };'
    ],
    [
      "getter",
      'export const route = { chain: "Arc", token: "USDC.e", get resolved() { return true; } };'
    ],
    [
      "setter",
      'export const route = { chain: "Arc", token: "USDC.e", set resolved(value) { void value; } };'
    ]
  ])(
    "NO_WRAPPED_USDC_ON_ARC ignores an unsupported or non-exact %s",
    async (_name, source) => {
      await expect(
        runBridgeRule(noWrappedUsdcOnArcRule, source)
      ).resolves.toEqual([]);
    }
  );

  it("NO_WRAPPED_USDC_ON_ARC ignores standalone wrapped-USDC comments", async () => {
    await expect(
      runBridgeRule(
        noWrappedUsdcOnArcRule,
        'export const route = {\n  chain: "Arc Testnet",\n  bridge: true,\n  // token: "USDC.e",\n  token: "USDC"\n};'
      )
    ).resolves.toEqual([]);
  });

  it("NO_WRAPPED_USDC_ON_ARC preserves an executable member before inline guidance", async () => {
    await expect(
      runBridgeRule(
        noWrappedUsdcOnArcRule,
        'export const route = {\n  chain: "Arc Testnet",\n  bridge: true,\n  token: "USDC.e", // Do not use wrapped USDC on Arc.\n};'
      )
    ).resolves.toHaveLength(1);
  });

  it("NO_WRAPPED_USDC_ON_ARC ignores guidance-only comments", async () => {
    await expect(
      runBridgeRule(
        noWrappedUsdcOnArcRule,
        '// Do not use wrapped USDC on an Arc bridge route.\nexport const route = { chain: "Arc", token: "USDC" };'
      )
    ).resolves.toEqual([]);
  });

  it.each([
    [
      "Markdown heading",
      '# Bad Arc bridge route: { chain: "Arc", token: "USDC.e" }'
    ],
    [
      "Markdown bullet",
      '- Example Arc bridge route: { chain: "Arc", token: "USDC.e" }'
    ],
    [
      "Markdown asterisk bullet",
      '* Example Arc bridge route: { chain: "Arc", token: "USDC.e" }'
    ],
    [
      "Markdown bold documentation",
      '**Bad Arc bridge route:** { chain: "Arc", token: "USDC.e" }'
    ],
    [
      "compact asterisk documentation",
      '*compact Arc bridge route:* { chain: "Arc", token: "USDC.e" }'
    ],
    [
      "Markdown blockquote",
      '> Avoid this Arc bridge route: { chain: "Arc", token: "USDC.e" }'
    ],
    [
      "guidance-only prose object",
      'Do not use this Arc bridge route: { chain: "Arc", token: "USDC.e" }'
    ],
    [
      "guidance after an object",
      'Example Arc bridge route: { chain: "Arc", token: "USDC.e" } should not be used.'
    ],
    [
      "unsupported guidance after an object",
      'This Arc bridge route { chain: "Arc", token: "USDC.e" } is unsupported.'
    ],
    [
      "avoid guidance after an object",
      'Example Arc bridge route: { chain: "Arc", token: "USDC.e" }. Avoid this configuration.'
    ],
    [
      "guidance between route prose and an object",
      'This Arc bridge route should not be used: { chain: "Arc", token: "USDC.e" }'
    ],
    [
      "line comment object",
      '// Bad Arc bridge route: { chain: "Arc", token: "USDC.e" }'
    ],
    [
      "block comment object",
      '/* Bad Arc bridge route: { chain: "Arc", token: "USDC.e" } */'
    ],
    [
      "block-comment terminator followed by guidance",
      '/* preface\n*/ Example Arc bridge route: { chain: "Arc", token: "USDC.e" } should not be used.'
    ],
    [
      "block-comment terminator followed by a Markdown heading",
      '/* preface\n*/ # Bad Arc bridge route: { chain: "Arc", token: "USDC.e" }'
    ],
    [
      "block-comment terminator followed by Markdown bold documentation",
      '/* preface\n*/ **Bad Arc bridge route:** { chain: "Arc", token: "USDC.e" }'
    ]
  ])("NO_WRAPPED_USDC_ON_ARC ignores a %s", async (_name, source) => {
    await expect(
      runBridgeRule(noWrappedUsdcOnArcRule, source)
    ).resolves.toEqual([]);
  });

  it("NO_WRAPPED_USDC_ON_ARC flags executable code after a block-comment terminator", async () => {
    await expect(
      runBridgeRule(
        noWrappedUsdcOnArcRule,
        '/* preface\n*/ export const route = {\n  chain: "Arc",\n  token: "USDC.e"\n};'
      )
    ).resolves.toHaveLength(1);
  });

  it("NO_WRAPPED_USDC_ON_ARC ignores guidance-only prose without an object", async () => {
    await expect(
      runBridgeRule(
        noWrappedUsdcOnArcRule,
        "Do not use USDC.e for any Arc bridge route."
      )
    ).resolves.toEqual([]);
  });

  it("NO_WRAPPED_USDC_ON_ARC ignores arbitrary wrapped-USDC prose", async () => {
    await expect(
      runBridgeRule(
        noWrappedUsdcOnArcRule,
        "Arc bridge route uses USDC.e as its destination asset."
      )
    ).resolves.toEqual([]);
  });

  it("RELAYER_USES_USDC_FOR_GAS flags ETH relayer funding", async () => {
    const findings = await runBridgeRule(
      relayerUsesUsdcForGasRule,
      "Arc relayer setup: fund with ETH before running the relay script."
    );

    expect(findings[0]).toMatchObject({
      ruleId: "bridge/RELAYER_USES_USDC_FOR_GAS",
      severity: "critical",
      docs: "arc-usdc-gas",
      message: expect.stringContaining("ETH is used for gas"),
      suggestedFix: expect.stringContaining("USDC")
    });
  });

  it("RELAYER_USES_USDC_FOR_GAS flags ETH relayer gas token config", async () => {
    const findings = await runBridgeRule(
      relayerUsesUsdcForGasRule,
      "export const arcRelayer = { chain: 'Arc Testnet', relayerGasToken: 'ETH' };"
    );

    expect(findings[0]).toMatchObject({
      ruleId: "bridge/RELAYER_USES_USDC_FOR_GAS",
      severity: "critical",
      docs: "arc-usdc-gas",
      message: expect.stringContaining("ETH is used for gas"),
      suggestedFix: expect.stringContaining("gas-token")
    });
  });

  it("RELAYER_USES_USDC_FOR_GAS ignores guidance against ETH funding", async () => {
    await expect(
      runBridgeRule(
        relayerUsesUsdcForGasRule,
        "const chain = 'Arc Testnet';\n// Relayer setup: do not fund with ETH; use USDC for gas."
      )
    ).resolves.toEqual([]);
  });

  it("RELAYER_USES_USDC_FOR_GAS allows USDC relayer funding", async () => {
    await expect(
      runBridgeRule(
        relayerUsesUsdcForGasRule,
        "Arc relayer setup: fund the relayer wallet with USDC for gas."
      )
    ).resolves.toEqual([]);
  });

  it("ATTESTATION_404_NOT_FATAL flags fatal 404 attestation handling", async () => {
    const findings = await runBridgeRule(
      attestation404NotFatalRule,
      "async function pollAttestation(response) { // CCTP attestation\n if (response.status === 404) throw new Error('attestation failed');\n}"
    );

    expect(findings[0]).toMatchObject({
      ruleId: "bridge/ATTESTATION_404_NOT_FATAL",
      severity: "critical",
      docs: "arc-cctp-attestation",
      message: expect.stringContaining("HTTP 404"),
      suggestedFix: expect.stringContaining("retryable pending")
    });
  });

  it("ATTESTATION_404_NOT_FATAL allows pending 404 handling", async () => {
    await expect(
      runBridgeRule(
        attestation404NotFatalRule,
        "async function pollAttestation(response) { // CCTP attestation\n if (response.status === 404) return { status: 'pending', retry: true };\n}"
      )
    ).resolves.toEqual([]);
  });

  it("ATTESTATION_404_NOT_FATAL ignores retry guidance about 404", async () => {
    await expect(
      runBridgeRule(
        attestation404NotFatalRule,
        "const flow = 'CCTP attestation on Arc';\n// Do not treat attestation 404 as fatal; retry while pending."
      )
    ).resolves.toEqual([]);
  });

  it("NO_PREVRANDAO_RELAY_SELECTION flags PREVRANDAO relay selection", async () => {
    const findings = await runBridgeRule(
      noPrevrandaoRelaySelectionRule,
      "const chain = 'Arc Testnet'; const relaySelection = block.prevrandao % relayers.length;"
    );

    expect(findings[0]).toMatchObject({
      ruleId: "bridge/NO_PREVRANDAO_RELAY_SELECTION",
      severity: "critical",
      docs: "arc-prevrandao",
      message: expect.stringContaining("PREVRANDAO"),
      suggestedFix: expect.stringContaining("relay selection")
    });
  });

  it("NO_PREVRANDAO_RELAY_SELECTION ignores non-Arc relay randomness", async () => {
    await expect(
      runBridgeRule(
        noPrevrandaoRelaySelectionRule,
        "const relaySelection = block.prevrandao % relayers.length;"
      )
    ).resolves.toEqual([]);
  });

  it("NO_PREVRANDAO_RELAY_SELECTION ignores guidance against PREVRANDAO selection", async () => {
    await expect(
      runBridgeRule(
        noPrevrandaoRelaySelectionRule,
        "const chain = 'Arc Testnet';\n// Do not use PREVRANDAO or mixHash for relayer selection randomness."
      )
    ).resolves.toEqual([]);
  });

  it("does not flag generic non-Arc bridge code", async () => {
    await expect(
      runBridgeRule(
        noWrappedUsdcOnArcRule,
        "export const route = { chain: 'Ethereum', bridge: true, token: 'USDC.e' };"
      )
    ).resolves.toEqual([]);
  });

  it("supports severity overrides for bridge rules", async () => {
    const findings = await runBridgeRule(
      bridgeConfirmationsOneRule,
      "export const arcBridge = { chain: 'Arc Testnet', confirmations: 6 };",
      {
        "bridge/BRIDGE_CONFIRMATIONS_ONE": "warning"
      }
    );

    expect(findings[0]?.severity).toBe("warning");
  });

  it("supports disabling bridge rules", async () => {
    const findings = await runBridgeRule(
      bridgeConfirmationsOneRule,
      "export const arcBridge = { chain: 'Arc Testnet', confirmations: 6 };",
      {
        "bridge/BRIDGE_CONFIRMATIONS_ONE": "off"
      }
    );

    expect(findings).toEqual([]);
  });

  it("scan pipeline with bridge preset runs bridge rules", async () => {
    const projectRoot = createTempProject();
    writeFixture(
      projectRoot,
      "arcready.config.json",
      JSON.stringify({ presets: ["bridge"] })
    );
    writeFixture(
      projectRoot,
      "package.json",
      JSON.stringify({ name: "bad-bridge-fixture" })
    );
    writeFixture(
      projectRoot,
      "src/bridge.ts",
      "export const arcBridge = { chain: 'Arc Testnet', finalityBlocks: 6 };"
    );

    const report = await createStubReport(projectRoot);

    expect(report).toMatchObject({
      project: "bad-bridge-fixture",
      status: "fail",
      score: 75,
      summary: {
        critical: 1,
        warning: 0,
        info: 0
      }
    });
    expect(report.findings[0]?.ruleId).toBe("bridge/BRIDGE_CONFIRMATIONS_ONE");
  });
});

async function runBridgeRule(
  rule: Rule,
  content: string,
  rules: RuleContext["config"]["rules"] = {}
) {
  return runRules([rule], {
    projectRoot: "/fixture",
    config: {
      ...DEFAULT_CONFIG,
      presets: ["bridge"],
      rules
    },
    files: ["src/fixture.ts"],
    detectedPresets: {
      detectedPresets: ["bridge"],
      confidence: "high",
      reasons: ["test"]
    },
    readFile: async () => content
  });
}

function createTempProject(): string {
  const projectRoot = mkdtempSync(join(tmpdir(), "arcready-bridge-"));
  tempDirs.push(projectRoot);
  return projectRoot;
}

function writeFixture(
  projectRoot: string,
  filePath: string,
  content: string
): void {
  const absolutePath = join(projectRoot, filePath);
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, content);
}
