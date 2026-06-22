/** Solana commitment levels, mapped from a node's freshness watermark. */
export type Commitment = "processed" | "confirmed" | "finalized";

/**
 * Signed proof-of-serve receipt. Canonical format documented in RECEIPT_FORMAT.md.
 * The backend read-node produces these; the SDK verifies them locally.
 */
export interface Receipt {
  version: 1;
  /** base58 ed25519 public key of the serving node. */
  nodePubkey: string;
  /** Solana JSON-RPC method that was served. */
  method: string;
  /** hex sha256 of canonical(params). */
  paramsHash: string;
  /** hex sha256 of canonical(result). */
  resultDigest: string;
  /** Freshness watermark the answer was true at. */
  slot: number;
  commitment: Commitment;
  /** unix ms when the receipt was signed (informational). */
  timestamp: number;
  /** base58 ed25519 signature over the signing payload. */
  signature: string;
}

/** Envelope returned by every Replikon SDK read method. */
export interface ReplikonResponse<T = unknown> {
  /** Raw Solana JSON-RPC result. */
  result: T;
  /** Freshness watermark the answer was true at. */
  slot: number;
  commitment: Commitment;
  /** Signed proof-of-serve receipt for this answer (if the gateway returned one). */
  receipt?: Receipt;
  /** The unmodified JSON-RPC envelope, for advanced callers. */
  raw: unknown;
}

/** Per-check breakdown returned by verifyReceipt — the "4 layers" UI surface. */
export interface ReceiptChecks {
  /** ed25519 signature verifies against the receipt's nodePubkey. */
  signature: boolean;
  /** Recomputed result digest matches the receipt. */
  digestMatch: boolean;
  /** Receipt slot is a positive integer and matches the response slot. */
  slot: boolean;
  /** Node pubkey is in the supplied knownNodes set (true if no set supplied). */
  nodeKnown: boolean;
}

export interface VerifyResult {
  valid: boolean;
  checks: ReceiptChecks;
  /** True when no knownNodes set was supplied, so `nodeKnown` was not actually enforced. */
  nodeKnownSkipped: boolean;
}

/** Per-request transport controls, accepted by every read method and `call()`. */
export interface RequestControl {
  /** Abort the request with an AbortSignal (e.g. an AbortController or AbortSignal.timeout). */
  signal?: AbortSignal;
  /** Per-request timeout in milliseconds; overrides the client-level `timeoutMs`. */
  timeoutMs?: number;
  /** Max retry attempts for this request; overrides the client-level `retries`. */
  retries?: number;
}

export interface ReplikonClientOptions {
  /** Gateway base URL, e.g. https://gateway.replikon.xyz */
  endpoint: string;
  /** Optional API key; raises your rate-limit tier per $REPL holdings. */
  apiKey?: string;
  /** Optional set of trusted node pubkeys for the nodeKnown verification layer. */
  knownNodes?: string[];
  /** Custom fetch implementation (defaults to global fetch). */
  fetch?: typeof fetch;
  /** Default commitment for requests that don't specify one. */
  commitment?: Commitment;
  /** Abort any request that takes longer than this many ms (default: no timeout). */
  timeoutMs?: number;
  /**
   * Retry transient failures (HTTP 429, 5xx, and network errors) this many times.
   * Reads are idempotent, so this is safe. Default: 2 (i.e. up to 3 attempts).
   */
  retries?: number;
  /** Base backoff in ms for retries; grows exponentially with jitter. Default: 300. */
  retryBaseMs?: number;
}

export class ReplikonRpcError extends Error {
  code: number;
  data?: unknown;
  /** Server-advised wait before retrying, parsed from a `Retry-After` header (ms). */
  retryAfterMs?: number;
  constructor(message: string, code: number, data?: unknown) {
    super(message);
    this.name = "ReplikonRpcError";
    this.code = code;
    this.data = data;
  }
}
