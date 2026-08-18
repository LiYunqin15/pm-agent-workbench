import type {
  Model,
  ModelProvider,
  ModelRequest,
  ModelResponse,
  ModelRetryAdviceRequest,
  StreamEvent,
} from "@openai/agents";
import { ZodError } from "zod";

const STANDARD_STATUSES = new Set(["in_progress", "completed", "incomplete"]);
const PROGRAM_OUTPUT_STATUSES = new Set(["completed", "incomplete"]);
const APPLY_PATCH_CALL_STATUSES = new Set(["in_progress", "completed"]);
const APPLY_PATCH_OUTPUT_STATUSES = new Set(["completed", "failed"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function withFallbackStatus(
  item: Record<string, unknown>,
  validStatuses: ReadonlySet<string>,
  required: boolean,
): Record<string, unknown> {
  if (typeof item.status === "string" && validStatuses.has(item.status)) return item;
  if (!required && item.status === undefined) return item;
  return { ...item, status: "completed" };
}

function normalizeOutputItem(item: unknown): unknown {
  if (!isRecord(item)) return item;

  switch (item.type) {
    case "message":
      return item.role === "assistant"
        ? withFallbackStatus(item, STANDARD_STATUSES, true)
        : item;
    case "function_call_result":
    case "computer_call":
      return withFallbackStatus(item, STANDARD_STATUSES, true);
    case "function_call":
    case "shell_call":
    case "shell_call_output":
      return withFallbackStatus(item, STANDARD_STATUSES, false);
    case "program_output":
      return withFallbackStatus(item, PROGRAM_OUTPUT_STATUSES, true);
    case "apply_patch_call":
      return withFallbackStatus(item, APPLY_PATCH_CALL_STATUSES, true);
    case "apply_patch_call_output":
      return withFallbackStatus(item, APPLY_PATCH_OUTPUT_STATUSES, true);
    default:
      return item;
  }
}

function normalizeOutput<T extends readonly unknown[]>(output: T): T {
  return output.map(normalizeOutputItem) as unknown as T;
}

export function normalizeRelayModelResponse(response: ModelResponse): ModelResponse {
  return { ...response, output: normalizeOutput(response.output) };
}

export function normalizeRelayStreamEvent(event: StreamEvent): StreamEvent {
  if (event.type !== "response_done") return event;
  return {
    ...event,
    response: {
      ...event.response,
      output: normalizeOutput(event.response.output),
    },
  };
}

class RelayResponsesModel implements Model {
  constructor(private readonly model: Model) {}

  async getResponse(request: ModelRequest): Promise<ModelResponse> {
    return normalizeRelayModelResponse(await this.model.getResponse(request));
  }

  async *getStreamedResponse(request: ModelRequest): AsyncIterable<StreamEvent> {
    for await (const event of this.model.getStreamedResponse(request)) {
      yield normalizeRelayStreamEvent(event);
    }
  }

  getRetryAdvice(args: ModelRetryAdviceRequest) {
    return this.model.getRetryAdvice?.(args);
  }
}

export class RelayResponsesModelProvider implements ModelProvider {
  constructor(private readonly provider: ModelProvider) {}

  async getModel(modelName?: string): Promise<Model> {
    return new RelayResponsesModel(await this.provider.getModel(modelName));
  }
}

export function isCustomResponsesEndpoint(baseUrl: string | undefined): boolean {
  const value = baseUrl?.trim();
  if (!value) return false;
  try {
    return new URL(value).hostname.toLowerCase() !== "api.openai.com";
  } catch {
    return true;
  }
}

export function isResponsesOutputValidationError(error: unknown): boolean {
  if (!(error instanceof ZodError)) return false;
  return error.issues.some((issue) => {
    const path = issue.path;
    return (
      (path[0] === "response" && path[1] === "output") ||
      path[0] === "output"
    );
  });
}

export type RelayFailureCode =
  | "WEB_SEARCH_UNAVAILABLE"
  | "UPSTREAM_AUTH_ERROR"
  | "UPSTREAM_RATE_LIMIT"
  | "TIMEOUT"
  | "UPSTREAM_ERROR";

export class RelayIntegrationError extends Error {
  constructor(readonly code: RelayFailureCode, message: string, readonly status?: number) {
    super(message);
    this.name = "RelayIntegrationError";
  }
}

/** Map relay HTTP/transport failures to stable, non-sensitive application codes. */
export function mapRelayFailure(error: unknown): RelayIntegrationError {
  if (error instanceof RelayIntegrationError) return error;
  if (error instanceof DOMException && error.name === "TimeoutError") {
    return new RelayIntegrationError("TIMEOUT", "中转站请求超时。", undefined);
  }
  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    const status = typeof record.status === "number" ? record.status : typeof record.statusCode === "number" ? record.statusCode : undefined;
    const rawMessage = error instanceof Error ? error.message : typeof record.message === "string" ? record.message : "";
    const message = rawMessage.toLowerCase();
    if (status === 401 || status === 403) return new RelayIntegrationError("UPSTREAM_AUTH_ERROR", "中转站鉴权失败，请检查 API Key 或权限。", status);
    if (status === 429) return new RelayIntegrationError("UPSTREAM_RATE_LIMIT", "中转站触发限流，请稍后重试。", status);
    if (status === 400 || status === 404 || status === 422) {
      if (/web\s*search|web_search|search tool|tool.*support|unsupported.*tool|not available/.test(message)) {
        return new RelayIntegrationError("WEB_SEARCH_UNAVAILABLE", "当前中转站不支持 Responses Web Search。", status);
      }
    }
    if (status !== undefined) return new RelayIntegrationError("UPSTREAM_ERROR", `中转站返回 HTTP ${status}。`, status);
    if (/timeout|timed out|aborted|abort/.test(message)) return new RelayIntegrationError("TIMEOUT", "中转站请求超时。", status);
  }
  return new RelayIntegrationError("UPSTREAM_ERROR", "中转站请求失败。", undefined);
}
