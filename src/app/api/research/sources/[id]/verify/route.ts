import { researchSourceVerifySchema } from "@/lib/workspace/contracts";
import { parseWorkspaceJson, workspaceErrorResponse, workspaceJson } from "@/lib/workspace/http";
import { WorkspaceRepository } from "@/lib/workspace/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const input = await parseWorkspaceJson(request, researchSourceVerifySchema);
    return workspaceJson(new WorkspaceRepository().verifyResearchSource((await params).id, input.trust, input.note, "PM", input.baseUpdatedAt));
  } catch (error) {
    return workspaceErrorResponse(error);
  }
}
