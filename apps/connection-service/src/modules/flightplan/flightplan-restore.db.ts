import { aftnMessages, db } from "@repo/database";
import { and, asc, eq, gte } from "drizzle-orm";

/** `source` that advisory-service stamps on rows it stores from the AFTN topic. */
const AFTN_SOURCE = "aeroswarm";
const MAX_ROWS = 20_000;

/** The original event payload of every AFTN row since `since`, oldest first. */
export async function fetchStoredFlightPlanEvents(
  since: Date,
): Promise<unknown[]> {
  const rows = await db
    .select({ providerRaw: aftnMessages.providerRaw })
    .from(aftnMessages)
    .where(
      and(
        eq(aftnMessages.source, AFTN_SOURCE),
        gte(aftnMessages.datetime, since),
      ),
    )
    .orderBy(asc(aftnMessages.datetime))
    .limit(MAX_ROWS);
  return rows.map((r) => r.providerRaw);
}
