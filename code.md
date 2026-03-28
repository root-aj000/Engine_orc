Love the structure — let’s scaffold the entire project with real, runnable TypeScript code. I’ll go file by file in the order they appear in your tree. You can paste these directly into your project.

If you want me to pause after a section (e.g., API layer first), say “stop” and I’ll hold there.

---

File: package.json
```json
{
  "name": "orchestrator",
  "version": "1.0.0",
  "private": true,
  "type": "commonjs",
  "scripts": {
    "dev": "ts-node-dev --respawn --transpile-only src/index.ts",
    "build": "tsc -p tsconfig.json",
    "start": "node dist/index.js",
    "test": "vitest run",
    "test:watch": "vitest",
    "prisma:generate": "prisma generate",
    "prisma:migrate": "prisma migrate dev",
    "prisma:deploy": "prisma migrate deploy"
  },
  "dependencies": {
    "@prisma/client": "^5.17.0",
    "axios": "^1.7.7",
    "bullmq": "^5.12.0",
    "cors": "^2.8.5",
    "dotenv": "^16.4.5",
    "express": "^4.19.2",
    "helmet": "^7.1.0",
    "ioredis": "^5.4.1",
    "pino": "^9.4.0",
    "pino-http": "^9.0.0",
    "uuid": "^9.0.1",
    "vm2": "^3.9.19",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@types/express": "^4.17.21",
    "@types/node": "^22.7.4",
    "@types/supertest": "^6.0.3",
    "prisma": "^5.17.0",
    "supertest": "^7.0.0",
    "ts-node": "^10.9.2",
    "ts-node-dev": "^2.0.0",
    "typescript": "^5.6.3",
    "vitest": "^2.1.1"
  }
}
```

---

File: tsconfig.json
```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "CommonJS",
    "rootDir": "./src",
    "outDir": "./dist",
    "strict": true,
    "noImplicitAny": false,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "moduleResolution": "Node",
    "resolveJsonModule": true,
    "types": ["node"]
  },
  "include": ["src", "tests"],
  "exclude": ["node_modules", "dist"]
}
```

---

File: .env
```env
# Database
DATABASE_URL="file:./dev.db" # using SQLite for simplicity

# Redis
REDIS_URL="redis://localhost:6379"

# App
PORT=3000
NODE_ENV=development
API_KEY=dev_api_key_123
LOG_LEVEL=info
```

---

File: README.md
```markdown
# Orchestrator

A TypeScript-based workflow orchestrator with:
- Multi-tenant support
- DAG workflow engine
- Pluggable node types (HTTP, Code, Webhook)
- Queue-based async executions (BullMQ)
- Express API and Prisma ORM

## Quick start

1. Install deps
   npm install

2. Generate Prisma artifacts
   npm run prisma:generate

3. Create DB and run migrations
   npm run prisma:migrate

4. Run in dev
   npm run dev

5. Build and start
   npm run build
   npm start

## ENV
See .env for required variables.

## API
- /api/tenants
- /api/workflows
- /api/executions

Use header: x-tenant-id: <tenant-id>
Auth: Authorization: Bearer <API_KEY>
```

---

File: src/lib/env.ts
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
```

---

File: src/lib/logger.ts
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

---

File: src/lib/errors.ts
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

---

File: src/lib/utils.ts
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

---

File: src/config/app.config.ts
```ts
import { ENV } from "../lib/env";

export const APP_CONFIG = {
  port: ENV.PORT,
  env: ENV.NODE_ENV
};
```

---

File: src/config/db.config.ts
```ts
import { ENV } from "../lib/env";

export const DB_CONFIG = {
  url: ENV.DATABASE_URL
};
```

---

File: src/config/queue.config.ts
```ts
import { ENV } from "../lib/env";

export const QUEUE_CONFIG = {
  connection: ENV.REDIS_URL
};
```

---

File: src/config/tenant.config.ts
```ts
export const TENANT_CONFIG = {
  defaultLimits: {
    maxWorkflows: 100,
    maxExecutionsPerDay: 10000
  },
  retentionDays: 30
};
```

---

File: src/global.ts
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

---

File: src/db/prisma/schema.prisma
```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "sqlite"
  url      = env("DATABASE_URL")
}

model Tenant {
  id        String     @id @default(cuid())
  name      String
  config    Json?
  createdAt DateTime   @default(now())
  workflows Workflow[]
}

model Workflow {
  id         String     @id @default(cuid())
  tenantId   String
  name       String
  definition Json
  createdAt  DateTime   @default(now())
  updatedAt  DateTime   @updatedAt
  executions Execution[]

  tenant Tenant @relation(fields: [tenantId], references: [id])
  @@index([tenantId])
}

model Execution {
  id         String   @id @default(cuid())
  workflowId String
  tenantId   String
  status     String
  input      Json?
  output     Json?
  error      Json?
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt

  workflow Workflow @relation(fields: [workflowId], references: [id])

  @@index([workflowId])
  @@index([tenantId])
}
```

---

File: src/db/db-client.ts
```ts
import { PrismaClient } from "@prisma/client";

export const db = new PrismaClient();

export type DB = typeof db;
```

---

File: src/tenants/tenant-model.ts
```ts
// Thin wrapper types to keep import ergonomics consistent
import type { Tenant } from "@prisma/client";
export type TenantModel = Tenant;
```

---

File: src/tenants/tenant-manager.ts
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

---

File: src/tenants/tenant-context.ts
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

---

File: src/core/node-registry.ts
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

---

File: src/core/node-types/http-node.ts
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

---

File: src/core/node-types/code-node.ts
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

---

File: src/core/node-types/webhook-node.ts
```ts
import type { NodeExecutor } from "../../global";

// For now, a webhook node acts as a pass-through starter node.
// In real setups, you'd expose an external endpoint and inject payload into the workflow.
export const webhookNode: NodeExecutor = async ({ input }) => {
  return input ?? {};
};
```

---

File: src/core/node-runner.ts
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

---

File: src/core/workflow-engine.ts
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

---

File: src/core/orchestrator.ts
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

---

File: src/workers/queue.ts
```ts
import { Queue } from "bullmq";
import { QUEUE_CONFIG } from "../config/queue.config";

export const EXECUTION_QUEUE = "executions";

export const executionQueue = new Queue(EXECUTION_QUEUE, {
  connection: QUEUE_CONFIG.connection
});

export type ExecutionJobData = {
  tenantId: string;
  workflowId: string;
  payload: any;
};

export async function enqueueExecution(job: ExecutionJobData, opts?: { delay?: number; repeat?: { cron: string } }) {
  return executionQueue.add("run", job, {
    removeOnComplete: 1000,
    removeOnFail: 1000,
    delay: opts?.delay,
    repeat: opts?.repeat
  });
}
```

---

File: src/workers/worker.ts
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

---

File: src/workers/scheduler.ts
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

---

File: src/api/middleware/auth.middleware.ts
```ts
import { Request, Response, NextFunction } from "express";
import { ENV } from "../../lib/env";
import { UnauthorizedError } from "../../lib/errors";

export function authMiddleware(req: Request, _res: Response, next: NextFunction) {
  // Simple API key auth via header
  const auth = req.headers["authorization"];
  const apiKeyHeader = req.headers["x-api-key"];
  const token = auth?.startsWith("Bearer ") ? auth.substring(7) : (apiKeyHeader as string | undefined);

  if (!token || token !== ENV.API_KEY) {
    return next(new UnauthorizedError("Invalid or missing API key"));
  }

  // optionally attach req.user
  (req as any).user = { token: "api-key-user" };
  next();
}
```

---

File: src/api/middleware/tenant.middleware.ts
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

---

File: src/api/middleware/error.middleware.ts
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

---

File: src/api/routes/workflows.route.ts
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

---

File: src/api/routes/tenants.route.ts
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

---

File: src/api/routes/executions.route.ts
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

---

File: src/api/index.ts
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

---

File: src/server.ts
```ts
import express from "express";
import helmet from "helmet";
import cors from "cors";
import pinoHttp from "pino-http";
import api from "./api";
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

  // Public routes
  app.use("/api/tenants", tenantsPublic());

  // Protected routes
  app.use("/api", authMiddleware, tenantMiddleware, api);

  // 404
  app.use((_req, res) => res.status(404).json({ message: "Not found" }));

  // Error handler
  app.use(errorMiddleware);

  return app;
}

function tenantsPublic() {
  const router = express.Router();
  // Allow managing tenants without auth for initial provisioning
  // If you want to protect this, add authMiddleware here as well.
  router.use("/", require("./api/routes/tenants.route").default);
  return router;
}

export function startServer() {
  const app = buildServer();
  const server = app.listen(APP_CONFIG.port, () => {
    logger.info({ port: APP_CONFIG.port }, "Server listening");
  });
  return server;
}
```

---

File: src/index.ts
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

---

File: tests/core.test.ts
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

---

File: tests/api.test.ts
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

---

File: tests/tenant.test.ts
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

---

That’s the complete scaffold in one go. Notes:

- DB: using Prisma with SQLite for easy local setup (DATABASE_URL=file:./dev.db). Change provider to PostgreSQL if needed.
- Auth: simple API key (Authorization: Bearer <API_KEY>), plus x-tenant-id header required for protected routes.
- Nodes: http (axios), code (vm2), webhook (pass-through trigger).
- Orchestrator: executes DAG by layers; nodes at the first layer receive the request payload as input.
- Queue: BullMQ worker processes async executions.

Want me to add a sample workflow JSON and example curl commands?