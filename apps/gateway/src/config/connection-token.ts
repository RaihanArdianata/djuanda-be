import { env } from "./env";

/** The token the gateway uses towards connection-service, or undefined when none is configured. */
export function connectionServiceToken(
  source: Pick<
    typeof env,
    | "CONNECTION_SERVICE_TOKEN"
    | "CONNECTION_API_TOKENS"
    | "AEROSWARM_MONITOR_TOKENS"
  > = env,
): string | undefined {
  const explicit = source.CONNECTION_SERVICE_TOKEN?.trim();
  if (explicit) return explicit;
  // Same lists, same order as connection-service reads them.
  const list = [
    source.CONNECTION_API_TOKENS,
    source.AEROSWARM_MONITOR_TOKENS,
  ].join(",");
  const first = list
    .split(",")
    .map((t) => t.trim())
    .find((t) => t.length > 0);
  return first || undefined;
}
