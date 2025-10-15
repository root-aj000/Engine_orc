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
