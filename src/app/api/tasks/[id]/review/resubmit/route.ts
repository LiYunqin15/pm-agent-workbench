import { taskReviewResubmitSchema } from "@/lib/workspace/contracts";
import { parseWorkspaceJson, workspaceErrorResponse, workspaceJson } from "@/lib/workspace/http";
import { WorkspaceRepository } from "@/lib/workspace/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const taskId = (await params).id;
    const input = await parseWorkspaceJson(request, taskReviewResubmitSchema);
    const detail = new WorkspaceRepository().resubmitTaskReview({ taskId, ...input });
    return workspaceJson({ ...detail, run: detail.run ? { ...detail.run, responseJson: null } : null });
  } catch (error) {
    return workspaceErrorResponse(error);
  }
}
