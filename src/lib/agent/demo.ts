import type { AgentRunRequest, AgentRunResponse } from "./types";
import { createBudgetPlan, createDemoBudgetSummary } from "./budget";
import { selectModel } from "./router";

const MODE_NAMES: Record<AgentRunRequest["mode"], string> = {
  market: "市场研究",
  competitor: "竞品分析",
  insight: "用户洞察",
  prd: "PRD 草拟",
};

export async function createDemoResponse(request: AgentRunRequest): Promise<AgentRunResponse> {
  const model = selectModel(request.depth);
  const startedAt = new Date().toISOString();
  const budgetPlan = createBudgetPlan(request, model);
  const report = async (update: Parameters<NonNullable<AgentRunRequest["onProgress"]>>[0]) => {
    if (request.signal?.aborted) throw request.signal.reason ?? new Error("任务已取消。");
    await request.onProgress?.(update);
    await new Promise((resolve) => setTimeout(resolve, 80));
  };

  await report({ stage: "planning", stageIndex: 1, progress: 12, action: "正在理解任务目标", detail: "已读取任务范围、执行深度和预算。" });
  await report({ stage: "searching", stageIndex: 2, progress: 32, action: "演示模式未访问外部网站", detail: "使用内置示例执行计划，不产生真实来源。" });
  await report({ stage: "analyzing", stageIndex: 3, progress: 58, action: "正在整理示例执行计划", detail: "区分事实、推断和建议的输出结构。" });
  await report({ stage: "evidence", stageIndex: 4, progress: 76, action: "演示模式不生成事实证据", detail: "已访问来源 0，已形成证据 0。" });
  await report({ stage: "archiving", stageIndex: 5, progress: 92, action: "正在归档演示结果", detail: "即将把执行计划保存到产品文档。" });
  const completedAt = new Date().toISOString();

  return {
    id: crypto.randomUUID(),
    demo: true,
    status: "demo",
    model,
    mode: request.mode,
    output: [
      `# ${MODE_NAMES[request.mode]}任务已建立`,
      "",
      `**目标**：${request.prompt}`,
      "",
      "## 执行计划",
      "",
      "1. 明确任务范围、目标用户、时间与地域边界。",
      "2. 收集一手来源并记录发布时间与访问时间。",
      "3. 区分事实、推断和建议，标记相互冲突的信息。",
      "4. 形成可验证的结论、风险和下一步行动。",
      "",
      "## 当前状态",
      "",
      "尚未连接 OpenAI API，因此本次只生成执行计划，没有访问外部网站，也没有生成研究结论或证据。",
    ].join("\n"),
    citations: [],
    evidence: [],
    attachmentReferences: (request.attachments ?? []).map((attachment) => ({ id: attachment.id, fileName: attachment.fileName, referenced: false })),
    stages: [
      { label: "任务校验", status: "completed" },
      { label: "研究规划", status: "completed" },
      { label: "外部检索", status: "pending" },
      { label: "分析交付", status: "pending" },
    ],
    usage: {
      requests: 0,
      inputTokens: 0,
      cachedInputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      webSearchCalls: 0,
      durationMs: 0,
    },
    budget: createDemoBudgetSummary(budgetPlan),
    quality: {
      status: "not_run",
      factCitationCoverage: null,
      warnings: ["演示模式没有访问外部来源，不能用于事实判断。"],
    },
    trace: [
      {
        id: "trace-1",
        at: startedAt,
        type: "system",
        name: "任务校验",
        status: "completed",
        detail: "输入与预算参数已通过服务端校验。",
      },
      {
        id: "trace-2",
        at: startedAt,
        type: "model",
        name: "模型路由",
        status: "completed",
        detail: `计划使用 ${model}，但当前没有发起模型请求。`,
      },
      {
        id: "trace-3",
        at: startedAt,
        type: "system",
        name: "演示模式",
        status: "completed",
        detail: "未配置服务端 API Key，仅返回执行计划。",
      },
    ],
    startedAt,
    completedAt,
  };
}
