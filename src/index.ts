import { startServer } from "./server";
import { startWorker } from "./workers/worker";
import { db } from "./db/db-client";
import { logger } from "./lib/logger";

async function main() {
  // Ensure DB connection
  await db.$connect();
  logger.info("DB connected");

  // Start HTTP server
  startServer();

  // Start worker
  startWorker();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
