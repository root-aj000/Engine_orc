import { Router } from "express";
import { orchestrator } from "../../core/orchestrator";
import { db } from "../../db/db-client";
import { enqueueExecution } from "../../workers/queue";
import { NotFoundError, ValidationError } from "../../lib/errors";

const router = Router();

// Execute a workflow immediately (sync or async via ?mode=async)
router.post("/:workflowId/execute", async (req, res, next) => {
  try {
    const tenantId = req.tenant!.id;
    const workflowId = req.params.workflowId;
    const mode = (req.query.mode as string) || "sync";
    const payload = req.body ?? {};

    const wf = await db.workflow.findFirst({ where: { id: workflowId, tenantId } });
    if (!wf) throw new NotFoundError("Workflow not found");

    if (mode === "async") {
      await enqueueExecution({ tenantId, workflowId, payload });
      res.status(202).json({ queued: true });
      return;
    }

    // create execution record
    const exec = await db.execution.create({
      data: { workflowId, tenantId, status: "running", input: payload }
    });

    try {
      const result = await orchestrator.run({ workflow: wf.definition as any, payload });
      await db.execution.update({
        where: { id: exec.id },
        data: { status: result.status, output: result }
      });
      res.json(result);
    } catch (err: any) {
      await db.execution.update({
        where: { id: exec.id },
        data: {
          status: "error",
          error: { message: err?.message ?? String(err) }
        }
      });
      throw err;
    }
  } catch (err) {
    next(err);
  }
});

// Get execution logs (last N)
router.get("/:workflowId/logs", async (req, res, next) => {
  try {
    const tenantId = req.tenant!.id;
    const workflowId = req.params.workflowId;
    const limit = Number(req.query.limit ?? 20);
    if (Number.isNaN(limit) || limit <= 0 || limit > 200) throw new ValidationError("Invalid limit");

    const wf = await db.workflow.findFirst({ where: { id: workflowId, tenantId } });
    if (!wf) throw new NotFoundError("Workflow not found");

    const logs = await db.execution.findMany({
      where: { workflowId, tenantId },
      orderBy: { createdAt: "desc" },
      take: limit
    });

    res.json(logs);
  } catch (err) {
    next(err);
  }
});

export default router;
