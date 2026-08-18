import type { AutonomyLevel } from "./types";

export const POLICY_VERSION = "2026-08-18.v1";

export type PolicyTool =
  | "web_search"
  | "file_search"
  | "code_interpreter"
  | "document_write"
  | "computer_use_readonly"
  | "external_write"
  | "send_message"
  | "publish"
  | "delete"
  | "payment"
  | "upload_sensitive";

export type PolicyDecision = "allowed" | "approval_required" | "blocked";

export type PolicyErrorCode = "POLICY_BLOCKED" | "APPROVAL_REQUIRED" | "BUDGET_EXCEEDED";

/** A stable, server-side error used by the execution gate and API layer. */
export class AgentPolicyError extends Error {
  constructor(
    readonly code: PolicyErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "AgentPolicyError";
  }
}

export interface AgentPolicy {
  version: string;
  autonomy: AutonomyLevel;
  allowedTools: PolicyTool[];
  allowedDomains: string[];
  budgetCents: number;
}

const READ_TOOLS: PolicyTool[] = ["web_search", "file_search", "code_interpreter"];
const HIGH_RISK_TOOLS = new Set<PolicyTool>([
  "external_write",
  "send_message",
  "publish",
  "delete",
  "payment",
  "upload_sensitive",
]);

export function buildAgentPolicy(
  autonomy: AutonomyLevel,
  options: { allowedDomains?: string[]; budgetCents?: number } = {},
): AgentPolicy {
  const allowedTools: PolicyTool[] = autonomy === "advise"
    ? [...READ_TOOLS]
    : autonomy === "draft"
      ? [...READ_TOOLS, "document_write"]
      : [...READ_TOOLS, "document_write", "computer_use_readonly"];
  return {
    version: POLICY_VERSION,
    autonomy,
    allowedTools,
    allowedDomains: [...new Set((options.allowedDomains ?? []).map((domain) => domain.trim().toLowerCase()).filter(Boolean))],
    budgetCents: Math.max(0, Math.round(options.budgetCents ?? 0)),
  };
}

export function evaluateToolCall(
  policy: AgentPolicy,
  tool: string,
  options: { targetDomain?: string; estimatedCostCents?: number; approvalStatus?: "pending" | "approved" | "rejected" | "cancelled" | "expired" } = {},
): PolicyDecision {
  const normalizedTool = tool as PolicyTool;
  if (!policy.allowedTools.includes(normalizedTool) && !HIGH_RISK_TOOLS.has(normalizedTool)) return "blocked";
  if (options.targetDomain && policy.allowedDomains.length > 0) {
    const domain = options.targetDomain.toLowerCase().replace(/^www\./, "");
    if (!policy.allowedDomains.some((allowed) => domain === allowed || domain.endsWith(`.${allowed}`))) return "blocked";
  }
  if (options.estimatedCostCents !== undefined && options.estimatedCostCents > policy.budgetCents) return "blocked";
  if (HIGH_RISK_TOOLS.has(normalizedTool)) {
    if (policy.autonomy !== "scoped") return "blocked";
    if (policy.allowedDomains.length === 0) return "blocked";
    return options.approvalStatus === "approved" ? "allowed" : "approval_required";
  }
  return "allowed";
}

export function assertToolAllowed(
  policy: AgentPolicy,
  tool: string,
  options: Parameters<typeof evaluateToolCall>[2] = {},
): void {
  const decision = evaluateToolCall(policy, tool, options);
  if (options.estimatedCostCents !== undefined && options.estimatedCostCents > policy.budgetCents) {
    throw new AgentPolicyError("BUDGET_EXCEEDED", `工具 ${tool} 的预计费用超过当前预算。`, {
      estimatedCostCents: options.estimatedCostCents,
      budgetCents: policy.budgetCents,
    });
  }
  if (decision === "blocked") {
    throw new AgentPolicyError("POLICY_BLOCKED", `工具 ${tool} 不在当前自治级别的允许范围内。`, { tool });
  }
  if (decision === "approval_required") {
    throw new AgentPolicyError("APPROVAL_REQUIRED", `工具 ${tool} 需要人工审批后才能执行。`, { tool });
  }
}
