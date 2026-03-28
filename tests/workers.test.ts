import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Queue, Worker } from "bullmq";

describe("Workers", () => {
  let queue: Queue;
  let worker: Worker;
  const connection = { host: "127.0.0.1", port: 6379 };

  beforeAll(async () => {
    queue = new Queue("test-queue", { connection });
    worker = new Worker(
      "test-queue",
      async (job) => {
        return { processed: job.data.value * 2 };
      },
      { connection }
    );
  });

  afterAll(async () => {
    await queue.close();
    await worker.close();
  });

  it("processes jobs correctly", async () => {
    const job = await queue.add("job1", { value: 5 });
    const result = await job.waitUntilFinished(worker);
    expect(result.processed).toBe(10);
  });
});
