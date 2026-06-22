import { verifyReceipt } from "./receipt.js";
import {
  type Commitment,
  type ReplikonClientOptions,
  type ReplikonResponse,
  type RequestControl,
  type VerifyResult,
  ReplikonRpcError,
} from "./types.js";

interface JsonRpcEnvelope {
  jsonrpc: "2.0";
  id: number | string;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
  /** Replikon extension: freshness + proof-of-serve, ignored by stock clients. */
  replikon?: {
    slot: number;
    commitment: Commitment;
    receipt?: ReplikonResponse["receipt"];
  };
}

/**
 * Thin client over a Replikon gateway. Speaks standard Solana JSON-RPC and surfaces
 * the Replikon freshness + receipt extension on every read.
 *
 * @example
 * const repl = new ReplikonClient({ endpoint: "https://gateway.replikon.xyz" });
 * const { result, receipt } = await repl.getBalance("<address>");
 * if (receipt) console.log(repl.verify(receipt, { result, slot }).valid);
 */
export class ReplikonClient {
  private readonly endpoint: string;
  private readonly apiKey?: string;
  private knownNodes?: string[];
  private readonly fetchImpl: typeof fetch;
  private readonly defaultCommitment?: Commitment;
  private readonly timeoutMs?: number;
  private readonly retries: number;
  private readonly retryBaseMs: number;
  private idCounter = 0;

  constructor(opts: ReplikonClientOptions) {
    if (!opts?.endpoint) throw new Error("ReplikonClient: `endpoint` is required");
    this.endpoint = opts.endpoint.replace(/\/+$/, "");
    this.apiKey = opts.apiKey;
    this.knownNodes = opts.knownNodes;
    this.defaultCommitment = opts.commitment;
    this.timeoutMs = opts.timeoutMs;
    this.retries = opts.retries ?? 2;
    this.retryBaseMs = opts.retryBaseMs ?? 300;
    const f = opts.fetch ?? globalThis.fetch;
    if (!f) {
      throw new Error(
        "ReplikonClient: no fetch implementation available; pass `fetch` in options",
      );
    }
    this.fetchImpl = f.bind(globalThis);
  }

  /** The node pubkeys currently trusted by `verify()`'s `nodeKnown` layer. */
  get trustedNodes(): readonly string[] {
    return this.knownNodes ?? [];
  }

  /**
   * Low-level JSON-RPC call returning the full Replikon envelope.
   * Transient failures (HTTP 429, 5xx, network) are retried; pass `control` to set a
   * per-request `signal` (cancellation), `timeoutMs`, or `retries`.
   */
  async call<T = unknown>(
    method: string,
    params: unknown[] = [],
    control?: RequestControl,
  ): Promise<ReplikonResponse<T>> {
    return this.runWithRetry(() => this.attemptCall<T>(method, params, control), control);
  }

  /**
   * Discover the gateway's live serving-node key and add it to the trusted set, so
   * `verify()` actually enforces the `nodeKnown` layer (skipped until a node set exists).
   * Returns the resulting trusted-node list. The simulated mesh nodes never sign real
   * answers, so they are intentionally excluded — only the real `/health` signer is added.
   */
  async useTrustedNodesFromGateway(control?: RequestControl): Promise<string[]> {
    return this.runWithRetry(async () => {
      const pubkey = await this.fetchHealthPubkey(control);
      if (pubkey) {
        this.knownNodes = [...new Set([...(this.knownNodes ?? []), pubkey])];
      }
      return this.knownNodes ?? [];
    }, control);
  }

  /** Verify a receipt locally against its response (offline). */
  verify(
    receipt: NonNullable<ReplikonResponse["receipt"]>,
    response: Pick<ReplikonResponse, "result" | "slot">,
  ): VerifyResult {
    return verifyReceipt(receipt, response, this.knownNodes);
  }

  // ---- Solana read subset (TZ scope) -------------------------------------

  getSlot(opts?: { commitment?: Commitment } & RequestControl): Promise<ReplikonResponse<number>> {
    const { signal, timeoutMs, retries, ...rpc } = opts ?? {};
    return this.call<number>("getSlot", [this.cfg(rpc)], { signal, timeoutMs, retries });
  }

  getBalance(
    address: string,
    opts?: { commitment?: Commitment } & RequestControl,
  ): Promise<ReplikonResponse<{ context: { slot: number }; value: number }>> {
    const { signal, timeoutMs, retries, ...rpc } = opts ?? {};
    return this.call("getBalance", [address, this.cfg(rpc)], { signal, timeoutMs, retries });
  }

  getAccountInfo(
    address: string,
    opts?: { commitment?: Commitment; encoding?: string } & RequestControl,
  ): Promise<ReplikonResponse> {
    const { signal, timeoutMs, retries, ...rpc } = opts ?? {};
    return this.call(
      "getAccountInfo",
      [address, this.cfg({ encoding: "base64", ...rpc })],
      { signal, timeoutMs, retries },
    );
  }

  getMultipleAccounts(
    addresses: string[],
    opts?: { commitment?: Commitment; encoding?: string } & RequestControl,
  ): Promise<ReplikonResponse> {
    const { signal, timeoutMs, retries, ...rpc } = opts ?? {};
    return this.call(
      "getMultipleAccounts",
      [addresses, this.cfg({ encoding: "base64", ...rpc })],
      { signal, timeoutMs, retries },
    );
  }

  getTokenAccountsByOwner(
    owner: string,
    filter: { mint: string } | { programId: string },
    opts?: { commitment?: Commitment; encoding?: string } & RequestControl,
  ): Promise<ReplikonResponse> {
    const { signal, timeoutMs, retries, ...rpc } = opts ?? {};
    return this.call(
      "getTokenAccountsByOwner",
      [owner, filter, this.cfg({ encoding: "jsonParsed", ...rpc })],
      { signal, timeoutMs, retries },
    );
  }

  // ---- internals ---------------------------------------------------------

  /** Run `fn`, retrying transient failures with backoff (shared by call + discovery). */
  private async runWithRetry<T>(fn: () => Promise<T>, control?: RequestControl): Promise<T> {
    const retries = control?.retries ?? this.retries;
    const external = control?.signal;
    let attempt = 0;
    for (;;) {
      try {
        return await fn();
      } catch (err) {
        if (external?.aborted || attempt >= retries || !isRetryable(err)) throw err;
        await sleep(retryAfterMsOf(err) ?? backoffMs(attempt, this.retryBaseMs), external);
        attempt++;
      }
    }
  }

  /** A single JSON-RPC attempt (no retries) with timeout + cancellation. */
  private async attemptCall<T>(
    method: string,
    params: unknown[],
    control?: RequestControl,
  ): Promise<ReplikonResponse<T>> {
    const id = ++this.idCounter;
    const headers: Record<string, string> = {
      "content-type": "application/json",
    };
    if (this.apiKey) headers["x-api-key"] = this.apiKey;

    const timeoutMs = control?.timeoutMs ?? this.timeoutMs;
    const deadline = armTimeout(control?.signal, timeoutMs);

    try {
      const res = await this.fetchImpl(this.endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
        signal: deadline.signal,
      });

      if (!res.ok) {
        const err = new ReplikonRpcError(
          `Replikon gateway HTTP ${res.status}`,
          res.status,
          await safeText(res),
        );
        err.retryAfterMs = parseRetryAfter(res.headers.get("retry-after"));
        throw err;
      }

      const body = (await res.json()) as JsonRpcEnvelope;
      if (body.error) {
        throw new ReplikonRpcError(body.error.message, body.error.code, body.error.data);
      }

      const ext = body.replikon;
      return {
        result: body.result as T,
        slot: ext?.slot ?? extractSlot(body.result) ?? 0,
        commitment: ext?.commitment ?? this.defaultCommitment ?? "confirmed",
        receipt: ext?.receipt,
        raw: body,
      };
    } catch (err) {
      // Our own timeout fired — surface a clear, typed error rather than a bare AbortError.
      // (An external `signal` abort is rethrown as-is so the caller's cancellation propagates.)
      if (deadline.timedOut()) {
        throw new ReplikonRpcError(`Replikon request timed out after ${timeoutMs}ms`, 408);
      }
      throw err;
    } finally {
      deadline.clear();
    }
  }

  /** GET the gateway's /health and return its serving-node pubkey (with timeout/cancel). */
  private async fetchHealthPubkey(control?: RequestControl): Promise<string | undefined> {
    const timeoutMs = control?.timeoutMs ?? this.timeoutMs;
    const deadline = armTimeout(control?.signal, timeoutMs);
    try {
      const res = await this.fetchImpl(`${this.endpoint}/health`, {
        method: "GET",
        headers: { accept: "application/json" },
        signal: deadline.signal,
      });
      if (!res.ok) {
        const err = new ReplikonRpcError(
          `Replikon gateway HTTP ${res.status}`,
          res.status,
          await safeText(res),
        );
        err.retryAfterMs = parseRetryAfter(res.headers.get("retry-after"));
        throw err;
      }
      const body = (await res.json()) as { pubkey?: string };
      return typeof body?.pubkey === "string" ? body.pubkey : undefined;
    } catch (err) {
      if (deadline.timedOut()) {
        throw new ReplikonRpcError(`Replikon request timed out after ${timeoutMs}ms`, 408);
      }
      throw err;
    } finally {
      deadline.clear();
    }
  }

  private cfg<T extends object>(opts?: T): T & { commitment?: Commitment } {
    const commitment = (opts as { commitment?: Commitment })?.commitment ??
      this.defaultCommitment;
    return { ...(opts as T), ...(commitment ? { commitment } : {}) };
  }
}

/** Transient failures worth retrying for an idempotent read. */
function isRetryable(err: unknown): boolean {
  if (err instanceof ReplikonRpcError) {
    return err.code === 429 || (err.code >= 500 && err.code <= 599);
  }
  // Network-level errors (fetch rejected). Not our timeout/abort (already typed above).
  return (err as { name?: string })?.name !== "AbortError";
}

function retryAfterMsOf(err: unknown): number | undefined {
  return err instanceof ReplikonRpcError ? err.retryAfterMs : undefined;
}

/** Exponential backoff with full jitter, capped at 10s. */
function backoffMs(attempt: number, base: number): number {
  const exp = Math.min(base * 2 ** attempt, 10_000);
  return exp / 2 + Math.random() * (exp / 2);
}

/** Parse a `Retry-After` header: delta-seconds or an HTTP date. */
function parseRetryAfter(header: string | null): number | undefined {
  if (!header) return undefined;
  const secs = Number(header);
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
  const dateMs = Date.parse(header);
  if (Number.isFinite(dateMs)) return Math.max(0, dateMs - Date.now());
  return undefined;
}

/** Resolve after `ms`, or reject early if `signal` aborts. */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason ?? new DOMException("aborted", "AbortError"));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    if (signal) {
      if (signal.aborted) return onAbort();
      signal.addEventListener("abort", onAbort, { once: true });
    }
  });
}

/**
 * Combine an optional external abort signal with an optional timeout into one signal.
 * Returns the signal to pass to fetch, a `timedOut()` probe (true only when OUR timer
 * fired, not when the caller aborted), and a `clear()` to release the timer/listener.
 */
function armTimeout(
  external: AbortSignal | undefined,
  timeoutMs: number | undefined,
): { signal: AbortSignal | undefined; timedOut: () => boolean; clear: () => void } {
  if (!timeoutMs || timeoutMs <= 0) {
    return { signal: external, timedOut: () => false, clear: () => {} };
  }
  const ctl = new AbortController();
  let timedOut = false;
  const onExternalAbort = () => ctl.abort();
  if (external) {
    if (external.aborted) ctl.abort();
    else external.addEventListener("abort", onExternalAbort, { once: true });
  }
  const timer = setTimeout(() => {
    timedOut = true;
    ctl.abort();
  }, timeoutMs);
  return {
    signal: ctl.signal,
    timedOut: () => timedOut,
    clear: () => {
      clearTimeout(timer);
      external?.removeEventListener("abort", onExternalAbort);
    },
  };
}

function extractSlot(result: unknown): number | undefined {
  if (typeof result === "number") return result;
  if (result && typeof result === "object" && "context" in result) {
    const ctx = (result as { context?: { slot?: number } }).context;
    if (ctx && typeof ctx.slot === "number") return ctx.slot;
  }
  return undefined;
}

async function safeText(res: Response): Promise<string | undefined> {
  try {
    return await res.text();
  } catch {
    return undefined;
  }
}
