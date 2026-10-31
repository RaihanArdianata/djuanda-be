/** Small env-parsing helpers shared by the ASTERIX and AFTN feed configs. */

export type Env = Record<string, string | undefined>;

export const isPort = (n: number): boolean =>
  Number.isInteger(n) && n >= 1 && n <= 65535;

/** A valid port, or null when unset/invalid. */
export function parsePort(raw: string | undefined): number | null {
  if (!raw?.trim()) return null;
  const n = Number(raw);
  return isPort(n) ? n : null;
}

/** A non-blank string, trimmed, or undefined. */
export const str = (v: unknown): string | undefined =>
  typeof v === "string" && v.trim() ? v.trim() : undefined;

/** Port from env; null when unset, with a warning when set but invalid. */
export function portFromEnv(
  env: Env,
  key: string,
  feedLabel: string,
  warnings: string[],
): number | null {
  const port = parsePort(env[key]);
  if (port === null && env[key]?.trim()) {
    warnings.push(
      `${key}="${env[key]}" is not a valid port — ${feedLabel} feed disabled`,
    );
  }
  return port;
}
