import {
  type AftnMessage,
  db,
  type NotamMessage,
  notamMessages,
} from "@repo/database";
import { and, eq, gte, lte } from "drizzle-orm";
import {
  deleteNotamMessages,
  getAftnMessages,
  getNotamMessages,
  setAftnMessage,
  setNotamMessages,
} from "@/cache/context.cache";
import { alertServiceEnv } from "@/config/env";
import type {
  AftnContextData,
  NotamContextData,
} from "../modules/engine/types";

async function fetchAftnMessages(airportId: string): Promise<AftnMessage[]> {
  const url = new URL("/aftn", alertServiceEnv.advisoryServiceUrl);
  url.searchParams.set("destination", airportId);
  url.searchParams.set("messageType", "FPL");
  url.searchParams.set("limit", "200");
  try {
    // Fallback cold-start saja — sumber utama AFTN adalah asmgcs.advisory
    // consumer yang mengisi cache. Timeout pendek supaya satu advisory-service
    // yang lambat tidak menahan evaluasi semua rule.
    const res = await fetch(url.toString(), {
      signal: AbortSignal.timeout(2_000),
    });
    if (!res.ok) return [];
    const json = (await res.json()) as { data?: { items: AftnMessage[] } };
    return json.data?.items ?? [];
  } catch {
    return [];
  }
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

async function fetchNotamMessages(airportId: string): Promise<NotamMessage[]> {
  const now = new Date();
  const rows = await db
    .select()
    .from(notamMessages)
    .where(
      and(
        eq(notamMessages.icaoLocation, airportId),
        eq(notamMessages.status, "ACTIVE"),
        lte(notamMessages.effectiveFrom, now),
        gte(notamMessages.effectiveTo, now),
      ),
    );
  return rows;
}

export async function cacheNotamMessages(
  airportId: string,
  messages: NotamMessage[],
): Promise<void> {
  await setNotamMessages(airportId, messages);
}

export async function getNotamContext(
  airportId: string,
): Promise<NotamContextData | null> {
  let messages = await getNotamMessages(airportId);
  if (!messages) {
    messages = await fetchNotamMessages(airportId);
    if (messages.length === 0) return null;
    await setNotamMessages(airportId, messages);
  }
  return { messages };
}

export async function invalidateNotamCache(airportId: string): Promise<void> {
  await deleteNotamMessages(airportId);
}
