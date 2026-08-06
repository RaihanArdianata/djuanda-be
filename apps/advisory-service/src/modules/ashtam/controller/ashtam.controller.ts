import { logger } from "@repo/logger";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { z } from "zod";
import { NavsimUpstreamError } from "../../client/navsim.client";
import { getAshtamHistories } from "../service/ashtam.service";

function toContentfulStatus(status: number): ContentfulStatusCode {
  const isContentBearing =
    Number.isInteger(status) &&
    status >= 200 &&
    status < 600 &&
    status !== 204 &&
    status !== 304;

  return (isContentBearing ? status : 502) as ContentfulStatusCode;
}

const querySchema = z.object({
  "startDateTime.lessThan": z
    .string()
    .datetime({
      message:
        "startDateTime.lessThan harus format ISO 8601, contoh: 2026-04-21T00:00:00Z",
    })
    .optional(),
  size: z.coerce.number().int().positive().max(5000).optional(),
});

export const list = async (c: Context): Promise<Response> => {
  const parsedQuery = querySchema.safeParse(c.req.query());

  if (!parsedQuery.success) {
    return c.json(
      {
        error: "Invalid query parameters",
        message: parsedQuery.error.issues.map((i) => i.message).join(", "),
      },
      400,
    );
  }

  const { size, "startDateTime.lessThan": startDateTimeLessThan } =
    parsedQuery.data;

  try {
    const data = await getAshtamHistories({ size, startDateTimeLessThan });
    return c.json(data as object, 200);
  } catch (err) {
    if (err instanceof NavsimUpstreamError) {
      logger.error(
        { err, status: err.status, upstreamBody: err.upstreamBody },
        "ashtam-service: NAVSIM request failed",
      );
      return c.json(
        {
          error: "Failed to fetch ASHTAM data from NAVSIM",
          message: err.message,
        },
        toContentfulStatus(err.status),
      );
    }

    logger.error(
      { err },
      "ashtam-service: unexpected error fetching ASHTAM data",
    );
    return c.json(
      { error: "Unexpected error while fetching ASHTAM data" },
      500,
    );
  }
};
