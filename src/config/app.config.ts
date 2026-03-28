import { ENV } from "../lib/env";

export const APP_CONFIG = {
  port: ENV.PORT,
  env: ENV.NODE_ENV
};