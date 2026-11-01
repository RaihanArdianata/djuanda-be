import { Hono } from "hono";
import { connectionServiceToken } from "@/config/connection-token";
import { authentication } from "@/middleware/auth";
import { connectionProxy } from "@/proxy/connection.proxy";

// Only /aero/tracks (a track's trail) goes through the gateway. The rest of connection-service
// (/aero/ingest, /aero/replay, its WebSocket) is reached directly and is deliberately not exposed here.
// The user must be logged in (JWT, like /notifications); connection-service sees the service token instead.
const app = new Hono()
  .use("/*", authentication)
  .use("/*", async (c, next) => {
    if (!connectionServiceToken()) {
      return c.json(
        {
          ok: false,
          error: {
            code: "UNAVAILABLE",
            message:
              "gateway has no CONNECTION_SERVICE_TOKEN (or CONNECTION_API_TOKENS)",
            recoverable: false,
          },
        },
        503,
      );
    }
    await next();
  })
  .all("/*", connectionProxy);

export default app;
