import { describe, it, expect } from "vitest";
import { ReplikonClient } from "../src/index.js";

/** A fetch stub that resolves to a valid Replikon envelope. */
function okFetch(result: unknown): typeof fetch {
  return (async () =>
    new Response(
      JSON.stringify({ jsonrpc: "2.0", id: 1, result, replikon: { slot: 7, commitment: "confirmed" } }),
      { status: 200, headers: { "content-type": "application/json" } },
    )) as unknown as typeof fetch;
}

/** A fetch stub that never resolves until its abort signal fires. */
function hangingFetch(): typeof fetch {
  return ((_url: unknown, init?: { signal?: AbortSignal }) =>
    new Promise((_resolve, reject) => {
      const sig = init?.signal;
      if (!sig) return;
      if (sig.aborted) reject(new DOMException("aborted", "AbortError"));
      else sig.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
    })) as unknown as typeof fetch;
}

describe("request timeout", () => {
  it("rejects with a 408 timeout error when the gateway is too slow", async () => {
    const c = new ReplikonClient({ endpoint: "http://gw", timeoutMs: 15, fetch: hangingFetch() });
    await expect(c.getSlot()).rejects.toMatchObject({ name: "ReplikonRpcError", code: 408 });
  });

  it("lets a per-call timeoutMs override the client default", async () => {
    const c = new ReplikonClient({ endpoint: "http://gw", timeoutMs: 10_000, fetch: hangingFetch() });
    await expect(c.getBalance("addr", { timeoutMs: 15 })).rejects.toThrow(/timed out/);
  });

  it("does not time out a fast response", async () => {
    const c = new ReplikonClient({ endpoint: "http://gw", timeoutMs: 1000, fetch: okFetch(123) });
    await expect(c.getSlot()).resolves.toMatchObject({ result: 123 });
  });
});

describe("cancellation", () => {
  it("propagates an external AbortSignal (not as a timeout)", async () => {
    const c = new ReplikonClient({ endpoint: "http://gw", fetch: hangingFetch() });
    const ac = new AbortController();
    const p = c.getSlot({ signal: ac.signal });
    ac.abort();
    await expect(p).rejects.toMatchObject({ name: "AbortError" });
  });
});
