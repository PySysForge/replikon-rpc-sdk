import { ed25519 } from "@noble/curves/ed25519";
import { utf8ToBytes } from "@noble/hashes/utils";
import bs58 from "bs58";
import { canonical, sha256Hex } from "./canonical.js";
import type {
  Receipt,
  ReplikonResponse,
  VerifyResult,
} from "./types.js";

/**
 * Reconstruct the exact bytes a node signs for a receipt (see RECEIPT_FORMAT.md).
 * Must stay byte-identical to the backend signer.
 */
export function receiptSigningPayload(receipt: Receipt): Uint8Array {
  const { signature: _sig, ...rest } = receipt;
  return utf8ToBytes(canonical(rest));
}

/**
 * Independently verify a proof-of-serve receipt against the response it covers.
 * Pure and offline — no network. This is the heart of the SDK's trust story.
 *
 * @param receipt   the signed receipt returned alongside a read
 * @param response  the response envelope (provides `result` and `slot`)
 * @param knownNodes optional trusted node pubkeys; enables the `nodeKnown` layer
 */
export function verifyReceipt(
  receipt: Receipt,
  response: Pick<ReplikonResponse, "result" | "slot">,
  knownNodes?: string[],
): VerifyResult {
  let signature = false;
  try {
    const sig = bs58.decode(receipt.signature);
    const pub = bs58.decode(receipt.nodePubkey);
    signature = ed25519.verify(sig, receiptSigningPayload(receipt), pub);
  } catch {
    signature = false;
  }

  const digestMatch = safeEq(sha256Hex(response.result), receipt.resultDigest);

  const slot =
    Number.isInteger(receipt.slot) &&
    receipt.slot > 0 &&
    receipt.slot === response.slot;

  const nodeKnownSkipped = !knownNodes || knownNodes.length === 0;
  const nodeKnown = nodeKnownSkipped
    ? true
    : knownNodes!.includes(receipt.nodePubkey);

  return {
    valid: signature && digestMatch && slot && nodeKnown,
    checks: { signature, digestMatch, slot, nodeKnown },
    nodeKnownSkipped,
  };
}

/** Recompute the digest the receipt should carry for a given result. */
export function digestResult(result: unknown): string {
  return sha256Hex(result);
}

/** Constant-ish-time string compare (length-leaking is fine for hex digests). */
function safeEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Re-export so backend tests / advanced callers can reuse the primitives.
export { canonical, sha256Hex };
