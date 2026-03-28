import { enqueueExecution } from "./queue";

export async function scheduleWorkflowCron(params: {
  tenantId: string;
  workflowId: string;
  cron: string;
}) {
  await enqueueExecution({ tenantId: params.tenantId, workflowId: params.workflowId, payload: {} }, { repeat: { cron: params.cron } });
}