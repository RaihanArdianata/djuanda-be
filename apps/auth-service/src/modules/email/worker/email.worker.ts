import { redisConfig } from "@repo/config";
import { Worker } from "bullmq";
import { sendEmail } from "../service/email.service";

export const emailWorker = new Worker(
  "email-queue",
  async (job) => {
    const { to, ...data } = job.data;

    try {
      await sendEmail(job.name, to, data);
    } catch (_error) {}
  },
  {
    connection: redisConfig,
  },
);
