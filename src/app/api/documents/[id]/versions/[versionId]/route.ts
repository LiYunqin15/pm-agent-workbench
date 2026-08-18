import { documentVersionMetadataSchema } from "@/lib/workspace/contracts";
import { parseWorkspaceJson, workspaceErrorResponse, workspaceJson } from "@/lib/workspace/http";
import { WorkspaceRepository } from "@/lib/workspace/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string; versionId: string }> }) {
  try {
    const input = await parseWorkspaceJson(request, documentVersionMetadataSchema);
    const { id, versionId } = await params;
    return workspaceJson(new WorkspaceRepository().updateDocumentVersionMetadata({ documentId: id, versionId, ...input }));
  } catch (error) {
    return workspaceErrorResponse(error);
  }
}
