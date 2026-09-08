import type { Context } from "hono";
import { services } from "@/config/services";
import { filterHeaders } from "../utils/headers";

export const sseProxy = async (c: Context): Promise<Response> => {
  const incomingUrl = new URL(c.req.url);
  const targetUrl = new URL(
    incomingUrl.pathname + incomingUrl.search,
    services.SSE_SERVICE,
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
