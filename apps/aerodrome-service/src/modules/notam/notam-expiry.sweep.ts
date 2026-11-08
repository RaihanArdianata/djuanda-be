import { aerodromeFeatures, db } from "@repo/database";
import { logger } from "@repo/logger";
import { eq, inArray, sql } from "drizzle-orm";
import { publishAerodromeGeometryUpdated } from "../messaging/aerodrome.producer";
import {
  clearNotamProperties,
  expiredFeatures,
  type FeatureRow,
} from "./notam-expiry";

/**
 * Satu putaran: fitur yang masih ditandai NOTAM tetapi masa berlakunya sudah lewat dikembalikan ke ACTIVE dan jejak NOTAM-nya dibuang.
 * Mengembalikan jumlah fitur yang dipulihkan.
 */
export async function clearExpiredNotams(
  now: number = Date.now(),
): Promise<number> {
  const candidates: FeatureRow[] = await db
    .select({
      id: aerodromeFeatures.id,
      airportId: aerodromeFeatures.airportId,
      properties: aerodromeFeatures.properties,
    })
    .from(aerodromeFeatures)
    .where(
      sql`${inArray(aerodromeFeatures.status, ["RESTRICTED", "INACTIVE"])} and ${aerodromeFeatures.properties}->>'notamEffectiveTo' is not null`,
    );

  const expired = expiredFeatures(candidates, now);
  const airports = new Set<string>();
  for (const row of expired) {
    await db
      .update(aerodromeFeatures)
      .set({
        status: "ACTIVE",
        properties: clearNotamProperties(
          (row.properties ?? {}) as Record<string, unknown>,
        ),
        updatedAt: new Date(now),
      })
      .where(eq(aerodromeFeatures.id, row.id));
    if (row.airportId) airports.add(row.airportId);
  }
  for (const airportId of airports)
    await publishAerodromeGeometryUpdated(airportId);
  if (expired.length > 0)
    logger.info(
      { count: expired.length },
      "aerodrome: expired NOTAM restrictions cleared",
    );
  return expired.length;
}

let timer: ReturnType<typeof setInterval> | null = null;

/**
 * Seberapa sering daftar diperiksa. Kapan sebuah NOTAM berakhir sepenuhnya ditentukan pesan NOTAM-nya (`notamEffectiveTo`, dari waktu
 * berakhir pesan); ini hanya jeda pemeriksaan, jadi tidak diatur dari luar.
 */
const CHECK_INTERVAL_MS = 60_000;

/** Periksa sekali saat mulai, supaya yang kedaluwarsa selagi layanan mati ikut dibersihkan, lalu berkala. */
export function startNotamExpirySweep(): void {
  if (timer) return;
  const run = (): void => {
    clearExpiredNotams().catch((err: unknown) =>
      logger.warn({ err }, "aerodrome: NOTAM expiry sweep failed"),
    );
  };
  run();
  timer = setInterval(run, CHECK_INTERVAL_MS);
  timer.unref?.();
}

export function stopNotamExpirySweep(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
