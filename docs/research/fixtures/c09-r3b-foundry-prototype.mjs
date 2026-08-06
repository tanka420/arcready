import path from "node:path";

const ARC_TESTNET_CHAIN_ID = 5042002;
const FOUNDRY_VERSION = "1.7.1";
const FOUNDRY_ARTIFACT_CONTRACT =
  "foundry-forge-script-run-latest-reviewed-2026-08-05";
const UNSUPPORTED_ARTIFACT_CONTRACTS = new Set([
  "hardhat-deploy-v1",
  "nonstandard-hardhat-like"
]);

const ASSOCIATION_STATUS = new Set([
  "arc-foundry",
  "non-arc",
  "ambiguous",
  "conflict",
  "unknown",
  "unsupported-adapter"
]);

function normalizeRepositoryPath(filePath) {
  if (
    typeof filePath !== "string" ||
    filePath.length === 0 ||
    filePath.startsWith("/") ||
    filePath.includes("\\")
  ) {
    return null;
  }

  const segments = filePath.split("/");
  if (
    segments.some(
      (segment) => segment === "" || segment === "." || segment === ".."
    )
  ) {
    return null;
  }

  const normalized = path.posix.normalize(filePath);
  if (normalized !== filePath || normalized.startsWith("../")) {
    return null;
  }

  return normalized;
}

function getSourceProjectRoot(filePath) {
  if (filePath === "src") return null;
  if (filePath.startsWith("src/")) return "";

  const marker = "/src/";
  const index = filePath.indexOf(marker);
  if (index < 0) return null;

  return filePath.slice(0, index + 1);
}

function getBroadcastDescriptor(filePath) {
  const match = filePath.match(
    /^(.*)broadcast\/([^/]+\.s\.sol)\/(\d+)\/run-latest\.json$/
  );
  if (!match) return null;

  const [, projectRoot, scriptName, chainIdText] = match;
  if (projectRoot.startsWith("vendor/") || projectRoot.includes("/vendor/")) {
    return null;
  }

  const chainId = Number(chainIdText);
  if (!Number.isSafeInteger(chainId) || chainId < 0) return null;

  return { projectRoot, scriptName, chainId };
}

function maskSolidityNonCode(source) {
  let state = "code";
  let escaped = false;
  let output = "";

  for (let index = 0; index < source.length; index += 1) {
    const current = source[index];
    const next = source[index + 1];

    if (state === "code") {
      if (current === "/" && next === "/") {
        output += "  ";
        index += 1;
        state = "line-comment";
        continue;
      }
      if (current === "/" && next === "*") {
        output += "  ";
        index += 1;
        state = "block-comment";
        continue;
      }
      if (current === '"') {
        output += " ";
        state = "double-string";
        escaped = false;
        continue;
      }
      if (current === "'") {
        output += " ";
        state = "single-string";
        escaped = false;
        continue;
      }

      output += current;
      continue;
    }

    if (state === "line-comment") {
      if (current === "\n" || current === "\r") {
        output += current;
        state = "code";
      } else {
        output += " ";
      }
      continue;
    }

    if (state === "block-comment") {
      if (current === "*" && next === "/") {
        output += "  ";
        index += 1;
        state = "code";
      } else {
        output += current === "\n" || current === "\r" ? current : " ";
      }
      continue;
    }

    const quote = state === "double-string" ? '"' : "'";
    if (escaped) {
      output += current === "\n" || current === "\r" ? current : " ";
      escaped = false;
      continue;
    }
    if (current === "\\") {
      output += " ";
      escaped = true;
      continue;
    }
    if (current === quote) {
      output += " ";
      state = "code";
      continue;
    }

    output += current === "\n" || current === "\r" ? current : " ";
  }

  return output;
}

function readConcreteContractNameCounts(source) {
  const counts = new Map();
  const maskedSource = maskSolidityNonCode(source);
  const pattern = /\b(abstract\s+)?contract\s+([A-Za-z_$][\w$]*)\b/g;

  for (const match of maskedSource.matchAll(pattern)) {
    if (match[1]) continue;
    const name = match[2];
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }

  return counts;
}

function parseFoundryBroadcast(content, descriptor) {
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    return { kind: "invalid", reason: "malformed-json" };
  }

  if (
    !parsed ||
    typeof parsed !== "object" ||
    Array.isArray(parsed) ||
    !Number.isSafeInteger(parsed.chain) ||
    !Array.isArray(parsed.transactions)
  ) {
    return { kind: "invalid", reason: "invalid-shape" };
  }

  if (parsed.chain !== descriptor.chainId) {
    return { kind: "conflict", reason: "path-json-chain-mismatch" };
  }

  const creates = [];
  for (const transaction of parsed.transactions) {
    if (
      !transaction ||
      typeof transaction !== "object" ||
      Array.isArray(transaction) ||
      transaction.transactionType !== "CREATE"
    ) {
      continue;
    }

    if (
      typeof transaction.contractName !== "string" ||
      !/^[A-Za-z_$][\w$]*$/.test(transaction.contractName)
    ) {
      continue;
    }

    creates.push({
      contractName: transaction.contractName,
      contractAddress:
        typeof transaction.contractAddress === "string" &&
        /^0x[0-9a-fA-F]{40}$/.test(transaction.contractAddress)
          ? transaction.contractAddress.toLowerCase()
          : null,
      chainId: parsed.chain
    });
  }

  return { kind: "valid", creates };
}

function similarContractCandidates(sourceNameCounts, artifactName) {
  return [...sourceNameCounts.keys()].filter(
    (sourceName) =>
      sourceName.startsWith(artifactName) || artifactName.startsWith(sourceName)
  );
}

function classifyProjectRoot(sourceNameCounts, broadcasts) {
  const exactRecords = [];
  let duplicateExactOwner = false;
  let sawConflict = false;
  let similarCandidateCount = 0;

  for (const broadcast of broadcasts) {
    if (broadcast.result.kind === "conflict") {
      sawConflict = true;
      continue;
    }
    if (broadcast.result.kind !== "valid") continue;

    for (const create of broadcast.result.creates) {
      const definitionCount = sourceNameCounts.get(create.contractName) ?? 0;
      if (definitionCount === 1) {
        exactRecords.push(create);
      } else if (definitionCount > 1) {
        duplicateExactOwner = true;
      } else {
        similarCandidateCount += similarContractCandidates(
          sourceNameCounts,
          create.contractName
        ).length;
      }
    }
  }

  if (sawConflict) return "conflict";
  if (duplicateExactOwner) return "ambiguous";

  if (exactRecords.length === 0) {
    return similarCandidateCount > 1 ? "ambiguous" : "unknown";
  }

  if (exactRecords.some((record) => record.contractAddress === null)) {
    return "unknown";
  }

  const arcRecords = exactRecords.filter(
    (record) => record.chainId === ARC_TESTNET_CHAIN_ID
  );
  const nonArcRecords = exactRecords.filter(
    (record) => record.chainId !== ARC_TESTNET_CHAIN_ID
  );

  if (arcRecords.length > 0 && nonArcRecords.length > 0) {
    return "ambiguous";
  }

  if (arcRecords.length > 0) {
    const addresses = new Set(
      arcRecords.map((record) => record.contractAddress)
    );
    return addresses.size === 1 ? "arc-foundry" : "conflict";
  }

  return nonArcRecords.length > 0 ? "non-arc" : "unknown";
}

function mergeStatuses(statuses) {
  if (statuses.includes("conflict")) return "conflict";
  if (statuses.includes("ambiguous")) return "ambiguous";

  const material = new Set(statuses.filter((status) => status !== "unknown"));
  if (material.size > 1) return "ambiguous";
  if (material.size === 1) return [...material][0];
  return "unknown";
}

export function classifyFoundryArcAssociation(projectCase) {
  if (
    !projectCase ||
    projectCase.kind !== "project" ||
    !projectCase.files ||
    typeof projectCase.files !== "object"
  ) {
    return {
      status: "unknown",
      foundryVersion: FOUNDRY_VERSION,
      reason: "invalid-project-case"
    };
  }

  if (UNSUPPORTED_ARTIFACT_CONTRACTS.has(projectCase.artifactContract)) {
    return {
      status: "unsupported-adapter",
      foundryVersion: FOUNDRY_VERSION,
      reason: "non-foundry-artifact-family"
    };
  }

  const sourceNameCountsByRoot = new Map();
  const broadcastsByRoot = new Map();

  for (const [rawPath, content] of Object.entries(projectCase.files)) {
    const filePath = normalizeRepositoryPath(rawPath);
    if (!filePath || typeof content !== "string") continue;

    if (filePath.endsWith(".sol")) {
      const projectRoot = getSourceProjectRoot(filePath);
      if (projectRoot === null) continue;

      const rootCounts = sourceNameCountsByRoot.get(projectRoot) ?? new Map();
      for (const [name, count] of readConcreteContractNameCounts(content)) {
        rootCounts.set(name, (rootCounts.get(name) ?? 0) + count);
      }
      sourceNameCountsByRoot.set(projectRoot, rootCounts);
      continue;
    }

    const descriptor = getBroadcastDescriptor(filePath);
    if (!descriptor) continue;

    const broadcasts = broadcastsByRoot.get(descriptor.projectRoot) ?? [];
    broadcasts.push({
      descriptor,
      result: parseFoundryBroadcast(content, descriptor)
    });
    broadcastsByRoot.set(descriptor.projectRoot, broadcasts);
  }

  const statuses = [];
  const roots = new Set([
    ...sourceNameCountsByRoot.keys(),
    ...broadcastsByRoot.keys()
  ]);

  for (const root of [...roots].sort()) {
    const sourceNameCounts = sourceNameCountsByRoot.get(root);
    const broadcasts = broadcastsByRoot.get(root);
    if (!sourceNameCounts || sourceNameCounts.size === 0 || !broadcasts) continue;
    statuses.push(classifyProjectRoot(sourceNameCounts, broadcasts));
  }

  const status = mergeStatuses(statuses);
  if (!ASSOCIATION_STATUS.has(status)) {
    throw new Error(`Unexpected C09-R3B status: ${status}`);
  }

  return {
    status,
    foundryVersion: FOUNDRY_VERSION,
    reason:
      statuses.length === 0
        ? "no-bounded-source-broadcast-project-root"
        : "bounded-foundry-broadcast-association"
  };
}

export const c09R3bFoundryPrototype = Object.freeze({
  foundryVersion: FOUNDRY_VERSION,
  artifactContract: FOUNDRY_ARTIFACT_CONTRACT,
  arcChainId: ARC_TESTNET_CHAIN_ID,
  classify: classifyFoundryArcAssociation
});
