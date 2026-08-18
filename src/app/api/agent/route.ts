import { MaxTurnsExceededError } from "@openai/agents";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { BudgetTooLowError } from "@/lib/agent/budget";
import { executePmAgent } from "@/lib/agent/execute";
import { getAgentRuntimeStatus } from "@/lib/agent/runtime";
import {
  agentRunRequestSchema,
  agentRunResponseSchema,
} from "@/lib/contracts/agent";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 64 * 1024;

class ApiRequestError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ApiRequestError";
    this.status = status;
    this.code = code;
  }
}

function responseHeaders(requestId: string): HeadersInit {
  return {
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "X-Request-Id": requestId,
  };
}

function jsonResponse(data: unknown, status: number, requestId: string) {
  return NextResponse.json(data, {
    status,
    headers: responseHeaders(requestId),
  });
}

function errorResponse(
  requestId: string,
  status: number,
  code: string,
  message: string,
  issues?: Array<{ path: string; message: string }>,
) {
  return jsonResponse(
    {
      error: message,
      code,
      requestId,
      ...(issues && issues.length > 0 ? { issues } : {}),
    },
    status,
    requestId,
  );
}

async function readJsonBody(request: Request): Promise<unknown> {
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.startsWith("application/json")) {
    throw new ApiRequestError(415, "UNSUPPORTED_MEDIA_TYPE", "请求必须使用 application/json。");
  }

  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    throw new ApiRequestError(413, "PAYLOAD_TOO_LARGE", "请求内容过大，请精简任务背景。");
  }

  const text = await request.text();
  if (Buffer.byteLength(text, "utf8") > MAX_BODY_BYTES) {
    throw new ApiRequestError(413, "PAYLOAD_TOO_LARGE", "请求内容过大，请精简任务背景。");
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ApiRequestError(400, "INVALID_JSON", "请求不是有效的 JSON。");
  }
}

function providerStatus(error: unknown): number | null {
  if (!error || typeof error !== "object") return null;
  const status = (error as Record<string, unknown>).status;
  return typeof status === "number" ? status : null;
}

function isTimeout(error: unknown): boolean {
  return (
    error instanceof DOMException &&
    (error.name === "TimeoutError" || error.name === "AbortError")
  );
}

export async function GET() {
  const requestId = crypto.randomUUID();
  const runtime = getAgentRuntimeStatus();
  return jsonResponse(
    {
      status: "ok",
      mode: runtime.mode,
      selectedMode: runtime.selectedMode,
      preference: runtime.preference,
      api: runtime.api,
      provider: runtime.api,
      models: runtime.models,
      limits: {
        maxBodyBytes: MAX_BODY_BYTES,
        maxPromptCharacters: 12_000,
        budgetUsd: { min: 0.1, max: 50 },
      },
    },
    200,
    requestId,
  );
}

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();

  try {
    const payload = agentRunRequestSchema.parse(await readJsonBody(request));
    const result = await executePmAgent(payload);

    return jsonResponse(agentRunResponseSchema.parse(result), 200, requestId);
  } catch (error) {
    if (error instanceof ApiRequestError) {
      return errorResponse(requestId, error.status, error.code, error.message);
    }

    if (error instanceof ZodError) {
      const issues = error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      }));
      return errorResponse(
        requestId,
        400,
        "INVALID_REQUEST",
        issues[0]?.message ?? "任务参数无效。",
        issues,
      );
    }

    if (error instanceof BudgetTooLowError) {
      return errorResponse(requestId, 422, "BUDGET_TOO_LOW", error.message);
    }

    if (error instanceof MaxTurnsExceededError) {
      return errorResponse(
        requestId,
        422,
        "RUN_LIMIT_REACHED",
        "任务已达到最大执行轮次，请缩小范围、提高预算或降低执行深度。",
      );
    }

    if (isTimeout(error)) {
      return errorResponse(
        requestId,
        504,
        "AGENT_TIMEOUT",
        "任务执行超时，请缩小范围或降低执行深度。",
      );
    }

    const status = providerStatus(error);
    if (status === 429) {
      return errorResponse(
        requestId,
        429,
        "PROVIDER_RATE_LIMITED",
        "模型服务当前繁忙，请稍后重试。",
      );
    }
    if (status === 401 || status === 403) {
      return errorResponse(
        requestId,
        503,
        "PROVIDER_AUTH_FAILED",
        "服务端模型配置无效，请联系项目管理员。",
      );
    }

    console.error("Agent run failed", {
      requestId,
      name: error instanceof Error ? error.name : "UnknownError",
      message: error instanceof Error ? error.message : "Unknown failure",
      providerStatus: status,
    });
    return errorResponse(
      requestId,
      500,
      "AGENT_RUN_FAILED",
      "任务执行失败，请稍后重试或降低执行深度。",
    );
  }
}
