import { fail, ok, toResponse } from "@aeroswarm/core/api";
import {
  formatTrail,
  type TrailQuery,
  trailToColumns,
} from "@aeroswarm/live-server";
import { logger } from "@repo/logger";
import { Hono } from "hono";
import { MAX_LIMIT } from "./trail-config";
import { trailMetrics } from "./trail-metrics";
import type { TrailService } from "./trail-service";

export interface TrailRouteDeps {
  service: TrailService;
  /** True when the token may read trails. */
  authenticate: (token: string | null) => boolean;
  /** A time mark every this many ms when the request does not say. 0 = none. */
  labelEveryMs: number;
  /** Points returned when the request gives no `limit`. */
  defaultLimit: number;
}

export interface ParsedTrailRequest {
  query: TrailQuery;
  format: "geojson" | "points";
  labelEveryMs: number;
  labelFormat: "datetime" | "time";
  tz: string;
}

type Parsed =
  | { ok: true; request: ParsedTrailRequest }
  | { ok: false; message: string };

const DAY_MS = 86_400_000;

/** Epoch milliseconds, or an ISO date. */
function time(raw: string): number | null {
  const n = /^-?\d+$/.test(raw) ? Number(raw) : Date.parse(raw);
  return Number.isFinite(n) ? n : null;
}

function validTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

type Q = Record<string, string | undefined>;

/** A time parameter: absent, valid, or an error message. */
function timeParam(q: Q, name: string): number | undefined | Error {
  const raw = q[name];
  if (raw === undefined || raw === "") return undefined;
  const t = time(raw);
  return t === null
    ? new Error(`${name} must be epoch milliseconds or an ISO date`)
    : t;
}

/** A number within a range: absent, valid, or an error message. */
function numberParam(
  q: Q,
  name: string,
  min: number,
  max: number,
  integer = false,
): number | undefined | Error {
  const raw = q[name];
  if (raw === undefined || raw === "") return undefined;
  const n = Number(raw);
  const bad =
    !Number.isFinite(n) ||
    n < min ||
    n > max ||
    (integer && !Number.isInteger(n));
  return bad
    ? new Error(
        `${name} must be ${integer ? "a whole number" : "a number"} from ${min} to ${max}`,
      )
    : n;
}

const firstError = (...values: unknown[]): Error | undefined =>
  values.find((v): v is Error => v instanceof Error);

/** Checks the query string; the first problem is reported by name. */
export function parseTrailQuery(
  q: Q,
  deps: Pick<TrailRouteDeps, "labelEveryMs" | "defaultLimit">,
): Parsed {
  const fromMs = timeParam(q, "fromMs");
  const toMs = timeParam(q, "toMs");
  const sinceMs = timeParam(q, "sinceMs");
  const stepM = numberParam(q, "stepM", 0, 1_000_000);
  const limit = numberParam(q, "limit", 2, MAX_LIMIT, true);
  const labelEveryMs = numberParam(q, "labelEveryMs", 0, DAY_MS);
  const error = firstError(fromMs, toMs, sinceMs, stepM, limit, labelEveryMs);
  if (error) return { ok: false, message: error.message };

  const format = q.format ?? "geojson";
  if (format !== "geojson" && format !== "points") {
    return { ok: false, message: "format must be geojson or points" };
  }
  const labelFormat = q.labelFormat ?? "datetime";
  if (labelFormat !== "datetime" && labelFormat !== "time") {
    return { ok: false, message: "labelFormat must be datetime or time" };
  }
  const tz = q.tz || "UTC";
  if (!validTimeZone(tz)) {
    return {
      ok: false,
      message: `tz "${tz}" is not a time zone (e.g. Asia/Jakarta)`,
    };
  }
  const from = fromMs as number | undefined;
  const to = toMs as number | undefined;
  const since = sinceMs as number | undefined;
  if (since !== undefined && from !== undefined) {
    return { ok: false, message: "use sinceMs or fromMs, not both" };
  }
  if (from !== undefined && to !== undefined && from > to) {
    return { ok: false, message: "fromMs must not be after toMs" };
  }

  return {
    ok: true,
    request: {
      query: {
        fromMs: from,
        toMs: to,
        sinceMs: since,
        stepM: stepM as number | undefined,
        limit: (limit as number | undefined) ?? deps.defaultLimit,
      },
      format,
      labelFormat,
      tz,
      labelEveryMs: (labelEveryMs as number | undefined) ?? deps.labelEveryMs,
    },
  };
}

/** The trail service is built in index.ts, after the live picture exists. */
let deps: TrailRouteDeps | null = null;

export function registerTrailRoute(next: TrailRouteDeps | null): void {
  deps = next;
}

const bearer = (header: string | undefined): string | null =>
  header?.startsWith("Bearer ") ? header.slice(7) : null;

/** A live answer must never be served from a cache. */
function noStore(res: Response): Response {
  res.headers.set("cache-control", "no-store");
  return res;
}

const app = new Hono().get("/tracks/:trackId/trail", async (c) => {
  if (!deps)
    return noStore(toResponse(fail("UNAVAILABLE", "trails are not enabled")));
  if (
    !deps.authenticate(
      bearer(c.req.header("authorization")) ?? c.req.query("token") ?? null,
    )
  ) {
    return noStore(toResponse(fail("UNAUTHORIZED", "Unauthorized")));
  }
  const parsed = parseTrailQuery(c.req.query(), deps);
  if (!parsed.ok)
    return noStore(toResponse(fail("BAD_REQUEST", parsed.message)));
  const { query, format, tz, labelEveryMs, labelFormat } = parsed.request;

  const trackId = c.req.param("trackId");
  try {
    const answer = await deps.service.get(trackId, query);
    if (!answer) {
      trailMetrics.notFound.inc();
      return noStore(
        toResponse(fail("NOT_FOUND", `no trail for track ${trackId}`)),
      );
    }
    (answer.source === "memory"
      ? trailMetrics.fromMemory
      : trailMetrics.fromDatabase
    ).inc();
    const data =
      format === "points"
        ? trailToColumns(answer.slice)
        : formatTrail(answer.slice, { tz, labelEveryMs, labelFormat });
    return noStore(
      toResponse(
        ok(data, {
          count: answer.slice.points.length,
          truncated: answer.slice.truncated,
        }),
      ),
    );
  } catch (err) {
    logger.error({ err, trackId }, "trail request failed");
    return noStore(toResponse(fail("INTERNAL", "Internal server error")));
  }
});

export default app;
