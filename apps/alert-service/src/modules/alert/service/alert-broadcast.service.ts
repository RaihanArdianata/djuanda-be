import type { Alert } from "@repo/database";
import { logger } from "@repo/logger";
import { publishToTopic } from "@repo/shared/sse/publisher";

export async function broadcastAlert(
  alert: Alert,
  eventType: string,
): Promise<void> {
  const payload = JSON.stringify({
    eventType,
    timestamp: new Date().toISOString(),
    alert,
  });

  try {
    await publishToTopic("alerts", payload);
  } catch (err) {
    logger.warn({ err }, "failed to broadcast alert to Redis");
  }
}
