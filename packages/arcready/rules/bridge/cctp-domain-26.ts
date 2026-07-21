import type { Rule } from "../../core/rules/index.js";
import {
  BRIDGE_DOCS,
  createBridgeFinding,
  isArcRelated,
  isCctpRelated,
  readBridgeFiles
} from "./helpers.js";

const SUGGESTED_FIX =
  "Check the CCTP domain map and set the Arc domain value to 26 wherever Arc routes are configured.";

export const cctpDomain26Rule: Rule = {
  id: "bridge/CCTP_DOMAIN_26",
  name: "CCTP domain 26",
  description: "Detects incorrect Arc CCTP domain configuration.",
  preset: "bridge",
  defaultSeverity: "critical",
  docs: [BRIDGE_DOCS.cctpDomain],
  async run(context) {
    const findings = [];
    for (const { filePath, content } of await readBridgeFiles(context)) {
      if (/\.mdx?$/i.test(filePath)) continue;
      if (!isArcRelated(content) || !isCctpRelated(content)) continue;
      if (hasWrongArcDomain(filePath, content)) {
        findings.push(
          createBridgeFinding(
            cctpDomain26Rule,
            filePath,
            "Arc CCTP domain config appears to use a value other than 26.",
            SUGGESTED_FIX,
            BRIDGE_DOCS.cctpDomain
          )
        );
      }
    }
    return findings;
  }
};

function hasWrongArcDomain(filePath: string, content: string): boolean {
  const yaml = /\.ya?ml$/i.test(filePath);
  const masked = maskInert(content, yaml);
  if (yaml) return hasWrongYaml(masked);

  const declaration =
    /^[\t ]*(?:export\s+const|const|let|var)\s+ARC(?:_CCTP)?_DOMAIN\s*=\s*(\d+)\s*;[\t ]*(?=\r?$)/gim;
  if ([...masked.matchAll(declaration)].some((match) => match[1] !== "26")) {
    return true;
  }
  const standalone =
    /^[\t ]*ARC(?:_CCTP)?_DOMAIN\s*=\s*(\d+)(?:\s*;[\t ]*(?=\r?$)|[\t ]*(?![\s\S]))/gim;
  for (const match of masked.matchAll(standalone)) {
    const prefix = masked.slice(0, match.index).trimEnd();
    if (!prefix.endsWith(",") && match[1] !== "26") return true;
  }
  for (const match of masked.matchAll(
    /([,{])\s*ARC(?:_CCTP)?_DOMAIN\s*:\s*(\d+)\s*(?=[,}])/gi
  )) {
    if (hasObjectOwner(masked, match.index ?? 0) && match[2] !== "26") {
      return true;
    }
  }
  return hasWrongNamedMap(masked);
}

function hasWrongNamedMap(content: string): boolean {
  for (const pattern of [
    /^[\t ]*const\s+cctpDomains\s*=\s*\{/gim,
    /^[\t ]*cctpDomains\s*=\s*\{/gim
  ]) {
    for (const match of content.matchAll(pattern)) {
      if (wrongMapCandidate(content, match, false)) return true;
    }
  }
  for (const match of content.matchAll(/([,{])\s*cctpDomains\s*:\s*\{/gi)) {
    if (
      hasObjectOwner(content, match.index ?? 0) &&
      wrongMapCandidate(content, match, true)
    ) {
      return true;
    }
  }
  return false;
}

function wrongMapCandidate(
  content: string,
  match: RegExpMatchArray,
  member: boolean
): boolean {
  const start = (match.index ?? 0) + match[0].length;
  const end = content.indexOf("}", start);
  if (end < 0) return false;
  const body = content.slice(start, end);
  if (body.includes("{") || body.includes("...")) return false;
  const suffix = content.slice(end + 1);
  const terminal = member
    ? /^(?:\s*,|\s*}\s*;?[\t ]*(?:\r?\n|$)|\s*}[\t ]*$)/
    : /^(?:\s*;[\t ]*(?:\r?\n|$)|[\t ]*$)/;
  return terminal.test(suffix) && wrongArcMember(body);
}

function wrongArcMember(body: string): boolean {
  const members = [...body.matchAll(/(?:^|,)\s*arc\s*:/gi)];
  if (members.length !== 1) return false;
  const start = (members[0].index ?? 0) + members[0][0].length;
  const value = /^\s*(\d+)\s*(?=,|$)/.exec(body.slice(start));
  return value !== null && value[1] !== "26";
}

function hasObjectOwner(content: string, index: number): boolean {
  let depth = 0;
  for (; index >= 0; index -= 1) {
    if (content[index] === "}") depth += 1;
    if (content[index] !== "{") continue;
    if (depth > 0) {
      depth -= 1;
      continue;
    }
    const prefix = content.slice(0, index).trimEnd();
    return (
      /(?:^|[\r\n])[\t ]*(?:(?:export\s+)?(?:const|let|var)\s+[$\w]+|[$\w.]+)\s*=$/.test(
        prefix
      ) || /[$\w]+\s*:$/.test(prefix)
    );
  }
  return false;
}

function hasWrongYaml(content: string): boolean {
  for (const match of content.matchAll(/^[\t ]*cctpDomains\s*:\s*\{/gim)) {
    const start = (match.index ?? 0) + match[0].length;
    const end = content.indexOf("}", start);
    if (end < 0) continue;
    const body = content.slice(start, end);
    if (
      !/[{}[\]&*!?]/.test(body) &&
      /^[\t ]*(?:\r?\n|$)/.test(content.slice(end + 1)) &&
      wrongArcMember(body)
    ) {
      return true;
    }
  }

  const lines = content.split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    const header = /^(?<indent>[\t ]*)cctpDomains\s*:\s*$/i.exec(line);
    if (header === null) continue;
    const parentIndent = header.groups?.indent.length ?? 0;
    let childIndent: number | undefined;
    const arcMembers: string[] = [];
    for (const childLine of lines.slice(index + 1)) {
      if (childLine.trim() === "") continue;
      const indent = /^[\t ]*/.exec(childLine)?.[0].length ?? 0;
      if (indent <= parentIndent) break;
      childIndent ??= indent;
      if (indent === childIndent && /^\s*arc\s*:/i.test(childLine)) {
        arcMembers.push(childLine);
      }
    }
    if (arcMembers.length !== 1) continue;
    const value = /^\s*arc\s*:\s*(\d+)\s*$/i.exec(arcMembers[0]);
    if (value !== null && value[1] !== "26") return true;
  }
  return false;
}

function maskInert(content: string, yaml: boolean): string {
  const masked = content.split("");
  let quote: "'" | '"' | "`" | undefined;
  let block = false,
    comment = false;
  for (let index = 0; index < content.length; index += 1) {
    const character = content[index],
      next = content[index + 1];
    if (character === "\r" || character === "\n") {
      comment = false;
      continue;
    }
    if (comment || block || quote !== undefined) {
      masked[index] = " ";
      if (!yaml && block && character === "*" && next === "/") {
        masked[++index] = " ";
        block = false;
      } else if (quote === "'" && yaml && character === "'" && next === "'") {
        masked[++index] = " ";
      } else if (quote !== undefined && character === "\\" && next) {
        masked[++index] = " ";
      } else if (character === quote) quote = undefined;
      continue;
    }
    if (
      yaml &&
      character === "#" &&
      (index === 0 || /\s/.test(content[index - 1]))
    ) {
      masked[index] = " ";
      comment = true;
    } else if (!yaml && character === "/" && (next === "/" || next === "*")) {
      masked[index] = masked[++index] = " ";
      comment = next === "/";
      block = next === "*";
    } else if (
      character === "'" ||
      character === '"' ||
      (!yaml && character === "`")
    ) {
      masked[index] = " ";
      quote = character;
    }
  }
  return masked.join("");
}
