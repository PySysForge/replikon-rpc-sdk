import { verifyReceipt } from "./receipt.js";
import {
  type Commitment,
  type ReplikonClientOptions,
  type ReplikonResponse,
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
  private readonly knownNodes?: string[];
  private readonly fetchImpl: typeof fetch;
  private readonly defaultCommitment?: Commitment;
  private idCounter = 0;

  constructor(opts: ReplikonClientOptions) {
    if (!opts?.endpoint) throw new Error("ReplikonClient: `endpoint` is required");
    this.endpoint = opts.endpoint.replace(/\/+$/, "");
    this.apiKey = opts.apiKey;
    this.knownNodes = opts.knownNodes;
    this.defaultCommitment = opts.commitment;
    const f = opts.fetch ?? globalThis.fetch;
    if (!f) {
      throw new Error(
        "ReplikonClient: no fetch implementation available; pass `fetch` in options",
      );
    }
    this.fetchImpl = f.bind(globalThis);
  }

  /** Low-level JSON-RPC call returning the full Replikon envelope. */
  async call<T = unknown>(
    method: string,
    params: unknown[] = [],
  ): Promise<ReplikonResponse<T>> {
    const id = ++this.idCounter;
    const headers: Record<string, string> = {
      "content-type": "application/json",
    };
    if (this.apiKey) headers["x-api-key"] = this.apiKey;

    const res = await this.fetchImpl(this.endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
    });

    if (!res.ok) {
      throw new ReplikonRpcError(
        `Replikon gateway HTTP ${res.status}`,
        res.status,
        await safeText(res),
      );
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
  }

  /** Verify a receipt locally against its response (offline). */
  verify(
    receipt: NonNullable<ReplikonResponse["receipt"]>,
    response: Pick<ReplikonResponse, "result" | "slot">,
  ): VerifyResult {
    return verifyReceipt(receipt, response, this.knownNodes);
  }

  // ---- Solana read subset (TZ scope) -------------------------------------

  getSlot(opts?: { commitment?: Commitment }): Promise<ReplikonResponse<number>> {
    return this.call<number>("getSlot", [this.cfg(opts)]);
  }

  getBalance(
    address: string,
    opts?: { commitment?: Commitment },
  ): Promise<ReplikonResponse<{ context: { slot: number }; value: number }>> {
    return this.call("getBalance", [address, this.cfg(opts)]);
  }

  getAccountInfo(
    address: string,
    opts?: { commitment?: Commitment; encoding?: string },
  ): Promise<ReplikonResponse> {
    return this.call("getAccountInfo", [
      address,
      this.cfg({ encoding: "base64", ...opts }),
    ]);
  }

  getMultipleAccounts(
    addresses: string[],
    opts?: { commitment?: Commitment; encoding?: string },
  ): Promise<ReplikonResponse> {
    return this.call("getMultipleAccounts", [
      addresses,
      this.cfg({ encoding: "base64", ...opts }),
    ]);
  }

  getTokenAccountsByOwner(
    owner: string,
    filter: { mint: string } | { programId: string },
    opts?: { commitment?: Commitment; encoding?: string },
  ): Promise<ReplikonResponse> {
    return this.call("getTokenAccountsByOwner", [
      owner,
      filter,
      this.cfg({ encoding: "jsonParsed", ...opts }),
    ]);
  }

  private cfg<T extends object>(opts?: T): T & { commitment?: Commitment } {
    const commitment = (opts as { commitment?: Commitment })?.commitment ??
      this.defaultCommitment;
    return { ...(opts as T), ...(commitment ? { commitment } : {}) };
  }
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
