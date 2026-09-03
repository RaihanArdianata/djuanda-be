import { createHash } from "node:crypto";
export function buildMovementId(
  trackId: string,
  type: string,
  at: Date,
): string {
  const hash = createHash("sha1")
    .update(`${trackId}|${type}|${at.toISOString()}`)
    .digest("hex")
    .slice(0, 16);
  return `mvt_${hash}`;
}
