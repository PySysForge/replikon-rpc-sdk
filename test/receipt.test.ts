import { describe, it, expect } from "vitest";
import { ed25519 } from "@noble/curves/ed25519";
import { utf8ToBytes } from "@noble/hashes/utils";
import bs58 from "bs58";
import {
  verifyReceipt,
  canonical,
  sha256Hex,
  receiptSigningPayload,
  type Receipt,
} from "../src/index.js";

/** Build a valid signed receipt the way the backend node will. */
function signReceipt(
  priv: Uint8Array,
  method: string,
  params: unknown[],
  result: unknown,
  slot: number,
): Receipt {
  const pub = ed25519.getPublicKey(priv);
  const unsigned = {
    version: 1 as const,
    nodePubkey: bs58.encode(pub),
    method,
    paramsHash: sha256Hex(params),
    resultDigest: sha256Hex(result),
    slot,
    commitment: "confirmed" as const,
    timestamp: 1_750_000_000_000,
  };
  const sig = ed25519.sign(receiptSigningPayload(unsigned as Receipt), priv);
  return { ...unsigned, signature: bs58.encode(sig) };
}

const PRIV = ed25519.utils.randomPrivateKey();
const PUB = bs58.encode(ed25519.getPublicKey(PRIV));

describe("canonical", () => {
  it("sorts keys recursively and is order-independent", () => {
    expect(canonical({ b: 1, a: { d: 4, c: 3 } })).toBe('{"a":{"c":3,"d":4},"b":1}');
    expect(canonical({ a: 1, b: 2 })).toBe(canonical({ b: 2, a: 1 }));
  });
  it("preserves array order", () => {
    expect(canonical([3, 1, 2])).toBe("[3,1,2]");
  });
});

describe("verifyReceipt", () => {
  const result = { context: { slot: 100 }, value: 42 };
  const params = ["SoME11111111111111111111111111111111111111", { commitment: "confirmed" }];

  it("accepts a correctly signed receipt", () => {
    const r = signReceipt(PRIV, "getBalance", params, result, 100);
    const v = verifyReceipt(r, { result, slot: 100 });
    expect(v.valid).toBe(true);
    expect(v.checks).toEqual({
      signature: true,
      digestMatch: true,
      slot: true,
      nodeKnown: true,
    });
    expect(v.nodeKnownSkipped).toBe(true);
  });

  it("fails digestMatch when the result is tampered", () => {
    const r = signReceipt(PRIV, "getBalance", params, result, 100);
    const v = verifyReceipt(r, { result: { context: { slot: 100 }, value: 999 }, slot: 100 });
    expect(v.checks.digestMatch).toBe(false);
    expect(v.valid).toBe(false);
  });

  it("fails signature when the signature is forged", () => {
    const r = signReceipt(PRIV, "getBalance", params, result, 100);
    const forged = { ...r, signature: bs58.encode(new Uint8Array(64)) };
    const v = verifyReceipt(forged, { result, slot: 100 });
    expect(v.checks.signature).toBe(false);
  });

  it("fails signature when any signed field is mutated after signing", () => {
    const r = signReceipt(PRIV, "getBalance", params, result, 100);
    const mutated = { ...r, slot: 101 };
    // slot check also fails, but specifically the signature must break too.
    const v = verifyReceipt(mutated, { result, slot: 101 });
    expect(v.checks.signature).toBe(false);
  });

  it("fails slot when response slot disagrees with receipt", () => {
    const r = signReceipt(PRIV, "getBalance", params, result, 100);
    const v = verifyReceipt(r, { result, slot: 99 });
    expect(v.checks.slot).toBe(false);
  });

  it("enforces nodeKnown when a knownNodes set is supplied", () => {
    const r = signReceipt(PRIV, "getBalance", params, result, 100);
    expect(verifyReceipt(r, { result, slot: 100 }, [PUB]).checks.nodeKnown).toBe(true);
    const other = verifyReceipt(r, { result, slot: 100 }, ["NotThisNode111"]);
    expect(other.checks.nodeKnown).toBe(false);
    expect(other.nodeKnownSkipped).toBe(false);
    expect(other.valid).toBe(false);
  });

  it("signing payload excludes the signature field", () => {
    const r = signReceipt(PRIV, "getBalance", params, result, 100);
    const payload = new TextDecoder().decode(receiptSigningPayload(r));
    expect(payload).not.toContain("signature");
    expect(payload).toContain(PUB);
  });
});
