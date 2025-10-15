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
