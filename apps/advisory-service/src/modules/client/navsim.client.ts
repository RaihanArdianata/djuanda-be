const NAVSIM_BASE_URL = (
  process.env.NAVSIM_BASE_URL || "https://navsim.kemenhub.go.id/serv_bdg/api"
).replace(/\/+$/, "");

const NAVSIM_TIMEOUT_MS = Number(process.env.NAVSIM_TIMEOUT_MS) || 15_000;

export class NavsimUpstreamError extends Error {
  readonly status: number;
  readonly upstreamBody?: unknown;

  constructor(message: string, status: number, upstreamBody?: unknown) {
    super(message);
    this.name = "NavsimUpstreamError";
    this.status = status;
    this.upstreamBody = upstreamBody;
  }
}

export async function fetchNotamHistories(size = 2000): Promise<unknown> {
  const url = `${NAVSIM_BASE_URL}/notam-histories?size=${size}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), NAVSIM_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
      // biome-ignore lint/style/useNamingConvention: The property name is based on the provider's API response.
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new NavsimUpstreamError(
        `NAVSIM did not respond within ${NAVSIM_TIMEOUT_MS}ms`,
        504,
      );
    }
    throw new NavsimUpstreamError(
      `Failed to reach NAVSIM: ${err instanceof Error ? err.message : String(err)}`,
      502,
    );
  } finally {
    clearTimeout(timeout);
  }

  const rawBody = await response.text();

  if (!response.ok) {
    throw new NavsimUpstreamError(
      `NAVSIM returned ${response.status} ${response.statusText}`,
      response.status,
      safeParseJson(rawBody) ?? rawBody,
    );
  }

  const parsed = safeParseJson(rawBody);
  if (parsed === undefined) {
    throw new NavsimUpstreamError(
      "NAVSIM returned a 2xx response with a body that was not valid JSON",
      502,
      rawBody,
    );
  }

  return parsed;
}

export interface FetchAshtamHistoriesParams {
  size?: number;
  /** Filter NAVSIM `startDateTime.lessThan` (ISO 8601). Sudah divalidasi di controller. */
  startDateTimeLessThan?: string;
}

export async function fetchAshtamHistories(
  params: FetchAshtamHistoriesParams = {},
): Promise<unknown> {
  const { size = 2000, startDateTimeLessThan } = params;

  const query = new URLSearchParams({ size: String(size) });
  if (startDateTimeLessThan) {
    query.set("startDateTime.lessThan", startDateTimeLessThan);
  }

  const url = `${NAVSIM_BASE_URL}/ashtam-histories?${query.toString()}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), NAVSIM_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
      // biome-ignore lint/style/useNamingConvention: The property name is based on the provider's API response.
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new NavsimUpstreamError(
        `NAVSIM did not respond within ${NAVSIM_TIMEOUT_MS}ms`,
        504,
      );
    }
    throw new NavsimUpstreamError(
      `Failed to reach NAVSIM: ${err instanceof Error ? err.message : String(err)}`,
      502,
    );
  } finally {
    clearTimeout(timeout);
  }

  const rawBody = await response.text();

  if (!response.ok) {
    throw new NavsimUpstreamError(
      `NAVSIM returned ${response.status} ${response.statusText}`,
      response.status,
      safeParseJson(rawBody) ?? rawBody,
    );
  }

  const parsed = safeParseJson(rawBody);
  if (parsed === undefined) {
    throw new NavsimUpstreamError(
      "NAVSIM returned a 2xx response with a body that was not valid JSON",
      502,
      rawBody,
    );
  }

  return parsed;
}

function safeParseJson(raw: string): unknown {
  try {
    return raw.length ? JSON.parse(raw) : null;
  } catch {
    return undefined;
  }
}
