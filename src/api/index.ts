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