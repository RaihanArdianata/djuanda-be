import { alertRules, db } from "@repo/database";
import { and, eq } from "drizzle-orm";
import type { InterestRule } from "./interest-area";

/** Aturan `ALERT_AREA` bandara ini (profil bandara: pusat dan radius), atau undefined bila belum ada. */
export async function fetchAreaRule(
  airportId: string,
): Promise<InterestRule | undefined> {
  const rows = await db
    .select({
      enabled: alertRules.enabled,
      configuration: alertRules.configuration,
    })
    .from(alertRules)
    .where(
      and(
        eq(alertRules.airportId, airportId),
        eq(alertRules.type, "ALERT_AREA"),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (!row) return undefined;
  return {
    enabled: row.enabled,
    configuration: (row.configuration as Record<string, unknown>) ?? {},
  };
}
