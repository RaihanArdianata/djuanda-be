import { env } from "./env";

/** The token the gateway uses towards connection-service, or undefined when none is configured. */
export function connectionServiceToken(
  source: Pick<
    typeof env,
    "CONNECTION_SERVICE_TOKEN" | "CONNECTION_API_TOKENS"
  > = env,
): string | undefined {
  const explicit = source.CONNECTION_SERVICE_TOKEN?.trim();
  if (explicit) return explicit;
  const first = source.CONNECTION_API_TOKENS?.split(",")
    .map((t) => t.trim())
    .find((t) => t.length > 0);
  return first || undefined;
}
