import { createHash } from "node:crypto";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { workspaceErrorResponse, workspaceJson, WorkspaceRequestError } from "@/lib/workspace/http";
import { WorkspaceRepository } from "@/lib/workspace/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_TASK_BYTES = 100 * 1024 * 1024;
const MAX_TASK_FILES = 10;

function publicAttachment(attachment: ReturnType<WorkspaceRepository["getTaskAttachment"]>) {
  const { parsedText: _parsedText, ...metadata } = attachment;
  return metadata;
}

function attachmentsRoot(): string {
  return process.env.PM_AGENT_ATTACHMENTS_DIR?.trim() || path.join(process.cwd(), "data", "attachments");
}

function safeExtension(fileName: string): string {
  const extension = path.extname(fileName).toLowerCase();
  return /^[.][a-z0-9]{1,12}$/.test(extension) ? extension : ".bin";
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const taskId = (await params).id;
    return workspaceJson({ items: new WorkspaceRepository().listTaskAttachments(taskId).map(publicAttachment) });
  } catch (error) {
    return workspaceErrorResponse(error);
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const repository = new WorkspaceRepository();
  let storagePath = "";
  try {
    const taskId = (await params).id;
    repository.getTask(taskId);
    const attachments = repository.listTaskAttachments(taskId);
    if (attachments.length >= MAX_TASK_FILES) {
      throw new WorkspaceRequestError(413, `单个任务最多上传 ${MAX_TASK_FILES} 个文件。`);
    }
    const totalBytes = attachments.reduce((sum, item) => sum + item.byteSize, 0);
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new WorkspaceRequestError(400, "请选择要上传的文件。");
    if (file.size <= 0) throw new WorkspaceRequestError(400, "文件内容为空。");
    if (file.size > MAX_FILE_BYTES) throw new WorkspaceRequestError(413, "单个文件不能超过 20 MB。");
    if (totalBytes + file.size > MAX_TASK_BYTES) throw new WorkspaceRequestError(413, "单个任务附件总大小不能超过 100 MB。");

    const buffer = Buffer.from(await file.arrayBuffer());
    const checksum = createHash("sha256").update(buffer).digest("hex");
    const duplicate = attachments.find((item) => item.checksum === checksum);
    if (duplicate) return workspaceJson({ attachment: publicAttachment(duplicate), duplicate: true });

    const id = `attachment-${crypto.randomUUID()}`;
    const directory = path.join(/* turbopackIgnore: true */ attachmentsRoot(), taskId);
    storagePath = path.join(directory, `${id}${safeExtension(file.name)}`);
    await mkdir(directory, { recursive: true });
    await writeFile(storagePath, buffer, { flag: "wx" });
    const attachment = repository.createTaskAttachment({
      id,
      taskId,
      fileName: file.name.slice(0, 255),
      mediaType: file.type || "application/octet-stream",
      byteSize: file.size,
      checksum,
      storagePath,
      status: "uploaded",
    });
    return workspaceJson({ attachment: publicAttachment(attachment) }, 201);
  } catch (error) {
    if (storagePath) await unlink(storagePath).catch(() => undefined);
    return workspaceErrorResponse(error);
  }
}
