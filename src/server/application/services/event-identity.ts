import { createHash } from "node:crypto";
import type { JsonValue } from "../../domain/persistence-model";

export function canonicalJson(value: JsonValue): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
export function eventDigest(event: JsonValue) { return createHash("sha256").update(canonicalJson(event)).digest("hex"); }

