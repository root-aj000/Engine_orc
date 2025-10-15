import { db } from "../db/db-client";
import type { TenantModel } from "./tenant-model";
import { NotFoundError, ValidationError } from "../lib/errors";

export class TenantManager {
  async createTenant(name: string, config?: Record<string, unknown>): Promise<TenantModel> {
    if (!name?.trim()) throw new ValidationError("Tenant name is required");
    return db.tenant.create({ data: { name, config: config ?? {} } });
  }

  async getTenant(id: string): Promise<TenantModel> {
    const tenant = await db.tenant.findUnique({ where: { id } });
    if (!tenant) throw new NotFoundError("Tenant not found");
    return tenant;
  }

  async listTenants(): Promise<TenantModel[]> {
    return db.tenant.findMany({ orderBy: { createdAt: "desc" } });
  }

  async deleteTenant(id: string): Promise<void> {
    await this.getTenant(id);
    await db.workflow.deleteMany({ where: { tenantId: id } });
    await db.tenant.delete({ where: { id } });
  }
}

export const tenantManager = new TenantManager();
