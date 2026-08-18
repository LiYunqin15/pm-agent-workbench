import { Agent, OpenAIProvider, Runner, webSearchTool } from "@openai/agents";
import { agentRunResponseSchema } from "@/lib/contracts/agent";
import { buildRunTrace, countWebSearchCalls } from "./audit";
import { completeBudgetSummary, createBudgetPlan } from "./budget";
import { extractEvidence } from "./citations";
import { BASE_INSTRUCTIONS, buildTaskInput } from "./instructions";
import {
  assessOutputQuality,
  formatPmAgentOutput,
  pmAgentOutputSchema,
} from "./output";
import { isCustomResponsesEndpoint, RelayResponsesModelProvider } from "./responses-compat";
import { selectModel } from "./router";
import type { AgentProgressUpdate, AgentRunRequest, AgentRunResponse, RunDepth } from "./types";

const REASONING_BY_DEPTH: Readonly<Record<RunDepth, "low" | "medium" | "high">> = {
  quick: "low",
  standard: "medium",
  deep: "high",
};

const VERBOSITY_BY_DEPTH: Readonly<Record<RunDepth, "low" | "medium" | "high">> = {
  quick: "low",
  standard: "medium",
  deep: "high",
};

function cachedInputTokens(details: Array<Record<string, number>>): number {
  return details.reduce(
    (total, item) => total + (item.cached_tokens ?? item.cachedTokens ?? 0),
    0,
  );
}

export async function runPmAgent(request: AgentRunRequest): Promise<AgentRunResponse> {
  const model = selectModel(request.depth);
  const requiresSearch = request.mode === "market" || request.mode === "competitor";
  const useResponses = process.env.OPENAI_API_MODE !== "chat_completions";
  const budgetPlan = createBudgetPlan(request, model);
  const startedAt = new Date().toISOString();
  const startTime = performance.now();
  const webSearch = webSearchTool({
    name: "web_search",
    externalWebAccess: true,
    filters: request.context?.allowedDomains
      ? { allowedDomains: request.context.allowedDomains }
      : undefined,
    userLocation: request.context?.region
      ? { type: "approximate", region: request.context.region }
      : undefined,
    searchContextSize:
      request.depth === "quick" ? "low" : request.depth === "deep" ? "high" : "medium",
  });
  const pmAgent = new Agent({
    name: "PM Workbench",
    instructions: BASE_INSTRUCTIONS,
    model,
    outputType: pmAgentOutputSchema,
    tools: useResponses ? [webSearch] : [],
    modelSettings: {
      toolChoice: useResponses ? (requiresSearch ? "required" : "auto") : undefined,
      parallelToolCalls: false,
      maxTokens: budgetPlan.summary.maxOutputTokens,
      store: false,
      promptCacheRetention: useResponses ? "in-memory" : undefined,
      promptCacheOptions: useResponses ? { mode: "implicit", ttl: "30m" } : undefined,
      reasoning: {
        effort: REASONING_BY_DEPTH[request.depth],
        summary: "auto",
      },
      text: { verbosity: VERBOSITY_BY_DEPTH[request.depth] },
      providerData: useResponses
        ? {
            include: ["web_search_call.action.sources"],
            prompt_cache_key: `pm-agent:${request.mode}:${request.depth}`,
          }
        : undefined,
    },
  });
  const openAIProvider = new OpenAIProvider({
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: process.env.OPENAI_BASE_URL?.trim() || undefined,
    useResponses,
  });
  const modelProvider = useResponses && isCustomResponsesEndpoint(process.env.OPENAI_BASE_URL)
    ? new RelayResponsesModelProvider(openAIProvider)
    : openAIProvider;
  const runner = new Runner({
    modelProvider,
    tracingDisabled: process.env.OPENAI_AGENTS_TRACING_ENABLED !== "true",
    traceIncludeSensitiveData: false,
    workflowName: "PM Agent MVP",
  });
  await request.onProgress?.({
    stage: "planning",
    stageIndex: 1,
    progress: 12,
    action: "正在理解任务目标",
    detail: "已读取任务范围、执行深度和预算。",
  });
  const result = await runner.run(pmAgent, buildTaskInput(request), {
    maxTurns: budgetPlan.summary.maxTurns,
    signal: request.signal,
    stream: true,
  });
  const sources = new Map<string, { url: string; title: string }>();
  for await (const event of result) {
    const eventValue = event as unknown as Record<string, unknown>;
    if (eventValue.type === "raw_model_stream_event") {
      const data = eventValue.data as Record<string, unknown> | undefined;
      const raw = data?.event as Record<string, unknown> | undefined;
      if (raw?.type === "response.web_search_call.searching") {
        const query = typeof raw.query === "string" ? raw.query : undefined;
        await emitProgress(request, {
          stage: "searching",
          stageIndex: 2,
          progress: Math.min(48, 24 + sources.size * 4),
          action: query ? `正在搜索：${query}` : "正在调用网页搜索",
          detail: "等待搜索服务返回可核验来源。",
          query,
          visitedSourceCount: sources.size,
        });
      }
    }
    if (eventValue.type === "run_item_stream_event") {
      const name = eventValue.name;
      const item = (eventValue.item as Record<string, unknown> | undefined)?.rawItem as Record<string, unknown> | undefined;
      const providerData = item?.providerData as Record<string, unknown> | undefined;
      const action = providerData?.action as Record<string, unknown> | undefined;
      if (item?.type === "hosted_tool_call" && (item.name === "web_search" || providerData?.type === "web_search_call")) {
        const query = typeof action?.query === "string" ? action.query : typeof item.arguments === "string" ? item.arguments : undefined;
        const actionSources = Array.isArray(action?.sources) ? action.sources : [];
        for (const candidate of actionSources) {
          const source = candidate as Record<string, unknown>;
          const url = typeof source.url === "string" ? source.url : "";
          if (!url || sources.has(url)) continue;
          const title = typeof source.title === "string" ? source.title : url;
          sources.set(url, { url, title });
          await emitProgress(request, {
            stage: "searching",
            stageIndex: 2,
            progress: Math.min(52, 30 + sources.size * 3),
            action: "已找到可核验来源",
            detail: title,
            query,
            url,
            sourceTitle: title,
            visitedSourceCount: sources.size,
          });
        }
        if (name === "tool_called" && actionSources.length === 0) {
          await emitProgress(request, {
            stage: "searching",
            stageIndex: 2,
            progress: 30,
            action: query ? `正在搜索：${query}` : "正在调用网页搜索",
            detail: "搜索服务已开始处理请求。",
            query,
            visitedSourceCount: sources.size,
          });
        }
      }
      if (name === "message_output_created") {
        await emitProgress(request, {
          stage: "analyzing",
          stageIndex: 3,
          progress: 64,
          action: "正在整理模型分析",
          detail: `${sources.size} 个来源已返回，正在交叉核验结论。`,
          visitedSourceCount: sources.size,
        });
      }
    }
  }
  const structuredOutput = result.finalOutput;

  if (!structuredOutput) {
    throw new Error("Agent completed without a structured final output");
  }

  const completedAt = new Date().toISOString();
  const durationMs = Math.max(0, Math.round(performance.now() - startTime));
  const output = formatPmAgentOutput(structuredOutput);
  const attachmentReferences = (request.attachments ?? []).map((attachment) => ({
    id: attachment.id,
    fileName: attachment.fileName,
    referenced: output.includes(attachment.id) || output.includes(attachment.fileName),
  }));
  const { citations, evidence } = extractEvidence(result.output, completedAt);
  await emitProgress(request, {
    stage: "evidence",
    stageIndex: 4,
    progress: 82,
    action: "正在检查证据覆盖率",
    detail: `${citations.length} 个来源，${evidence.length} 条证据已整理。`,
    visitedSourceCount: citations.length,
    evidenceCount: evidence.length,
  });
  const webSearchCalls = countWebSearchCalls(result.output);
  const rawUsage = result.runContext.usage;
  const usage = {
    requests: rawUsage.requests,
    inputTokens: rawUsage.inputTokens,
    cachedInputTokens: cachedInputTokens(rawUsage.inputTokensDetails),
    outputTokens: rawUsage.outputTokens,
    totalTokens: rawUsage.totalTokens,
    webSearchCalls,
    durationMs,
  };
  const budget = completeBudgetSummary(budgetPlan, usage, webSearchCalls);
  const quality = assessOutputQuality(structuredOutput, citations, requiresSearch);

  if (budget.status === "exceeded") {
    quality.status = "needs_review";
    quality.warnings.push("本次估算费用超过用户设置的预算，需要检查搜索轮次与输出长度。 ");
  }

  const trace = buildRunTrace(result.output, {
    model,
    startedAt,
    completedAt,
    quality,
  });
  const response: AgentRunResponse = {
    id: result.lastResponseId ?? crypto.randomUUID(),
    demo: false,
    status: quality.status === "passed" ? "completed" : "needs_review",
    model,
    mode: request.mode,
    output,
    citations,
    evidence,
    attachmentReferences,
    stages: [
      { label: "任务校验", status: "completed" },
      { label: "研究规划", status: "completed" },
      {
        label: requiresSearch ? "外部检索" : "外部检索（按需）",
        status: requiresSearch && webSearchCalls === 0 ? "failed" : "completed",
      },
      { label: "结构化分析", status: "completed", durationMs },
      {
        label: "证据质量检查",
        status: quality.status === "passed" ? "completed" : "failed",
      },
    ],
    usage,
    budget,
    quality,
    trace,
    startedAt,
    completedAt,
  };

  await emitProgress(request, {
    stage: "archiving",
    stageIndex: 5,
    progress: 96,
    action: "正在归档研究结果",
    detail: "结构化结果已生成，准备保存主文档。",
    visitedSourceCount: citations.length,
    evidenceCount: evidence.length,
  });

  return agentRunResponseSchema.parse(response);
}

async function emitProgress(request: AgentRunRequest, update: AgentProgressUpdate) {
  if (request.signal?.aborted) throw request.signal.reason ?? new Error("任务已取消。");
  await request.onProgress?.(update);
}
