import { getAgentRuntimeStatus } from "@/lib/agent/runtime";
import { agentModeUpdateSchema } from "@/lib/workspace/contracts";
import {
  parseWorkspaceJson,
  workspaceErrorResponse,
  workspaceJson,
} from "@/lib/workspace/http";
import { WorkspaceRepository } from "@/lib/workspace/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return workspaceJson(getAgentRuntimeStatus(new WorkspaceRepository()));
  } catch (error) {
    return workspaceErrorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const input = await parseWorkspaceJson(request, agentModeUpdateSchema);
    const repository = new WorkspaceRepository();
    repository.setAgentModePreference(input.mode);
    return workspaceJson(getAgentRuntimeStatus(repository));
  } catch (error) {
    return workspaceErrorResponse(error);
  }
}
