import { db } from "@repo/database";
import { sql } from "drizzle-orm";
import type { StoredIdentity } from "./identity-restore";

interface Row {
  icao24: string | null;
  callsign: string | null;
  fused_ms: string | number | null;
  [column: string]: unknown;
}

/** Callsign terbaru per icao24 pada track yang tersimpan sejak `since` (memakai indeks fused_at). */
export async function fetchStoredIdentities(
  since: Date,
): Promise<StoredIdentity[]> {
  const result = await db.execute<Row>(sql`
    SELECT DISTINCT ON (lower(data->'identity'->>'icao24'))
      lower(data->'identity'->>'icao24') AS icao24,
      btrim(data->'identity'->>'callsign') AS callsign,
      (extract(epoch from fused_at) * 1000)::bigint AS fused_ms
    FROM aeroswarm_tracks
    WHERE fused_at >= ${since}
      AND coalesce(btrim(data->'identity'->>'callsign'), '') <> ''
      AND coalesce(data->'identity'->>'icao24', '') <> ''
    ORDER BY lower(data->'identity'->>'icao24'), fused_at DESC
  `);
  const out: StoredIdentity[] = [];
  for (const row of (result as unknown as { rows: Row[] }).rows) {
    if (!(row.icao24 && row.callsign)) continue;
    out.push({
      icao24: row.icao24,
      callsign: row.callsign,
      at: Number(row.fused_ms),
    });
  }
  return out;
}
