import { redisConfig } from "@repo/config";
import { logger } from "@repo/logger";
import { Queue } from "bullmq";

let queue: Queue | undefined;
export function getPlaybackFileQueue(): Queue {
  if (!queue) {
    queue = new Queue("playback-file-management", { connection: redisConfig });
    queue.on("error", (error) => {
      logger.error({ err: error }, "Playback file queue error");
    });
  }
  return queue;
}

export async function closePlaybackFileQueue(): Promise<void> {
  if (queue) {
    await queue.close();
    queue = undefined;
  }
}
