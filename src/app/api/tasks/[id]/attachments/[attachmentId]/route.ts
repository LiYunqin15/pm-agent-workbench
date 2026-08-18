import { unlink } from "node:fs/promises";
import { workspaceErrorResponse, workspaceJson } from "@/lib/workspace/http";
import { WorkspaceRepository } from "@/lib/workspace/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; attachmentId: string }> },
) {
  try {
    const { id: taskId, attachmentId } = await params;
    const removed = new WorkspaceRepository().deleteTaskAttachment(taskId, attachmentId);
    try {
      await unlink(removed.storagePath);
    } catch (error) {
      if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) {
        console.error("Attachment file cleanup failed", { attachmentId, error });
      }
    }
    return workspaceJson({ removed: true, attachmentId });
  } catch (error) {
    return workspaceErrorResponse(error);
  }
}
