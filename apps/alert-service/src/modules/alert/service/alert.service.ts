import { aeroswarmAlerts, db } from "@repo/database";
import { desc, eq } from "drizzle-orm";
import { GetAllAlertsSchemaType } from "../validator/alert.validator";

export async function getAllAlerts(params: GetAllAlertsSchemaType) {
  const whereClause = params.airportId ? eq(aeroswarmAlerts.airportId, params.airportId) : undefined;
  const page = params.page ?? 1;
  const size = params.size ?? 10;

  const alerts = await db.query.aeroswarmAlerts.findMany({
    where: whereClause,
    orderBy: (alerts) => [desc(alerts.triggeredAt)],
    limit: size,
    offset: (page - 1) * size,
  });

  return alerts;
}
