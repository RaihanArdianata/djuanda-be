import { needsCriticalConfirmation } from "./incident-query";

/** Bagian alert yang dibutuhkan untuk merencanakan verifikasi. */
export interface VerifiableAlert {
  id: string;
  alertId: string;
  severity: string;
  verificationStatus: string;
  verificationNote: string | null;
}

export interface VerifyPlanInput {
  status: "VERIFIED" | "FALSE_ALARM";
  note: string | undefined;
  onlyUnverified: boolean;
}

export interface VerifyPlan<T extends VerifiableAlert> {
  /** Alert yang akan diubah. */
  targets: T[];
  /** Alert yang dilewati: sudah dinilai (mode "terapkan juga") atau sudah berisi penilaian yang sama. */
  skipped: T[];
  /** Ada alert Critical di antara yang akan diubah: butuh konfirmasi eksplisit. */
  needsCriticalConfirmation: boolean;
}

/**
 * Alert yang sama dengan penilaian yang sudah tersimpan tidak ditulis ulang. Ini membuat pengerjaan di antrean aman diulang
 * (mis. setelah gagal di tengah): bagian yang sudah selesai tidak mencatat riwayat dua kali.
 */
function alreadyApplied(
  alert: VerifiableAlert,
  input: VerifyPlanInput,
): boolean {
  return (
    alert.verificationStatus === input.status &&
    (alert.verificationNote ?? undefined) === input.note
  );
}

export function planVerification<T extends VerifiableAlert>(
  alerts: readonly T[],
  input: VerifyPlanInput,
): VerifyPlan<T> {
  const targets: T[] = [];
  const skipped: T[] = [];
  for (const alert of alerts) {
    const judged = alert.verificationStatus !== "UNVERIFIED";
    if ((input.onlyUnverified && judged) || alreadyApplied(alert, input)) {
      skipped.push(alert);
    } else {
      targets.push(alert);
    }
  }
  return {
    targets,
    skipped,
    needsCriticalConfirmation: needsCriticalConfirmation(
      targets.map((a) => a.severity),
    ),
  };
}

/** Potong daftar menjadi kelompok berukuran `size` (kelompok terakhir boleh lebih kecil). */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  if (size < 1) throw new Error("chunk size must be at least 1");
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size)
    out.push(items.slice(i, i + size));
  return out;
}
