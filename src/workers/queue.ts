// src/workers/queue.ts
import { Queue, JobsOptions } from "bullmq";
import Redis from "ioredis";
import { ENV } from "../lib/env";

export const EXECUTION_QUEUE = "executions";

let queue: Queue | null = null;

function shouldDisableQueue() {
  return process.env.NODE_ENV === "test" || process.env.QUEUE_DISABLED === "1";
}

function getQueue(): Queue | null {
  if (shouldDisableQueue()) return null;
  if (!queue) {
    const connection = new Redis(ENV.REDIS_URL); // robust: works for redis:// URLs
    queue = new Queue(EXECUTION_QUEUE, { connection });
  }
  return queue;
}

export type ExecutionJobData = {
  tenantId: string;
  workflowId: string;
  payload: any;
};

export async function enqueueExecution(
  job: ExecutionJobData,
  opts?: { delay?: number; repeat?: { cron: string } }
) {
  const q = getQueue();
  if (!q) {
    // No-op stub in tests or when disabled
    return { id: "disabled", name: "run", data: job };
  }
  const jobOpts: JobsOptions = {
    removeOnComplete: 1000,
    removeOnFail: 1000,
    delay: opts?.delay,
    repeat: opts?.repeat
  };
  return q.add("run", job, jobOpts);
}