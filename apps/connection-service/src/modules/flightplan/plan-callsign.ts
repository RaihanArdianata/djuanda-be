import type { FlightPlanStore } from "@aeroswarm/live-server";

/** Rencana yang jauh dari sekarang bisa milik penerbangan lain dengan pesawat (icao24) yang sama. */
export const PLAN_CALLSIGN_MAX_AGE_MS = 6 * 3_600_000;

/**
 * Callsign dari rencana penerbangan AFTN yang memuat alamat Mode-S pesawat ini, dipakai untuk
 * pesawat yang transponder-nya belum pernah mengirim identitas. Hanya rencana yang waktunya
 * dekat (berangkat, tiba, atau EOBT dalam 6 jam) yang dipakai, supaya penerbangan kemarin
 * dengan pesawat yang sama tidak memberi nama yang salah.
 */
export function callsignFromPlan(
  plans: Pick<FlightPlanStore, "find">,
  icao24: string,
  now: number = Date.now(),
): string | undefined {
  const plan = plans.find({ icao24, callsign: null }, now);
  if (!plan) return undefined;
  const at = plan.ataAt ?? plan.atdAt ?? plan.eobtAt ?? plan.firstSeenAt;
  if (Math.abs(now - at) > PLAN_CALLSIGN_MAX_AGE_MS) return undefined;
  return plan.callsign || undefined;
}
