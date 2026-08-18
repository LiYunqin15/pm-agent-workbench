import type { AgentRunRequest, AgentRunResponse } from "./types";
import { createDemoResponse } from "./demo";
import { runPmAgent } from "./run-agent";
import { getAgentRuntimeStatus } from "./runtime";
import { getRunTimeoutMs } from "@/lib/queue/config";

export async function executePmAgent(request: AgentRunRequest): Promise<AgentRunResponse> {
  const signal = request.signal ?? AbortSignal.timeout(getRunTimeoutMs(request.depth));
  const effectiveRequest = request.signal ? request : { ...request, signal };
  return getAgentRuntimeStatus().mode === "live" ? runPmAgent(effectiveRequest) : createDemoResponse(effectiveRequest);
}
