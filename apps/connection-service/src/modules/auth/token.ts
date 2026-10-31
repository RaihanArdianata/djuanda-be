import { createHash, timingSafeEqual } from "node:crypto";
import { logger } from "@repo/logger";

/** What a valid token grants. `airportId` pins the connection to that airport. */
export interface TokenAuth {
  airportId?: string;
}

export interface TokenVerifier {
  /** Null for a missing, empty or unknown token. */
  verify(token: string | null | undefined): TokenAuth | null;
  readonly size: number;
}

const MIN_RECOMMENDED_LENGTH = 16;

/** Comma-separated list; blanks and duplicates are dropped. */
export function parseTokenList(raw: string | undefined): string[] {
  const out = new Set<string>();
  for (const part of (raw ?? "").split(",")) {
    const t = part.trim();
    if (t) out.add(t);
  }
  return [...out];
}

/** First characters only, safe to log. */
export function redactToken(token: string | null | undefined): string {
  if (!token) return "(none)";
  return `${token.slice(0, 4)}…(${token.length})`;
}

const digest = (token: string): Buffer =>
  createHash("sha256").update(token).digest();

/**
 * A static allowlist. Several tokens may be valid at once, which makes
 * rotation painless: add the new one, move clients over, remove the old one.
 *
 * Tokens are compared by SHA-256 digest with `timingSafeEqual`, and every
 * entry is checked on every call, so response time does not reveal how much
 * of a guess matched or which entry it hit.
 */
export function createTokenVerifier(opts: {
  tokens: string[];
  airportId?: string;
}): TokenVerifier {
  const digests = opts.tokens.map(digest);
  const grant: TokenAuth = opts.airportId ? { airportId: opts.airportId } : {};
  return {
    size: digests.length,
    verify(token: string | null | undefined): TokenAuth | null {
      if (!token) return null;
      const given = digest(token);
      let ok = false;
      for (const d of digests) {
        // No early exit: keep the work independent of which entry matches.
        if (timingSafeEqual(given, d)) ok = true;
      }
      return ok ? { ...grant } : null;
    },
  };
}

/**
 * Tokens from `CONNECTION_API_TOKENS`, plus the legacy
 * `AEROSWARM_MONITOR_TOKENS` so existing deployments keep working. The same
 * list guards the live WebSocket (`/ws/tracks/live`) and replay (`/aero/*`).
 */
export function tokensFromEnv(
  env: Record<string, string | undefined>,
): string[] {
  return [
    ...new Set([
      ...parseTokenList(env.CONNECTION_API_TOKENS),
      ...parseTokenList(env.AEROSWARM_MONITOR_TOKENS),
    ]),
  ];
}

const AIRPORT_ID: string = process.env.AEROSWARM_AIRPORT_ID || "";
const tokens = tokensFromEnv(process.env);

if (tokens.length === 0) {
  logger.warn(
    "CONNECTION_API_TOKENS is empty — the live WebSocket and replay will reject every connection",
  );
}
const weak: number = tokens.filter(
  (t) => t.length < MIN_RECOMMENDED_LENGTH,
).length;
if (weak > 0) {
  logger.warn(
    { count: weak, minLength: MIN_RECOMMENDED_LENGTH },
    "some API tokens are shorter than recommended — use long random values (e.g. `openssl rand -hex 24`)",
  );
}

/** Shared by the live WebSocket and replay. Scoped to this deployment's airport. */
export const tokenVerifier: TokenVerifier = createTokenVerifier({
  tokens,
  airportId: AIRPORT_ID || undefined,
});

export const verifyToken = (
  token: string | null | undefined,
): TokenAuth | null => tokenVerifier.verify(token);
