// import { Request, Response, NextFunction } from "express";
// import { ENV } from "../../lib/env";
// import { UnauthorizedError } from "../../lib/errors";

// export function authMiddleware(req: Request, _res: Response, next: NextFunction) {
//   // Simple API key auth via header
//   const auth = req.headers["authorization"];
//   const apiKeyHeader = req.headers["x-api-key"];
//   const token = auth?.startsWith("Bearer ") ? auth.substring(7) : (apiKeyHeader as string | undefined);

//   if (!token || token !== ENV.API_KEY) {
//     return next(new UnauthorizedError("Invalid or missing API key"));
//   }

//   // optionally attach req.user
//   (req as any).user = { token: "api-key-user" };
//   next();
// }

import { Request, Response, NextFunction } from "express";

export function authMiddleware(req: Request, res: Response, next: NextFunction) {
  const apiKey = req.headers.authorization?.split(" ")[1];
  const tenantId = req.headers["x-tenant-id"];

  if (apiKey === "dev_api_key_123" && tenantId) {
    return next(); // ✅ must call next()
  }

  return res.status(401).json({ error: "Unauthorized" });
}
