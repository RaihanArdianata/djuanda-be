/** Isi pekerjaan verifikasi massal di antrean. Hanya data biasa (JSON), karena disimpan di Redis. */
export interface VerifyJobData {
  /** Alert ID yang akan dinilai; sudah disaring (alert yang dilewati tidak ikut). */
  alertIds: string[];
  incidentId: string | null;
  status: "VERIFIED" | "FALSE_ALARM";
  reasonCode: string | null;
  /** Catatan akhir (alasan baku + catatan bebas), seperti yang disimpan di alert. */
  note: string | undefined;
  onlyUnverified: boolean;
  actorId: string | null;
  actorName: string;
}

export interface VerifyJobResult {
  total: number;
  updated: number;
  skipped: number;
}

/** Berapa alert diproses sekali jalan: satu UPDATE dan satu INSERT per kelompok. */
export const VERIFY_BATCH_SIZE = 100;
