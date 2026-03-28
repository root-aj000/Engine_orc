import { ENV } from "../lib/env";

export const QUEUE_CONFIG = {
  connection: ENV.REDIS_URL
};