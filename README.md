# replikon-rpc-sdk

<p>
  <a href="https://www.npmjs.com/package/replikon-rpc-sdk"><img src="https://img.shields.io/npm/v/replikon-rpc-sdk?style=flat-square&color=CB3837&label=npm&logo=npm&logoColor=white" alt="npm version"></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue?style=flat-square" alt="license"></a>
  <img src="https://img.shields.io/badge/node-%3E%3D18-3C873A?style=flat-square&logo=node.js&logoColor=white" alt="node >=18">
  <img src="https://img.shields.io/badge/types-TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white" alt="typescript">
  <img src="https://img.shields.io/badge/Solana-mainnet--beta-9945FF?style=flat-square&logo=solana&logoColor=white" alt="solana">
  <img src="https://img.shields.io/badge/proof--of--serve-ed25519-5B5BD6?style=flat-square" alt="proof-of-serve ed25519">
  <img src="https://img.shields.io/badge/bundle-ESM%20%2B%20CJS-F7DF1E?style=flat-square" alt="ESM + CJS">
</p>

Thin TypeScript client for **Replikon** — the read-RPC network for Solana — with
**local proof-of-serve receipt verification**. Every read can return a node-signed
receipt that you verify yourself, offline, without trusting the gateway.

> `$REPL` is a utility/access token. Holding $REPL raises your rate-limit tier on the
> Replikon endpoint and SDK. It is not an investment and confers no yield.

## Install

```bash
npm install replikon-rpc-sdk
```

## Quickstart (3 lines)

```ts
import { ReplikonClient } from "replikon-rpc-sdk";

const repl = new ReplikonClient({ endpoint: "https://gateway.replikon.xyz" });
const { result, receipt } = await repl.getBalance("So11111111111111111111111111111111111111112");
```

## Verify a receipt

```ts
const { result, slot, receipt } = await repl.getAccountInfo(address);

if (receipt) {
  const { valid, checks } = repl.verify(receipt, { result, slot });
  // checks => { signature, digestMatch, slot, nodeKnown }
  console.log(valid ? "✓ verified" : "✗ rejected", checks);
}
```

`verify()` runs four independent layers (see [RECEIPT_FORMAT.md](./RECEIPT_FORMAT.md)):

| layer         | what it proves                                                  |
|---------------|----------------------------------------------------------------|
| `signature`   | the node really signed this exact answer with its registered key |
| `digestMatch` | the answer you received is the one the node signed              |
| `slot`        | the freshness watermark is consistent and positive             |
| `nodeKnown`   | the signer is in your trusted node set (if you supply one)      |

Pass trusted nodes to enable the `nodeKnown` layer:

```ts
const repl = new ReplikonClient({
  endpoint: "https://gateway.replikon.xyz",
  knownNodes: ["<base58 node pubkey>"],
  apiKey: process.env.REPLIKON_API_KEY, // optional; raises your tier per $REPL hold
});
```

## Supported methods

Read subset of the Solana JSON-RPC interface:

- `getSlot`
- `getBalance`
- `getAccountInfo`
- `getMultipleAccounts`
- `getTokenAccountsByOwner`

Need a method that isn't wrapped? Use the low-level escape hatch:

```ts
const { result, receipt } = await repl.call("getSignaturesForAddress", [address, { limit: 10 }]);
```

## Standalone verification

`verifyReceipt` is pure and has no network dependency, so you can verify receipts
captured anywhere:

```ts
import { verifyReceipt } from "replikon-rpc-sdk";
const { valid } = verifyReceipt(receipt, { result, slot }, knownNodes);
```

## License

MIT
