import { logger } from "@repo/logger";
import { createMiddleware } from "hono/factory";
import { systemStatus } from "../lib/system-status";
import type { Variables } from "../types/hono";

/** Permintaan yang sedang diproses gateway saat ini; ikut dicatat supaya terlihat kapan banyak yang bersamaan. */
let inFlight = 0;

export const requestLogger = createMiddleware<{ Variables: Variables }>(
  async (c, next) => {
    const start = Date.now();
    inFlight += 1;
    const concurrent = inFlight;

    try {
      await next();
    } finally {
      inFlight -= 1;
    }

    // `sys`: status VPS dan proses ini pada cuplikan terakhir (tiap 5 detik), supaya log lambat bisa dihubungkan
    // dengan beban mesin saat itu. `concurrent`: jumlah permintaan yang sedang berjalan ketika yang ini mulai.
    logger.info(
      {
        method: c.req.method,
        path: c.req.path,
        status: c.res.status,
        ms: Date.now() - start,
        requestId: c.get("requestId"),
        concurrent,
        sys: systemStatus(),
      },
      "request completed",
    );
  },
);
