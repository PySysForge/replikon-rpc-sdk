# Changelog

All notable changes to `replikon-rpc-sdk` are documented here. This project follows
[Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.4.0] - 2026-06-22

### Added

- `client.useTrustedNodesFromGateway()` — discovers the gateway's live serving-node
  pubkey (via `/health`) and adds it to the trusted set, so `verify()` actually
  enforces the `nodeKnown` layer instead of skipping it.
- `client.trustedNodes` getter — inspect the currently trusted node pubkeys.

## [0.3.0] - 2026-06-22

### Added

- Automatic retries for transient failures (HTTP 429, 5xx, network errors) with
  exponential backoff + jitter; honors `Retry-After`. Configurable via `retries` /
  `retryBaseMs` (client) or `retries` per call. Defaults to 2 retries.
- `ReplikonRpcError.retryAfterMs` — server-advised wait parsed from `Retry-After`.

## [0.2.0] - 2026-06-22

### Added

- Request timeouts — pass `timeoutMs` to the client (or per call) to abort a slow
  gateway instead of hanging forever. A timeout throws `ReplikonRpcError` with
  `code === 408`.
- Cancellation — every read method and `call()` now accept an `AbortSignal` via
  `signal`, so in-flight requests can be cancelled. New `RequestControl` type.

## [0.1.2] - 2026-06-22

### Changed

- Docs: added the `$REPL` mint address to the README. No code changes.

## [0.1.1] - 2026-06-17

### Changed

- Docs: added status badges (npm, license, node, TypeScript, Solana, proof-of-serve,
  bundle) to the README. No code changes.

## [0.1.0] - 2026-06-16

### Added

- `ReplikonClient` — thin client over a Replikon gateway speaking the Solana read
  subset: `getSlot`, `getBalance`, `getAccountInfo`, `getMultipleAccounts`,
  `getTokenAccountsByOwner`, plus a low-level `call()` escape hatch.
- `verifyReceipt()` / `client.verify()` — offline proof-of-serve verification across
  four layers: signature, digest match, slot, and known-node membership.
- `canonical()` / `sha256Hex()` canonicalization primitives, shared with the backend
  signer (see `RECEIPT_FORMAT.md`).
