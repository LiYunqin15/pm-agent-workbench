import { z } from "zod";
import type { Citation, QualitySummary } from "./types";

const confidenceSchema = z.enum(["high", "medium", "low"]);

export const pmAgentOutputSchema = z.object({
  title: z.string().min(1).max(200),
  scopeAndAssumptions: z.array(z.string().min(1).max(500)).max(12),
  facts: z
    .array(
      z.object({
        claim: z.string().min(1).max(1_000),
        evidenceSummary: z.string().min(1).max(1_000),
        sourceUrls: z.array(z.string().min(1).max(2_048)).max(10),
        confidence: confidenceSchema,
      }),
    )
    .max(20),
  inferences: z
    .array(
      z.object({
        claim: z.string().min(1).max(1_000),
        basis: z.string().min(1).max(1_000),
        confidence: confidenceSchema,
      }),
    )
    .max(15),
  recommendations: z
    .array(
      z.object({
        action: z.string().min(1).max(1_000),
        rationale: z.string().min(1).max(1_000),
        userValue: z.string().min(1).max(800),
        costAndRisk: z.string().min(1).max(800),
      }),
    )
    .max(15),
  risks: z.array(z.string().min(1).max(800)).max(15),
  unknowns: z.array(z.string().min(1).max(800)).max(15),
  nextActions: z.array(z.string().min(1).max(800)).max(15),
});

export type PmAgentOutput = z.infer<typeof pmAgentOutputSchema>;

const CONFIDENCE_LABELS: Readonly<Record<PmAgentOutput["facts"][number]["confidence"], string>> = {
  high: "高",
  medium: "中",
  low: "低",
};

function safeHttpUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function appendList(lines: string[], heading: string, items: string[]): void {
  lines.push(`## ${heading}`, "");
  if (items.length === 0) {
    lines.push("- 暂无", "");
    return;
  }
  items.forEach((item) => lines.push(`- ${item}`));
  lines.push("");
}

export function formatPmAgentOutput(output: PmAgentOutput): string {
  const lines = [`# ${output.title}`, ""];
  appendList(lines, "范围与假设", output.scopeAndAssumptions);

  lines.push("## 事实", "");
  if (output.facts.length === 0) lines.push("- 暂无已验证事实", "");
  output.facts.forEach((fact, index) => {
    lines.push(
      `### ${index + 1}. ${fact.claim}`,
      "",
      `- 证据：${fact.evidenceSummary}`,
      `- 可信度：${CONFIDENCE_LABELS[fact.confidence]}`,
    );
    const urls = [...new Set(fact.sourceUrls.map(safeHttpUrl).filter((url): url is string => Boolean(url)))];
    if (urls.length > 0) {
      lines.push(
        `- 来源：${urls
          .map((url) => `[${new URL(url).hostname}](${url})`)
          .join("、")}`,
      );
    }
    lines.push("");
  });

  lines.push("## 推断", "");
  if (output.inferences.length === 0) lines.push("- 暂无", "");
  output.inferences.forEach((item, index) => {
    lines.push(
      `### ${index + 1}. ${item.claim}`,
      "",
      `- 推断依据：${item.basis}`,
      `- 可信度：${CONFIDENCE_LABELS[item.confidence]}`,
      "",
    );
  });

  lines.push("## 建议", "");
  if (output.recommendations.length === 0) lines.push("- 暂无", "");
  output.recommendations.forEach((item, index) => {
    lines.push(
      `### ${index + 1}. ${item.action}`,
      "",
      `- 原因：${item.rationale}`,
      `- 用户价值：${item.userValue}`,
      `- 成本与风险：${item.costAndRisk}`,
      "",
    );
  });

  appendList(lines, "风险", output.risks);
  appendList(lines, "待验证问题", output.unknowns);
  appendList(lines, "下一步行动", output.nextActions);
  return lines.join("\n").trim();
}

function comparableUrl(value: string): string | null {
  const safe = safeHttpUrl(value);
  if (!safe) return null;
  const url = new URL(safe);
  url.searchParams.sort();
  return url.toString().replace(/\/$/, "");
}

export function assessOutputQuality(
  output: PmAgentOutput,
  citations: Citation[],
  requiresSearch: boolean,
): QualitySummary {
  const citedUrls = new Set(
    citations.map((citation) => comparableUrl(citation.url)).filter(Boolean),
  );
  const coveredFacts = output.facts.filter((fact) =>
    fact.sourceUrls.some((url) => {
      const comparable = comparableUrl(url);
      return comparable !== null && citedUrls.has(comparable);
    }),
  ).length;
  const factCitationCoverage =
    output.facts.length > 0 ? coveredFacts / output.facts.length : null;
  const warnings: string[] = [];

  if (requiresSearch && citations.length === 0) {
    warnings.push("研究任务没有返回可点击的 URL 引用，所有外部结论都需要人工复核。");
  }
  if (requiresSearch && output.facts.length === 0) {
    warnings.push("研究任务没有形成结构化事实结论。");
  }
  if (
    requiresSearch &&
    factCitationCoverage !== null &&
    factCitationCoverage < 0.9
  ) {
    warnings.push(
      `事实引用覆盖率为 ${Math.round(factCitationCoverage * 100)}%，低于 MVP 目标 90%。`,
    );
  }

  return {
    status: warnings.length === 0 ? "passed" : "needs_review",
    factCitationCoverage,
    warnings,
  };
}
