import { z } from "zod";
import { AUTONOMY_LEVELS, RUN_DEPTHS, TASK_MODES } from "@/lib/agent/types";

const domainSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(253, "域名不能超过 253 个字符")
  .regex(
    /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/,
    "仅支持不含协议和路径的域名，例如 example.com",
  );

export const researchContextSchema = z
  .object({
    region: z.string().trim().min(1).max(500).optional(),
    timeRange: z.string().trim().min(1).max(500).optional(),
    targetUsers: z.string().trim().min(1).max(500).optional(),
    researchQuestions: z.array(z.string().trim().min(1).max(120)).max(20).optional(),
    competitorNames: z.array(z.string().trim().min(1).max(120)).max(20).optional(),
    experienceScope: z.string().trim().min(1).max(500).optional(),
    allowedDomains: z.array(domainSchema).min(1).max(20).optional(),
    constraints: z.string().trim().min(1).max(500).optional(),
  })
  .strict();

export const agentRunRequestSchema = z
  .object({
    prompt: z.string().trim().min(10, "请至少描述 10 个字符的任务背景").max(12_000),
    mode: z.enum(TASK_MODES),
    depth: z.enum(RUN_DEPTHS),
    autonomy: z.enum(AUTONOMY_LEVELS),
    budgetUsd: z.coerce.number().finite().min(0.1).max(50),
    context: researchContextSchema.optional(),
  })
  .strict();

const citationSchema = z.object({
  title: z.string(),
  url: z.url(),
});

const evidenceSchema = citationSchema.extend({
  id: z.string(),
  publisher: z.string(),
  capturedAt: z.string(),
  cited: z.boolean(),
  excerpt: z.string().optional(),
  trust: z.literal("unrated"),
  freshness: z.literal("unknown"),
});

const attachmentReferenceSchema = z.object({
  id: z.string(),
  fileName: z.string(),
  referenced: z.boolean(),
});

export const agentRunResponseSchema = z.object({
  id: z.string(),
  demo: z.boolean(),
  status: z.enum(["completed", "needs_review", "demo"]),
  model: z.string(),
  mode: z.enum(TASK_MODES),
  output: z.string(),
  citations: z.array(citationSchema),
  evidence: z.array(evidenceSchema),
  attachmentReferences: z.array(attachmentReferenceSchema).optional(),
  stages: z.array(
    z.object({
      label: z.string(),
      status: z.enum(["completed", "pending", "failed"]),
      durationMs: z.number().int().nonnegative().optional(),
    }),
  ),
  usage: z.object({
    requests: z.number().int().nonnegative(),
    inputTokens: z.number().int().nonnegative(),
    cachedInputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    totalTokens: z.number().int().nonnegative(),
    webSearchCalls: z.number().int().nonnegative(),
    durationMs: z.number().int().nonnegative(),
  }),
  budget: z.object({
    limitUsd: z.number().nonnegative(),
    estimatedCostUsd: z.number().nonnegative().nullable(),
    remainingUsd: z.number().nullable(),
    status: z.enum(["within", "exceeded", "unavailable"]),
    maxTurns: z.number().int().positive(),
    maxOutputTokens: z.number().int().positive(),
    timeoutMs: z.number().int().positive(),
    pricingBasis: z.string().nullable(),
  }),
  quality: z.object({
    status: z.enum(["passed", "needs_review", "not_run"]),
    factCitationCoverage: z.number().min(0).max(1).nullable(),
    warnings: z.array(z.string()),
  }),
  trace: z.array(
    z.object({
      id: z.string(),
      at: z.string(),
      type: z.enum(["system", "model", "tool", "quality"]),
      name: z.string(),
      status: z.enum(["completed", "failed"]),
      detail: z.string(),
    }),
  ),
  startedAt: z.string(),
  completedAt: z.string(),
});
