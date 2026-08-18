import { selectModel } from "./router";
import type { AgentRuntimeMode, AgentRuntimeStatus } from "./types";
import { apiKeyHint, safeBaseUrl } from "./environment";
import { WorkspaceRepository } from "@/lib/workspace/repository";

function endpointLabel(): string {
  const configuredEndpoint = process.env.OPENAI_BASE_URL?.trim();
  if (!configuredEndpoint) return "OpenAI 官方 API";
  try {
    return new URL(configuredEndpoint).host || "自定义中转站";
  } catch {
    return "自定义中转站";
  }
}

export function getAgentRuntimeStatus(
  repository = new WorkspaceRepository(),
): AgentRuntimeStatus {
  const settings = repository.getAgentSettings();
  const apiConfigured = Boolean(process.env.OPENAI_API_KEY?.trim());
  const configuredMode: AgentRuntimeMode = apiConfigured ? "live" : "demo";
  const selectedMode = settings.modePreference === "auto"
    ? configuredMode
    : settings.modePreference;
  const mode: AgentRuntimeMode = selectedMode === "live" && apiConfigured ? "live" : "demo";
  const apiMode = process.env.OPENAI_API_MODE === "chat_completions"
    ? "chat_completions"
    : "responses";

  return {
    mode,
    selectedMode,
    preference: settings.modePreference,
    updatedAt: settings.updatedAt,
    api: {
      configured: apiConfigured,
      keyHint: apiKeyHint(),
      baseUrl: safeBaseUrl(),
      customEndpoint: Boolean(process.env.OPENAI_BASE_URL?.trim()),
      endpointLabel: endpointLabel(),
      apiMode,
      webSearchAvailable: apiConfigured && apiMode !== "chat_completions",
    },
    models: {
      quick: selectModel("quick"),
      standard: selectModel("standard"),
      deep: selectModel("deep"),
    },
  };
}
