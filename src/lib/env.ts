import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const EnvSchema = z.object({
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  PORT: z.coerce.number().default(3000),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  API_KEY: z.string().min(1),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info")
});

export const ENV = EnvSchema.parse(process.env);

// src/lib/env.ts
export function getEnv(key: string, fallback?: string): string {
  const value = process.env[key];
  if (!value && !fallback) {
    throw new Error(`Missing environment variable: ${key}`);
  }
  return value ?? fallback!;
}
