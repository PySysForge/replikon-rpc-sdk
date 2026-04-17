import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils";

/**
 * Deterministic JSON serialization with recursively sorted object keys.
 *
 * This is the single source of truth for canonicalization (see RECEIPT_FORMAT.md).
 * The backend signer MUST produce byte-identical output for the same value, so keep
 * this implementation dependency-free and stable.
 *
 * - Object keys are sorted lexicographically at every depth.
 * - Arrays preserve order.
 * - `undefined` object properties are dropped (matching JSON.stringify).
 * - `undefined` array elements and function/symbol values become `null`.
 */
export function canonical(value: unknown): string {
  return serialize(value);
}

function serialize(value: unknown): string {
  if (value === null) return "null";

  const t = typeof value;
  if (t === "number") {
    if (!Number.isFinite(value as number)) return "null";
    return String(value);
  }
  if (t === "bigint") return (value as bigint).toString();
  if (t === "boolean") return value ? "true" : "false";
  if (t === "string") return JSON.stringify(value);
  if (t === "undefined" || t === "function" || t === "symbol") return "null";

  if (Array.isArray(value)) {
    return "[" + value.map((v) => serialize(v)).join(",") + "]";
  }

  // Plain object: sort keys, drop undefined-valued properties.
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  const parts: string[] = [];
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "undefined") continue;
    parts.push(JSON.stringify(k) + ":" + serialize(v));
  }
  return "{" + parts.join(",") + "}";
}

/** Lowercase hex sha256 of the canonical serialization of `value`. */
export function sha256Hex(value: unknown): string {
  return bytesToHex(sha256(utf8ToBytes(canonical(value))));
}
