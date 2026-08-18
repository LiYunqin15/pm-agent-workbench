import { connectionBaseUrl, updateLocalEnvironment } from "@/lib/agent/environment";
import { getAgentRuntimeStatus } from "@/lib/agent/runtime";
import { agentConnectionSchema } from "@/lib/workspace/contracts";
import {
  parseWorkspaceJson,
  workspaceErrorResponse,
  workspaceJson,
  WorkspaceRequestError,
} from "@/lib/workspace/http";
import { WorkspaceRepository } from "@/lib/workspace/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function assertLocalRequest(request: Request) {
  const url = new URL(request.url);
  if (!["localhost", "127.0.0.1", "::1"].includes(url.hostname)) {
    throw new WorkspaceRequestError(403, "API 配置仅允许从本机修改。");
  }
  const origin = request.headers.get("origin");
  if (origin) {
    try {
      if (new URL(origin).host !== url.host) {
        throw new WorkspaceRequestError(403, "API 配置请求来源无效。");
      }
    } catch (error) {
      if (error instanceof WorkspaceRequestError) throw error;
      throw new WorkspaceRequestError(403, "API 配置请求来源无效。");
    }
  }
}

function toEnvironmentUpdate(input: ReturnType<typeof agentConnectionSchema.parse>) {
  const update: Parameters<typeof updateLocalEnvironment>[0] = {};
  if (input.apiKey?.trim()) update.apiKey = input.apiKey.trim();
  if (input.baseUrl !== undefined) update.baseUrl = input.baseUrl.trim() || null;
  if (input.apiMode !== undefined) update.apiMode = input.apiMode;
  if (input.modelFast !== undefined) update.modelFast = input.modelFast.trim() || null;
  if (input.modelDefault !== undefined) update.modelDefault = input.modelDefault.trim() || null;
  if (input.modelDeep !== undefined) update.modelDeep = input.modelDeep.trim() || null;
  return update;
}

function endpointLabel(baseUrl: string): string {
  try {
    return new URL(baseUrl).host || "API 服务";
  } catch {
    return "API 服务";
  }
}

export async function PATCH(request: Request) {
  try {
    assertLocalRequest(request);
    const input = await parseWorkspaceJson(request, agentConnectionSchema);
    updateLocalEnvironment(toEnvironmentUpdate(input));
    return workspaceJson(getAgentRuntimeStatus(new WorkspaceRepository()));
  } catch (error) {
    return workspaceErrorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    assertLocalRequest(request);
    updateLocalEnvironment({
      apiKey: null,
      baseUrl: null,
      apiMode: null,
      modelFast: null,
      modelDefault: null,
      modelDeep: null,
    });
    return workspaceJson(getAgentRuntimeStatus(new WorkspaceRepository()));
  } catch (error) {
    return workspaceErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    assertLocalRequest(request);
    const input = await parseWorkspaceJson(request, agentConnectionSchema);
    const apiKey = input.apiKey?.trim() || process.env.OPENAI_API_KEY?.trim();
    if (!apiKey) return workspaceJson({ ok: false, code: "API_NOT_CONFIGURED", error: "请先填写 API Key。" }, 422);

    const baseUrl = input.baseUrl?.trim() || connectionBaseUrl();
    const parsedUrl = new URL(baseUrl);
    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
      return workspaceJson({ ok: false, error: "中转站地址必须使用 http 或 https。" }, 400);
    }

    const startedAt = Date.now();
    const response = await fetch(`${baseUrl.replace(/\/+$/, "")}/models`, {
      headers: { Accept: "application/json", Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      return workspaceJson({
        ok: false,
        error: response.status === 401 || response.status === 403 ? "API Key 无效或没有访问权限。" : `服务返回 HTTP ${response.status}。`,
        endpoint: endpointLabel(baseUrl),
        latencyMs: Date.now() - startedAt,
      }, response.status === 401 || response.status === 403 ? 401 : 502);
    }
    return workspaceJson({ ok: true, endpoint: endpointLabel(baseUrl), latencyMs: Date.now() - startedAt });
  } catch (error) {
    if (error instanceof TypeError) return workspaceJson({ ok: false, error: "无法连接到该 API 地址。" }, 502);
    if (error instanceof DOMException && error.name === "TimeoutError") {
      return workspaceJson({ ok: false, error: "连接超时，请检查中转站地址和网络。" }, 504);
    }
    return workspaceErrorResponse(error);
  }
}
