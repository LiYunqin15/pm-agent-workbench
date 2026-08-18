import { researchSourceReopenSchema } from "@/lib/workspace/contracts";
import { parseWorkspaceJson, workspaceErrorResponse, workspaceJson } from "@/lib/workspace/http";
import { WorkspaceRepository } from "@/lib/workspace/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const input = request.headers.get("content-type")?.toLowerCase().startsWith("application/json")
      ? await parseWorkspaceJson(request, researchSourceReopenSchema)
      : { baseUpdatedAt: undefined };
    return workspaceJson(new WorkspaceRepository().reopenResearchSource((await params).id, input.baseUpdatedAt));
  } catch (error) {
    return workspaceErrorResponse(error);
  }
}
