import {
  researchSourceTrustSchema,
  researchSourceTypeSchema,
  researchSourceVerificationSchema,
  researchSourceCreateSchema,
} from "@/lib/workspace/contracts";
import { parseWorkspaceJson, workspaceErrorResponse, workspaceJson } from "@/lib/workspace/http";
import { WorkspaceRepository } from "@/lib/workspace/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const repository = new WorkspaceRepository();
    return workspaceJson(repository.listResearchSources({
      query: params.get("query") ?? undefined,
      type: params.get("type") ? researchSourceTypeSchema.parse(params.get("type")) : undefined,
      trust: params.get("trust") ? researchSourceTrustSchema.parse(params.get("trust")) : undefined,
      verification: params.get("verification") ? researchSourceVerificationSchema.parse(params.get("verification")) : undefined,
      taskId: params.get("taskId") ?? undefined,
      sort: params.get("sort") === "oldest" ? "oldest" : "newest",
    }));
  } catch (error) {
    return workspaceErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const input = await parseWorkspaceJson(request, researchSourceCreateSchema);
    return workspaceJson(new WorkspaceRepository().createResearchSource(input), 201);
  } catch (error) {
    return workspaceErrorResponse(error);
  }
}
