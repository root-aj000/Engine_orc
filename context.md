structure

orchestrator/
│
├── src/
│   ├── api/
│   │   ├── index.ts
│   │   ├── routes/
│   │   │   ├── workflows.route.ts
│   │   │   ├── tenants.route.ts
│   │   │   ├── executions.route.ts
│   │   └── middleware/
│   │       ├── auth.middleware.ts
│   │       ├── tenant.middleware.ts
│   │       └── error.middleware.ts
│   │
│   ├── core/
│   │   ├── orchestrator.ts           # Main orchestration logic
│   │   ├── workflow-engine.ts        # Handles execution flow, node graph traversal
│   │   ├── node-registry.ts          # Manages available nodes and triggers
│   │   ├── node-runner.ts            # Executes nodes with inputs/outputs
│   │   └── node-types/
│   │       ├── http-node.ts
│   │       ├── webhook-node.ts
│   │       └── code-node.ts
│   │
│   ├── tenants/
│   │   ├── tenant-manager.ts         # Create, read, update, delete tenants
│   │   ├── tenant-context.ts         # Context switching middleware
│   │   └── tenant-model.ts
│   │
│   ├── db/
│   │   ├── prisma/                   # ORM (e.g. Prisma)
│   │   │   ├── schema.prisma
│   │   ├── migrations/
│   │   └── db-client.ts
│   │
│   ├── workers/
│   │   ├── queue.ts                  # BullMQ, RabbitMQ, etc.
│   │   ├── worker.ts                 # Job processing
│   │   └── scheduler.ts              # Cron-based or trigger-based
│   │
│   ├── lib/
│   │   ├── logger.ts
│   │   ├── env.ts
│   │   ├── utils.ts
│   │   └── errors.ts
│   │
│   ├── config/
│   │   ├── app.config.ts
│   │   ├── db.config.ts
│   │   ├── queue.config.ts
│   │   └── tenant.config.ts
│   │
│   ├── global.ts                     # Unified input/output schema & API reference
│   ├── server.ts                     # Express or Fastify bootstrap
│   └── index.ts                      # Entry point
│
├── tests/
│   ├── api.test.ts
│   ├── core.test.ts
│   └── tenant.test.ts
│
├── .env
├── package.json
├── tsconfig.json
└── README.md




Below is a **comprehensive guide** describing **each file’s purpose, internal contents, input/output expectations, and cross-dependencies**, so you can implement or scaffold them cleanly.

---

# 🧱 Root Structure Overview

```
orchestrator/
├── src/
│   ├── api/
│   ├── core/
│   ├── tenants/
│   ├── db/
│   ├── workers/
│   ├── lib/
│   ├── config/
│   ├── global.ts
│   ├── server.ts
│   └── index.ts
├── tests/
└── config & setup files
```

---

# 🧩 `src/api/` — API Layer

The **API layer** exposes HTTP endpoints for managing workflows, executions, and tenants.
It interacts with `core/` (engine) and `tenants/` (context) modules.

---

## `src/api/index.ts`

**Purpose:** Combines all routes and middlewares into one API router.

**Contains:**

```ts
import express from "express";
import workflowsRouter from "./routes/workflows.route";
import tenantsRouter from "./routes/tenants.route";
import executionsRouter from "./routes/executions.route";

const api = express.Router();
api.use("/workflows", workflowsRouter);
api.use("/tenants", tenantsRouter);
api.use("/executions", executionsRouter);

export default api;
```

**Input:** Express requests
**Output:** Combined router

---

## `src/api/routes/workflows.route.ts`

**Purpose:** CRUD operations for workflows.

**Contains:**

* `GET /` → list all workflows (for a tenant)
* `POST /` → create new workflow
* `GET /:id` → get workflow by ID
* `PUT /:id` → update workflow
* `DELETE /:id` → delete workflow

**Uses:**

* `tenantMiddleware`
* `WorkflowEngine` or DB client

**Input:**
Tenant header + JSON body (workflow config)
**Output:**
Workflow JSON objects

---

## `src/api/routes/tenants.route.ts`

**Purpose:** Tenant management API.

**Contains:**

* `GET /` → list tenants
* `POST /` → create tenant
* `DELETE /:id` → delete tenant

**Uses:**

* `TenantManager`

**Input:** JSON body (tenant data)
**Output:** Tenant metadata

---

## `src/api/routes/executions.route.ts`

**Purpose:** Execute workflows manually or view past executions.

**Contains:**

* `POST /:workflowId/execute` → Run a workflow immediately
* `GET /:workflowId/logs` → Get execution logs

**Uses:**

* `Orchestrator`
* `Worker Queue`

**Input:**
Workflow ID, payload (input data)
**Output:**
Execution result (`NodeIO[]`)

---

## `src/api/middleware/auth.middleware.ts`

**Purpose:** Verifies user token or API key.

**Contains:**

* JWT verification or header-based API key
* Attaches `req.user`

**Input:** `Authorization` header
**Output:** `req.user` context

---

## `src/api/middleware/tenant.middleware.ts`

**Purpose:** Loads tenant context for every request.

**Contains:**

* Extracts `x-tenant-id` from header
* Loads tenant info via `TenantManager`
* Attaches `req.tenant`

**Input:** Header
**Output:** `req.tenant`

---

## `src/api/middleware/error.middleware.ts`

**Purpose:** Centralized error handler.

**Contains:**

* Catches thrown errors
* Normalizes to JSON structure
* Logs via `logger`

**Input:** Error
**Output:** JSON `{ message, code }`

---

# ⚙️ `src/core/` — Orchestration Engine

Handles **execution flow**, **node registry**, and **runtime orchestration** logic.

---

## `src/core/orchestrator.ts`

**Purpose:** Entry point to execute entire workflows.

**Contains:**

* `Orchestrator.run(payload)`
* Loads workflow graph
* Sequentially or concurrently executes nodes
* Collects all node outputs

**Input:** Workflow definition, payload
**Output:** Array of node results

---

## `src/core/workflow-engine.ts`

**Purpose:** Graph traversal engine.

**Contains:**

* DAG (Directed Acyclic Graph) traversal logic
* Support for parallel execution
* Detects triggers vs normal nodes
* Validates graph consistency

**Input:** Workflow graph
**Output:** Ordered execution plan

---

## `src/core/node-registry.ts`

**Purpose:** Node discovery and registration system.

**Contains:**

* Registry map: `{ [type: string]: NodeExecutor }`
* `registerNode(type, handler)`
* `getNode(type)`

**Input:** Node type string
**Output:** Node executor function

---

## `src/core/node-runner.ts`

**Purpose:** Executes a node safely with error handling.

**Contains:**

* `executeNode(node, input)`
* Loads node type from `node-registry`
* Runs it
* Wraps in try/catch for safety

**Input:** Node config, input payload
**Output:** Node output payload

---

## `src/core/node-types/http-node.ts`

**Purpose:** Executes HTTP requests.

**Contains:**

```ts
import axios from "axios";
export async function httpNode(config, input) {
  const res = await axios({ method: config.method, url: config.url, data: input });
  return res.data;
}
```

**Input:** Node config (method, URL), input
**Output:** HTTP response body

---

## `src/core/node-types/webhook-node.ts`

**Purpose:** Acts as trigger node waiting for incoming webhook events.

**Contains:**

* Registers webhook URL
* Listens for external POSTs
* Emits events into workflow

**Input:** External HTTP event
**Output:** Triggers workflow

---

## `src/core/node-types/code-node.ts`

**Purpose:** Runs user-supplied JavaScript safely in sandbox.

**Contains:**

* VM2 sandbox or isolated runtime
* Executes JS code block
* Passes input as `context.input`

**Input:** Input payload + user code
**Output:** Script output

---

# 🧠 `src/tenants/` — Multi-Tenant Logic

Manages tenant separation, models, and context switching.

---

## `src/tenants/tenant-manager.ts`

**Purpose:** Tenant lifecycle management.

**Contains:**

* `createTenant()`
* `getTenant()`
* `deleteTenant()`
* Connects tenant DB or schema isolation

**Input:** Tenant data or ID
**Output:** Tenant object

---

## `src/tenants/tenant-context.ts`

**Purpose:** In-memory context helper.

**Contains:**

* `setTenantContext(tenantId)`
* `getTenantContext()`
* Used by background jobs or non-HTTP processes

**Input:** Tenant ID
**Output:** Tenant scoped context

---

## `src/tenants/tenant-model.ts`

**Purpose:** ORM model definition (Prisma schema or similar).

**Contains:**

* Tenant table structure:

  ```ts
  id: string
  name: string
  config: JSON
  createdAt: Date
  ```

**Input:** DB queries
**Output:** Tenant records

---

# 🗄️ `src/db/` — Database Layer

Handles schema, migrations, and ORM.

---

## `src/db/prisma/schema.prisma`

**Purpose:** ORM schema definition (Prisma).

**Contains:**
Tables for tenants, workflows, executions, and nodes.

---

## `src/db/migrations/`

**Purpose:** Migration scripts generated by Prisma CLI.

**Contains:**
SQL files defining schema evolution.

---

## `src/db/db-client.ts`

**Purpose:** Initializes Prisma client.

**Contains:**

```ts
import { PrismaClient } from "@prisma/client";
export const db = new PrismaClient();
```

**Input:** Queries
**Output:** ORM instance

---

# ⚡ `src/workers/` — Background Processing

For queued executions, scheduling, and async work.

---

## `src/workers/queue.ts`

**Purpose:** Initialize message queue (BullMQ, RabbitMQ, etc).

**Contains:**

* Queue setup
* Producer/consumer registration

**Input:** Job data
**Output:** Enqueued job

---

## `src/workers/worker.ts`

**Purpose:** Worker process for executing jobs.

**Contains:**

* Queue listener
* Executes orchestrator for each job

**Input:** Job payload
**Output:** Execution logs

---

## `src/workers/scheduler.ts`

**Purpose:** Cron or trigger-based scheduler.

**Contains:**

* Node-schedule or BullMQ repeat jobs
* Periodically enqueue workflows

**Input:** Time/cron expressions
**Output:** Scheduled job triggers

---

# 🔧 `src/lib/` — Shared Utilities

Generic helpers across the project.

---

## `src/lib/logger.ts`

**Purpose:** Centralized logging system.

**Contains:**

* Winston or Pino logger
* Contextual tenant tagging

---

## `src/lib/env.ts`

**Purpose:** Env variable loader + validator.

**Contains:**

```ts
import dotenv from "dotenv";
dotenv.config();

export const ENV = {
  DB_URL: process.env.DB_URL!,
  REDIS_URL: process.env.REDIS_URL!,
  PORT: process.env.PORT || 3000,
};
```

---

## `src/lib/utils.ts`

**Purpose:** Misc helpers (UUIDs, deep clones, etc.)

---

## `src/lib/errors.ts`

**Purpose:** Custom error classes (`ApiError`, `ValidationError`).

---

# ⚙️ `src/config/` — Config Layer

All runtime configs separated by domain.

---

## `src/config/app.config.ts`

**Purpose:** App-level constants (port, environment).

---

## `src/config/db.config.ts`

**Purpose:** DB connection and pool settings.

---

## `src/config/queue.config.ts`

**Purpose:** Queue configuration for BullMQ/RabbitMQ.

---

## `src/config/tenant.config.ts`

**Purpose:** Tenant-specific defaults (limits, retention, etc.)

---

# 🌐 `src/global.ts` — Global API Contracts

Defines **all shared input/output interfaces** for every API and node.

* `GlobalInput`
* `GlobalOutput`
* `NodeIO`
* `WorkflowDefinition`
* `API_REFERENCE`

Acts as a **schema contract** and **API doc source**.

---

# 🚀 `src/server.ts`

**Purpose:** Starts Express/Fastify server.

**Contains:**

* JSON parser
* Middlewares
* API mounting
* Error handling

**Input:** HTTP requests
**Output:** HTTP responses

---

# 🧩 `src/index.ts`

**Purpose:** App entry point.

**Contains:**

* Loads env
* Initializes DB, queues, server

```ts
import { ENV } from "./lib/env";
import "./server";
```

---

# 🧪 `tests/`

**Purpose:** Automated tests for each subsystem.

* `api.test.ts`: API routes
* `core.test.ts`: Orchestrator & engine
* `tenant.test.ts`: Multi-tenant behavior

---

## ✅ Summary of Inputs/Outputs by Layer

| Layer   | Input                         | Output           |
| ------- | ----------------------------- | ---------------- |
| API     | HTTP requests                 | JSON responses   |
| Core    | Workflow definitions, payload | NodeIO[]         |
| Tenants | Tenant ID / Config            | Tenant context   |
| DB      | ORM queries                   | Records          |
| Workers | Jobs                          | Execution logs   |
| Lib     | Internal calls                | Utilities        |
| Config  | Env vars                      | Runtime settings |

---

Would you like me to now generate **actual boilerplate starter code (runnable)** for this full structure — including `Orchestrator`, sample node execution, Express routes, and tenant isolation — in one ready-to-run TypeScript project scaffold?
