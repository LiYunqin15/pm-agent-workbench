import { exportDocumentContent, type ExportFormat } from "@/lib/documents/export";
import { workspaceErrorResponse, WorkspaceRequestError } from "@/lib/workspace/http";
import { WorkspaceRepository } from "@/lib/workspace/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FORMATS: ExportFormat[] = ["markdown", "html", "txt", "docx", "pdf"];

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const format = new URL(request.url).searchParams.get("format") as ExportFormat | null;
    if (!format || !FORMATS.includes(format)) throw new WorkspaceRequestError(400, "导出格式无效。");
    const document = new WorkspaceRepository().getDocument((await params).id);
    const file = await exportDocumentContent(document.currentVersion.title, document.currentVersion.content, format);
    const headers = new Headers({
      "Content-Type": file.contentType,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "no-store",
      "Content-Disposition": `${file.printable ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
    });
    return new Response(new Uint8Array(file.body), { headers });
  } catch (error) {
    if (error instanceof WorkspaceRequestError) {
      return Response.json({ error: error.message }, { status: error.status, headers: { "Cache-Control": "no-store" } });
    }
    return workspaceErrorResponse(error);
  }
}
