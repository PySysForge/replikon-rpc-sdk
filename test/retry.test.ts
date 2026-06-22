import { describe, it, expect } from "vitest";
import { ReplikonClient } from "../src/index.js";

function envelope(result: unknown): Response {
  return new Response(
    JSON.stringify({ jsonrpc: "2.0", id: 1, result, replikon: { slot: 1, commitment: "confirmed" } }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

describe("retries", () => {
  it("retries a transient network error, then succeeds", async () => {
    let n = 0;
    const fetchImpl = (async () => {
      n++;
      if (n < 3) throw new TypeError("network down");
      return envelope(42);
    }) as unknown as typeof fetch;
    const c = new ReplikonClient({ endpoint: "http://gw", retryBaseMs: 1, fetch: fetchImpl });
    await expect(c.getSlot()).resolves.toMatchObject({ result: 42 });
    expect(n).toBe(3); // default 2 retries → 3 attempts
  });

  it("retries HTTP 429 honoring a numeric Retry-After", async () => {
    let n = 0;
    const fetchImpl = (async () => {
      n++;
      if (n === 1) return new Response("slow down", { status: 429, headers: { "retry-after": "0" } });
      return envelope(7);
    }) as unknown as typeof fetch;
    const c = new ReplikonClient({ endpoint: "http://gw", retryBaseMs: 1, fetch: fetchImpl });
    await expect(c.getSlot()).resolves.toMatchObject({ result: 7 });
    expect(n).toBe(2);
  });

  it("does not retry a permanent 400", async () => {
    let n = 0;
    const fetchImpl = (async () => {
      n++;
      return new Response("bad request", { status: 400 });
    }) as unknown as typeof fetch;
    const c = new ReplikonClient({ endpoint: "http://gw", retryBaseMs: 1, fetch: fetchImpl });
    await expect(c.getSlot()).rejects.toMatchObject({ name: "ReplikonRpcError", code: 400 });
    expect(n).toBe(1);
  });

  it("retries: 0 disables retrying", async () => {
    let n = 0;
    const fetchImpl = (async () => {
      n++;
      throw new TypeError("network down");
    }) as unknown as typeof fetch;
    const c = new ReplikonClient({ endpoint: "http://gw", retries: 0, fetch: fetchImpl });
    await expect(c.getSlot()).rejects.toBeTruthy();
    expect(n).toBe(1);
  });
});
