import { describe, expect, it } from "vitest";
import {
  BudgetTooLowError,
  completeBudgetSummary,
  createBudgetPlan,
} from "./budget";
import type { AgentRunRequest } from "./types";

function request(overrides: Partial<AgentRunRequest> = {}): AgentRunRequest {
  return {
    prompt: "分析目标市场、关键趋势和主要竞争者。",
    mode: "market",
    depth: "standard",
    autonomy: "draft",
    budgetUsd: 2,
    ...overrides,
  };
}

describe("budget policy", () => {
  it("keeps depth limits when the budget is sufficient", () => {
    const plan = createBudgetPlan(request(), "gpt-5.6-terra", {});

    expect(plan.summary.maxTurns).toBe(8);
    expect(plan.summary.maxOutputTokens).toBe(6_000);
  });

  it("reduces turns and output for a low-budget research run", () => {
    const plan = createBudgetPlan(
      request({ budgetUsd: 0.1 }),
      "gpt-5.6-terra",
      {},
    );

    expect(plan.summary.maxTurns).toBe(3);
    expect(plan.summary.maxOutputTokens).toBeGreaterThanOrEqual(800);
    expect(plan.summary.maxOutputTokens).toBeLessThan(6_000);
  });

  it("rejects a run whose minimum safe output cannot fit the budget", () => {
    expect(() =>
      createBudgetPlan(
        request({ prompt: "a".repeat(12_000), depth: "deep", budgetUsd: 0.1 }),
        "gpt-5.6-sol",
        {},
      ),
    ).toThrow(BudgetTooLowError);
  });

  it("estimates token and web-search costs with cached tokens", () => {
    const plan = createBudgetPlan(request(), "gpt-5.6-terra", {});
    const summary = completeBudgetSummary(
      plan,
      { inputTokens: 10_000, cachedInputTokens: 2_000, outputTokens: 1_000 },
      2,
    );

    expect(summary.estimatedCostUsd).toBe(0.0484);
    expect(summary.status).toBe("within");
  });

  it("marks custom model pricing unavailable without explicit overrides", () => {
    const plan = createBudgetPlan(request(), "custom-model", {});
    const summary = completeBudgetSummary(
      plan,
      { inputTokens: 1_000, cachedInputTokens: 0, outputTokens: 500 },
      1,
    );

    expect(summary.estimatedCostUsd).toBeNull();
    expect(summary.status).toBe("unavailable");
  });

  it("does not apply official pricing to a relay endpoint", () => {
    const plan = createBudgetPlan(request(), "gpt-5.6-terra", {
      OPENAI_BASE_URL: "https://relay.example.com/v1",
    });

    expect(plan.summary.pricingBasis).toBeNull();
  });
});
