import type { Context } from "hono";
import { env } from "../config/env";
import { filterHeaders } from "../utils/headers";

export const alertStreamProxy = async (c: Context): Promise<Response> => {
  const incomingUrl = new URL(c.req.url);
  const targetUrl = new URL(
    `/alerts/stream${incomingUrl.search}`,
    env.ALERT_SERVICE_URL,
  );

  const headers = filterHeaders(c.req.raw.headers);

  const upstream = await fetch(targetUrl.toString(), {
    method: "GET",
    headers,
  });

  const responseHeaders = new Headers();
  for (const [key, value] of upstream.headers.entries()) {
    responseHeaders.set(key, value);
  }

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: filterHeaders(responseHeaders),
  });
};
