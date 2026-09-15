import type { NotamMessage } from "@repo/database";
import { logger } from "@repo/logger";
import { publishToTopic } from "@repo/shared/sse/publisher";

export type NotamBroadcastEventType = "created" | "updated" | "status_changed";

export async function broadcastNotam(
  notam: NotamMessage,
  eventType: NotamBroadcastEventType,
): Promise<void> {
  const payload = JSON.stringify({
    eventType,
    timestamp: new Date().toISOString(),
    notam,
  });

  try {
    await publishToTopic("notams", payload);
  } catch (err) {
    logger.warn({ err }, "failed to broadcast notam to Redis");
  }
}
