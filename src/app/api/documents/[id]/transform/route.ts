import { documentTransformSchema } from "@/lib/documents/contracts";
import { transformDocument, DOCUMENT_TRANSFORM_ACTION_LABELS } from "@/lib/documents/transform";
import { parseWorkspaceJson, workspaceErrorResponse, workspaceJson } from "@/lib/workspace/http";
import { WorkspaceRepository } from "@/lib/workspace/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const input = await parseWorkspaceJson(request, documentTransformSchema);
    const repository = new WorkspaceRepository();
    const source = repository.getDocument((await params).id);
    const transformed = await transformDocument({
      title: source.currentVersion.title,
      content: source.currentVersion.content,
      action: input.action,
      targetFormat: input.targetFormat,
      instruction: input.instruction,
    });
    const versionSource = transformed.demo ? "agent_demo" : "agent";
    const changeNote = `AI${DOCUMENT_TRANSFORM_ACTION_LABELS[input.action]} · ${transformed.model}`;
    if (input.destination === "new_version") {
      const document = repository.saveDocumentVersion({
        documentId: source.id,
        baseRevision: input.baseRevision,
        title: transformed.title,
        content: transformed.content,
        changeNote,
        createdBy: "PM Agent",
        source: versionSource,
      });
      return workspaceJson({ document, result: transformed }, 201);
    }
    const document = repository.createDocument({
      taskId: source.taskId,
      title: transformed.title,
      content: transformed.content,
      format: input.targetFormat,
      owner: "PM Agent",
      source: versionSource,
      changeNote,
      createdBy: "PM Agent",
    });
    return workspaceJson({ document, result: transformed }, 201);
  } catch (error) {
    return workspaceErrorResponse(error);
  }
}
