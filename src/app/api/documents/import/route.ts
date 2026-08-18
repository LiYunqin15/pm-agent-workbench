import { parseUploadedDocument, DocumentFileError } from "@/lib/documents/office";
import { workspaceErrorResponse, workspaceJson, WorkspaceRequestError } from "@/lib/workspace/http";
import { WorkspaceRepository } from "@/lib/workspace/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const file = form.get("file");
    const taskId = String(form.get("taskId") ?? "").trim();
    if (!(file instanceof File)) throw new WorkspaceRequestError(400, "请选择要导入的文件。");
    if (!taskId) throw new WorkspaceRequestError(400, "导入文档必须关联一个任务。");
    if (file.size > MAX_UPLOAD_BYTES) throw new WorkspaceRequestError(413, "文件不能超过 25 MB。");
    const parsed = await parseUploadedDocument(file.name, Buffer.from(await file.arrayBuffer()));
    const document = new WorkspaceRepository().createDocument({
      taskId,
      title: parsed.title,
      content: parsed.content,
      format: "markdown",
      owner: "PM",
      source: "manual",
      changeNote: `导入 ${file.name}`,
      createdBy: "PM",
    });
    return workspaceJson({ document, fileName: file.name }, 201);
  } catch (error) {
    if (error instanceof DocumentFileError) return workspaceJson({ error: error.message }, 400);
    return workspaceErrorResponse(error);
  }
}
