import { Agent, OpenAIProvider, Runner } from "@openai/agents";
import { z } from "zod";
import { getAgentRuntimeStatus } from "@/lib/agent/runtime";
import { isCustomResponsesEndpoint, RelayResponsesModelProvider } from "@/lib/agent/responses-compat";
import { selectModel } from "@/lib/agent/router";
import { DOCUMENT_FORMAT_LABELS, type DocumentFormat } from "@/lib/workspace/types";

export const DOCUMENT_TRANSFORM_ACTIONS = [
  "rewrite",
  "summarize",
  "to_prd",
  "to_outline",
  "translate_en",
  "convert",
] as const;

export type DocumentTransformAction = (typeof DOCUMENT_TRANSFORM_ACTIONS)[number];

export const DOCUMENT_TRANSFORM_ACTION_LABELS: Record<DocumentTransformAction, string> = {
  rewrite: "智能改写",
  summarize: "提炼摘要",
  to_prd: "转换为 PRD",
  to_outline: "整理为汇报提纲",
  translate_en: "翻译为英文",
  convert: "转换文档类型",
};

const transformOutputSchema = z.object({
  title: z.string().trim().min(1).max(200),
  content: z.string().min(1).max(200_000),
});

export interface DocumentTransformInput {
  title: string;
  content: string;
  action: DocumentTransformAction;
  targetFormat: DocumentFormat;
  instruction?: string;
  signal?: AbortSignal;
}

export interface DocumentTransformResult {
  title: string;
  content: string;
  demo: boolean;
  model: string;
}

function firstParagraphs(content: string, count: number): string {
  return content
    .split(/\n\s*\n/)
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((part) => !part.startsWith("#"))
    .slice(0, count)
    .join("\n\n");
}

function demoTransform(input: DocumentTransformInput): DocumentTransformResult {
  const label = DOCUMENT_FORMAT_LABELS[input.targetFormat];
  const title = input.action === "translate_en"
    ? `${input.title} - English version`
    : input.action === "convert"
      ? `${input.title} - ${label}`
      : input.title;
  const body = input.content.trim();
  let content = body;

  if (input.action === "summarize") {
    content = `# ${input.title} 摘要\n\n## 核心摘要\n\n${firstParagraphs(body, 3) || "原文暂未提供可提炼的段落。"}\n\n## 后续动作\n\n- 对关键结论补充来源和验证状态。\n- 将摘要同步到评审材料或任务清单。`;
  } else if (input.action === "to_outline") {
    const headings = body.match(/^#{1,3}\s+.+$/gm) ?? [];
    content = `# ${input.title} 汇报提纲\n\n${headings.length > 0 ? headings.map((heading, index) => `${index + 1}. ${heading.replace(/^#+\s*/, "")}`).join("\n") : "1. 背景与目标\n2. 关键发现\n3. 结论与下一步"}`;
  } else if (input.action === "to_prd") {
    content = `# ${input.title} PRD\n\n## 背景与目标\n\n${firstParagraphs(body, 2) || "补充产品背景和用户目标。"}\n\n## 用户与场景\n\n- 目标用户：待补充\n- 核心场景：待补充\n\n## 需求范围\n\n${body}\n\n## 验收标准\n\n- 关键流程可被验证。\n- 失败、空态和权限边界有明确处理。`;
  } else if (input.action === "translate_en") {
    content = `# ${input.title} - English version\n\n> Demo mode keeps the original content. Connect a live API to translate it.\n\n${body}`;
  } else if (input.action === "rewrite") {
    content = `# ${input.title}\n\n${body}\n\n## 编辑提示\n\n- 结论、事实和建议建议分层呈现。\n- 为关键数字补充来源和采集时间。`;
  }

  return { title, content, demo: true, model: "演示模式" };
}

export async function transformDocument(input: DocumentTransformInput): Promise<DocumentTransformResult> {
  const runtime = getAgentRuntimeStatus();
  if (runtime.mode !== "live") return demoTransform(input);

  const useResponses = process.env.OPENAI_API_MODE !== "chat_completions";
  const provider = new OpenAIProvider({
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: process.env.OPENAI_BASE_URL?.trim() || undefined,
    useResponses,
  });
  const modelProvider = useResponses && isCustomResponsesEndpoint(process.env.OPENAI_BASE_URL)
    ? new RelayResponsesModelProvider(provider)
    : provider;
  const agent = new Agent({
    name: "PM 文档转换助手",
    instructions: "你是产品经理文档编辑助手。根据用户选择的动作处理 Markdown 文档，保留事实含义，不捏造来源。只返回结构化的 title 和 content，正文使用 Markdown。",
    model: selectModel("standard"),
    outputType: transformOutputSchema,
    modelSettings: {
      maxTokens: 8_000,
      store: false,
      reasoning: useResponses ? { effort: "medium", summary: "auto" } : undefined,
      text: useResponses ? { verbosity: "medium" } : undefined,
    },
  });
  const runner = new Runner({
    modelProvider,
    tracingDisabled: process.env.OPENAI_AGENTS_TRACING_ENABLED !== "true",
    traceIncludeSensitiveData: false,
    workflowName: "PM Document Transform",
  });
  const action = DOCUMENT_TRANSFORM_ACTION_LABELS[input.action];
  const target = DOCUMENT_FORMAT_LABELS[input.targetFormat];
  const prompt = [
    `动作：${action}`,
    `目标文档类型：${target}`,
    input.instruction?.trim() ? `补充要求：${input.instruction.trim()}` : "",
    `原文标题：${input.title}`,
    "原文正文：",
    input.content,
  ].filter(Boolean).join("\n\n");
  const result = await runner.run(agent, prompt, {
    maxTurns: 1,
    signal: input.signal ?? AbortSignal.timeout(120_000),
    stream: false,
  });
  if (!result.finalOutput) throw new Error("文档转换没有生成可用结果。");
  return { ...result.finalOutput, demo: false, model: selectModel("standard") };
}
