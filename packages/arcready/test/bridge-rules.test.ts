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
    ["case and whitespace variants", "const arc_cctp_domain = 7;"]
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

  it.each([
    [
      "inline named map",
      "const DOMAIN = 7;\nconst cctpDomains = { arc: DOMAIN };"
    ],
    [
      "multiline named map",
      "const DOMAIN = 7;\nconst cctpDomains = {\n  arc: DOMAIN\n};"
    ],
    [
      "exported binding",
      "export const DOMAIN = 7;\nconst cctpDomains = { arc: DOMAIN };"
    ],
    [
      "direct CCTP property",
      "const DOMAIN = 7;\nconst config = { ARC_CCTP_DOMAIN: DOMAIN };"
    ],
    [
      "compatibility property",
      "const DOMAIN = 7;\nconst config = { ARC_DOMAIN: DOMAIN };"
    ],
    [
      "independent bindings",
      "const FIRST = 26;\nconst SECOND = 7;\nconst first = { cctpDomains: { arc: FIRST } };\nconst second = { cctpDomains: { arc: SECOND } };"
    ],
    [
      "inert declaration comments",
      "const /* declaration */ DOMAIN /* name */ = /* value */ 7;\nconst cctpDomains = { arc: DOMAIN };"
    ],
    [
      "fake declarations beside a live binding",
      "const text = 'const DOMAIN = 26;';\n// const DOMAIN = 26;\nconst DOMAIN = 7;\nconst cctpDomains = { arc: DOMAIN };"
    ],
    [
      "member assignment beside a binding",
      "const DOMAIN = 7;\nobject.DOMAIN = 26;\nconst cctpDomains = { arc: DOMAIN };"
    ],
    [
      "equality and arrow syntax beside a binding",
      "const DOMAIN = 7;\nconst strict = DOMAIN === 26;\nconst loose = DOMAIN == 26;\nconst fn = DOMAIN => DOMAIN;\nconst cctpDomains = { arc: DOMAIN };"
    ]
  ])(
    "CCTP_DOMAIN_26 resolves an earlier const for %s",
    async (_name, source) => {
      expect(
        await runBridgeRule(cctpDomain26Rule, `Arc CCTP bridge\n${source}`)
      ).toHaveLength(1);
    }
  );
  it.each([
    [
      "correct literal",
      "const DOMAIN = 26;\nconst cctpDomains = { arc: DOMAIN };"
    ],
    ["let", "let DOMAIN = 7;\nconst cctpDomains = { arc: DOMAIN };"],
    ["var", "var DOMAIN = 7;\nconst cctpDomains = { arc: DOMAIN };"],
    [
      "forward reference",
      "const cctpDomains = { arc: DOMAIN };\nconst DOMAIN = 7;"
    ],
    [
      "different duplicate",
      "const DOMAIN = 7;\nconst DOMAIN = 26;\nconst cctpDomains = { arc: DOMAIN };"
    ],
    [
      "equal duplicate",
      "const DOMAIN = 7;\nconst DOMAIN = 7;\nconst cctpDomains = { arc: DOMAIN };"
    ],
    [
      "conflicting let",
      "const DOMAIN = 7;\nlet DOMAIN = 26;\nconst cctpDomains = { arc: DOMAIN };"
    ],
    [
      "conflicting var",
      "const DOMAIN = 7;\nvar DOMAIN = 26;\nconst cctpDomains = { arc: DOMAIN };"
    ],
    [
      "local conflict",
      "const DOMAIN = 7;\nfunction example() {\n  const DOMAIN = 26;\n}\nconst cctpDomains = { arc: DOMAIN };"
    ],
    [
      "reassignment",
      "const DOMAIN = 7;\nDOMAIN = 26;\nconst cctpDomains = { arc: DOMAIN };"
    ],
    [
      "multiline reassignment",
      "const DOMAIN = 7;\nDOMAIN\n  = 26;\nconst cctpDomains = { arc: DOMAIN };"
    ],
    [
      "multiline conflicting declaration",
      "const DOMAIN = 7;\nlet\n  DOMAIN\n  = 26;\nconst cctpDomains = { arc: DOMAIN };"
    ],
    [
      "identifier chain",
      "const A = B;\nconst B = 7;\nconst cctpDomains = { arc: A };"
    ],
    [
      "import",
      'import { DOMAIN } from "./constants";\nconst cctpDomains = { arc: DOMAIN };'
    ],
    [
      "call",
      "const DOMAIN = getDomain();\nconst cctpDomains = { arc: DOMAIN };"
    ],
    [
      "arithmetic",
      "const DOMAIN = 6 + 1;\nconst cctpDomains = { arc: DOMAIN };"
    ],
    [
      "conditional",
      "const DOMAIN = enabled ? 7 : 26;\nconst cctpDomains = { arc: DOMAIN };"
    ],
    [
      "template",
      "const DOMAIN = `${domain}`;\nconst cctpDomains = { arc: DOMAIN };"
    ],
    [
      "case mismatch",
      "const Domain = 7;\nconst cctpDomains = { arc: DOMAIN };"
    ],
    [
      "multi-declarator",
      "const DOMAIN = 7, OTHER = 8;\nconst cctpDomains = { arc: DOMAIN };"
    ],
    [
      "local declaration",
      "function example() {\n  const DOMAIN = 7;\n  return { cctpDomains: { arc: DOMAIN } };\n}"
    ],
    [
      "ambiguous map",
      "const DOMAIN = 7;\nconst cctpDomains = { arc: DOMAIN, arc: DOMAIN };"
    ]
  ])("CCTP_DOMAIN_26 keeps resolver boundary %s", async (_name, source) => {
    expect(
      await runBridgeRule(cctpDomain26Rule, `Arc CCTP bridge\n${source}`)
    ).toEqual([]);
  });
  it("CCTP_DOMAIN_26 does not resolve a YAML identifier scalar", async () => {
    const source = "chain: Arc\nbridge: CCTP\ncctpDomains:\n  arc: DOMAIN";
    expect(
      await runBridgeRule(cctpDomain26Rule, source, {}, "config.yaml")
    ).toEqual([]);
  });

  it("CCTP_DOMAIN_26 flags a directly indented YAML domain map", async () => {
    const findings = await runBridgeRule(
      cctpDomain26Rule,
      "Arc CCTP bridge\ncctpDomains:\n  arc: 7",
      {},
      "config.yaml"
    );

    expect(findings).toHaveLength(1);
  });

  it("CCTP_DOMAIN_26 allows a correct directly indented YAML domain map", async () => {
    await expect(
      runBridgeRule(
        cctpDomain26Rule,
        "Arc CCTP bridge\ncctpDomains:\n  arc: 26",
        {},
        "config.yaml"
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
        `Arc CCTP bridge\r\n${source}`,
        {},
        _name === "YAML" ? "config.yaml" : "src/fixture.ts"
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

  it.each([
    [
      "a direct declaration in Markdown",
      "# Arc CCTP migration\n\nconst ARC_DOMAIN = 7;",
      "docs/migration.md"
    ],
    [
      "an indented declaration in Markdown",
      "# Arc CCTP migration\n\n    const ARC_CCTP_DOMAIN = 7;",
      "docs/migration.md"
    ],
    [
      "a named map in MDX",
      "# Arc CCTP\n\nconst cctpDomains = {\n  arc: 7\n};",
      "docs/configuration.mdx"
    ]
  ])("CCTP_DOMAIN_26 skips %s", async (_name, source, filePath) => {
    await expect(
      runBridgeRule(cctpDomain26Rule, source, {}, filePath)
    ).resolves.toEqual([]);
  });

  it.each([
    [
      "equivalent TypeScript",
      'const protocol = "Arc CCTP";\nconst ARC_DOMAIN = 7;',
      "src/config.ts"
    ],
    [
      "equivalent YAML",
      "chain: Arc\nbridge: CCTP\ncctpDomains:\n  arc: 7",
      "config/bridge.yaml"
    ]
  ])("CCTP_DOMAIN_26 keeps %s live", async (_name, source, filePath) => {
    await expect(
      runBridgeRule(cctpDomain26Rule, source, {}, filePath)
    ).resolves.toHaveLength(1);
  });

  it.each([
    ["wrong direct candidate", "Arc CCTP bridge\nconst ARC_CCTP_DOMAIN = 7;"],
    [
      "compatibility direct candidate",
      "Arc CCTP bridge\nconst ARC_DOMAIN = 7;"
    ],
    [
      "exported direct candidate",
      "Arc CCTP bridge\nexport const ARC_CCTP_DOMAIN = 7;"
    ],
    [
      "multiline direct candidate",
      "Arc CCTP bridge\nconst ARC_CCTP_DOMAIN /* Arc */ =\n  7\n;"
    ],
    ["standalone line-start candidate", "Arc CCTP bridge\n  ARC_DOMAIN = 7;"],
    [
      "direct object property",
      "Arc CCTP bridge\nconst config = {\n  ARC_CCTP_DOMAIN: 7,\n};"
    ],
    ["inline named map", "Arc CCTP bridge\nconst cctpDomains = { arc: 7 };"],
    [
      "multiline named map",
      "Arc CCTP bridge\nconst cctpDomains = {\n  arc: 7\n};"
    ],
    [
      "named map in a parent",
      "Arc CCTP bridge\nconst config = { cctpDomains: { arc: 7 } };"
    ],
    [
      "named-map member with same-line sibling",
      "Arc CCTP bridge\nconst config = { cctpDomains: { arc: 7 }, enabled: true };"
    ],
    [
      "named-map member between siblings",
      "Arc CCTP bridge\nconst config = {\n  enabled: true,\n  cctpDomains: { arc: 7 },\n  retry: 3\n};"
    ],
    [
      "compact nested direct object property",
      "Arc CCTP bridge\nconst config = { bridge: { ARC_CCTP_DOMAIN: 7 } };"
    ],
    [
      "compact nested direct object property with outer sibling",
      "Arc CCTP bridge\nconst config = {\n  bridge: { ARC_CCTP_DOMAIN: 7 },\n  enabled: true\n};"
    ],
    [
      "comments between map tokens",
      "Arc CCTP bridge\nconst cctpDomains /* a */ = /* b */ { /* c */ arc /* d */ : /* e */ 7 };"
    ],
    [
      "quoted braces in a live map",
      'Arc CCTP bridge\nconst cctpDomains = { note: "{ ignored }", arc: 7 };'
    ],
    [
      "comment braces in a live map",
      "Arc CCTP bridge\nconst cctpDomains = { /* { ignored } */ arc: 7 };"
    ],
    [
      "inert spread text in a live map",
      'Arc CCTP bridge\nconst cctpDomains = { note: "...", /* ... */ arc: 7 };'
    ],
    [
      "direct candidate with trailing guidance",
      "Arc CCTP bridge\nconst ARC_CCTP_DOMAIN = 7; // This domain should not be used."
    ],
    [
      "map with trailing guidance",
      "Arc CCTP bridge\nconst cctpDomains = { arc: 7 }; // Do not use domain 7 for Arc."
    ],
    [
      "live map after a block comment",
      "Arc CCTP bridge\n/* preface\n*/ const cctpDomains = { arc: 7 };"
    ],
    [
      "independent named maps",
      "Arc CCTP bridge\nconst first = { cctpDomains: { arc: 26 } };\nconst second = { cctpDomains: { arc: 7 } };"
    ],
    [
      "independent direct candidates",
      "Arc CCTP bridge\nconst ARC_DOMAIN = 26;\nconst ARC_DOMAIN = 7;"
    ],
    [
      "basic YAML child",
      "chain: Arc\nbridge: CCTP\ncctpDomains:\n  arc: 7",
      "config.yaml"
    ],
    [
      "YAML child with trailing guidance",
      "chain: Arc\nbridge: CCTP\ncctpDomains:\n  arc: 7 # This domain should not be used.",
      "config.yml"
    ],
    [
      "YAML wrapper nesting",
      "chain: Arc\nbridge: CCTP\nconfig:\n  cctpDomains:\n    arc: 7",
      "config.yaml"
    ],
    [
      "flow YAML with an inert quoted brace",
      'chain: Arc\nbridge: CCTP\ncctpDomains: { note: "}", arc: 7 }',
      "config.yaml"
    ],
    ["closed candidate at EOF", "Arc CCTP bridge\nARC_DOMAIN = 7"],
    [
      "multiple independent wrong candidates",
      "Arc CCTP bridge\nconst ARC_DOMAIN = 7;\nconst cctpDomains = { arc: 8 };"
    ],
    [
      "emoji string before a direct candidate",
      'Arc CCTP bridge\nconst note = "😀";\nconst ARC_CCTP_DOMAIN = 7;'
    ],
    [
      "emoji line comment before a named map",
      "Arc CCTP bridge\n// 😀\nconst cctpDomains = { arc: 7 };"
    ],
    [
      "YAML emoji comment before a child",
      "chain: Arc\nbridge: CCTP\n# 😀\ncctpDomains:\n  arc: 7",
      "config.yaml"
    ],
    [
      "YAML emoji scalar before a child",
      'chain: Arc\nbridge: CCTP\nnote: "😀"\ncctpDomains:\n  arc: 7',
      "config.yaml"
    ],
    [
      "guidance-like named-map members",
      'const bridgeName = "Arc CCTP";\nconst unsupported = 0;\nconst cctpDomains = { arc: 7, domain: unsupported };'
    ],
    [
      "flow YAML plain scalar hash",
      "chain: Arc\nbridge: CCTP\ncctpDomains: { arc: 7, note: value#hash }",
      "config.yaml"
    ],
    [
      "flow YAML trailing comment",
      "chain: Arc\nbridge: CCTP\ncctpDomains: { arc: 7, note: value#hash } # comment",
      "config.yaml"
    ],
    [
      "block YAML after a plain scalar hash",
      "chain: Arc\nbridge: CCTP\nnote: value#hash\ncctpDomains:\n  arc: 7",
      "config.yaml"
    ]
  ])(
    "CCTP_DOMAIN_26 reports one finding for %s",
    async (_name, source, filePath = "src/fixture.ts") => {
      const findings = await runBridgeRule(
        cctpDomain26Rule,
        source,
        {},
        filePath
      );

      expect(findings).toHaveLength(1);
    }
  );

  it.each([
    [
      "correct direct candidates",
      "Arc CCTP bridge\nconst ARC_DOMAIN = 26;\nconst ARC_CCTP_DOMAIN = 26;"
    ],
    ["correct named map", "Arc CCTP bridge\nconst cctpDomains = { arc: 26 };"],
    [
      "correct YAML",
      "chain: Arc\nbridge: CCTP\ncctpDomains:\n  arc: 26",
      "config.yaml"
    ],
    [
      "direct text in source strings",
      "const a = 'Arc CCTP ARC_DOMAIN = 7';\nconst b = \"ARC_CCTP_DOMAIN: 8\";\nconst c = `ARC_DOMAIN = 9`;"
    ],
    [
      "map text in strings and templates",
      "const a = 'Arc CCTP cctpDomains = { arc: 7 }';\nconst b = `cctpDomains: { arc: 8 }`;"
    ],
    [
      "candidate text in source comments",
      "// Arc CCTP cctpDomains = { arc: 7 }\nconst ok = true; // ARC_DOMAIN = 8"
    ],
    [
      "candidate text in a block comment",
      "/* Arc CCTP\ncctpDomains = { arc: 7 }\nARC_DOMAIN = 8\n*/"
    ],
    [
      "guidance before a textual map",
      "Arc CCTP bridge\nDo not use this CCTP map: cctpDomains = { arc: 7 }"
    ],
    [
      "guidance after a textual map",
      "Arc CCTP bridge\ncctpDomains = { arc: 7 } should not be used for domains"
    ],
    [
      "separate CCTP gate before never guidance",
      'const protocol = "CCTP";\nNever cctpDomains = { arc: 7 } for Arc bridge'
    ],
    [
      "separate CCTP gate before map guidance",
      'const protocol = "CCTP";\ncctpDomains = { arc: 7 } should not be used.'
    ],
    [
      "separate CCTP gate before semicolon map guidance",
      'const protocol = "CCTP";\nconst chain = "Arc";\ncctpDomains = { arc: 7 }; should not be used.'
    ],
    [
      "separate CCTP gate before unsupported direct guidance",
      'const protocol = "CCTP";\nARC_DOMAIN = 7; is unsupported.'
    ],
    [
      "separate CCTP gate before direct should-not guidance",
      'const protocol = "CCTP";\nARC_CCTP_DOMAIN = 7; should not be used.'
    ],
    ["Markdown heading", "# Bad Arc CCTP map: cctpDomains = { arc: 7 }"],
    ["Markdown dash bullet", "- Bad Arc CCTP map: cctpDomains = { arc: 7 }"],
    [
      "Markdown asterisk bullet",
      "* Bad Arc CCTP map: cctpDomains = { arc: 7 }"
    ],
    ["Markdown bold", "**Bad Arc CCTP map:** cctpDomains = { arc: 7 }"],
    ["compact asterisk prose", "*Bad Arc CCTP map: cctpDomains = { arc: 7 }"],
    ["Markdown blockquote", "> Bad Arc CCTP map: cctpDomains = { arc: 7 }"],
    [
      "cross-object arc",
      "Arc CCTP bridge\nconst cctpDomains = { ethereum: 0 };\nconst unrelated = { arc: 7 };"
    ],
    [
      "nested metadata arc",
      "Arc CCTP bridge\nconst cctpDomains = { metadata: { arc: 7 } };"
    ],
    [
      "spread before arc",
      "Arc CCTP bridge\nconst cctpDomains = { ...defaults, arc: 7 };"
    ],
    [
      "spread after arc",
      "Arc CCTP bridge\nconst cctpDomains = { arc: 7, ...defaults };"
    ],
    [
      "direct object property inside function call",
      "Arc CCTP bridge\nconfigure({ ARC_CCTP_DOMAIN: 7 });"
    ],
    [
      "direct object property inside array object",
      "Arc CCTP bridge\nconst configs = [{ ARC_CCTP_DOMAIN: 7 }];"
    ],
    [
      "correct map with numeric noise",
      "Arc CCTP bridge\nconst cctpDomains = { arc: 26 };\nconst retry = 7;"
    ],
    [
      "identifier value",
      "Arc CCTP bridge\nconst cctpDomains = { arc: WRONG_ARC_DOMAIN };"
    ],
    [
      "call value",
      "Arc CCTP bridge\nconst cctpDomains = { arc: getDomain() };"
    ],
    [
      "template value",
      "Arc CCTP bridge\nconst cctpDomains = { arc: `${domain}` };"
    ],
    ["negative value", "Arc CCTP bridge\nconst cctpDomains = { arc: -7 };"],
    ["hex value", "Arc CCTP bridge\nconst cctpDomains = { arc: 0x1a };"],
    ["fractional value", "Arc CCTP bridge\nconst cctpDomains = { arc: 7.5 };"],
    ["bigint value", "Arc CCTP bridge\nconst cctpDomains = { arc: 7n };"],
    [
      "numeric separator value",
      "Arc CCTP bridge\nconst cctpDomains = { arc: 2_6 };"
    ],
    ["quoted arc key", "Arc CCTP bridge\nconst cctpDomains = { 'arc': 7 };"],
    ["computed arc key", "Arc CCTP bridge\nconst cctpDomains = { [arc]: 7 };"],
    [
      "duplicate correct then wrong",
      "Arc CCTP bridge\nconst cctpDomains = { arc: 26, arc: 7 };"
    ],
    [
      "duplicate wrong then correct",
      "Arc CCTP bridge\nconst cctpDomains = { arc: 7, arc: 26 };"
    ],
    [
      "duplicate wrong values",
      "Arc CCTP bridge\nconst cctpDomains = { arc: 7, arc: 7 };"
    ],
    ["unterminated map", "Arc CCTP bridge\nconst cctpDomains = { arc: 7;"],
    [
      "YAML nested descendant",
      "chain: Arc\nbridge: CCTP\ncctpDomains:\n  metadata:\n    arc: 7",
      "config.yaml"
    ],
    [
      "YAML sibling outside boundary",
      "chain: Arc\nbridge: CCTP\ncctpDomains:\n  ethereum: 0\narc: 7",
      "config.yaml"
    ],
    [
      "YAML quoted arc key",
      'chain: Arc\nbridge: CCTP\ncctpDomains:\n  "arc": 7',
      "config.yaml"
    ],
    [
      "YAML comment-only map",
      "chain: Arc\nbridge: CCTP\ncctpDomains:\n  # arc: 7",
      "config.yaml"
    ],
    [
      "YAML header at EOF",
      "chain: Arc\nbridge: CCTP\ncctpDomains:",
      "config.yaml"
    ],
    [
      "duplicate YAML arc children",
      "chain: Arc\nbridge: CCTP\ncctpDomains:\n  arc: 7\n  arc: WRONG_DOMAIN",
      "config.yaml"
    ],
    [
      "JS private field",
      'const context = "Arc CCTP";\nclass Config { #cctpDomains = { arc: 7 }; }'
    ],
    [
      "block terminator before documentation",
      "/* Arc CCTP preface\n*/ **Bad CCTP map:** cctpDomains = { arc: 7 }"
    ],
    ["invalid colon declaration", "Arc CCTP bridge\nconst ARC_CCTP_DOMAIN: 7;"],
    [
      "multiline multi-declarator candidate",
      'const bridgeName = "Arc CCTP";\nconst unsupported = 0,\n  domain = unsupported,\n  ARC_CCTP_DOMAIN = 7;'
    ],
    [
      "same-line multi-declarator candidate",
      'const bridgeName = "Arc CCTP";\nconst unsupported = 0, domain = unsupported, ARC_CCTP_DOMAIN = 7;'
    ],
    ["direct expression value", "Arc CCTP bridge\nARC_DOMAIN = 7 + 1;"],
    ["direct call value", "Arc CCTP bridge\nARC_DOMAIN = getDomain();"],
    ["direct identifier value", "Arc CCTP bridge\nARC_DOMAIN = WRONG_DOMAIN;"],
    ["parenthesized direct value", "Arc CCTP bridge\nARC_DOMAIN = (7);"],
    ["signed direct value", "Arc CCTP bridge\nARC_DOMAIN = -7;"],
    ["positive direct value", "Arc CCTP bridge\nARC_DOMAIN = +7;"],
    ["fractional direct value", "Arc CCTP bridge\nARC_DOMAIN = 7.0;"],
    ["hex direct value", "Arc CCTP bridge\nARC_DOMAIN = 0x07;"],
    ["octal direct value", "Arc CCTP bridge\nARC_DOMAIN = 0o7;"],
    ["binary direct value", "Arc CCTP bridge\nARC_DOMAIN = 0b111;"],
    ["bigint direct value", "Arc CCTP bridge\nARC_DOMAIN = 7n;"],
    ["separated direct value", "Arc CCTP bridge\nARC_DOMAIN = 7_0;"],
    [
      "multiline arithmetic expression",
      "Arc CCTP bridge\nARC_DOMAIN = 7\n  + 1;"
    ],
    [
      "multiline ternary expression",
      "Arc CCTP bridge\nARC_DOMAIN = condition\n  ? 7\n  : 26;"
    ],
    [
      "ASI-dependent assignment",
      "Arc CCTP bridge\nARC_DOMAIN = 7\nconst next = true;"
    ],
    [
      "assignment inside if",
      "Arc CCTP bridge\nif ((ARC_DOMAIN = 7)) { run(); }"
    ],
    [
      "assignment inside return",
      "Arc CCTP bridge\nreturn (ARC_CCTP_DOMAIN = 7);"
    ],
    [
      "assignment inside function call",
      "Arc CCTP bridge\navoid(ARC_DOMAIN = 7);"
    ],
    [
      "commented function-call boundary",
      "Arc CCTP bridge\navoid /* comment */ (ARC_DOMAIN = 7);"
    ],
    ["assignment inside label", "Arc CCTP bridge\navoid: ARC_DOMAIN = 7;"],
    [
      "executable prefix before assignment",
      'const bridgeName = "Arc CCTP";\nif (avoid) ARC_DOMAIN = 7;'
    ],
    [
      "multiple statements after direct candidate",
      "Arc CCTP bridge\nARC_DOMAIN = 7; const next = true;"
    ],
    [
      "quoted direct object key",
      "Arc CCTP bridge\nconst config = { 'ARC_DOMAIN': 7, };"
    ],
    [
      "computed direct object key",
      "Arc CCTP bridge\nconst config = { [ARC_DOMAIN]: 7, };"
    ],
    [
      "candidate text in an emoji source string",
      'const note = "😀 Arc CCTP ARC_CCTP_DOMAIN = 7";'
    ],
    [
      "candidate text in an emoji YAML scalar",
      'chain: Arc\nbridge: CCTP\nnote: "😀 cctpDomains: { arc: 7 }"',
      "config.yaml"
    ],
    [
      "avoid guidance for a direct candidate",
      "Avoid ARC_CCTP_DOMAIN = 7 for this Arc CCTP bridge."
    ],
    [
      "candidate-like YAML hash comment",
      "chain: Arc\nbridge: CCTP\n# cctpDomains: { arc: 7, note: value#hash }",
      "config.yaml"
    ],
    [
      "YAML quoted map key",
      'chain: Arc\nbridge: CCTP\n"cctpDomains":\n  arc: 7',
      "config.yaml"
    ],
    [
      "YAML quoted numeric value",
      'chain: Arc\nbridge: CCTP\ncctpDomains:\n  arc: "7"',
      "config.yaml"
    ],
    [
      "correct flow YAML plain scalar hash",
      "chain: Arc\nbridge: CCTP\ncctpDomains: { arc: 26, note: value#hash }",
      "config.yaml"
    ]
  ])(
    "CCTP_DOMAIN_26 stays silent for %s",
    async (_name, source, filePath = "src/fixture.ts") => {
      await expect(
        runBridgeRule(cctpDomain26Rule, source, {}, filePath)
      ).resolves.toEqual([]);
    }
  );

  it.each([
    ["emoji", 'const note = "😀";\nconst ARC_CCTP_DOMAIN = 7;'],
    ["Vietnamese text", 'const note = "cấu hình";\nconst ARC_CCTP_DOMAIN = 7;'],
    ["quoted braces", 'const cctpDomains = { note: "{ }", arc: 7 };'],
    ["comment braces", "const cctpDomains = { /* { } */ arc: 7 };"],
    ["LF", "const cctpDomains = {\n  arc: 7\n};"],
    ["CRLF", "const cctpDomains = {\r\n  arc: 7\r\n};"],
    ["escaped quotes", 'const note = "\\"{\\"";\nconst ARC_DOMAIN = 7;']
  ])(
    "CCTP_DOMAIN_26 preserves a supported candidate with inert %s",
    async (_name, candidate) => {
      const findings = await runBridgeRule(
        cctpDomain26Rule,
        `const bridge = "Arc CCTP";\n${candidate}`
      );

      expect(findings).toHaveLength(1);
    }
  );

  it.each([
    ["guidance", "Do not use ARC_CCTP_DOMAIN = 7."],
    ["map prose", "Never use this map: cctpDomains = { arc: 7 }"],
    ["suffix prose", "cctpDomains = { arc: 7 }; should not be used."],
    ["control flow", "return (ARC_CCTP_DOMAIN = 7);"]
  ])(
    "CCTP_DOMAIN_26 keeps unsupported %s negative with gates elsewhere",
    async (_name, candidate) => {
      await expect(
        runBridgeRule(
          cctpDomain26Rule,
          `const protocol = "CCTP";\nconst chain = "Arc";\n${candidate}`
        )
      ).resolves.toEqual([]);
    }
  );

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

  it.each([
    ["Arc owner", 'const arcRelayer = { relayerGasToken: "ETH" };'],
    [
      "direct chain",
      'export const config = { chain: "Arc Testnet", relayerGasToken: "ETH" };'
    ],
    [
      "chain ID and generic field",
      'const relayer = { chainId: 5042002, gasToken: "ETH" };'
    ],
    ["Arc child", 'const config = { arc: { relayerGasToken: "ETH" } };'],
    [
      "relayer child",
      'const config = { relayer: { chain: "Arc", gasToken: "ETH" } };'
    ],
    [
      "one wrong independent declaration",
      'const ethereumRelayer = { chain: "Ethereum", relayerGasToken: "ETH" };\nconst arcRelayer = { relayerGasToken: "ETH" };'
    ],
    [
      "wrong candidate after correct siblings",
      'const config = { ethereum: { relayerGasToken: "ETH" }, arc: { relayerGasToken: "USDC" }, backupArcRelayer: { relayerGasToken: "ETH" } };'
    ],
    [
      "multiline object",
      'const arc_relayer = {\n  enabled: true,\n  retries: 3,\n  relayerGasToken: "eth"\n};'
    ],
    [
      "inert text around candidate",
      '// const arcRelayer = { relayerGasToken: "ETH" };\nconst note = "{ gasToken: ETH }";\nconst ARC_RELAYER = { name: "primary", relayerGasToken: "ETH" };'
    ],
    [
      "trailing guidance",
      'const arcRelayer = { relayerGasToken: "ETH" // do not use this\n};'
    ],
    [
      "two wrong candidates",
      'const arcRelayer = { relayerGasToken: "ETH" };\nconst arcRelay = { relayerGasToken: "ETH" };'
    ]
  ])("RELAYER_USES_USDC_FOR_GAS flags %s", async (_name, source) => {
    await expect(
      runBridgeRule(relayerUsesUsdcForGasRule, source)
    ).resolves.toHaveLength(1);
  });

  it("RELAYER_USES_USDC_FOR_GAS preserves finding metadata", async () => {
    const findings = await runBridgeRule(
      relayerUsesUsdcForGasRule,
      'const arcRelayer = { relayerGasToken: "ETH" };'
    );
    expect(findings).toEqual([
      {
        ruleId: "bridge/RELAYER_USES_USDC_FOR_GAS",
        severity: "critical",
        message: "Arc relayer funding appears to assume ETH is used for gas.",
        files: ["src/fixture.ts"],
        suggestedFix:
          "Check relayer funding and gas-token config; Arc relayer gas should be modeled as USDC rather than ETH.",
        docs: "arc-usdc-gas",
        preset: "bridge"
      }
    ]);
  });

  it.each([
    [
      "correct explicit field",
      'const arcRelayer = { relayerGasToken: "USDC" };'
    ],
    ["correct generic field", 'const arcRelayer = { gasToken: "USDC" };'],
    [
      "isolated chain siblings",
      'const relayers = { ethereum: { relayerGasToken: "ETH" }, arc: { relayerGasToken: "USDC" } };'
    ],
    [
      "source-chain ETH",
      'const ethereumRelayer = { chain: "Ethereum", relayerGasToken: "ETH" };\nconst arcRoute = { chain: "Arc Testnet", token: "USDC" };'
    ],
    [
      "wallet generic field",
      'const arcWallet = { chain: "Arc", gasToken: "ETH" };'
    ],
    ["Arc child generic field", 'const config = { arc: { gasToken: "ETH" } };'],
    ["feeToken alias", 'const arcRelayer = { feeToken: "ETH" };'],
    ["nativeGasToken alias", 'const arcRelayer = { nativeGasToken: "ETH" };'],
    [
      "funding prose",
      "Arc relayer setup: fund with ETH before running the relay."
    ],
    [
      "guidance",
      'const note = "Do not fund the Arc relayer with ETH; use USDC.";'
    ],
    [
      "candidate string",
      'const note = `const arcRelayer = { relayerGasToken: "ETH" };`;'
    ],
    ["line comment", '// const arcRelayer = { relayerGasToken: "ETH" };'],
    ["block comment", '/* const arcRelayer = { relayerGasToken: "ETH" }; */'],
    ["let declaration", 'let arcRelayer = { relayerGasToken: "ETH" };'],
    ["var declaration", 'var arcRelayer = { relayerGasToken: "ETH" };'],
    [
      "duplicate explicit field",
      'const arcRelayer = { relayerGasToken: "USDC", relayerGasToken: "ETH" };'
    ],
    [
      "duplicate generic field",
      'const arcRelayer = { gasToken: "USDC", gasToken: "ETH" };'
    ],
    [
      "both token fields",
      'const arcRelayer = { relayerGasToken: "ETH", gasToken: "ETH" };'
    ],
    [
      "duplicate chain",
      'const relayer = { chain: "Arc", chain: "Arc Testnet", gasToken: "ETH" };'
    ],
    [
      "contradictory chain",
      'const arcRelayer = { chain: "Ethereum", relayerGasToken: "ETH" };'
    ],
    [
      "candidate spread",
      'const arcRelayer = { ...base, relayerGasToken: "ETH" };'
    ],
    [
      "envelope spread",
      'const config = { ...base, arc: { relayerGasToken: "ETH" } };'
    ],
    [
      "duplicate Arc child wrong then correct",
      'const config = { arc: { relayerGasToken: "ETH" }, arc: { relayerGasToken: "USDC" } };'
    ],
    [
      "duplicate Arc child correct then wrong",
      'const config = { arc: { relayerGasToken: "USDC" }, arc: { relayerGasToken: "ETH" } };'
    ],
    [
      "quoted owner override",
      'const config = { arc: { relayerGasToken: "ETH" }, "arc": { relayerGasToken: "USDC" } };'
    ],
    [
      "computed parent ownership",
      'const config = { [owner]: { relayerGasToken: "USDC" }, arc: { relayerGasToken: "ETH" } };'
    ],
    ["computed key", 'const arcRelayer = { [relayerGasToken]: "ETH" };'],
    ["quoted key", 'const arcRelayer = { "relayerGasToken": "ETH" };'],
    ["relevant shorthand", "const arcRelayer = { relayerGasToken };"],
    ["identifier value", "const arcRelayer = { relayerGasToken: ETH };"],
    [
      "imported value",
      'import { ETH } from "./tokens";\nconst arcRelayer = { relayerGasToken: ETH };'
    ],
    ["template value", "const arcRelayer = { relayerGasToken: `ETH` };"],
    ["call value", "const arcRelayer = { relayerGasToken: token() };"],
    [
      "function-call object",
      'configure({ chain: "Arc", relayerGasToken: "ETH" });'
    ],
    [
      "array object",
      'const configs = [{ chain: "Arc", relayerGasToken: "ETH" }];'
    ],
    ["member assignment", 'arcRelayer.relayerGasToken = "ETH";'],
    [
      "deep object",
      'const config = { routes: { arc: { relayerGasToken: "ETH" } } };'
    ],
    ["method", 'const arcRelayer = { relayerGasToken() { return "ETH"; } };'],
    [
      "getter",
      'const arcRelayer = { get relayerGasToken() { return "ETH"; } };'
    ],
    ["malformed object", 'const arcRelayer = { relayerGasToken: "ETH";'],
    ["Arc substring", 'const archiveRelayer = { relayerGasToken: "ETH" };'],
    ["parcel substring", 'const parcelRelayer = { relayerGasToken: "ETH" };'],
    [
      "no file-level ownership",
      'const note = "Arc Testnet";\nconst relayer = { relayerGasToken: "ETH" };'
    ]
  ])("RELAYER_USES_USDC_FOR_GAS ignores %s", async (_name, source) => {
    await expect(
      runBridgeRule(relayerUsesUsdcForGasRule, source)
    ).resolves.toEqual([]);
  });

  it.each(["md", "mdx", "json", "yaml", "yml", "sol"])(
    "RELAYER_USES_USDC_FOR_GAS skips .%s files",
    async (extension) => {
      await expect(
        runBridgeRule(
          relayerUsesUsdcForGasRule,
          'const arcRelayer = { relayerGasToken: "ETH" };',
          {},
          `src/fixture.${extension}`
        )
      ).resolves.toEqual([]);
    }
  );

  it("RELAYER_USES_USDC_FOR_GAS supports severity overrides", async () => {
    const findings = await runBridgeRule(
      relayerUsesUsdcForGasRule,
      'const arcRelayer = { relayerGasToken: "ETH" };',
      { "bridge/RELAYER_USES_USDC_FOR_GAS": "warning" }
    );
    expect(findings[0]?.severity).toBe("warning");
  });

  it("RELAYER_USES_USDC_FOR_GAS supports disabling", async () => {
    await expect(
      runBridgeRule(
        relayerUsesUsdcForGasRule,
        'const arcRelayer = { relayerGasToken: "ETH" };',
        { "bridge/RELAYER_USES_USDC_FOR_GAS": "off" }
      )
    ).resolves.toEqual([]);
  });

  it("ATTESTATION_404_NOT_FATAL emits conditional deprecated advice", async () => {
    const findings = await runBridgeRule(
      attestation404NotFatalRule,
      "async function pollAttestation(response) { // CCTP attestation\n if (response.status === 404) throw new Error('attestation failed');\n}"
    );

    expect(attestation404NotFatalRule).toMatchObject({
      defaultSeverity: "info",
      description: expect.stringContaining("deprecated low-confidence")
    });
    expect(findings[0]).toMatchObject({
      ruleId: "bridge/ATTESTATION_404_NOT_FATAL",
      severity: "info",
      docs: "arc-cctp-attestation",
      message: expect.stringContaining("Deprecated CCTP guidance"),
      suggestedFix: expect.stringContaining("verify the source burn succeeded")
    });

    const suggestedFix = findings[0]?.suggestedFix ?? "";
    expect(suggestedFix).toContain("transaction hash");
    expect(suggestedFix).toContain("source domain");
    expect(suggestedFix).toContain("positive delay");
    expect(suggestedFix).toContain("bounded timeout or cancellation");
    expect(suggestedFix).toContain("429");
    expect(suggestedFix).toContain("unexpected non-OK");
    expect(suggestedFix).toContain("empty messages");
    expect(suggestedFix).toContain("pending");
    expect(suggestedFix).toContain("complete");
    expect(suggestedFix).not.toContain("404 as a retryable pending state");
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
  rules: RuleContext["config"]["rules"] = {},
  filePath = "src/fixture.ts"
) {
  return runRules([rule], {
    projectRoot: "/fixture",
    config: {
      ...DEFAULT_CONFIG,
      presets: ["bridge"],
      rules
    },
    files: [filePath],
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
