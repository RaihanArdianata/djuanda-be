import axios from "axios";
import type { Context } from "hono";
import { DEFAULT_TIMEOUT_MS, REQUEST_ID_HEADER } from "../config/constants";
import type { Variables } from "../types/hono";
import { filterHeaders } from "../utils/headers";

export interface ProxyOptions {
  /** Headers to set on the forwarded request, replacing what the caller sent. */
  setHeaders?: () => Record<string, string>;
}

export const createProxy = (
  targetBaseUrl: string,
  options: ProxyOptions = {},
) => {
  return async (c: Context<{ Variables: Variables }>): Promise<Response> => {
    const incomingUrl = new URL(c.req.url);

    const targetUrl = new URL(
      incomingUrl.pathname + incomingUrl.search,
      targetBaseUrl,
    );

    const headers = filterHeaders(c.req.raw.headers);
    for (const [key, value] of Object.entries(options.setHeaders?.() ?? {})) {
      headers.set(key, value);
    }
    const requestId = c.get("requestId");

    if (requestId) {
      headers.set(REQUEST_ID_HEADER, requestId);
    }

    const hasBody = !["GET", "HEAD"].includes(c.req.method);

    const body = hasBody ? await c.req.arrayBuffer() : undefined;

    const response = await axios.request({
      url: targetUrl.toString(),
      method: c.req.method,
      headers: Object.fromEntries(headers.entries()),
      data: body,
      timeout: DEFAULT_TIMEOUT_MS,
      responseType: "stream",
      validateStatus: () => true,
    });

    const responseHeaders = new Headers();

    for (const [key, value] of Object.entries(response.headers)) {
      if (typeof value === "string") {
        responseHeaders.set(key, value);
      } else if (Array.isArray(value)) {
        responseHeaders.set(key, value.join(", "));
      }
    }

    return new Response(response.data, {
      status: response.status,
      headers: filterHeaders(responseHeaders),
    });
  };
};
