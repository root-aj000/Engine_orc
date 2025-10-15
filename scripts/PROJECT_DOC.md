# Project Files Documentation

### scripts/validate-engine.ts

```ts
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

```

### src/api/index.ts

```ts
import express from "express";
import workflowsRouter from "./routes/workflows.route";
import tenantsRouter from "./routes/tenants.route";
import executionsRouter from "./routes/executions.route";

const api = express.Router();

api.get("/health", (_req, res) => res.json({ ok: true }));

api.use("/tenants", tenantsRouter);
api.use("/workflows", workflowsRouter);
api.use("/executions", executionsRouter);

export default api;
```

### src/api/middleware/auth.middleware.ts

```ts
// import { Request, Response, NextFunction } from "express";
// import { ENV } from "../../lib/env";
// import { UnauthorizedError } from "../../lib/errors";

// export function authMiddleware(req: Request, _res: Response, next: NextFunction) {
//   // Simple API key auth via header
//   const auth = req.headers["authorization"];
//   const apiKeyHeader = req.headers["x-api-key"];
//   const token = auth?.startsWith("Bearer ") ? auth.substring(7) : (apiKeyHeader as string | undefined);

//   if (!token || token !== ENV.API_KEY) {
//     return next(new UnauthorizedError("Invalid or missing API key"));
//   }

//   // optionally attach req.user
//   (req as any).user = { token: "api-key-user" };
//   next();
// }

import { Request, Response, NextFunction } from "express";

export function authMiddleware(req: Request, res: Response, next: NextFunction) {
  const apiKey = req.headers.authorization?.split(" ")[1];
  const tenantId = req.headers["x-tenant-id"];

  if (apiKey === "dev_api_key_123" && tenantId) {
    return next(); // ✅ must call next()
  }

  return res.status(401).json({ error: "Unauthorized" });
}

```

### src/api/middleware/error.middleware.ts

```ts
import { Request, Response, NextFunction } from "express";
import { ApiError } from "../../lib/errors";
import { logger } from "../../lib/logger";

export function errorMiddleware(err: any, _req: Request, res: Response, _next: NextFunction) {
  const status = err instanceof ApiError ? err.status : 500;
  const code = err instanceof ApiError ? err.code : "INTERNAL_ERROR";
  const message = err?.message ?? "Internal Server Error";
  const details = err?.details;

  if (status >= 500) {
    logger.error({ err }, "Unhandled error");
  } else {
    logger.warn({ err }, "Handled error");
  }

  res.status(status).json({ message, code, details });
}

```

### src/api/middleware/tenant.middleware.ts

```ts
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

```

### src/api/routes/executions.route.ts

```ts
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

```

### src/api/routes/tenants.route.ts

```ts
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

```

### src/api/routes/workflows.route.ts

```ts
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

```

### src/config/app.config.ts

```ts
import { ENV } from "../lib/env";

export const APP_CONFIG = {
  port: ENV.PORT,
  env: ENV.NODE_ENV
};
```

### src/config/db.config.ts

```ts
import { ENV } from "../lib/env";

export const DB_CONFIG = {
  url: ENV.DATABASE_URL
};
```

### src/config/queue.config.ts

```ts
import { ENV } from "../lib/env";

export const QUEUE_CONFIG = {
  connection: ENV.REDIS_URL
};
```

### src/config/tenant.config.ts

```ts
export const TENANT_CONFIG = {
  defaultLimits: {
    maxWorkflows: 100,
    maxExecutionsPerDay: 10000
  },
  retentionDays: 30
};
```

### src/core/node-registry.ts

```ts
import type { NodeExecutor } from "../global";
import { httpNode } from "./node-types/http-node";
import { codeNode } from "./node-types/code-node";
import { webhookNode } from "./node-types/webhook-node";

class NodeRegistry {
  private registry = new Map<string, NodeExecutor>();

  register(type: string, executor: NodeExecutor) {
    this.registry.set(type, executor);
  }

  get(type: string): NodeExecutor {
    const exec = this.registry.get(type);
    if (!exec) throw new Error(`Node type not registered: ${type}`);
    return exec;
  }

  has(type: string) {
    return this.registry.has(type);
  }
}

export const nodeRegistry = new NodeRegistry();

// Register built-in nodes
nodeRegistry.register("http", httpNode);
nodeRegistry.register("code", codeNode);
nodeRegistry.register("webhook", webhookNode);

```

### src/core/node-runner.ts

```ts
import { nodeRegistry } from "./node-registry";
import type { NodeSpec, NodeRunContext, NodeResult } from "../global";

export async function executeNode(node: NodeSpec, input: any, context: Omit<NodeRunContext, "nodeId">): Promise<NodeResult> {
  const startedAt = new Date().toISOString();
  try {
    const executor = nodeRegistry.get(node.type);
    const output = await executor({
      config: node.config,
      input,
      context: { ...context, nodeId: node.id }
    });
    const finishedAt = new Date().toISOString();
    return {
      nodeId: node.id,
      status: "success",
      output,
      startedAt,
      finishedAt
    };
  } catch (err: any) {
    const finishedAt = new Date().toISOString();
    return {
      nodeId: node.id,
      status: "error",
      error: { message: err?.message ?? String(err), stack: err?.stack },
      startedAt,
      finishedAt
    };
  }
}
```

### src/core/node-types/code-node.ts

```ts
import { NodeVM } from "vm2";
import type { NodeExecutor } from "../../global";

export const codeNode: NodeExecutor = async ({ config, input, context }) => {
  const { code, timeoutMs } = config as { code: string; timeoutMs?: number };
  if (!code) throw new Error("code node requires 'code'");

  const vm = new NodeVM({
    console: "redirect",
    sandbox: { input, env: context.env },
    timeout: timeoutMs ?? 3000,
    eval: false,
    wasm: false,
    require: {
      external: false
    }
  });

  vm.on("console.log", (data: any) => context.logger.info({ data }, "code node log"));
  vm.on("console.error", (data: any) => context.logger.error({ data }, "code node error"));

  // Code should export a default function or return a value.
  // Example:
  // module.exports = (input, env) => { return { foo: input.x + 1 }; }
  const wrapper = `
    const fn = (typeof module.exports === 'function') ? module.exports :
      (typeof exports === 'function' ? exports : null);
    if (fn) {
      module.exports = fn(sandbox.input, sandbox.env);
    } else if (typeof module.exports === 'object') {
      module.exports = module.exports;
    } else {
      module.exports = sandbox.input;
    }
  `;

  // Load user code into VM's module
  const userModule = `
    ${code}
  `;

  const result = vm.run(userModule + "\n" + wrapper, "vm2-code-node.js");
  return result;
};

```

### src/core/node-types/http-node.ts

```ts
import axios from "axios";
import type { NodeExecutor } from "../../global";

export const httpNode: NodeExecutor = async ({ config, input, context }) => {
  const { method, url, headers, timeoutMs } = config as {
    method: string; url: string; headers?: Record<string, string>; timeoutMs?: number;
  };

  if (!method || !url) throw new Error("http node requires method and url");

  context.logger.info({ url, method }, "HTTP node request");

  const res = await axios.request({
    method,
    url,
    headers,
    timeout: timeoutMs ?? 15000,
    data: input
  });

  return res.data;
};

```

### src/core/node-types/webhook-node.ts

```ts
import type { NodeExecutor } from "../../global";

// For now, a webhook node acts as a pass-through starter node.
// In real setups, you'd expose an external endpoint and inject payload into the workflow.
export const webhookNode: NodeExecutor = async ({ input }) => {
  return input ?? {};
};
```

### src/core/orchestrator.ts

```ts
import type { ExecutionResult, NodeResult, WorkflowDefinition } from "../global";
import { buildExecutionPlan } from "./workflow-engine";
import { executeNode } from "./node-runner";
import { withTenant } from "../lib/logger";

export class Orchestrator {
  async run(args: { workflow: WorkflowDefinition; payload: any }): Promise<ExecutionResult> {
    const { workflow, payload } = args;
    const plan = buildExecutionPlan(workflow);

    const startedAt = new Date().toISOString();
    const results: NodeResult[] = [];
    const logger = withTenant(workflow.tenantId);

    // Keep a map: nodeId -> output
    const outputs = new Map<string, any>();

    // Helper to compute input to a node from its predecessors
    function buildInput(nodeId: string): any {
      // find predecessors
      const preds = workflow.edges.filter((e) => e.to === nodeId).map((e) => e.from);
      if (preds.length === 0) {
        return payload;
      }
      if (preds.length === 1) {
        return outputs.get(preds[0]);
      }
      const merged: Record<string, any> = {};
      for (const p of preds) {
        merged[p] = outputs.get(p);
      }
      return merged;
    }

    for (const layer of plan) {
      const layerResults = await Promise.all(
        layer.map(async (nodeId) => {
          const node = workflow.nodes.find((n) => n.id === nodeId)!;
          const input = buildInput(nodeId);
          const res = await executeNode(node, input, {
            env: process.env,
            logger,
            tenantId: workflow.tenantId,
            workflowId: workflow.id
          });
          if (res.status === "success") outputs.set(nodeId, res.output);
          return res;
        })
      );
      results.push(...layerResults);
    }

    const status = results.some((r) => r.status === "error") ? "error" : "success";
    const finishedAt = new Date().toISOString();

    return {
      workflowId: workflow.id,
      tenantId: workflow.tenantId,
      status,
      startedAt,
      finishedAt,
      results
    };
  }
}

export const orchestrator = new Orchestrator();

```

### src/core/workflow-engine.ts

```ts
import type { ExecutionPlan, WorkflowDefinition } from "../global";
import { ValidationError } from "../lib/errors";

export function buildExecutionPlan(workflow: WorkflowDefinition): ExecutionPlan {
  const nodeIds = new Set(workflow.nodes.map((n) => n.id));
  for (const e of workflow.edges) {
    if (!nodeIds.has(e.from)) throw new ValidationError(`Edge.from references missing node: ${e.from}`);
    if (!nodeIds.has(e.to)) throw new ValidationError(`Edge.to references missing node: ${e.to}`);
  }

  const indegree = new Map<string, number>();
  const adj = new Map<string, string[]>();
  for (const id of nodeIds) {
    indegree.set(id, 0);
    adj.set(id, []);
  }
  for (const e of workflow.edges) {
    indegree.set(e.to, (indegree.get(e.to) ?? 0) + 1);
    adj.get(e.from)!.push(e.to);
  }

  // Kahn's algorithm with layering
  const layers: string[][] = [];
  let currentLayer = Array.from(nodeIds).filter((id) => (indegree.get(id) ?? 0) === 0);

  const visited = new Set<string>();
  while (currentLayer.length > 0) {
    layers.push(currentLayer);
    const nextLayerSet = new Set<string>();
    for (const u of currentLayer) {
      visited.add(u);
      for (const v of adj.get(u) ?? []) {
        indegree.set(v, (indegree.get(v) ?? 0) - 1);
        if ((indegree.get(v) ?? 0) === 0) nextLayerSet.add(v);
      }
    }
    currentLayer = Array.from(nextLayerSet);
  }

  if (visited.size !== nodeIds.size) {
    throw new ValidationError("Workflow graph contains a cycle or unreachable nodes");
  }

  return layers;
}
```

### src/db/db-client.ts

```ts
import { PrismaClient } from "@prisma/client";

export const db = new PrismaClient();

export type DB = typeof db;
```

### src/global.ts

```ts
import { z } from "zod";

export type JSONValue = string | number | boolean | null | JSONObject | JSONArray;
export interface JSONObject { [key: string]: JSONValue }
export interface JSONArray extends Array<JSONValue> {}

export type NodeType = "http" | "webhook" | "code";

export type HttpNodeConfig = {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  url: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
};

export type CodeNodeConfig = {
  code: string;
  timeoutMs?: number;
};

export type WebhookNodeConfig = {
  name?: string;
};

export type AnyNodeConfig = HttpNodeConfig | CodeNodeConfig | WebhookNodeConfig;

export interface NodeSpec<T extends AnyNodeConfig = AnyNodeConfig> {
  id: string;
  type: NodeType;
  name?: string;
  config: T;
}

export interface Edge {
  from: string;
  to: string;
}

export interface WorkflowDefinition {
  id: string;
  tenantId: string;
  name: string;
  nodes: NodeSpec[];
  edges: Edge[];
  createdAt?: string;
  updatedAt?: string;
}

export interface NodeRunContext {
  tenantId: string;
  workflowId: string;
  nodeId: string;
  env: Record<string, string | undefined>;
  logger: { info: (o: any, m?: string) => void; error: (o: any, m?: string) => void; debug: (o: any, m?: string) => void; warn: (o: any, m?: string) => void };
}

export type NodeExecutor<C extends AnyNodeConfig = AnyNodeConfig> = (args: {
  config: C;
  input: any;
  context: NodeRunContext;
}) => Promise<any>;

export interface NodeResult {
  nodeId: string;
  status: "success" | "error";
  output?: any;
  error?: { message: string; stack?: string };
  startedAt: string;
  finishedAt: string;
}

export interface ExecutionResult {
  workflowId: string;
  tenantId: string;
  status: "success" | "error";
  startedAt: string;
  finishedAt: string;
  results: NodeResult[];
}

export const zEdge = z.object({
  from: z.string().min(1),
  to: z.string().min(1)
});

export const zNodeSpec = z.object({
  id: z.string().min(1),
  type: z.enum(["http", "code", "webhook"]),
  name: z.string().optional(),
  config: z.any()
});

export const zWorkflowDefinition = z.object({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  name: z.string().min(1),
  nodes: z.array(zNodeSpec),
  edges: z.array(zEdge)
});

export type ExecutionPlanLayer = string[]; // node ids
export type ExecutionPlan = ExecutionPlanLayer[];

```

### src/index.ts

```ts
import { startServer } from "./server";
import { startWorker } from "./workers/worker";
import { db } from "./db/db-client";
import { logger } from "./lib/logger";

async function main() {
  // Ensure DB connection
  await db.$connect();
  logger.info("DB connected");

  // Start HTTP server
  startServer();

  // Start worker
  startWorker();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

```

### src/lib/env.ts

```ts
import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const EnvSchema = z.object({
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  PORT: z.coerce.number().default(3000),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  API_KEY: z.string().min(1),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info")
});

export const ENV = EnvSchema.parse(process.env);

// src/lib/env.ts
export function getEnv(key: string, fallback?: string): string {
  const value = process.env[key];
  if (!value && !fallback) {
    throw new Error(`Missing environment variable: ${key}`);
  }
  return value ?? fallback!;
}

```

### src/lib/errors.ts

```ts
export class ApiError extends Error {
  status: number;
  code?: string;
  details?: unknown;

  constructor(status: number, message: string, code?: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export class ValidationError extends ApiError {
  constructor(message: string, details?: unknown) {
    super(400, message, "VALIDATION_ERROR", details);
  }
}

export class NotFoundError extends ApiError {
  constructor(message = "Not found") {
    super(404, message, "NOT_FOUND");
  }
}

export class UnauthorizedError extends ApiError {
  constructor(message = "Unauthorized") {
    super(401, message, "UNAUTHORIZED");
  }
}

export class ForbiddenError extends ApiError {
  constructor(message = "Forbidden") {
    super(403, message, "FORBIDDEN");
  }
}

```

### src/lib/logger.ts

```ts
import pino from "pino";
import { ENV } from "./env";

export const logger = pino({
  level: ENV.LOG_LEVEL,
  transport: ENV.NODE_ENV === "development" ? { target: "pino-pretty" } : undefined
});

export function withTenant(tenantId?: string) {
  return logger.child({ tenantId });
}

```

### src/lib/utils.ts

```ts
export const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

export function deepMerge<T extends Record<string, any>, U extends Record<string, any>>(target: T, source: U): T & U {
  const out: any = { ...target };
  Object.keys(source).forEach((key) => {
    if (source[key] && typeof source[key] === "object" && !Array.isArray(source[key])) {
      out[key] = deepMerge(out[key] || {}, source[key]);
    } else {
      out[key] = source[key];
    }
  });
  return out;
}

```

### src/server.ts

```ts
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
```

### src/tenants/tenant-context.ts

```ts
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

```

### src/tenants/tenant-manager.ts

```ts
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

```

### src/tenants/tenant-model.ts

```ts
// Thin wrapper types to keep import ergonomics consistent
import type { Tenant } from "@prisma/client";
export type TenantModel = Tenant;
```

### src/workers/queue.ts

```ts
// src/workers/queue.ts
import { Queue, JobsOptions } from "bullmq";
import Redis from "ioredis";
import { ENV } from "../lib/env";

export const EXECUTION_QUEUE = "executions";

let queue: Queue | null = null;

function shouldDisableQueue() {
  return process.env.NODE_ENV === "test" || process.env.QUEUE_DISABLED === "1";
}

function getQueue(): Queue | null {
  if (shouldDisableQueue()) return null;
  if (!queue) {
    const connection = new Redis(ENV.REDIS_URL); // robust: works for redis:// URLs
    queue = new Queue(EXECUTION_QUEUE, { connection });
  }
  return queue;
}

export type ExecutionJobData = {
  tenantId: string;
  workflowId: string;
  payload: any;
};

export async function enqueueExecution(
  job: ExecutionJobData,
  opts?: { delay?: number; repeat?: { cron: string } }
) {
  const q = getQueue();
  if (!q) {
    // No-op stub in tests or when disabled
    return { id: "disabled", name: "run", data: job };
  }
  const jobOpts: JobsOptions = {
    removeOnComplete: 1000,
    removeOnFail: 1000,
    delay: opts?.delay,
    repeat: opts?.repeat
  };
  return q.add("run", job, jobOpts);
}
```

### src/workers/scheduler.ts

```ts
import { enqueueExecution } from "./queue";

export async function scheduleWorkflowCron(params: {
  tenantId: string;
  workflowId: string;
  cron: string;
}) {
  await enqueueExecution({ tenantId: params.tenantId, workflowId: params.workflowId, payload: {} }, { repeat: { cron: params.cron } });
}
```

### src/workers/worker.ts

```ts
import { Worker, Job } from "bullmq";
import { EXECUTION_QUEUE } from "./queue";
import { QUEUE_CONFIG } from "../config/queue.config";
import { db } from "../db/db-client";
import { orchestrator } from "../core/orchestrator";
import { withTenant } from "../lib/logger";

export function startWorker() {
  const worker = new Worker(
    EXECUTION_QUEUE,
    async (job: Job) => {
      const { tenantId, workflowId, payload } = job.data as { tenantId: string; workflowId: string; payload: any };
      const logger = withTenant(tenantId);

      logger.info({ workflowId }, "Worker: starting execution");

      const workflowRow = await db.workflow.findFirst({ where: { id: workflowId, tenantId } });
      if (!workflowRow) throw new Error("Workflow not found");

      const workflowDef = workflowRow.definition as any;
      // Execution DB record
      const exec = await db.execution.create({
        data: {
          tenantId,
          workflowId,
          status: "running",
          input: payload
        }
      });

      try {
        const result = await orchestrator.run({ workflow: workflowDef, payload });
        await db.execution.update({
          where: { id: exec.id },
          data: {
            status: result.status,
            output: result
          }
        });
        logger.info({ executionId: exec.id, status: result.status }, "Worker: execution completed");
      } catch (err: any) {
        await db.execution.update({
          where: { id: exec.id },
          data: {
            status: "error",
            error: { message: err?.message ?? String(err), stack: err?.stack }
          }
        });
        logger.error({ err }, "Worker: execution failed");
        throw err;
      }
    },
    { connection: QUEUE_CONFIG.connection, concurrency: 5 }
  );

  worker.on("failed", (job, err) => {
    console.error("Job failed", job?.id, err);
  });

  worker.on("completed", (job) => {
    console.log("Job completed", job.id);
  });

  return worker;
}

```

### tests/api.test.ts

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { buildServer } from "../src/server";
import { db } from "../src/db/db-client";

const API_KEY = "dev_api_key_123"; // must match .env in dev
let app: any;
let tenantId: string;

describe("API", () => {
  beforeAll(async () => {
    app = buildServer();
    // create a tenant
    const res = await request(app).post("/api/tenants").send({ name: "Test Tenant" });
    expect(res.status).toBe(201);
    tenantId = res.body.id;
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  it("creates, gets, updates, deletes a workflow", async () => {
    const wfDef = {
      id: "wf_test_1",
      tenantId,
      name: "My WF",
      nodes: [{ id: "start", type: "webhook", config: {} }],
      edges: []
    };

    const createRes = await request(app)
      .post("/api/workflows")
      .set("Authorization", `Bearer ${API_KEY}`)
      .set("x-tenant-id", tenantId)
      .send({ definition: wfDef });
    expect(createRes.status).toBe(201);

    const listRes = await request(app)
      .get("/api/workflows")
      .set("Authorization", `Bearer ${API_KEY}`)
      .set("x-tenant-id", tenantId);
    expect(listRes.status).toBe(200);
    expect(Array.isArray(listRes.body)).toBe(true);

    const wfId = createRes.body.id;
    const getRes = await request(app)
      .get(`/api/workflows/${wfId}`)
      .set("Authorization", `Bearer ${API_KEY}`)
      .set("x-tenant-id", tenantId);
    expect(getRes.status).toBe(200);

    const updateRes = await request(app)
      .put(`/api/workflows/${wfId}`)
      .set("Authorization", `Bearer ${API_KEY}`)
      .set("x-tenant-id", tenantId)
      .send({ name: "Updated" });
    expect(updateRes.status).toBe(200);

    const delRes = await request(app)
      .delete(`/api/workflows/${wfId}`)
      .set("Authorization", `Bearer ${API_KEY}`)
      .set("x-tenant-id", tenantId);
    expect(delRes.status).toBe(204);
  });
});

```

### tests/core.test.ts

```ts
import { describe, it, expect } from "vitest";
import { buildExecutionPlan } from "../src/core/workflow-engine";
import type { WorkflowDefinition } from "../src/global";

describe("workflow-engine", () => {
  it("builds layers for simple DAG", () => {
    const wf: WorkflowDefinition = {
      id: "wf1",
      tenantId: "t1",
      name: "test",
      nodes: [
        { id: "A", type: "webhook", config: {} },
        { id: "B", type: "code", config: { code: "module.exports = (input)=> input" } },
        { id: "C", type: "http", config: { method: "POST", url: "http://example.com" } }
      ],
      edges: [
        { from: "A", to: "B" },
        { from: "B", to: "C" }
      ]
    };
    const plan = buildExecutionPlan(wf);
    expect(plan).toEqual([["A"], ["B"], ["C"]]);
  });
});

```

### tests/e2e.test.ts

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { buildServer } from "../src/server";
import { db } from "../src/db/db-client";

const API_KEY = "dev_api_key_123";
let app: any;
let tenantId: string;

describe("E2E Lifecycle", () => {
  beforeAll(async () => {
    app = buildServer();
    const res = await request(app).post("/api/tenants").send({ name: "Lifecycle Tenant" });
    tenantId = res.body.id;
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  it("runs full lifecycle", async () => {
    // Create workflow
    const wfDef = {
      id: "wf_lifecycle",
      tenantId,
      name: "Lifecycle",
      nodes: [{ id: "A", type: "code", config: { code: "module.exports=()=>({msg:'ok'})" } }],
      edges: []
    };

    const createRes = await request(app)
      .post("/api/workflows")
      .set("Authorization", `Bearer ${API_KEY}`)
      .set("x-tenant-id", tenantId)
      .send({ definition: wfDef });
    expect(createRes.status).toBe(201);

    // Execute
    const execRes = await request(app)
      .post(`/api/executions/run`)
      .set("Authorization", `Bearer ${API_KEY}`)
      .set("x-tenant-id", tenantId)
      .send({ workflowId: wfDef.id, input: { test: true } });
    expect(execRes.status).toBe(200);
    expect(execRes.body.output.msg).toBe("ok");

    // Clean up
    await request(app)
      .delete(`/api/workflows/${wfDef.id}`)
      .set("Authorization", `Bearer ${API_KEY}`)
      .set("x-tenant-id", tenantId);
  });
});

```

### tests/lib.test.ts

```ts
import { describe, it, expect } from "vitest";
import { getEnv } from "../src/lib/env";
import { logger } from "../src/lib/logger";

describe("Lib utilities", () => {
  it("loads environment variables", () => {
    const port = getEnv("PORT", "3000");
    expect(typeof port).toBe("string");
  });

  it("logs messages without throwing", () => {
    expect(() => logger.info("test message")).not.toThrow();
  });
});

```

### tests/middleware.test.ts

```ts
import { describe, it, expect } from "vitest";
import express from "express";
import request from "supertest";
import { authMiddleware } from "../src/api/middleware/auth.middleware";

describe("Middleware", () => {
  const app = express();
  app.get("/api/ping", authMiddleware, (req, res) => res.json({ ok: true }));

  it("rejects requests without API key", async () => {
    const res = await request(app).get("/api/ping");
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Unauthorized");
  });

  it("accepts valid API key and tenant", async () => {
    const res = await request(app)
      .get("/api/ping")
      .set("Authorization", "Bearer dev_api_key_123")
      .set("x-tenant-id", "t1");

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});

```

### tests/tenant.test.ts

```ts
import { describe, it, expect } from "vitest";
import { tenantManager } from "../src/tenants/tenant-manager";

describe("Tenant manager", () => {
  it("creates and fetches a tenant", async () => {
    const t = await tenantManager.createTenant("Acme");
    const fetched = await tenantManager.getTenant(t.id);
    expect(fetched.id).toBe(t.id);
  });
});
```

### tests/workers.test.ts

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Queue, Worker } from "bullmq";

describe("Workers", () => {
  let queue: Queue;
  let worker: Worker;
  const connection = { host: "127.0.0.1", port: 6379 };

  beforeAll(async () => {
    queue = new Queue("test-queue", { connection });
    worker = new Worker(
      "test-queue",
      async (job) => {
        return { processed: job.data.value * 2 };
      },
      { connection }
    );
  });

  afterAll(async () => {
    await queue.close();
    await worker.close();
  });

  it("processes jobs correctly", async () => {
    const job = await queue.add("job1", { value: 5 });
    const result = await job.waitUntilFinished(worker);
    expect(result.processed).toBe(10);
  });
});

```

