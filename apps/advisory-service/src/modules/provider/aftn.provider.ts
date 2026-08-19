import { logger } from "@repo/logger";
import { env } from "@/config/env";
import { getAccessToken, providerBaseUrl } from "./auth.provider";

const AFTN_ENDPOINT = "/api/aftn";

export class ProviderRequestError extends Error {
  readonly status: number;
  readonly upstreamBody?: unknown;

  constructor(message: string, status: number, upstreamBody?: unknown) {
    super(message);
    this.name = "ProviderRequestError";
    this.status = status;
    this.upstreamBody = upstreamBody;
  }
}

export interface AftnProviderItem {
  datetime?: string | null;

  message_type?: string | null;

  call_sign?: string | null;
  registration?: string | null;

  aircraft_type?: string | null;
  departure?: string | null;

  departure_time?: string | null;
  destination?: string | null;

  destination_time?: string | null;
  duration?: string | null;
  speed?: string | null;
  altitude?: string | null;
  route?: string | null;
  raw?: string | null;
  [key: string]: unknown;
}

export interface FetchAftnParams {
  startDate: Date;

  endDate: Date;
}

export const toProviderDateString = (date: Date): string =>
  date.toISOString().slice(0, 19).replace("T", " ");

const postAftn = async (
  token: string,
  params: FetchAftnParams,
): Promise<Response> => {
  const url = `${providerBaseUrl()}${AFTN_ENDPOINT}`;
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

const extractItems = (body: unknown): AftnProviderItem[] => {
  if (Array.isArray(body)) {
    return body.filter(isRecord);
  }

  if (isRecord(body) && Array.isArray(body.data)) {
    return body.data.filter(isRecord);
  }

  return [];
};

const isRecord = (value: unknown): value is AftnProviderItem =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const fetchAftnMessages = async (
  params: FetchAftnParams,
): Promise<AftnProviderItem[]> => {
  let token = await getAccessToken();
  let response = await postAftn(token, params);

  if (response.status === 401) {
    logger.warn(
      "advisory provider returned 401 for /api/aftn, refreshing token",
    );
    token = await getAccessToken(true);
    response = await postAftn(token, params);
  }

  const rawBody = await response.text();

  if (!response.ok) {
    throw new ProviderRequestError(
      `Advisory provider /api/aftn returned ${response.status}`,
      response.status === 401 ? 401 : 502,
      rawBody,
    );
  }

  let body: unknown;
  try {
    body = rawBody.length ? JSON.parse(rawBody) : null;
  } catch {
    throw new ProviderRequestError(
      "Advisory provider /api/aftn returned a body that was not valid JSON",
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
    "advisory provider /api/aftn fetched",
  );

  return items;
};
