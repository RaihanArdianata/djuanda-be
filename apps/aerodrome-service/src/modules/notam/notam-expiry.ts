/**
 * Batasan dari NOTAM yang sudah lewat masa berlakunya. Fitur aerodrome yang ditandai NOTAM (status RESTRICTED/INACTIVE, `restricted`,
 * properti `notam*`) kembali ke keadaan biasa saat `notamEffectiveTo` terlewati; tanpa ini ia merah selamanya, karena yang mengubah
 * statusnya hanya event masuk dan tidak ada yang mengirim event pembatal saat waktunya habis.
 */

type Props = Record<string, unknown>;

/** True bila properti memuat NOTAM dengan waktu berakhir yang sudah lewat. NOTAM tanpa waktu berakhir (permanen) tidak pernah kedaluwarsa. */
export function isNotamExpired(props: Props, now: number): boolean {
  if (typeof props.notamId !== "string") return false;
  const to = props.notamEffectiveTo;
  if (typeof to !== "string") return false;
  const t = Date.parse(to);
  return !Number.isNaN(t) && t < now;
}

/** Properti tanpa jejak NOTAM: `restricted` dan semua `notam*` dibuang, status di dalam properti dikembalikan ke ACTIVE. */
export function clearNotamProperties(props: Props): Props {
  const out: Props = {};
  for (const [key, value] of Object.entries(props)) {
    if (key === "restricted" || key.startsWith("notam")) continue;
    out[key] = value;
  }
  if ("status" in out) out.status = "ACTIVE";
  return out;
}

export interface FeatureRow {
  id: string;
  airportId: string | null;
  properties: unknown;
}

/** Fitur yang NOTAM-nya sudah lewat, dari daftar kandidat. */
export function expiredFeatures(rows: FeatureRow[], now: number): FeatureRow[] {
  return rows.filter((r) => isNotamExpired((r.properties ?? {}) as Props, now));
}
