import type { NodeExecutor } from "../../global";

// For now, a webhook node acts as a pass-through starter node.
// In real setups, you'd expose an external endpoint and inject payload into the workflow.
export const webhookNode: NodeExecutor = async ({ input }) => {
  return input ?? {};
};