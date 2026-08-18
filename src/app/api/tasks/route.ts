import { taskCreateSchema, taskMetricSchema, taskStatusSchema } from "@/lib/workspace/contracts";
import { parseWorkspaceJson, workspaceErrorResponse, workspaceJson } from "@/lib/workspace/http";
import { WorkspaceRepository } from "@/lib/workspace/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const status = params.get("status");
    const metric = params.get("metric");
    const result = new WorkspaceRepository().listTasks({
      query: params.get("query") ?? undefined,
      productId: params.get("productId") ?? undefined,
      status: status ? taskStatusSchema.parse(status) : undefined,
      metric: metric ? taskMetricSchema.parse(metric) : "all",
    });
    return workspaceJson({
      ...result,
      summary: { ...result.summary, changesRequestedCount: result.summary.changesRequestedCount ?? 0 },
    });
  } catch (error) {
    return workspaceErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const input = await parseWorkspaceJson(request, taskCreateSchema);
    return workspaceJson(new WorkspaceRepository().createTask(input), 201);
  } catch (error) {
    return workspaceErrorResponse(error);
  }
}
