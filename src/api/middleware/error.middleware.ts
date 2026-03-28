import { Request, Response, NextFunction } from "express";
import { ApiError } from "../../lib/errors";
import { logger } from "../../lib/logger";

export function errorMiddleware(err: any, _req: Request, res: Response, _next: NextFunction) {
  const status = err instanceof ApiError ? err.status : 500;
  const code = err instanceof ApiError ? err.code : "INTERNAL_ERROR";
  const message = err?.message ?? "Internal Server Error";
  const details = err?.details;

  if (status >= 500) {
    logger.error({ err }, "Unhandled error");
  } else {
    logger.warn({ err }, "Handled error");
  }

  res.status(status).json({ message, code, details });
}
