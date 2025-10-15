import { describe, it, expect } from "vitest";
import { getEnv } from "../src/lib/env";
import { logger } from "../src/lib/logger";

describe("Lib utilities", () => {
  it("loads environment variables", () => {
    const port = getEnv("PORT", "3000");
    expect(typeof port).toBe("string");
  });

  it("logs messages without throwing", () => {
    expect(() => logger.info("test message")).not.toThrow();
  });
});
