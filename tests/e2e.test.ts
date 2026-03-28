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
