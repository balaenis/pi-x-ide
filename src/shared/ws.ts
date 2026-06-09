import { Buffer } from "node:buffer";
import type { RawData } from "ws";

export function decodeRawData(raw: RawData): string {
  if (Array.isArray(raw)) return Buffer.concat(raw).toString("utf8");
  if (Buffer.isBuffer(raw)) return raw.toString("utf8");
  return Buffer.from(raw).toString("utf8");
}
