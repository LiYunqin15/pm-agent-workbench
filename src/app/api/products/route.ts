import { productCreateSchema } from "@/lib/workspace/contracts";
import { parseWorkspaceJson, workspaceErrorResponse, workspaceJson } from "@/lib/workspace/http";
import { WorkspaceRepository } from "@/lib/workspace/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const repository = new WorkspaceRepository();
    const includeTree = new URL(request.url).searchParams.get("tree") === "1";
    return workspaceJson({ items: includeTree ? repository.getProductTree() : repository.listProducts() });
  } catch (error) {
    return workspaceErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const input = await parseWorkspaceJson(request, productCreateSchema);
    return workspaceJson(new WorkspaceRepository().createProduct(input.name, input.description), 201);
  } catch (error) {
    return workspaceErrorResponse(error);
  }
}

