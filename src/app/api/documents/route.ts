import { documentCreateSchema } from "@/lib/workspace/contracts";
import { parseWorkspaceJson, WorkspaceRequestError, workspaceErrorResponse, workspaceJson } from "@/lib/workspace/http";
import { WorkspaceRepository } from "@/lib/workspace/repository";
import { DOCUMENT_FORMATS, type DocumentFormat } from "@/lib/workspace/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseFormat(value: string | null): DocumentFormat | undefined {
  if (!value) return undefined;
  if (!(DOCUMENT_FORMATS as readonly string[]).includes(value)) throw new WorkspaceRequestError(400, "文档类型无效。");
  return value as DocumentFormat;
}

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const documents = new WorkspaceRepository().listDocuments({
      query: params.get("query") ?? undefined,
      productId: params.get("productId") ?? undefined,
      taskId: params.get("taskId") ?? undefined,
      format: parseFormat(params.get("format")),
    });
    return workspaceJson({ items: documents });
  } catch (error) {
    return workspaceErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const input = await parseWorkspaceJson(request, documentCreateSchema);
    return workspaceJson(new WorkspaceRepository().createDocument(input), 201);
  } catch (error) {
    return workspaceErrorResponse(error);
  }
}
