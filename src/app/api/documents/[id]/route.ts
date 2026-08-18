import { workspaceErrorResponse, workspaceJson } from "@/lib/workspace/http";
import { WorkspaceRepository } from "@/lib/workspace/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    return workspaceJson(new WorkspaceRepository().getDocument((await params).id));
  } catch (error) {
    return workspaceErrorResponse(error);
  }
}

