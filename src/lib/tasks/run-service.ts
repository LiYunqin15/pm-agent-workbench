import { executePmAgent } from "@/lib/agent/execute";
import { isResponsesOutputValidationError, mapRelayFailure } from "@/lib/agent/responses-compat";
import { getRunTimeoutMs, getWorkerId } from "@/lib/queue/config";
import type { AgentProgressUpdate } from "@/lib/agent/types";
import { WorkspaceRepository } from "@/lib/workspace/repository";
import { WorkspacePolicyError } from "@/lib/workspace/repository";
import type { TaskRunStage } from "@/lib/workspace/types";

export class TaskRunExecutionError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "TaskRunExecutionError";
  }
}

function mapStage(stage: AgentProgressUpdate["stage"]): TaskRunStage {
  return stage;
}

function mapError(error: unknown, timedOut: boolean, cancelled: boolean): TaskRunExecutionError {
  if (cancelled) return new TaskRunExecutionError("CANCELLED", "任务已按请求取消。");
  if (timedOut) return new TaskRunExecutionError("TIMEOUT", "任务执行超过允许时长，已自动停止。请降低执行深度或检查中转站响应速度。");
  if (error instanceof TaskRunExecutionError) return error;
  if (error instanceof WorkspacePolicyError) return new TaskRunExecutionError(error.code, error.message);
  if (isResponsesOutputValidationError(error)) {
    return new TaskRunExecutionError(
      "UPSTREAM_RESPONSE_INVALID",
      "中转站返回的数据格式与 Responses 协议不兼容，请检查中转站的 Responses API 实现。",
    );
  }
  const relayFailure = mapRelayFailure(error);
  if (relayFailure.code !== "UPSTREAM_ERROR" || relayFailure.status !== undefined) {
    return new TaskRunExecutionError(relayFailure.code, relayFailure.message);
  }
  const message = error instanceof Error ? error.message : "上游 Agent 执行失败。";
  return new TaskRunExecutionError("UPSTREAM_ERROR", message || "上游 Agent 执行失败。");
}

export async function executeTaskRun(
  runId: string,
  workerId = getWorkerId(),
  repository = new WorkspaceRepository(),
): Promise<void> {
  if (!repository.claimTaskRun(runId, workerId)) return;
  const run = repository.getTaskRun(runId);
  const task = repository.getTask(run.taskId);
  const controller = new AbortController();
  let timedOut = false;
  let cancelled = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort(new TaskRunExecutionError("TIMEOUT", "任务执行超过允许时长，已自动停止。"));
  }, getRunTimeoutMs(task.depth));
  const heartbeat = setInterval(() => repository.heartbeatTaskRun(runId), 2_000);
  const cancelWatcher = setInterval(() => {
    if (!cancelled && repository.isTaskRunCancelRequested(runId)) {
      cancelled = true;
      controller.abort(new TaskRunExecutionError("CANCELLED", "任务已按请求取消。"));
    }
  }, 500);

  const onProgress = async (update: AgentProgressUpdate) => {
    repository.updateTaskRunProgress({
      runId,
      stage: mapStage(update.stage),
      stageIndex: update.stageIndex,
      progress: update.progress,
      action: update.action,
      detail: update.detail,
      query: update.query,
      url: update.url,
      sourceTitle: update.sourceTitle,
      visitedSourceCount: update.visitedSourceCount,
      evidenceCount: update.evidenceCount,
      eventType: update.url ? "source" : update.stage === "analyzing" || update.stage === "evidence" ? "analysis" : "tool",
    });
  };

  try {
    // Web Search is the only hosted tool currently exposed by the MVP. Keep a
    // server-side policy check immediately before execution so future tools
    // cannot bypass the same gate by only changing the UI or prompt.
    if (task.type === "market" || task.type === "competitor") {
      repository.authorizeToolCall({ runId, toolName: "web_search" });
    }
    const result = await executePmAgent({
      prompt: task.prompt,
      mode: task.type,
      depth: task.depth,
      autonomy: task.autonomy,
      budgetUsd: task.budgetCents / 100,
      context: task.researchInput,
      attachments: repository.getAgentAttachmentContext(task.id),
      signal: controller.signal,
      onProgress,
    });
    if (cancelled || repository.isTaskRunCancelRequested(runId)) {
      repository.finishCancelledTaskRun(runId);
      return;
    }
    repository.completeTaskRun(runId, result);
  } catch (error) {
    const mapped = mapError(error, timedOut, cancelled || repository.isTaskRunCancelRequested(runId));
    if (mapped.code === "CANCELLED") repository.finishCancelledTaskRun(runId);
    else repository.failTaskRun(runId, { code: mapped.code, message: mapped.message });
  } finally {
    clearTimeout(timeout);
    clearInterval(heartbeat);
    clearInterval(cancelWatcher);
  }
}
