import { describe, it, expect } from "vitest";
import { tenantManager } from "../src/tenants/tenant-manager";

describe("Tenant manager", () => {
  it("creates and fetches a tenant", async () => {
    const t = await tenantManager.createTenant("Acme");
    const fetched = await tenantManager.getTenant(t.id);
    expect(fetched.id).toBe(t.id);
  });
});