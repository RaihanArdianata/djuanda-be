import type { AftnMessage } from "@repo/database";

/**
 * Pesan AFTN yang lebih tua dari ini tidak dianggap jadwal terkini: sama dengan umur
 * rencana penerbangan di connection-service (48 jam), yang menentukan warna label track.
 * Tanpa batas ini, penerbangan harian menampilkan pesan berbulan-bulan lalu seolah jadwal hari ini.
 */
export const LATEST_WINDOW_MS = 48 * 3_600_000;

export const latestWindowStart = (now: number = Date.now()): Date =>
  new Date(now - LATEST_WINDOW_MS);

export interface AftnAircraftDetail {
  id: string;
  callSign: string | null;
  registration: string | null;
  datetime: Date;
  status: string;
  route: string | null;
  dep: { icao: string | null; time: string | null };
  arrival: { icao: string | null; time: string | null };
}

export const buildAftnAircraftDetail = (
  rows: AftnMessage[],
): AftnAircraftDetail | null => {
  const latest = rows[0];
  if (!latest) return null;

  const pick = (get: (row: AftnMessage) => string | null): string | null => {
    for (const row of rows) {
      const value = get(row);
      if (value !== null && value !== undefined) return value;
    }
    return null;
  };

  return {
    id: latest.id,
    callSign: pick((r) => r.callSign),
    registration: pick((r) => r.registration),
    datetime: latest.datetime,
    status: latest.messageType,
    route: pick((r) => r.route),
    dep: {
      icao: pick((r) => r.departure),
      time: pick((r) => r.departureTime),
    },
    arrival: {
      icao: pick((r) => r.destination),
      time: pick((r) => r.destinationTime),
    },
  };
};
