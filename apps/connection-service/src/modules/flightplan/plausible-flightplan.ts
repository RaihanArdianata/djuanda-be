import type { FlightPlanEvent } from "@aeroswarm/core";

/** Identifikasi pesawat pada AFTN (item 7): huruf besar dan angka saja, paling banyak 7 karakter, bukan simbol atau spasi. */
const CALLSIGN: RegExp = /^[A-Z0-9]{2,7}$/;

/** Bagian teks AFTN yang boleh muncul: huruf, angka, dan tanda baca dari rangkaian ITA-2. */
const AFTN_TEXT: RegExp = /^[A-Z0-9 \-/().,:+?='\r\n]*$/i;

export interface PlausibleVerdict {
  ok: boolean;
  reason?: string;
}

/**
 * Pesan AFTN nyata atau bukan. Feed ASTERIX mencoba membaca datagram yang gagal didekode sebagai AFTN (sebagian site
 * menyatukan keduanya di satu port UDP), dan data acak (aliran terenkripsi atau proprietari di port yang sama) bisa
 * kebetulan memuat "(" dan ")" lalu lolos sebagai "flight plan" dengan callsign berisi simbol acak. Tanpa penyaringan,
 * sampah itu tersimpan di database dan tampil di daftar rencana penerbangan.
 */
export function isPlausibleFlightPlan(
  event: FlightPlanEvent,
): PlausibleVerdict {
  const callsign = (event.message?.callsign ?? "").trim();
  if (!CALLSIGN.test(callsign)) {
    return {
      ok: false,
      reason: "callsign bukan identifikasi pesawat yang sah",
    };
  }
  const text = event.message?.text ?? "";
  if (!AFTN_TEXT.test(text)) {
    return { ok: false, reason: "teks memuat karakter di luar set AFTN" };
  }
  return { ok: true };
}
