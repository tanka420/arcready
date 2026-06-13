import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { ArcReadyPreset } from "../config/index.js";

export type DetectionConfidence = "low" | "medium" | "high";

export interface ProjectDetection {
  detectedPresets: ArcReadyPreset[];
  confidence: DetectionConfidence;
  reasons: string[];
}

export interface DetectProjectOptions {
  projectRoot: string;
  files: string[];
}

const APP_KIT_PACKAGE = "@circle-fin/app-kit";
const APP_KIT_CONTENT_TERMS = ["AppKit", "Arc_Testnet"];

const WALLET_DEPENDENCIES = [
  "wagmi",
  "viem",
  "ethers",
  "rainbowkit",
  "walletconnect",
  "@rainbow-me/rainbowkit",
  "@walletconnect/ethereum-provider"
];
const WALLET_CONTENT_TERMS = [
  "wagmi",
  "viem",
  "ethers",
  "rainbowkit",
  "walletconnect",
  "nativeCurrency",
  "chainId",
  "explorer",
  "rpcUrls"
];

const BRIDGE_STRONG_TERMS = ["CCTP", "depositForBurn", "receiveMessage"];
const BRIDGE_CONTENT_TERMS = [
  "CCTP",
  "depositForBurn",
  "receiveMessage",
  "bridge",
  "attestation",
  "relayer"
];

export function detectProject(options: DetectProjectOptions): ProjectDetection {
  const detectedPresets = new Set<ArcReadyPreset>();
  const reasons: string[] = [];
  const confidenceLevels: DetectionConfidence[] = [];
  const packageJson = readPackageJson(options.projectRoot);
  const content = readCombinedContent(options.files);

  if (packageJson.includes(APP_KIT_PACKAGE)) {
    detectedPresets.add("app-kit");
    confidenceLevels.push("high");
    reasons.push(`package.json contains ${APP_KIT_PACKAGE}`);
  } else if (containsAny(content, APP_KIT_CONTENT_TERMS)) {
    detectedPresets.add("app-kit");
    confidenceLevels.push("medium");
    reasons.push("source content references App Kit markers");
  }

  const walletDependency = WALLET_DEPENDENCIES.find((term) =>
    packageJson.includes(term)
  );
  const walletContentMatches = matchingTerms(content, WALLET_CONTENT_TERMS);

  if (walletDependency) {
    detectedPresets.add("wallet");
    confidenceLevels.push("high");
    reasons.push(`package.json contains wallet dependency ${walletDependency}`);
  } else if (walletContentMatches.length >= 2) {
    detectedPresets.add("wallet");
    confidenceLevels.push("medium");
    reasons.push(
      `source content contains wallet markers: ${walletContentMatches
        .slice(0, 3)
        .join(", ")}`
    );
  }

  const bridgeStrongMatch = BRIDGE_STRONG_TERMS.find((term) =>
    content.includes(term)
  );
  const bridgeContentMatches = matchingTerms(content, BRIDGE_CONTENT_TERMS);

  if (bridgeStrongMatch) {
    detectedPresets.add("bridge");
    confidenceLevels.push("high");
    reasons.push(`source content contains bridge marker ${bridgeStrongMatch}`);
  } else if (bridgeContentMatches.length >= 2) {
    detectedPresets.add("bridge");
    confidenceLevels.push("medium");
    reasons.push(
      `source content contains bridge markers: ${bridgeContentMatches
        .slice(0, 3)
        .join(", ")}`
    );
  }

  if (detectedPresets.size === 0) {
    return {
      detectedPresets: [],
      confidence: "low",
      reasons: ["No wallet, App Kit, or bridge markers detected"]
    };
  }

  return {
    detectedPresets: [...detectedPresets].sort(),
    confidence: highestConfidence(confidenceLevels),
    reasons
  };
}

export function readProjectName(projectRoot: string): string {
  const packageJsonPath = join(projectRoot, "package.json");

  if (existsSync(packageJsonPath)) {
    try {
      const parsedPackage = JSON.parse(
        readFileSync(packageJsonPath, "utf8")
      ) as {
        name?: unknown;
      };

      if (
        typeof parsedPackage.name === "string" &&
        parsedPackage.name.length > 0
      ) {
        return parsedPackage.name;
      }
    } catch {
      return basename(projectRoot);
    }
  }

  return basename(projectRoot);
}

function readPackageJson(projectRoot: string): string {
  const packageJsonPath = join(projectRoot, "package.json");

  if (!existsSync(packageJsonPath)) {
    return "";
  }

  try {
    return readFileSync(packageJsonPath, "utf8");
  } catch {
    return "";
  }
}

function readCombinedContent(files: string[]): string {
  return files
    .map((file) => {
      try {
        return readFileSync(file, "utf8");
      } catch {
        return "";
      }
    })
    .join("\n");
}

function containsAny(content: string, terms: string[]): boolean {
  return terms.some((term) => content.includes(term));
}

function matchingTerms(content: string, terms: string[]): string[] {
  return terms.filter((term) => content.includes(term));
}

function highestConfidence(
  confidenceLevels: DetectionConfidence[]
): DetectionConfidence {
  if (confidenceLevels.includes("high")) {
    return "high";
  }

  if (confidenceLevels.includes("medium")) {
    return "medium";
  }

  return "low";
}
