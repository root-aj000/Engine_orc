import { Worker, Job } from "bullmq";
import { EXECUTION_QUEUE } from "./queue";
import { QUEUE_CONFIG } from "../config/queue.config";
import { db } from "../db/db-client";
import { orchestrator } from "../core/orchestrator";
import { withTenant } from "../lib/logger";

export function startWorker() {
  const worker = new Worker(
    EXECUTION_QUEUE,
    async (job: Job) => {
      const { tenantId, workflowId, payload } = job.data as { tenantId: string; workflowId: string; payload: any };
      const logger = withTenant(tenantId);

      logger.info({ workflowId }, "Worker: starting execution");

      const workflowRow = await db.workflow.findFirst({ where: { id: workflowId, tenantId } });
      if (!workflowRow) throw new Error("Workflow not found");

      const workflowDef = workflowRow.definition as any;
      // Execution DB record
      const exec = await db.execution.create({
        data: {
          tenantId,
          workflowId,
          status: "running",
          input: payload
        }
      });

      try {
        const result = await orchestrator.run({ workflow: workflowDef, payload });
        await db.execution.update({
          where: { id: exec.id },
          data: {
            status: result.status,
            output: result
          }
        });
        logger.info({ executionId: exec.id, status: result.status }, "Worker: execution completed");
      } catch (err: any) {
        await db.execution.update({
          where: { id: exec.id },
          data: {
            status: "error",
            error: { message: err?.message ?? String(err), stack: err?.stack }
          }
        });
        logger.error({ err }, "Worker: execution failed");
        throw err;
      }
    },
    { connection: QUEUE_CONFIG.connection, concurrency: 5 }
  );

  worker.on("failed", (job, err) => {
    console.error("Job failed", job?.id, err);
  });

  worker.on("completed", (job) => {
    console.log("Job completed", job.id);
  });

  return worker;
}
