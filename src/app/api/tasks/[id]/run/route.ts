import { agentRunResponseSchema } from "@/lib/contracts/agent";
import { selectModel } from "@/lib/agent/router";
import { getTaskRunQueue } from "@/lib/queue";
import { workspaceErrorResponse, workspaceJson } from "@/lib/workspace/http";
import { WorkspaceConflictError, WorkspaceNotFoundError, WorkspaceRepository } from "@/lib/workspace/repository";
import type { TaskRunRecord } from "@/lib/workspace/types";

export const runtime = "nodejs";
export const maxDuration = 30;
export const dynamic = "force-dynamic";

function publicRun(run: TaskRunRecord): TaskRunRecord {
  return { ...run, responseJson: null };
}

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const repository = new WorkspaceRepository();
  let runId = "";
  try {
    const taskId = (await params).id;
    const task = repository.getTask(taskId);
    const blockedAttachments = repository.listTaskAttachments(taskId).filter((attachment) => attachment.status !== "ready");
    if (blockedAttachments.length > 0) {
      return workspaceJson({
        error: "存在尚未解析完成的附件，请先重试解析或移除失败附件。",
        code: "ATTACHMENTS_NOT_READY",
        attachments: blockedAttachments.map(({ parsedText: _parsedText, ...attachment }) => attachment),
      }, 409);
    }
    const run = repository.createTaskRun(taskId, selectModel(task.depth));
    runId = run.id;
    const queued = await getTaskRunQueue().enqueue({ runId, taskId });
    const attached = repository.attachTaskRunQueueJob(runId, queued.jobId);
    return workspaceJson({ run: publicRun(attached), task: repository.getTask(taskId) }, 202);
  } catch (error) {
    if (runId) {
      try {
        repository.failTaskRun(runId, { code: "QUEUE_UNAVAILABLE", message: "任务未能加入执行队列，请检查 Redis 和 Worker 是否已启动。" });
      } catch {
        // Preserve the original queue error.
      }
      return workspaceJson({ error: "任务未能加入执行队列，请检查 Redis 和 Worker 是否已启动。", code: "QUEUE_UNAVAILABLE" }, 503);
    }
    if (error instanceof WorkspaceConflictError) {
      const taskId = (await params).id;
      const active = repository.getLatestTaskRun(taskId);
      return workspaceJson({ error: error.message, code: error.code, run: active ? publicRun(active) : undefined }, 409);
    }
    return workspaceErrorResponse(error);
  }
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const repository = new WorkspaceRepository();
  try {
    const taskId = (await params).id;
    const task = repository.getTask(taskId);
    const run = repository.getLatestTaskRun(taskId);
    if (!run) throw new WorkspaceNotFoundError("该任务还没有运行记录。");
    const payload: { run: TaskRunRecord; task: typeof task; result?: unknown; document?: unknown } = { run: publicRun(run), task };
    if (run.status === "completed" && run.responseJson) {
      const parsed = agentRunResponseSchema.safeParse(JSON.parse(run.responseJson));
      if (parsed.success) {
        payload.result = parsed.data;
        const primary = repository.getPrimaryDocument(taskId);
        if (primary) payload.document = primary;
      }
    }
    return workspaceJson(payload);
  } catch (error) {
    return workspaceErrorResponse(error);
  }
}
