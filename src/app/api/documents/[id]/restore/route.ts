import { documentRestoreSchema } from "@/lib/workspace/contracts";
import { parseWorkspaceJson, workspaceErrorResponse, workspaceJson } from "@/lib/workspace/http";
import { WorkspaceRepository } from "@/lib/workspace/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const input = await parseWorkspaceJson(request, documentRestoreSchema);
    return workspaceJson(
      new WorkspaceRepository().restoreDocumentVersion({ documentId: (await params).id, ...input }),
      201,
    );
  } catch (error) {
    return workspaceErrorResponse(error);
  }
}

