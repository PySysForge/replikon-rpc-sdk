import { describe, it, expect } from "vitest";
import { ed25519 } from "@noble/curves/ed25519";
import bs58 from "bs58";
import { ReplikonClient, receiptSigningPayload, sha256Hex, type Receipt } from "../src/index.js";

function makeReceipt(priv: Uint8Array, result: unknown, slot: number): Receipt {
  const unsigned = {
    version: 1 as const,
    nodePubkey: bs58.encode(ed25519.getPublicKey(priv)),
    method: "getSlot",
    paramsHash: sha256Hex([]),
    resultDigest: sha256Hex(result),
    slot,
    commitment: "confirmed" as const,
    timestamp: 1_750_000_000_000,
  };
  const sig = ed25519.sign(receiptSigningPayload(unsigned as Receipt), priv);
  return { ...unsigned, signature: bs58.encode(sig) };
}

/** A fetch stub answering GET /health with a serving-node pubkey. */
function healthFetch(pubkey: string): typeof fetch {
  return (async (url: unknown) => {
    if (String(url).endsWith("/health")) {
      return new Response(JSON.stringify({ ok: true, slot: 5, pubkey }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    throw new Error(`unexpected url ${String(url)}`);
  }) as unknown as typeof fetch;
}

const PRIV = ed25519.utils.randomPrivateKey();
const PUB = bs58.encode(ed25519.getPublicKey(PRIV));

describe("trusted-node auto-discovery", () => {
  it("adds the gateway's /health pubkey to the trusted set", async () => {
    const c = new ReplikonClient({ endpoint: "http://gw", fetch: healthFetch(PUB) });
    const nodes = await c.useTrustedNodesFromGateway();
    expect(nodes).toContain(PUB);
    expect(c.trustedNodes).toContain(PUB);
  });

  it("turns on the nodeKnown layer in verify() once discovered", async () => {
    const c = new ReplikonClient({ endpoint: "http://gw", fetch: healthFetch(PUB) });
    const result = 123;
    const slot = 5;
    const receipt = makeReceipt(PRIV, result, slot);

    expect(c.verify(receipt, { result, slot }).nodeKnownSkipped).toBe(true);

    await c.useTrustedNodesFromGateway();

    const v = c.verify(receipt, { result, slot });
    expect(v.nodeKnownSkipped).toBe(false);
    expect(v.checks.nodeKnown).toBe(true);
    expect(v.valid).toBe(true);
  });

  it("rejects a receipt from an unknown signer after discovery", async () => {
    const c = new ReplikonClient({ endpoint: "http://gw", fetch: healthFetch(PUB) });
    await c.useTrustedNodesFromGateway();

    const otherPriv = ed25519.utils.randomPrivateKey();
    const result = 1;
    const slot = 5;
    const receipt = makeReceipt(otherPriv, result, slot);

    const v = c.verify(receipt, { result, slot });
    expect(v.checks.nodeKnown).toBe(false);
    expect(v.valid).toBe(false);
  });
});
