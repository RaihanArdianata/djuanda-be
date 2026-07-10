import { redisConfig } from "@repo/config";
import { Queue } from "bullmq";

export const emailQueue = new Queue("email-queue", {
  connection: redisConfig,
});

export const addEmailJob = (
  type: string,
  to: string,
  data: Record<string, unknown>,
): void => {
  emailQueue.add(type, { to, ...data });
};
