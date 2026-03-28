// src/server.ts
import express from "express";
import helmet from "helmet";
import cors from "cors";
import pinoHttp from "pino-http";
import api from "./api";
import tenantsRouter from "./api/routes/tenants.route";
import { errorMiddleware } from "./api/middleware/error.middleware";
import { authMiddleware } from "./api/middleware/auth.middleware";
import { tenantMiddleware } from "./api/middleware/tenant.middleware";
import { APP_CONFIG } from "./config/app.config";
import { logger } from "./lib/logger";

export function buildServer() {
  const app = express();

  app.use(helmet());
  app.use(cors());
  app.use(express.json({ limit: "1mb" }));
  app.use(pinoHttp({ logger }));

  // Public tenants endpoints (no auth)
  app.use("/api/tenants", tenantsRouter);

  // Protected endpoints (require API key and tenant context)
  app.use("/api", authMiddleware, tenantMiddleware, api);

  // 404
  app.use((_req, res) => res.status(404).json({ message: "Not found" }));

  // Error handler
  app.use(errorMiddleware);

  return app;
}

export function startServer() {
  const app = buildServer();
  const server = app.listen(APP_CONFIG.port, () => {
    logger.info({ port: APP_CONFIG.port }, "Server listening");
  });
  return server;
}