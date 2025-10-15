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
