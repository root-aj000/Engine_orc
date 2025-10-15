import pino from "pino";
import { ENV } from "./env";

export const logger = pino({
  level: ENV.LOG_LEVEL,
  transport: ENV.NODE_ENV === "development" ? { target: "pino-pretty" } : undefined
});

export function withTenant(tenantId?: string) {
  return logger.child({ tenantId });
}
