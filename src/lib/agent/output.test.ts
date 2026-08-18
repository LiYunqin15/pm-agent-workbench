import { describe, expect, it } from "vitest";
import { assessOutputQuality, formatPmAgentOutput, type PmAgentOutput } from "./output";

const output: PmAgentOutput = {
  title: "AI 会议市场研究",
  scopeAndAssumptions: ["中国市场，近 12 个月"],
  facts: [
    {
      claim: "市场仍在增长",
      evidenceSummary: "行业报告给出同比增长数据",
      sourceUrls: ["https://example.com/report"],
      confidence: "high",
    },
    {
      claim: "中小团队需求增加",
      evidenceSummary: "用户评论样本",
      sourceUrls: ["https://example.com/reviews"],
      confidence: "medium",
    },
  ],
  inferences: [{ claim: "轻量方案存在机会", basis: "需求与价格带不匹配", confidence: "medium" }],
  recommendations: [
    {
      action: "验证自动纪要到任务闭环",
      rationale: "高频痛点集中",
      userValue: "减少会后整理",
      costAndRisk: "需要验证识别准确率",
    },
  ],
  risks: ["样本偏差"],
  unknowns: ["付费意愿"],
  nextActions: ["完成 5 次访谈"],
};

describe("structured PM output", () => {
  it("renders a deterministic Markdown deliverable", () => {
    const markdown = formatPmAgentOutput(output);

    expect(markdown).toContain("## 事实");
    expect(markdown).toContain("## 推断");
    expect(markdown).toContain("[example.com](https://example.com/report)");
  });

  it("flags research results below the 90 percent citation target", () => {
    const quality = assessOutputQuality(
      output,
      [{ title: "报告", url: "https://example.com/report" }],
      true,
    );

    expect(quality.factCitationCoverage).toBe(0.5);
    expect(quality.status).toBe("needs_review");
    expect(quality.warnings[0]).toContain("50%");
  });
});
