import { Router } from "express";
import { tenantManager } from "../../tenants/tenant-manager";
import { ValidationError } from "../../lib/errors";

const router = Router();

// List tenants
router.get("/", async (_req, res, next) => {
  try {
    const tenants = await tenantManager.listTenants();
    res.json(tenants);
  } catch (err) {
    next(err);
  }
});

// Create tenant
router.post("/", async (req, res, next) => {
  try {
    const { name, config } = req.body ?? {};
    if (!name) throw new ValidationError("name is required");
    const tenant = await tenantManager.createTenant(name, config);
    res.status(201).json(tenant);
  } catch (err) {
    next(err);
  }
});

// Delete tenant
router.delete("/:id", async (req, res, next) => {
  try {
    await tenantManager.deleteTenant(req.params.id);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

export default router;
