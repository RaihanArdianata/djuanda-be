import { logger } from "@repo/logger";
import { env } from "@/config/env";

const TOKEN_ENDPOINT = "/api/token";

const EXPIRY_SAFETY_MARGIN_MS = 60_000;

const FALLBACK_TOKEN_LIFETIME_MS: number =
  env.ADVISORY_PROVIDER_TOKEN_LIFETIME_MS;

export class ProviderAuthError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ProviderAuthError";
    this.status = status;
  }
}

interface CachedToken {
  token: string;
  expiresAtMs: number;
}

let cached: CachedToken | null = null;

let inFlight: Promise<CachedToken> | null = null;

export const providerBaseUrl = (): string =>
  env.ADVISORY_PROVIDER_BASE_URL.replace(/\/+$/, "");

const decodeJwtExpiryMs = (token: string): number | null => {
  const parts = token.split(".");
  if (parts.length !== 3) {
    return null;
  }

  const payloadSegment = parts[1];
  if (!payloadSegment) {
    return null;
  }

  try {
    const json = Buffer.from(payloadSegment, "base64url").toString("utf8");
    const payload: unknown = JSON.parse(json);

    if (
      typeof payload === "object" &&
      payload !== null &&
      typeof (payload as { exp?: unknown }).exp === "number"
    ) {
      return (payload as { exp: number }).exp * 1000;
    }
  } catch {
    return null;
  }

  return null;
};

const requestToken = async (): Promise<CachedToken> => {
  const url = `${providerBaseUrl()}${TOKEN_ENDPOINT}`;
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    env.ADVISORY_PROVIDER_TIMEOUT_MS,
  );

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        username: env.ADVISORY_PROVIDER_USERNAME,
        password: env.ADVISORY_PROVIDER_PASSWORD,
      }),
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new ProviderAuthError(
        `Advisory provider did not respond within ${env.ADVISORY_PROVIDER_TIMEOUT_MS}ms`,
        504,
      );
    }
    throw new ProviderAuthError(
      `Failed to reach advisory provider: ${err instanceof Error ? err.message : String(err)}`,
      502,
    );
  } finally {
    clearTimeout(timeout);
  }

  const rawBody = await response.text();

  if (!response.ok) {
    throw new ProviderAuthError(
      `Advisory provider token endpoint returned ${response.status}`,
      response.status === 401 ? 401 : 502,
    );
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    throw new ProviderAuthError(
      "Advisory provider token endpoint returned a body that was not valid JSON",
      502,
    );
  }

  const token = extractToken(body);
  if (!token) {
    throw new ProviderAuthError(
      "Advisory provider token endpoint response did not contain an access token",
      502,
    );
  }

  const jwtExpiryMs = decodeJwtExpiryMs(token);
  const expiresAtMs =
    (jwtExpiryMs ?? Date.now() + FALLBACK_TOKEN_LIFETIME_MS) -
    EXPIRY_SAFETY_MARGIN_MS;

  logger.info(
    { expiresAt: new Date(expiresAtMs).toISOString() },
    "advisory provider access token acquired",
  );

  return { token, expiresAtMs };
};

const extractToken = (body: unknown): string | null => {
  if (typeof body === "string" && body.length > 0) {
    return body;
  }

  if (typeof body !== "object" || body === null) {
    return null;
  }

  const candidate = body as Record<string, unknown>;
  const keys = ["access_token", "accessToken", "token", "data"];

  for (const key of keys) {
    const value = candidate[key];
    if (typeof value === "string" && value.length > 0) {
      return value;
    }

    if (key === "data" && typeof value === "object" && value !== null) {
      const nested = extractToken(value);
      if (nested) {
        return nested;
      }
    }
  }

  return null;
};

const isExpired = (token: CachedToken): boolean =>
  Date.now() >= token.expiresAtMs;

export const getAccessToken = async (forceRefresh = false): Promise<string> => {
  if (!forceRefresh && cached && !isExpired(cached)) {
    return cached.token;
  }

  if (forceRefresh) {
    cached = null;
    inFlight = null;
  }

  if (!inFlight) {
    inFlight = requestToken()
      .then((token) => {
        cached = token;
        return token;
      })
      .finally(() => {
        inFlight = null;
      });
  }

  const token = await inFlight;
  return token.token;
};

export const resetAccessTokenCache = (): void => {
  cached = null;
  inFlight = null;
};
