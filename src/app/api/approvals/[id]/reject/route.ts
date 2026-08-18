import { approvalRejectSchema } from "@/lib/workspace/contracts";
import { parseWorkspaceJson, workspaceErrorResponse, workspaceJson } from "@/lib/workspace/http";
import { WorkspaceRepository } from "@/lib/workspace/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const input = await parseWorkspaceJson(request, approvalRejectSchema);
    const approval = new WorkspaceRepository().resolveApproval({ approvalId: id, status: "rejected", ...input });
    return workspaceJson({ approval });
  } catch (error) {
    return workspaceErrorResponse(error);
  }
}
