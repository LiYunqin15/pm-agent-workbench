import { getTaskRunQueue } from "@/lib/queue";
import { workspaceErrorResponse, workspaceJson } from "@/lib/workspace/http";
import { WorkspaceRepository } from "@/lib/workspace/repository";
import type { TaskRunRecord } from "@/lib/workspace/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function publicRun(run: TaskRunRecord): TaskRunRecord {
  return { ...run, responseJson: null };
}

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const repository = new WorkspaceRepository();
  try {
    const taskId = (await params).id;
    const run = repository.getLatestTaskRun(taskId);
    if (!run) return workspaceJson({ error: "该任务没有可取消的运行记录。" }, 404);
    const requested = repository.requestTaskRunCancel(run.id);
    if (run.status === "queued" && requested.queueJobId) await getTaskRunQueue().remove(requested.queueJobId);
    return workspaceJson({ run: publicRun(requested), task: repository.getTask(taskId) });
  } catch (error) {
    return workspaceErrorResponse(error);
  }
}
