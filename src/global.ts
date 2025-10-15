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
