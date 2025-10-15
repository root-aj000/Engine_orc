// src/tenants/tenant-manager.ts
import { db, Prisma } from "../db/db-client";
import type { TenantModel } from "./tenant-model";
import { NotFoundError, ValidationError } from "../lib/errors";

export class TenantManager {
  /**
   * Create a new tenant.
   * @param name Tenant name
   * @param config Optional tenant-specific configuration (JSON)
   */
  async createTenant(name: string, config?: Record<string, unknown>): Promise<TenantModel> {
    if (!name?.trim()) throw new ValidationError("Tenant name is required");

    // Cast config to Prisma.InputJsonValue to satisfy Prisma typing
    const safeConfig: Prisma.InputJsonValue = config ?? {};

    return db.tenant.create({ data: { name, config: safeConfig } });
  }

  /**
   * Fetch a tenant by ID
   */
  async getTenant(id: string): Promise<TenantModel> {
    const tenant = await db.tenant.findUnique({ where: { id } });
    if (!tenant) throw new NotFoundError("Tenant not found");
    return tenant;
  }

  /**
   * List all tenants
   */
  async listTenants(): Promise<TenantModel[]> {
    return db.tenant.findMany({ orderBy: { createdAt: "desc" } });
  }

  /**
   * Delete a tenant and all its workflows
   */
  async deleteTenant(id: string): Promise<void> {
    // Verify tenant exists
    await this.getTenant(id);

    // Delete workflows and executions first to maintain referential integrity
    await db.execution.deleteMany({ where: { tenantId: id } });
    await db.workflow.deleteMany({ where: { tenantId: id } });

    await db.tenant.delete({ where: { id } });
  }
}

export const tenantManager = new TenantManager();
