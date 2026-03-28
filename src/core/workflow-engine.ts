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