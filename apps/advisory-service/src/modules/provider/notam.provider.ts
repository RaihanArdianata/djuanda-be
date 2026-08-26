import { logger } from "@repo/logger";
import { env } from "@/config/env";
import type { NotamSourceItem } from "../notam-trigger/parser/common";
import { toProviderDateString } from "./aftn.provider";
import { getAccessToken, providerBaseUrl } from "./auth.provider";

const NOTAM_ENDPOINT = "/api/notam";

export interface FetchNotamParams {
  startDate: Date;
  endDate: Date;
}

const isRecord = (value: unknown): value is NotamSourceItem =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const extractItems = (body: unknown): NotamSourceItem[] => {
  if (Array.isArray(body)) {
    return body.filter(isRecord);
  }

  if (isRecord(body) && Array.isArray(body.data)) {
    return body.data.filter(isRecord);
  }

  return [];
};

const postNotam = async (
  token: string,
  params: FetchNotamParams,
): Promise<Response> => {
  const url = `${providerBaseUrl()}${NOTAM_ENDPOINT}`;
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
      throw new Error(
        `Advisory provider did not respond within ${env.ADVISORY_PROVIDER_TIMEOUT_MS}ms`,
      );
    }
    throw new Error(
      `Failed to reach advisory provider: ${err instanceof Error ? err.message : String(err)}`,
    );
  } finally {
    clearTimeout(timeout);
  }
};

export const fetchNotamMessages = async (
  params: FetchNotamParams,
): Promise<NotamSourceItem[]> => {
  let token = await getAccessToken();
  let response = await postNotam(token, params);

  if (response.status === 401) {
    logger.warn(
      "advisory provider returned 401 for /api/notam, refreshing token",
    );
    token = await getAccessToken(true);
    response = await postNotam(token, params);
  }

  const rawBody = await response.text();

  if (!response.ok) {
    throw new Error(
      `Advisory provider /api/notam returned ${response.status}: ${rawBody}`,
    );
  }

  let body: unknown;
  try {
    body = rawBody.length ? JSON.parse(rawBody) : null;
  } catch {
    throw new Error(
      "Advisory provider /api/notam returned a body that was not valid JSON",
    );
  }

  const items = extractItems(body);

  logger.info(
    {
      startDate: toProviderDateString(params.startDate),
      endDate: toProviderDateString(params.endDate),
      received: items.length,
    },
    "advisory provider /api/notam fetched",
  );

  return items;
};
