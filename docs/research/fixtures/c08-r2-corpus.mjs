const CLASSES = new Set(["safe-candidate", "unsafe-candidate", "unsupported"]);
const ELIGIBILITY = new Set([
  "eligible-source-validated-burn",
  "blocked-unvalidated-burn",
  "not-applicable"
]);

function replaceOnce(source, from, to) {
  const first = source.indexOf(from);
  const last = source.lastIndexOf(from);
  if (first < 0 || first !== last) {
    throw new Error(`Expected one replacement for: ${from.slice(0, 80)}`);
  }
  return source.slice(0, first) + to + source.slice(first + from.length);
}

function replaceMany(source, replacements) {
  return replacements.reduce(
    (current, [from, to]) => replaceOnce(current, from, to),
    source
  );
}

const BASE_SAFE = `const SOURCE = { chainId: 5042002, domain: 26 } as const;
const MAX_ATTEMPTS = 60;

async function pollArcAttestation(transactionHash: string) {
  const url =
    \`https://iris-api-sandbox.circle.com/v2/messages/\${SOURCE.domain}\` +
    \`?transactionHash=\${transactionHash}\`;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const response = await fetch(url);

    if (response.status === 404) {
      await new Promise((resolve) => setTimeout(resolve, 5_000));
      continue;
    }

    if (response.status === 429) {
      await new Promise((resolve) => setTimeout(resolve, 10_000));
      continue;
    }

    if (!response.ok) {
      throw new Error(\`Unexpected Iris status: \${response.status}\`);
    }

    const body = await response.json();

    if (body.messages.length === 0) {
      await new Promise((resolve) => setTimeout(resolve, 5_000));
      continue;
    }

    const message = body.messages[0];

    if (message.status === "pending") {
      await new Promise((resolve) => setTimeout(resolve, 5_000));
      continue;
    }

    if (message.status === "complete" && message.attestation) {
      return message;
    }

    throw new Error(\`Unexpected attestation state: \${message.status}\`);
  }

  throw new Error("Attestation polling timed out");
}

void SOURCE.chainId;
void pollArcAttestation;
`;

const BRANCH_404_SAFE = `if (response.status === 404) {
      await new Promise((resolve) => setTimeout(resolve, 5_000));
      continue;
    }`;
const BRANCH_404_THROW = `if (response.status === 404) {
      throw new Error("Attestation failed");
    }`;
const BRANCH_429 = `if (response.status === 429) {
      await new Promise((resolve) => setTimeout(resolve, 10_000));
      continue;
    }`;
const EMPTY_SAFE = `if (body.messages.length === 0) {
      await new Promise((resolve) => setTimeout(resolve, 5_000));
      continue;
    }`;
const PENDING_SAFE = `if (message.status === "pending") {
      await new Promise((resolve) => setTimeout(resolve, 5_000));
      continue;
    }`;
const COMPLETE_SAFE = `if (message.status === "complete" && message.attestation) {
      return message;
    }`;
const OTHER_SAFE = `if (!response.ok) {
      throw new Error(\`Unexpected Iris status: \${response.status}\`);
    }`;
const FOR_LOOP = `for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {`;
const FINAL_TIMEOUT = `throw new Error("Attestation polling timed out");`;

function makeCase(
  id,
  controlFlowClass,
  publicFindingEligibility,
  source,
  note
) {
  return { id, controlFlowClass, publicFindingEligibility, source, note };
}

const cases = [];

cases.push(
  makeCase(
    "R2-A01",
    "safe-candidate",
    "not-applicable",
    BASE_SAFE,
    "Canonical bounded direct-fetch flow with structurally paired source object."
  )
);

cases.push(
  makeCase(
    "R2-A02",
    "unsafe-candidate",
    "blocked-unvalidated-burn",
    replaceOnce(BASE_SAFE, BRANCH_404_SAFE, BRANCH_404_THROW),
    "Owned 404 branch throws, but queried hash has request ownership only."
  )
);

const PRESSURE_SAMPLE = `import { CHAIN_CONFIGS, IRIS_API_URL } from "./chains";

const POLL_INTERVAL_MS = 5_000;

export async function retrieveAttestation(
  transactionHash: string,
  sourceChainId: number
) {
  const url =
    \`\${IRIS_API_URL}/v2/messages/\` +
    \`\${CHAIN_CONFIGS[sourceChainId].destinationDomain}\` +
    \`?transactionHash=\${transactionHash}\`;

  while (true) {
    const response = await fetch(url);
    if (response.status === 404) {
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      continue;
    }
    if (!response.ok) {
      throw new Error(\`Attestation request failed: \${response.status}\`);
    }
    const body = await response.json();
    if (body?.messages?.[0]?.status === "complete") return body.messages[0];
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}
`;

const PRESSURE_BURN_FLOW = `import { CHAIN_CONFIGS, IRIS_API_URL } from "./chains";

export async function executeTransfer(sourceChainId: number) {
  const burnTx = await burnUsdc(sourceChainId);
  return retrieveAttestation(burnTx, sourceChainId);
}

async function burnUsdc(sourceChainId: number) {
  return submitBurnThroughImportedConfig(sourceChainId);
}

async function retrieveAttestation(transactionHash: string, sourceChainId: number) {
  const url =
    \`\${IRIS_API_URL}/v2/messages/\` +
    \`\${CHAIN_CONFIGS[sourceChainId].destinationDomain}\` +
    \`?transactionHash=\${transactionHash}\`;
  const response = await fetch(url);
  if (!response.ok) throw new Error("Attestation unavailable");
  return response.json();
}
`;

const PRESSURE_AXIOS = `import axios from "axios";

export async function poll(url: string) {
  while (true) {
    try {
      const response = await axios.get(url);
      if (response.data.messages?.[0]?.status === "complete") {
        return response.data.messages[0];
      }
    } catch (error: any) {
      if (error.response?.status !== 404) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }
}
`;

const PRESSURE_V1 = `export async function getAttestation(messageHash: string) {
  const response = await fetch(
    \`https://iris-api-sandbox.circle.com/v1/attestations/\${messageHash}\`
  );
  if (!response.ok) throw new Error("Attestation request failed");
  const body = await response.json();
  return body.status === "complete" ? body.attestation : null;
}
`;

const PRESSURE_ONESHOT = `export async function getAttestation(
  sourceDomainId: number,
  transactionHash: string
) {
  const response = await fetch(
    \`https://iris-api-sandbox.circle.com/v2/messages/\${sourceDomainId}\` +
      \`?transactionHash=\${transactionHash}\`
  );
  if (!response.ok) throw new Error("Attestation unavailable");
  const body = await response.json();
  return body.messages?.[0] ?? null;
}
`;

for (const [id, source, note] of [
  [
    "R2-P01",
    PRESSURE_SAMPLE,
    "Circle maintained sample-like imported configuration."
  ],
  [
    "R2-P02",
    PRESSURE_BURN_FLOW,
    "One-hop burn helper and attestation helper pressure."
  ],
  ["R2-P03", PRESSURE_AXIOS, "Axios error-semantics family."],
  ["R2-P04", PRESSURE_V1, "CCTP V1 message-hash attestation family."],
  ["R2-P05", PRESSURE_ONESHOT, "One-shot V2 request without polling ownership."]
]) {
  cases.push(makeCase(id, "unsupported", "not-applicable", source, note));
}

const safeCases = [
  [
    "R2-S01",
    replaceOnce(
      BASE_SAFE,
      "iris-api-sandbox.circle.com",
      "iris-api.circle.com"
    ),
    "Production Iris host."
  ],
  [
    "R2-S02",
    replaceMany(BASE_SAFE, [
      [
        `const url =
    \`https://iris-api-sandbox.circle.com/v2/messages/\${SOURCE.domain}\` +
    \`?transactionHash=\${transactionHash}\`;

  ${FOR_LOOP}
    const response = await fetch(url);`,
        `${FOR_LOOP}
    const response = await fetch(
      \`https://iris-api-sandbox.circle.com/v2/messages/\${SOURCE.domain}\` +
        \`?transactionHash=\${transactionHash}\`
    );`
      ]
    ]),
    "Direct URL expression at fetch."
  ],
  [
    "R2-S03",
    replaceMany(BASE_SAFE, [
      [
        "async function pollArcAttestation(transactionHash: string) {\n  const url =",
        "async function pollArcAttestation(transactionHash: string) {\n  const hash = transactionHash;\n  const url ="
      ],
      ["?transactionHash=${transactionHash}", "?transactionHash=${hash}"]
    ]),
    "One immutable hash alias."
  ],
  [
    "R2-S04",
    replaceOnce(
      BASE_SAFE,
      "const SOURCE = { chainId: 5042002, domain: 26 } as const;",
      "const SOURCE = { chainId: 1, domain: 0 } as const;"
    ),
    "Exact Ethereum source/domain pair."
  ],
  [
    "R2-S05",
    replaceMany(BASE_SAFE, [
      [
        "const MAX_ATTEMPTS = 60;",
        "const MAX_ATTEMPTS = 60;\nlet attempt = 0;"
      ],
      [FOR_LOOP, "while (attempt < MAX_ATTEMPTS) {\n    attempt += 1;"]
    ]),
    "Direct bounded while loop."
  ],
  [
    "R2-S06",
    replaceMany(BASE_SAFE, [
      ["const MAX_ATTEMPTS = 60;", "const DEADLINE_MS = Date.now() + 300_000;"],
      [FOR_LOOP, "while (Date.now() < DEADLINE_MS) {"]
    ]),
    "Direct deadline bound."
  ],
  [
    "R2-S07",
    replaceMany(BASE_SAFE, [
      [
        "async function pollArcAttestation(transactionHash: string) {",
        "async function pollArcAttestation(\n  transactionHash: string,\n  signal: AbortSignal\n) {"
      ],
      [
        `${FOR_LOOP}
    const response = await fetch(url);`,
        `${FOR_LOOP}
    if (signal.aborted) throw new Error("Attestation polling aborted");
    const response = await fetch(url);`
      ]
    ]),
    "Direct abort check plus attempt bound."
  ],
  [
    "R2-S08",
    replaceMany(BASE_SAFE, [
      [" as const", ""],
      ["transactionHash: string", "transactionHash"]
    ]),
    "Plain JavaScript-compatible source."
  ]
];

for (const [id, source, note] of safeCases) {
  cases.push(makeCase(id, "safe-candidate", "not-applicable", source, note));
}

const unsafeCases = [
  ["R2-U01", BRANCH_404_THROW, "Owned 404 throws."],
  [
    "R2-U02",
    `if (response.status === 404) {
      return null;
    }`,
    "Owned 404 returns failure."
  ],
  [
    "R2-U03",
    `if (response.status === 404) {
      break;
    }`,
    "Owned 404 breaks polling."
  ],
  [
    "R2-U04",
    `if (response.status === 404) {
      continue;
    }`,
    "Owned 404 retries without delay."
  ]
];

for (const [id, replacement, note] of unsafeCases) {
  cases.push(
    makeCase(
      id,
      "unsafe-candidate",
      "blocked-unvalidated-burn",
      replaceOnce(BASE_SAFE, BRANCH_404_SAFE, replacement),
      note
    )
  );
}

cases.push(
  makeCase(
    "R2-U05",
    "unsafe-candidate",
    "blocked-unvalidated-burn",
    replaceMany(BASE_SAFE, [
      [
        `${BRANCH_404_SAFE}

    ${BRANCH_429}`,
        `if (response.status === 404 || response.status === 429) {
      await new Promise((resolve) => setTimeout(resolve, 5_000));
      continue;
    }`
      ]
    ]),
    "404 and 429 share one branch."
  ),
  makeCase(
    "R2-U06",
    "unsafe-candidate",
    "blocked-unvalidated-burn",
    replaceOnce(
      BASE_SAFE,
      EMPTY_SAFE,
      `if (body.messages.length === 0) {
      throw new Error("No attestation message");
    }`
    ),
    "Empty messages is terminal."
  ),
  makeCase(
    "R2-U07",
    "unsafe-candidate",
    "blocked-unvalidated-burn",
    replaceOnce(
      BASE_SAFE,
      PENDING_SAFE,
      `if (message.status === "pending") {
      return null;
    }`
    ),
    "Pending message returns failure."
  ),
  makeCase(
    "R2-U08",
    "unsafe-candidate",
    "blocked-unvalidated-burn",
    replaceOnce(
      BASE_SAFE,
      COMPLETE_SAFE,
      `if (message.status === "complete" && message.attestation) {
      await new Promise((resolve) => setTimeout(resolve, 5_000));
      continue;
    }`
    ),
    "Complete attestation is ignored."
  ),
  makeCase(
    "R2-U09",
    "unsafe-candidate",
    "blocked-unvalidated-burn",
    replaceOnce(
      BASE_SAFE,
      OTHER_SAFE,
      `if (!response.ok) {
      await new Promise((resolve) => setTimeout(resolve, 5_000));
      continue;
    }`
    ),
    "Unexpected non-OK is silently retried."
  ),
  makeCase(
    "R2-U10",
    "unsafe-candidate",
    "blocked-unvalidated-burn",
    replaceMany(BASE_SAFE, [
      [FOR_LOOP, "while (true) {"],
      [`\n  ${FINAL_TIMEOUT}\n`, "\n"]
    ]),
    "Bounded exit removed."
  )
);

const unsupportedMutations = [
  ["R2-X01", "iris-api-sandbox.circle.com", "example.com", "Wrong host."],
  [
    "R2-X02",
    "https://iris-api-sandbox.circle.com",
    "${IRIS_API_URL}",
    "Imported host placeholder."
  ],
  [
    "R2-X03",
    "https://iris-api-sandbox.circle.com",
    "${process.env.IRIS_API_URL}",
    "Environment-selected host."
  ],
  ["R2-X04", "/v2/messages/", "/v1/messages/", "V1 messages endpoint."],
  ["R2-X05", "?transactionHash=", "?nonce=", "Nonce query family."],
  [
    "R2-X06",
    "const SOURCE = { chainId: 5042002, domain: 26 } as const;",
    "const SOURCE = { chainId: 5042002, domain: 0 } as const;",
    "Wrong Arc source/domain pair."
  ],
  [
    "R2-X07",
    "const SOURCE = { chainId: 5042002, domain: 26 } as const;",
    "const SOURCE = { domain: 26 } as const;",
    "Unknown source chain."
  ],
  [
    "R2-X08",
    "const SOURCE = { chainId: 5042002, domain: 26 } as const;",
    'import { SOURCE } from "./source";',
    "Imported source/domain pair."
  ],
  [
    "R2-X09",
    "SOURCE.domain",
    "CHAIN_CONFIGS[sourceChainId].domain",
    "Computed domain map."
  ],
  [
    "R2-X10",
    "async function pollArcAttestation(transactionHash: string) {",
    'import { transactionHash } from "./burn";\n\nasync function pollArcAttestation() {',
    "Imported transaction hash."
  ],
  [
    "R2-X11",
    "?transactionHash=${transactionHash}",
    "?transactionHash=${await getTransactionHash()}",
    "Unknown hash helper."
  ],
  [
    "R2-X12",
    "async function pollArcAttestation(transactionHash: string) {",
    "async function pollArcAttestation(transactionHash: string) {\n  const fetch = async () => new Response();",
    "Shadowed fetch."
  ],
  ["R2-X13", "await fetch(url)", "await httpGet(url)", "Wrapper client."],
  ["R2-X14", "await fetch(url)", "await axios.get(url)", "Axios."],
  [
    "R2-X15",
    "async function pollArcAttestation(transactionHash: string) {",
    "async function helper(transactionHash: string) {",
    "Helper polling boundary."
  ],
  [FOR_LOOP, `for (const item of [1]) {\n    ${FOR_LOOP}`, "Nested loop."],
  [
    "R2-X17",
    "const response = await fetch(url);",
    "const first = await fetch(url);\n    const response = await fetch(url);\n    void first;",
    "Multiple responses."
  ],
  [
    "R2-X18",
    "const response = await fetch(url);",
    "const original = await fetch(url);\n    const alias1 = original;\n    const response = alias1;",
    "Response alias chain."
  ],
  [
    "R2-X19",
    "if (response.status === 404)",
    "const earlyBody = await response.json();\n    void earlyBody;\n\n    if (response.status === 404)",
    "JSON parsed before status."
  ],
  [
    "R2-X20",
    BRANCH_404_SAFE,
    `if (response.status === 404) {\n      await sleep(5_000);\n      continue;\n    }`,
    "Imported delay helper."
  ],
  [
    "R2-X21",
    BRANCH_404_SAFE,
    `if (response.status === 404) {\n      await new Promise((resolve) => setTimeout(resolve, getDelay()));\n      continue;\n    }`,
    "Computed delay."
  ],
  [
    "R2-X22",
    BRANCH_404_SAFE,
    `if (response.status === 404) {\n      onFailure();\n      return;\n    }`,
    "Callback terminal action."
  ],
  [
    "R2-X23",
    "const response = await fetch(url);",
    "let response = await fetch(url);\n    response = await fetch(url);",
    "Mutable response."
  ],
  [
    "R2-X24",
    BASE_SAFE,
    `const docs = ${JSON.stringify(BASE_SAFE)};`,
    "Documentation string only."
  ],
  [
    "R2-X25",
    "void pollArcAttestation;",
    "void pollArcAttestation",
    "Malformed source."
  ],
  [
    "R2-X26",
    "void pollArcAttestation;",
    "const view = <div />;\nvoid pollArcAttestation;",
    "TSX pressure source."
  ]
];

for (let index = 0; index < unsupportedMutations.length; index += 1) {
  const item = unsupportedMutations[index];
  let id;
  let source;
  let note;

  if (index === 15) {
    id = "R2-X16";
    source = replaceOnce(BASE_SAFE, item[0], item[1]) + "\n}";
    note = item[2];
  } else {
    [id] = item;
    const from = item[1];
    const to = item[2];
    note = item[3];
    source = from === BASE_SAFE ? to : replaceOnce(BASE_SAFE, from, to);
  }

  cases.push(makeCase(id, "unsupported", "not-applicable", source, note));
}

function validateCorpus(entries) {
  const ids = new Set();
  for (const entry of entries) {
    if (ids.has(entry.id)) throw new Error(`Duplicate case ID: ${entry.id}`);
    ids.add(entry.id);
    if (!CLASSES.has(entry.controlFlowClass)) {
      throw new Error(`Invalid controlFlowClass for ${entry.id}`);
    }
    if (!ELIGIBILITY.has(entry.publicFindingEligibility)) {
      throw new Error(`Invalid eligibility for ${entry.id}`);
    }
    if (typeof entry.source !== "string" || entry.source.length < 20) {
      throw new Error(`Missing complete source for ${entry.id}`);
    }
    if (/__[A-Z0-9_]+__/.test(entry.source)) {
      throw new Error(`Unexpanded placeholder in ${entry.id}`);
    }
    if (
      entry.controlFlowClass === "unsafe-candidate" &&
      entry.publicFindingEligibility !== "blocked-unvalidated-burn"
    ) {
      throw new Error(`Unsafe candidate eligibility mismatch for ${entry.id}`);
    }
  }

  const counts = Object.fromEntries(
    [...CLASSES].map((kind) => [
      kind,
      entries.filter((entry) => entry.controlFlowClass === kind).length
    ])
  );
  if (entries.length !== 51)
    throw new Error(`Expected 51 cases, got ${entries.length}`);
  if (counts["safe-candidate"] !== 9)
    throw new Error("Expected 9 safe candidates");
  if (counts["unsafe-candidate"] !== 11)
    throw new Error("Expected 11 unsafe candidates");
  if (counts.unsupported !== 31)
    throw new Error("Expected 31 unsupported cases");
  return counts;
}

export const C08_R2_CASES = Object.freeze(cases);
export const C08_R2_COUNTS = Object.freeze(validateCorpus(C08_R2_CASES));

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(JSON.stringify({ total: C08_R2_CASES.length, ...C08_R2_COUNTS }));
}
