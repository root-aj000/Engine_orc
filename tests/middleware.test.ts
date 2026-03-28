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
