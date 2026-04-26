# Replikon Proof-of-Serve Receipt — Canonical Format (v1)

This document is the **contract** between the Replikon read-node (signer, in `backend/`)
and the SDK / any verifier (`sdk/`). Both sides must implement it identically. Changing
it is a breaking change — bump `version` and the SDK major.

## Why receipts exist

A receipt is a node's signed attestation that *it* returned a specific answer to a
specific query at a specific slot. It is the unit of reward accounting and the evidence
trail for disputes (TZ §6.3 / Technical Concept §6.3). A node that signs a receipt for a
false answer signs its own slashing evidence.

## Receipt object

```jsonc
{
  "version": 1,
  "nodePubkey": "<base58 ed25519 public key of the serving node>",
  "method": "getBalance",                 // Solana JSON-RPC method served
  "paramsHash": "<hex sha256 of canonical(params)>",
  "resultDigest": "<hex sha256 of canonical(result)>",
  "slot": 360123456,                       // freshness watermark the answer was true at
  "commitment": "confirmed",               // processed | confirmed | finalized
  "timestamp": 1750000000000,              // unix ms when signed (informational)
  "signature": "<base58 ed25519 signature over the signing payload>"
}
```

## Canonicalization

`canonical(x)` = deterministic JSON serialization with **recursively sorted object keys**,
no insignificant whitespace, UTF-8 encoded. Arrays preserve order. This is implemented
once in `src/canonical.ts` (SDK) and mirrored in the backend. `sha256` outputs lowercase
hex.

- `paramsHash = sha256hex(canonical(params))` where `params` is the JSON-RPC params array.
- `resultDigest = sha256hex(canonical(result))` where `result` is the raw Solana result.

## Signing payload

The bytes the node signs are the UTF-8 encoding of the canonical serialization of the
receipt **without** the `signature` field:

```
payload = canonical({
  version, nodePubkey, method, paramsHash, resultDigest, slot, commitment, timestamp
})
signature = base58( ed25519_sign(privkey, utf8(payload)) )
```

## Verification (`verifyReceipt(receipt, response)`)

Returns `{ valid, checks }` where `checks` has four independent booleans (TZ "4 layers
of verification" surface):

| check         | meaning                                                                 |
|---------------|-------------------------------------------------------------------------|
| `signature`   | ed25519 signature over the reconstructed payload verifies against `nodePubkey` |
| `digestMatch` | `sha256hex(canonical(response.result))` equals `receipt.resultDigest`    |
| `slot`        | `receipt.slot` is a positive integer and equals `response.slot`         |
| `nodeKnown`   | `receipt.nodePubkey` is in the caller-supplied `knownNodes` set (if none supplied, this is reported as `true` but the SDK exposes that the set was empty) |

`valid = signature && digestMatch && slot && nodeKnown`.
