import { Request, Response, NextFunction } from "express";
import { tenantManager } from "../../tenants/tenant-manager";
import { ValidationError } from "../../lib/errors";

declare global {
  namespace Express {
    interface Request {
      tenant?: { id: string; name: string };
      user?: any;
    }
  }
}

export async function tenantMiddleware(req: Request, _res: Response, next: NextFunction) {
  const tenantId = req.headers["x-tenant-id"] as string | undefined;
  if (!tenantId) return next(new ValidationError("x-tenant-id header is required"));

  try {
    const tenant = await tenantManager.getTenant(tenantId);
    req.tenant = { id: tenant.id, name: tenant.name };
    next();
  } catch (err) {
    next(err);
  }
}
