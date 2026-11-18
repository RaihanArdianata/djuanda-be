import ApiError from "@repo/shared/api-error";
import {
  type ReplacingSession,
  sessionTerminatedOverrides,
} from "./session-message";

/**
 * Galat SESSION_TERMINATED; menyebut perangkat yang menggantikan bila diketahui. Mencari sesi itu bersifat tambahan: bila
 * gagal (database, atau modul layanan tidak menyediakannya), hasilnya tetap galat SESSION_TERMINATED biasa.
 */
export async function sessionTerminatedError(
  userId: string,
  requestUserAgent: string | null | undefined,
): Promise<ApiError> {
  let other: ReplacingSession | null = null;
  try {
    // Impor dinamis: modul ini ikut dimuat tes yang me-mock ./service tanpa fungsi ini.
    const { getReplacingSession } = await import("./service");
    other = await getReplacingSession(userId);
  } catch {
    other = null;
  }
  return new ApiError(
    "SESSION_TERMINATED",
    sessionTerminatedOverrides(other, requestUserAgent),
  );
}
