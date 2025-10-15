import { Router } from "express";
import { db } from "../../db/db-client";
import { zWorkflowDefinition } from "../../global";
import { ValidationError, NotFoundError } from "../../lib/errors";

const router = Router();

// List workflows for tenant
router.get("/", async (req, res, next) => {
  try {
    const tenantId = req.tenant!.id;
    const workflows = await db.workflow.findMany({
      where: { tenantId },
      orderBy: { createdAt: "desc" }
    });
    res.json(workflows);
  } catch (err) {
    next(err);
  }
});

// Create workflow
router.post("/", async (req, res, next) => {
  try {
    const tenantId = req.tenant!.id;
    const payload = req.body;
    if (!payload?.definition) throw new ValidationError("definition is required");
    const def = zWorkflowDefinition.parse({ ...payload.definition, tenantId });

    const created = await db.workflow.create({
      data: {
        tenantId,
        name: def.name,
        definition: def
      }
    });
    res.status(201).json(created);
  } catch (err) {
    next(err);
  }
});

// Get workflow by ID
router.get("/:id", async (req, res, next) => {
  try {
    const tenantId = req.tenant!.id;
    const id = req.params.id;
    const wf = await db.workflow.findFirst({ where: { id, tenantId } });
    if (!wf) throw new NotFoundError("Workflow not found");
    res.json(wf);
  } catch (err) {
    next(err);
  }
});

// Update workflow
router.put("/:id", async (req, res, next) => {
  try {
    const tenantId = req.tenant!.id;
    const id = req.params.id;
    const payload = req.body;
    const wf = await db.workflow.findFirst({ where: { id, tenantId } });
    if (!wf) throw new NotFoundError("Workflow not found");

    const definition = payload?.definition ? zWorkflowDefinition.parse({ ...payload.definition, tenantId }) : (wf.definition as any);
    const name = payload?.name ?? wf.name;

    const updated = await db.workflow.update({
      where: { id },
      data: { name, definition }
    });
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// Delete workflow
router.delete("/:id", async (req, res, next) => {
  try {
    const tenantId = req.tenant!.id;
    const id = req.params.id;
    const wf = await db.workflow.findFirst({ where: { id, tenantId } });
    if (!wf) throw new NotFoundError("Workflow not found");
    await db.execution.deleteMany({ where: { workflowId: id } });
    await db.workflow.delete({ where: { id } });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

export default router;
