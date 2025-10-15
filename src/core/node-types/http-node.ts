import axios from "axios";
import type { NodeExecutor } from "../../global";

export const httpNode: NodeExecutor = async ({ config, input, context }) => {
  const { method, url, headers, timeoutMs } = config as {
    method: string; url: string; headers?: Record<string, string>; timeoutMs?: number;
  };

  if (!method || !url) throw new Error("http node requires method and url");

  context.logger.info({ url, method }, "HTTP node request");

  const res = await axios.request({
    method,
    url,
    headers,
    timeout: timeoutMs ?? 15000,
    data: input
  });

  return res.data;
};
