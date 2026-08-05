import { describe, expect, it } from "vitest";

import {
  C08_R3_CASES,
  C08_R3_ERRATA
} from "../../../docs/research/fixtures/c08-r3-corpus.mjs";
import { classifyC08R3Source } from "./c08-r3-attestation-prototype.mjs";

function filePathFor(caseId) {
  if (caseId === "R2-S08") return "fixture.js";
  if (caseId === "R2-X26") return "fixture.tsx";
  return "fixture.ts";
}

function replaceExactlyOnce(source, from, to) {
  const first = source.indexOf(from);
  const last = source.lastIndexOf(from);
  if (first < 0 || first !== last) {
    throw new Error(`Expected exactly one adversarial replacement: ${from}`);
  }
  return source.slice(0, first) + to + source.slice(first + from.length);
}

const SAFE_ANCHOR = C08_R3_CASES.find((entry) => entry.id === "R2-A01")?.source;
if (SAFE_ANCHOR === undefined) throw new Error("Missing C08-R3 safe anchor");

const SAFE_404_BRANCH = `    if (response.status === 404) {
      await new Promise((resolve) => setTimeout(resolve, 5_000));
      continue;
    }`;
const SAFE_COMPLETE_BRANCH = `    if (message.status === "complete" && message.attestation) {
      return message;
    }`;
const SAFE_MESSAGE_BINDING = "    const message = body.messages[0];";
const SAFE_FOR_CONDITION = "attempt < MAX_ATTEMPTS";
const SAFE_POLL_SIGNATURE =
  "async function pollArcAttestation(transactionHash: string) {";
const SAFE_FINAL_REFERENCE = "void pollArcAttestation;";

describe("C08-R3 disposable control-flow prototype", () => {
  it.each(C08_R3_CASES)(
    "$id matches the pinned C08-R2 classification with explicit R3 errata",
    (entry) => {
      const actual = classifyC08R3Source(filePathFor(entry.id), entry.source);

      expect(actual.controlFlowClass).toBe(entry.controlFlowClass);
      expect(actual.publicFindingEligibility).toBe(
        entry.publicFindingEligibility
      );
    }
  );

  it("records exactly one transparent corpus erratum", () => {
    expect(C08_R3_ERRATA).toEqual([
      expect.objectContaining({
        id: "R2-X25",
        reason: "optional-semicolon-is-valid"
      })
    ]);
  });

  it("classifies a wrong complete return as unsafe", () => {
    const source = replaceExactlyOnce(
      SAFE_ANCHOR,
      SAFE_COMPLETE_BRANCH,
      `    if (message.status === "complete" && message.attestation) {
      return null;
    }`
    );
    expect(classifyC08R3Source("fixture.ts", source)).toEqual(
      expect.objectContaining({
        controlFlowClass: "unsafe-candidate",
        publicFindingEligibility: "blocked-unvalidated-burn"
      })
    );
  });

  it("fails closed on duplicate owned 404 branches", () => {
    const source = replaceExactlyOnce(
      SAFE_ANCHOR,
      SAFE_404_BRANCH,
      `${SAFE_404_BRANCH}

    if (response.status === 404) {
      throw new Error("Conflicting duplicate 404 branch");
    }`
    );
    expect(classifyC08R3Source("fixture.ts", source).controlFlowClass).toBe(
      "unsupported"
    );
  });

  it("fails closed on duplicate owned complete branches", () => {
    const source = replaceExactlyOnce(
      SAFE_ANCHOR,
      SAFE_COMPLETE_BRANCH,
      `${SAFE_COMPLETE_BRANCH}

    if (message.status === "complete" && message.attestation) {
      return null;
    }`
    );
    expect(classifyC08R3Source("fixture.ts", source).controlFlowClass).toBe(
      "unsupported"
    );
  });

  it("fails closed on a deceptive Iris-host substring", () => {
    const source = replaceExactlyOnce(
      SAFE_ANCHOR,
      "https://iris-api-sandbox.circle.com",
      "https://evil.example/iris-api-sandbox.circle.com"
    );
    expect(classifyC08R3Source("fixture.ts", source).controlFlowClass).toBe(
      "unsupported"
    );
  });

  it("fails closed on an unbounded compound attempt condition", () => {
    const source = replaceExactlyOnce(
      SAFE_ANCHOR,
      SAFE_FOR_CONDITION,
      `${SAFE_FOR_CONDITION} || true`
    );
    expect(classifyC08R3Source("fixture.ts", source).controlFlowClass).toBe(
      "unsupported"
    );
  });

  it("fails closed on crossed message ownership", () => {
    const source = replaceExactlyOnce(
      SAFE_ANCHOR,
      SAFE_MESSAGE_BINDING,
      "    const message = other.messages[0];"
    );
    expect(classifyC08R3Source("fixture.ts", source).controlFlowClass).toBe(
      "unsupported"
    );
  });

  it("fails closed when top-level code shadows global fetch", () => {
    const source = `const fetch = async () => new Response();\n${SAFE_ANCHOR}`;
    expect(classifyC08R3Source("fixture.ts", source).controlFlowClass).toBe(
      "unsupported"
    );
  });

  it("fails closed on a nested poll helper", () => {
    const source = replaceExactlyOnce(
      replaceExactlyOnce(
        SAFE_ANCHOR,
        SAFE_POLL_SIGNATURE,
        `function outer() {\n  ${SAFE_POLL_SIGNATURE}`
      ),
      SAFE_FINAL_REFERENCE,
      `  ${SAFE_FINAL_REFERENCE}\n}\nvoid outer;`
    );
    expect(classifyC08R3Source("fixture.ts", source).controlFlowClass).toBe(
      "unsupported"
    );
  });

  it("classifies a zero-millisecond 404 retry as unsafe", () => {
    const zeroDelayBranch = SAFE_404_BRANCH.replace("5_000", "0");
    const source = replaceExactlyOnce(
      SAFE_ANCHOR,
      SAFE_404_BRANCH,
      zeroDelayBranch
    );
    expect(classifyC08R3Source("fixture.ts", source)).toEqual(
      expect.objectContaining({
        controlFlowClass: "unsafe-candidate",
        publicFindingEligibility: "blocked-unvalidated-burn"
      })
    );
  });

  it("fails closed when combined and separate status branches coexist", () => {
    const combinedBranch = `    if (
      response.status === 404 ||
      response.status === 429
    ) {
      await new Promise((resolve) => setTimeout(resolve, 5_000));
      continue;
    }`;
    const source = replaceExactlyOnce(
      SAFE_ANCHOR,
      SAFE_404_BRANCH,
      `${combinedBranch}\n\n${SAFE_404_BRANCH}`
    );
    expect(classifyC08R3Source("fixture.ts", source).controlFlowClass).toBe(
      "unsupported"
    );
  });

  it("keeps every unsafe control-flow candidate blocked from public emission", () => {
    const unsafeResults = C08_R3_CASES.filter(
      (entry) => entry.controlFlowClass === "unsafe-candidate"
    ).map((entry) => classifyC08R3Source(filePathFor(entry.id), entry.source));

    expect(unsafeResults).toHaveLength(11);
    expect(
      unsafeResults.every(
        (entry) => entry.publicFindingEligibility === "blocked-unvalidated-burn"
      )
    ).toBe(true);
  });
});
