import type { IdentityMemory } from "./identity-memory";

/** Seberapa jauh ke belakang callsign dipulihkan: sama dengan umur ingatan. */
export const DEFAULT_RESTORE_WINDOW_MS = 30 * 60_000;

export interface StoredIdentity {
  icao24: string;
  callsign: string;
  /** epoch ms track yang membawa callsign itu */
  at: number;
}

export interface RestoreIdentitiesResult {
  rows: number;
  restored: number;
}

/**
 * Mengisi ingatan callsign dari track yang tersimpan di database, supaya pesawat yang sedang
 * parkir (identitasnya hanya sesekali terkirim) tidak tampil sebagai kode Mode-S setelah restart.
 * `fetchRows` mengembalikan callsign terbaru per icao24 sejak waktu tertentu.
 */
export async function restoreIdentities(
  memory: IdentityMemory,
  fetchRows: (since: Date) => Promise<StoredIdentity[]>,
  windowMs: number = DEFAULT_RESTORE_WINDOW_MS,
  now: number = Date.now(),
): Promise<RestoreIdentitiesResult> {
  const rows = await fetchRows(new Date(now - windowMs));
  let restored = 0;
  for (const row of rows) {
    if (!(row.icao24 && row.callsign)) continue;
    memory.remember(row.icao24, row.callsign, row.at);
    restored++;
  }
  return { rows: rows.length, restored };
}
