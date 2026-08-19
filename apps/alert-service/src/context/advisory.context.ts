import type { AftnMessage } from "@repo/database";
import { getAftnMessages, setAftnMessage } from "@/cache/context.cache";
import { alertServiceEnv } from "@/config/env";
import type { AftnContextData } from "../modules/engine/types";

async function fetchAftnMessages(airportId: string): Promise<AftnMessage[]> {
  const url = new URL("/aftn", alertServiceEnv.advisoryServiceUrl);
  url.searchParams.set("destination", airportId);
  url.searchParams.set("messageType", "FPL");
  url.searchParams.set("limit", "200");
  const res = await fetch(url.toString());
  if (!res.ok) return [];
  const json = (await res.json()) as { data?: { items: AftnMessage[] } };
  return json.data?.items ?? [];
}

export async function cacheAftnMessage(message: AftnMessage): Promise<void> {
  const airports = [message.departure, message.destination].filter(
    (a): a is string => typeof a === "string" && a.length > 0,
  );
  for (const airportId of new Set(airports)) {
    await setAftnMessage(airportId, message.id, message);
  }
}

export async function getAftnContext(
  airportId: string,
): Promise<AftnContextData | null> {
  let messages = await getAftnMessages(airportId);
  if (messages.length === 0) {
    messages = await fetchAftnMessages(airportId);
    if (messages.length === 0) return null;
    for (const m of messages) {
      if (m.departure === airportId || m.destination === airportId) {
        await setAftnMessage(airportId, m.id, m);
      }
    }
  }

  const byCallsign: Record<string, AftnMessage[]> = {};
  for (const m of messages) {
    const cs = m.callSign ?? "UNKNOWN";
    byCallsign[cs] ??= [];
    byCallsign[cs].push(m);
  }

  return { messages, byCallsign };
}
