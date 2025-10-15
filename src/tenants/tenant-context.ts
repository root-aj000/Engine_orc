import { AsyncLocalStorage } from "node:async_hooks";

type TenantContext = { tenantId: string };

const storage = new AsyncLocalStorage<TenantContext>();

export function runWithTenantContext<T>(tenantId: string, fn: () => Promise<T> | T): Promise<T> | T {
  return storage.run({ tenantId }, fn);
}

export function setTenantContext(tenantId: string) {
  storage.enterWith({ tenantId });
}

export function getTenantContext(): TenantContext | undefined {
  return storage.getStore();
}
