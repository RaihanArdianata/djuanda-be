import { logger } from "@repo/logger";
import { env } from "@/config/env";
import type { AshtamSourceItem } from "../ashtam/parser/common";
import { getAccessToken, providerBaseUrl } from "./auth.provider";
import { ProviderRequestError, toProviderDateString } from "./common";

const ASHTAM_ENDPOINT = "/api/ashtam";

export interface FetchAshtamParams {
  startDate: Date;
  endDate: Date;
}

const isRecord = (value: unknown): value is AshtamSourceItem =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const extractItems = (body: unknown): AshtamSourceItem[] => {
  if (Array.isArray(body)) {
    return body.filter(isRecord);
  }

  if (isRecord(body) && Array.isArray(body.data)) {
    return body.data.filter(isRecord);
  }

  return [];
};

const postAshtam = async (
  token: string,
  params: FetchAshtamParams,
): Promise<Response> => {
  const url = `${providerBaseUrl()}${ASHTAM_ENDPOINT}`;
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    env.ADVISORY_PROVIDER_TIMEOUT_MS,
  );

  try {
    return await fetch(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        start_date: toProviderDateString(params.startDate),
        end_date: toProviderDateString(params.endDate),
      }),
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new ProviderRequestError(
        `Advisory provider did not respond within ${env.ADVISORY_PROVIDER_TIMEOUT_MS}ms`,
        504,
      );
    }
    throw new ProviderRequestError(
      `Failed to reach advisory provider: ${err instanceof Error ? err.message : String(err)}`,
      502,
    );
  } finally {
    clearTimeout(timeout);
  }
};

/**
 * Fetches raw ASHTAM items from the real advisory provider.
 *
 * Same shared token (`getAccessToken` from `auth.provider.ts`), same base
 * URL, same request/response envelope and 401-then-retry-once behavior as the
 * other advisory provider fetches — only the endpoint path and payload type
 * differ.
 */
export const fetchAshtamMessages = async (
  params: FetchAshtamParams,
): Promise<AshtamSourceItem[]> => {
  let token = await getAccessToken();
  let response = await postAshtam(token, params);

  if (response.status === 401) {
    logger.warn(
      "advisory provider returned 401 for /api/ashtam, refreshing token",
    );
    token = await getAccessToken(true);
    response = await postAshtam(token, params);
  }

  const rawBody = await response.text();

  if (!response.ok) {
    throw new ProviderRequestError(
      `Advisory provider /api/ashtam returned ${response.status}`,
      response.status === 401 ? 401 : 502,
      rawBody,
    );
  }

  let body: unknown;
  try {
    body = rawBody.length ? JSON.parse(rawBody) : null;
  } catch {
    throw new ProviderRequestError(
      "Advisory provider /api/ashtam returned a body that was not valid JSON",
      502,
      rawBody,
    );
  }

  const items = extractItems(body);

  logger.info(
    {
      startDate: toProviderDateString(params.startDate),
      endDate: toProviderDateString(params.endDate),
      received: items.length,
    },
    "advisory provider /api/ashtam fetched",
  );

  return items;
};
