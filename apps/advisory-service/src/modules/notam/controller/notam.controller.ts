import { logger } from "@repo/logger";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { NavsimUpstreamError } from "../../client/navsim.client";
import { getNotamHistories } from "../service/notam.service";

function toContentfulStatus(status: number): ContentfulStatusCode {
  const isContentBearing =
    Number.isInteger(status) &&
    status >= 200 &&
    status < 600 &&
    status !== 204 &&
    status !== 304;

  return (isContentBearing ? status : 502) as ContentfulStatusCode;
}

export const list = async (c: Context): Promise<Response> => {
  try {
    const data = await getNotamHistories();
    return c.json(data as object, 200);
  } catch (err) {
    if (err instanceof NavsimUpstreamError) {
      logger.error(
        { err, status: err.status, upstreamBody: err.upstreamBody },
        "notam-service: NAVSIM request failed",
      );
      return c.json(
        {
          error: "Failed to fetch NOTAM data from NAVSIM",
          message: err.message,
        },
        toContentfulStatus(err.status),
      );
    }

    logger.error(
      { err },
      "notam-service: unexpected error fetching NOTAM data",
    );
    return c.json({ error: "Unexpected error while fetching NOTAM data" }, 500);
  }
};
