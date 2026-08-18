import { TASK_MODES, type TaskMode } from "@/lib/agent/types";
import { workspaceErrorResponse, workspaceJson, WorkspaceRequestError } from "@/lib/workspace/http";
import { WorkspaceRepository } from "@/lib/workspace/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function optionalIso(value: string | null, field: string): string | undefined {
  if (!value) return undefined;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new WorkspaceRequestError(400, `${field} 不是有效的 ISO 时间。`);
  return parsed.toISOString();
}

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const taskTypeValue = params.get("taskType");
    if (taskTypeValue && !(TASK_MODES as readonly string[]).includes(taskTypeValue)) {
      throw new WorkspaceRequestError(400, "taskType 参数无效。");
    }
    const from = optionalIso(params.get("from"), "from");
    const to = optionalIso(params.get("to"), "to");
    if (from && to && from > to) throw new WorkspaceRequestError(400, "from 不能晚于 to。");
    return workspaceJson(new WorkspaceRepository().getMetricsOverview({ from, to, taskType: taskTypeValue as TaskMode | undefined }));
  } catch (error) {
    return workspaceErrorResponse(error);
  }
}
