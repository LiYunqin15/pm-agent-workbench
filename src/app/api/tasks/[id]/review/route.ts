import { agentRunResponseSchema } from "@/lib/contracts/agent";
import { taskReviewSchema } from "@/lib/workspace/contracts";
import { parseWorkspaceJson, workspaceErrorResponse, workspaceJson } from "@/lib/workspace/http";
import { WorkspaceRepository } from "@/lib/workspace/repository";
import type { TaskReviewResponse, TaskRunRecord } from "@/lib/workspace/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function publicRun(run: TaskRunRecord | null): TaskRunRecord | null {
  return run ? { ...run, responseJson: null } : null;
}

function publicReview(repository: WorkspaceRepository, taskId: string): TaskReviewResponse {
  const detail = repository.getTaskReview(taskId);
  let result: TaskReviewResponse["result"];
  if (detail.run?.status === "completed" && detail.run.responseJson) {
    try {
      const parsed = agentRunResponseSchema.safeParse(JSON.parse(detail.run.responseJson));
      if (parsed.success) result = parsed.data;
    } catch {
      // A legacy or partially-written payload must not block manual review of
      // the persisted document and task history.
    }
  }
  return { ...detail, run: publicRun(detail.run), ...(result ? { result } : {}) };
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const taskId = (await params).id;
    return workspaceJson(publicReview(new WorkspaceRepository(), taskId));
  } catch (error) {
    return workspaceErrorResponse(error);
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const taskId = (await params).id;
    const input = await parseWorkspaceJson(request, taskReviewSchema);
    const repository = new WorkspaceRepository();
    repository.reviewTask({ taskId, ...input });
    return workspaceJson(publicReview(repository, taskId));
  } catch (error) {
    return workspaceErrorResponse(error);
  }
}
