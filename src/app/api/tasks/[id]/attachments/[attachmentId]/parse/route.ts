import { readFile } from "node:fs/promises";
import { parseUploadedDocument, DocumentFileError } from "@/lib/documents/office";
import { workspaceErrorResponse, workspaceJson } from "@/lib/workspace/http";
import { WorkspaceRepository } from "@/lib/workspace/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function publicAttachment(attachment: ReturnType<WorkspaceRepository["getTaskAttachment"]>) {
  const { parsedText: _parsedText, ...metadata } = attachment;
  return metadata;
}

function fileErrorCode(error: unknown): string {
  return error && typeof error === "object" && "code" in error && error.code === "ENOENT"
    ? "ATTACHMENT_FILE_MISSING"
    : "PARSE_FAILED";
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string; attachmentId: string }> },
) {
  const repository = new WorkspaceRepository();
  let claimed = false;
  let taskId = "";
  let attachmentId = "";
  try {
    ({ id: taskId, attachmentId } = await params);
    repository.getTask(taskId);
    const attachment = repository.claimTaskAttachmentForParsing(taskId, attachmentId);
    if (attachment.status === "ready") {
      return workspaceJson({ attachment: publicAttachment(attachment), alreadyReady: true });
    }
    claimed = true;
    const buffer = await readFile(attachment.storagePath);
    const parsed = await parseUploadedDocument(attachment.fileName, buffer);
    const ready = repository.completeTaskAttachmentParsing(taskId, attachmentId, parsed.content.slice(0, 500_000));
    return workspaceJson({ attachment: publicAttachment(ready) });
  } catch (error) {
    if (claimed) {
      const message = error instanceof DocumentFileError ? error.message : error && typeof error === "object" && "code" in error && error.code === "ENOENT"
        ? "附件原文件不存在，请移除后重新上传。"
        : "文件解析失败。";
      try {
        const failed = repository.failTaskAttachmentParsing(taskId, attachmentId, fileErrorCode(error), message);
        return workspaceJson({ attachment: publicAttachment(failed), error: message });
      } catch (stateError) {
        return workspaceErrorResponse(stateError);
      }
    }
    return workspaceErrorResponse(error);
  }
}
