# Changelog

All notable changes to `replikon-rpc-sdk` are documented here. This project follows
[Semantic Versioning](https://semver.org/).

## [Unreleased]

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
