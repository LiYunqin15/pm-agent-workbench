import { approvalCreateSchema } from "@/lib/workspace/contracts";
import { parseWorkspaceJson, workspaceErrorResponse, workspaceJson } from "@/lib/workspace/http";
import { WorkspaceRepository } from "@/lib/workspace/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ runId: string }> }) {
  try {
    const { runId } = await params;
    const repository = new WorkspaceRepository();
    return workspaceJson({ items: repository.listApprovals(runId) });
  } catch (error) {
    return workspaceErrorResponse(error);
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ runId: string }> }) {
  try {
    const { runId } = await params;
    const input = await parseWorkspaceJson(request, approvalCreateSchema);
    const approval = new WorkspaceRepository().createApprovalRequest({ runId, ...input });
    return workspaceJson({ approval }, 201);
  } catch (error) {
    return workspaceErrorResponse(error);
  }
}
