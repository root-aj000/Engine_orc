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