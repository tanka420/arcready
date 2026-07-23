import type { Rule } from "../../core/rules/index.js";
import {
  fieldsAt,
  inspectArcChainObjects,
  stringValue,
  supportsArcChainObjectPath
} from "./arc-chain-object-scanner.js";
import type { ArcChainObjectCandidate } from "./arc-chain-object-scanner.js";
import { WALLET_DOCS, createWalletFinding } from "./helpers.js";

const MESSAGE =
  "Arc-owned chain metadata sets nativeCurrency.name to ETH/Ethereum or nativeCurrency.symbol to a value other than USDC.";
const SUGGESTED_FIX =
  'Set nativeCurrency.symbol to "USDC". If nativeCurrency.name is "ETH" or "Ethereum", replace it with a USDC-facing name such as "USDC" or "USD Coin". Handle Arc native accounting precision and USDC display precision according to the integration surface.';

export const walletNativeUsdcDisplayRule: Rule = {
  id: "wallet/WALLET_NATIVE_USDC_DISPLAY",
  name: "Wallet native USDC display",
  description:
    "Detects explicit non-USDC native-currency labels in bounded Arc-owned chain objects.",
  preset: "wallet",
  defaultSeverity: "critical",
  docs: [WALLET_DOCS.usdcGas],
  async run(context) {
    const findings = [];
    for (const filePath of context.files) {
      if (!supportsArcChainObjectPath(filePath)) continue;
      let source: string;
      try {
        source = await context.readFile(filePath);
      } catch {
        continue;
      }
      if (inspectArcChainObjects(source, hasContradiction) === true) {
        findings.push(
          createWalletFinding(
            walletNativeUsdcDisplayRule,
            filePath,
            MESSAGE,
            SUGGESTED_FIX,
            WALLET_DOCS.usdcGas
          )
        );
      }
    }
    return findings;
  }
};

function hasContradiction(
  candidate: ArcChainObjectCandidate
): true | undefined {
  const span = candidate.fields.get("nativeCurrency");
  if (span === undefined || candidate.masked[span[0]] !== "{") return undefined;
  const fields = fieldsAt(candidate.masked, span);
  if (fields === undefined) return undefined;
  const name = fields.get("name");
  const symbol = fields.get("symbol");
  const nameValue =
    name === undefined
      ? undefined
      : stringValue(candidate.source.slice(...name));
  const symbolValue =
    symbol === undefined
      ? undefined
      : stringValue(candidate.source.slice(...symbol));
  return nameValue !== undefined && /^(?:ETH|Ethereum)$/i.test(nameValue)
    ? true
    : symbolValue !== undefined && !/^USDC$/i.test(symbolValue)
      ? true
      : undefined;
}
