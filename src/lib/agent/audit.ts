import type { QualitySummary, RunTraceEvent } from "./types";

type TraceOptions = {
  model: string;
  startedAt: string;
  completedAt: string;
  quality: QualitySummary;
};

type ToolCall = {
  id: string;
  name: string;
  status: "completed" | "failed";
  detail: string;
};

function stringField(record: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    if (typeof record[key] === "string" && record[key]) return record[key];
  }
  return null;
}

function collectToolCalls(value: unknown): ToolCall[] {
  const calls = new Map<string, ToolCall>();
  const seen = new Set<unknown>();

  function visit(node: unknown): void {
    if (!node || typeof node !== "object" || seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }

    const record = node as Record<string, unknown>;
    const providerData =
      record.providerData && typeof record.providerData === "object"
        ? (record.providerData as Record<string, unknown>)
        : null;
    const rawType = stringField(record, "type");
    const providerType = providerData ? stringField(providerData, "type") : null;
    const isHostedTool = rawType === "hosted_tool_call";
    const isWebSearch =
      rawType === "web_search_call" ||
      providerType === "web_search_call" ||
      stringField(record, "name") === "web_search_call";

    if (isHostedTool || isWebSearch) {
      const id =
        stringField(record, "id") ??
        (providerData ? stringField(providerData, "id") : null) ??
        `tool-${calls.size + 1}`;
      const action =
        providerData?.action && typeof providerData.action === "object"
          ? (providerData.action as Record<string, unknown>)
          : record.action && typeof record.action === "object"
            ? (record.action as Record<string, unknown>)
            : null;
      const queries = action?.queries;
      const actionType = action ? stringField(action, "type") : null;
      const statusValue = stringField(record, "status") ?? "completed";
      const name = isWebSearch
        ? "Web Search"
        : stringField(record, "name") ?? providerType ?? "Hosted tool";
      const detail = isWebSearch
        ? Array.isArray(queries)
          ? `完成 ${queries.length} 个网页查询`
          : actionType
            ? `执行网页操作：${actionType}`
            : "执行网页检索"
        : `执行托管工具：${name}`;

      calls.set(id, {
        id,
        name,
        status: statusValue === "failed" ? "failed" : "completed",
        detail,
      });
    }

    Object.values(record).forEach(visit);
  }

  visit(value);
  return [...calls.values()];
}

export function countWebSearchCalls(value: unknown): number {
  return collectToolCalls(value).filter((call) => call.name === "Web Search").length;
}

export function buildRunTrace(value: unknown, options: TraceOptions): RunTraceEvent[] {
  const toolCalls = collectToolCalls(value);
  const trace: RunTraceEvent[] = [
    {
      id: "trace-1",
      at: options.startedAt,
      type: "system",
      name: "任务校验",
      status: "completed",
      detail: "输入、任务类型、自治级别和预算参数已通过服务端校验。",
    },
    {
      id: "trace-2",
      at: options.startedAt,
      type: "model",
      name: "模型路由",
      status: "completed",
      detail: `已选择 ${options.model}，仅启用低风险研究工具。`,
    },
  ];

  toolCalls.forEach((call) => {
    trace.push({
      id: `trace-${trace.length + 1}`,
      at: options.completedAt,
      type: "tool",
      name: call.name,
      status: call.status,
      detail: call.detail,
    });
  });

  trace.push(
    {
      id: `trace-${trace.length + 1}`,
      at: options.completedAt,
      type: "quality",
      name: "证据质量检查",
      status: options.quality.status === "passed" ? "completed" : "failed",
      detail:
        options.quality.warnings[0] ?? "结构完整，研究任务的引用覆盖达到 MVP 阈值。",
    },
    {
      id: `trace-${trace.length + 2}`,
      at: options.completedAt,
      type: "system",
      name: "任务结束",
      status: "completed",
      detail: "结果、证据、使用量和预算状态已完成整理。",
    },
  );

  return trace;
}
