import { NextResponse } from "next/server";
import { ZodError, type ZodType } from "zod";
import { AgentPolicyError } from "@/lib/agent/policy";
import { WorkspaceConflictError, WorkspaceNotFoundError, WorkspacePolicyError, WorkspaceValidationError } from "./repository";

const MAX_JSON_BYTES = 512 * 1024;

export function workspaceJson(data: unknown, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export async function parseWorkspaceJson<T>(request: Request, schema: ZodType<T>): Promise<T> {
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.startsWith("application/json")) {
    throw new WorkspaceRequestError(415, "请求必须使用 application/json。");
  }
  const text = await request.text();
  if (Buffer.byteLength(text, "utf8") > MAX_JSON_BYTES) {
    throw new WorkspaceRequestError(413, "请求内容过大。");
  }
  let payload: unknown;
  try {
    payload = JSON.parse(text) as unknown;
  } catch {
    throw new WorkspaceRequestError(400, "请求不是有效的 JSON。");
  }
  return schema.parse(payload);
}

export class WorkspaceRequestError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "WorkspaceRequestError";
  }
}

export function workspaceErrorResponse(error: unknown) {
  if (error instanceof WorkspaceRequestError) {
    return workspaceJson({ error: error.message }, error.status);
  }
  if (error instanceof WorkspaceNotFoundError) {
    return workspaceJson({ error: error.message }, 404);
  }
  if (error instanceof WorkspaceConflictError) {
    return workspaceJson({ error: error.message, code: error.code }, 409);
  }
  if (error instanceof WorkspacePolicyError) {
    return workspaceJson({ error: error.message, code: error.code, ...(error.details ? { details: error.details } : {}) }, error.code === "APPROVAL_REQUIRED" ? 409 : 403);
  }
  if (error instanceof AgentPolicyError) {
    return workspaceJson({ error: error.message, code: error.code, ...(error.details ? { details: error.details } : {}) }, error.code === "APPROVAL_REQUIRED" ? 409 : 403);
  }
  if (error instanceof WorkspaceValidationError) {
    return workspaceJson({ error: error.message }, 400);
  }
  if (error instanceof ZodError) {
    return workspaceJson(
      {
        error: error.issues[0]?.message ?? "请求参数无效。",
        issues: error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
      },
      400,
    );
  }
  if (error && typeof error === "object" && "status" in error && typeof error.status === "number") {
    const status = error.status;
    const code = "code" in error && typeof error.code === "string" ? error.code : undefined;
    const message = error instanceof Error ? error.message : "请求无法完成。";
    return workspaceJson({ error: message, ...(code ? { code } : {}) }, status);
  }
  if (error && typeof error === "object" && "code" in error && error.code === "SQLITE_CONSTRAINT_UNIQUE") {
    return workspaceJson({ error: "同名数据已经存在。" }, 409);
  }
  console.error("Workspace API failed", error);
  return workspaceJson({ error: "工作区数据处理失败，请稍后重试。" }, 500);
}
