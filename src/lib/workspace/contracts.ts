import { z } from "zod";
import { AGENT_RUNTIME_MODES, AUTONOMY_LEVELS, RUN_DEPTHS, TASK_MODES } from "@/lib/agent/types";
import { researchContextSchema } from "@/lib/contracts/agent";
import {
  DOCUMENT_FORMATS,
  OUTPUT_DOCUMENT_FORMATS,
  RESEARCH_SOURCE_TRUSTS,
  RESEARCH_SOURCE_TYPES,
  RESEARCH_SOURCE_VERIFICATIONS,
  TASK_STATUSES,
} from "./types";

export const productCreateSchema = z.object({
  name: z.string().trim().min(1, "请输入产品名称。").max(80, "产品名称不能超过 80 个字符。"),
  description: z.string().trim().max(500, "产品描述不能超过 500 个字符。").optional().default(""),
}).strict();

export const taskCreateSchema = z.object({
  productId: z.string().trim().min(1),
  title: z.string().trim().min(1, "请输入任务名称。").max(200),
  prompt: z.string().trim().min(10, "请至少描述 10 个字符的任务背景。").max(12_000),
  type: z.enum(TASK_MODES),
  depth: z.enum(RUN_DEPTHS),
  autonomy: z.enum(AUTONOMY_LEVELS),
  budgetCents: z.number().int().min(10).max(5_000),
  researchInput: researchContextSchema.optional(),
}).strict();

export const taskStatusSchema = z.enum(TASK_STATUSES);
export const taskMetricSchema = z.enum(["all", "month", "running", "review", "changes_requested"]);

export const taskReviewSchema = z.object({
  decision: z.enum(["approved", "changes_requested"]),
  note: z.string().trim().max(500, "审核意见不能超过 500 个字符。").default(""),
  baseUpdatedAt: z.string().datetime(),
}).strict().superRefine((value, context) => {
  if (value.decision === "changes_requested" && !value.note) {
    context.addIssue({ code: "custom", path: ["note"], message: "退回修改时必须填写修改意见。" });
  }
});

export const taskReviewResubmitSchema = z.object({
  baseUpdatedAt: z.string().datetime(),
  documentRevision: z.number().int().positive(),
  note: z.string().trim().max(500, "复审说明不能超过 500 个字符。").optional(),
}).strict();

export const approvalCreateSchema = z.object({
  toolName: z.string().trim().min(1).max(80),
  target: z.string().trim().max(500).nullable().optional(),
  parameterHash: z.string().trim().regex(/^[a-f0-9]{64}$/i).optional(),
  estimatedCostCents: z.number().int().min(0).max(5_000).optional(),
}).strict();

export const approvalDecisionSchema = z.object({
  baseRevision: z.number().int().positive(),
  note: z.string().trim().max(500).optional(),
  resolvedBy: z.string().trim().min(1).max(80).optional(),
}).strict();

export const approvalRejectSchema = approvalDecisionSchema.superRefine((value, context) => {
  if (!value.note) context.addIssue({ code: "custom", path: ["note"], message: "拒绝审批时必须填写原因。" });
});

export const approvalCancelSchema = z.object({
  baseRevision: z.number().int().positive(),
  note: z.string().trim().max(500).optional(),
  resolvedBy: z.string().trim().min(1).max(80).optional(),
}).strict();

const researchSourceUrlSchema = z.string().trim().max(2_000, "来源地址不能超过 2,000 个字符。").refine((value) => {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}, "请输入以 http:// 或 https:// 开头的有效来源地址。");

export const researchSourceTypeSchema = z.enum(RESEARCH_SOURCE_TYPES);
export const researchSourceTrustSchema = z.enum(RESEARCH_SOURCE_TRUSTS);
export const researchSourceVerificationSchema = z.enum(RESEARCH_SOURCE_VERIFICATIONS);
export const researchSourceCreateSchema = z.object({
  title: z.string().trim().min(1, "请输入资料标题。").max(240),
  type: researchSourceTypeSchema,
  url: researchSourceUrlSchema,
  taskId: z.string().trim().min(1).nullable().optional(),
  verificationNote: z.string().trim().max(500).optional(),
}).strict();

export const researchSourceUpdateSchema = z.object({
  title: z.string().trim().min(1, "请输入资料标题。").max(240),
  type: researchSourceTypeSchema,
  trust: researchSourceTrustSchema,
  url: researchSourceUrlSchema,
  taskId: z.string().trim().min(1).nullable().optional(),
  baseUpdatedAt: z.string().datetime().optional(),
}).strict();

export const researchSourceVerifySchema = z.object({
  trust: researchSourceTrustSchema,
  note: z.string().trim().max(500).optional(),
  baseUpdatedAt: z.string().datetime().optional(),
}).strict();

export const researchSourceReopenSchema = z.object({
  baseUpdatedAt: z.string().datetime().optional(),
}).strict();

export const agentModeUpdateSchema = z.object({
  mode: z.enum(AGENT_RUNTIME_MODES),
}).strict();

export const outputSettingsSchema = z.object({
  outputFormats: z.array(z.enum(OUTPUT_DOCUMENT_FORMATS)).min(1, "至少保留一种输出格式。").max(OUTPUT_DOCUMENT_FORMATS.length),
  defaultOutputFormat: z.enum(OUTPUT_DOCUMENT_FORMATS),
}).strict().refine(
  (value) => value.outputFormats.includes(value.defaultOutputFormat),
  { message: "默认输出格式必须包含在已启用格式中。", path: ["defaultOutputFormat"] },
);

const connectionBaseUrlSchema = z.string().trim().max(500, "中转站地址不能超过 500 个字符。").refine((value) => {
  if (!value) return true;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}, "请输入以 http:// 或 https:// 开头的有效地址。");

export const agentConnectionSchema = z.object({
  apiKey: z.string().trim().max(500, "API Key 不能超过 500 个字符。").optional(),
  baseUrl: connectionBaseUrlSchema.optional(),
  apiMode: z.enum(["responses", "chat_completions"]).optional(),
  modelFast: z.string().trim().max(120).optional(),
  modelDefault: z.string().trim().max(120).optional(),
  modelDeep: z.string().trim().max(120).optional(),
}).strict();

export const documentCreateSchema = z.object({
  taskId: z.string().trim().regex(/^TASK-\d+$/, "任务 ID 无效。"),
  title: z.string().trim().min(1, "请输入文档标题。").max(200),
  content: z.string().max(200_000).default(""),
  format: z.enum(DOCUMENT_FORMATS),
  owner: z.string().trim().min(1).max(80).optional(),
}).strict();

export const documentVersionCreateSchema = z.object({
  baseRevision: z.number().int().positive(),
  title: z.string().trim().min(1, "请输入文档标题。").max(200),
  content: z.string().max(200_000),
  changeNote: z.string().trim().max(500).optional(),
  createdBy: z.string().trim().min(1).max(80).optional(),
}).strict();

export const documentVersionMetadataSchema = z.object({
  baseMetadataRevision: z.number().int().positive(),
  alias: z.string().trim().max(80).nullable(),
  changeNote: z.string().trim().max(500).nullable(),
  updatedBy: z.string().trim().min(1).max(80).optional(),
}).strict();

export const documentRestoreSchema = z.object({
  versionId: z.string().trim().min(1),
  baseRevision: z.number().int().positive(),
  createdBy: z.string().trim().min(1).max(80).optional(),
}).strict();
