import { outputSettingsSchema } from "@/lib/workspace/contracts";
import { parseWorkspaceJson, workspaceErrorResponse, workspaceJson } from "@/lib/workspace/http";
import { WorkspaceRepository } from "@/lib/workspace/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return workspaceJson(new WorkspaceRepository().getOutputSettings());
  } catch (error) {
    return workspaceErrorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const input = await parseWorkspaceJson(request, outputSettingsSchema);
    return workspaceJson(new WorkspaceRepository().setOutputSettings(input));
  } catch (error) {
    return workspaceErrorResponse(error);
  }
}
