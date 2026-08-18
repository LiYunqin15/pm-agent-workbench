import { researchSourceUpdateSchema } from "@/lib/workspace/contracts";
import { parseWorkspaceJson, workspaceErrorResponse, workspaceJson } from "@/lib/workspace/http";
import { WorkspaceRepository } from "@/lib/workspace/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    return workspaceJson(new WorkspaceRepository().getResearchSource((await params).id));
  } catch (error) {
    return workspaceErrorResponse(error);
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const input = await parseWorkspaceJson(request, researchSourceUpdateSchema);
    return workspaceJson(new WorkspaceRepository().updateResearchSource((await params).id, input));
  } catch (error) {
    return workspaceErrorResponse(error);
  }
}
