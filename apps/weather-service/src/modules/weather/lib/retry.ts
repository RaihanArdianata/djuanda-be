import { logger } from "@repo/logger";

export interface RetryOptions {
  timeoutMs: number;
  maxRetries: number;
  baseDelayMs: number;
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const fetchOnce = async (
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
};

// Graceful failure by design: returns null instead of throwing once every
// attempt is exhausted, so a poller cycle (weather-poller.ts) can log and
// move on to the next interval instead of crashing the process — same
// fail-soft posture as checkRateLimit in @repo/shared and the kafka ingest
// consumer's CRASH handler.
export const fetchWithRetry = async (
  url: string,
  init: RequestInit,
  options: RetryOptions,
): Promise<Response | null> => {
  let attempt = 0;

  while (attempt <= options.maxRetries) {
    try {
      const response = await fetchOnce(url, init, options.timeoutMs);
      if (response.ok) {
        return response;
      }
      logger.warn(
        { url, status: response.status, attempt },
        "weather provider responded with a non-OK status",
      );
    } catch (err) {
      logger.warn({ err, url, attempt }, "weather provider request failed");
    }

    attempt += 1;
    if (attempt <= options.maxRetries) {
      const delayMs = options.baseDelayMs * 2 ** (attempt - 1);
      await sleep(delayMs);
    }
  }

  logger.error(
    { url, maxRetries: options.maxRetries },
    "weather provider request exhausted all retries — graceful failure, caller will keep serving last known data",
  );
  return null;
};
