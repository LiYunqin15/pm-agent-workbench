import type { AgentRunRequest, BudgetSummary, RunDepth, RunUsage } from "./types";
import { maxTurnsFor } from "./router";
import { getRunTimeoutMs } from "@/lib/queue/config";

type ModelPricing = {
  inputPerMillion: number;
  cachedInputPerMillion: number;
  outputPerMillion: number;
  basis: string;
};

export type BudgetPlan = {
  summary: BudgetSummary;
  pricing: ModelPricing | null;
  webSearchCostPerCall: number;
};

const PRICING_BASIS = "OpenAI API public pricing, checked 2026-08-17";
const DEFAULT_WEB_SEARCH_COST_PER_CALL = 0.01;
const MIN_OUTPUT_TOKENS = 800;

const MODEL_PRICING: Readonly<Record<string, ModelPricing>> = {
  "gpt-5.6-luna": {
    inputPerMillion: 0.2,
    cachedInputPerMillion: 0.02,
    outputPerMillion: 1.2,
    basis: PRICING_BASIS,
  },
  "gpt-5.6-terra": {
    inputPerMillion: 2,
    cachedInputPerMillion: 0.2,
    outputPerMillion: 12,
    basis: PRICING_BASIS,
  },
  "gpt-5.6-sol": {
    inputPerMillion: 5,
    cachedInputPerMillion: 0.5,
    outputPerMillion: 30,
    basis: PRICING_BASIS,
  },
};

const OUTPUT_TOKENS_BY_DEPTH: Readonly<Record<RunDepth, number>> = {
  quick: 3_000,
  standard: 6_000,
  deep: 10_000,
};

export class BudgetTooLowError extends Error {
  readonly minimumBudgetUsd: number;

  constructor(minimumBudgetUsd: number) {
    super(`当前任务至少需要约 $${minimumBudgetUsd.toFixed(2)} 的预算，请提高预算或降低执行深度。`);
    this.name = "BudgetTooLowError";
    this.minimumBudgetUsd = minimumBudgetUsd;
  }
}

function readNonNegativeNumber(value: string | undefined): number | null {
  if (value === undefined || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function pricingFor(
  model: string,
  env: Readonly<Record<string, string | undefined>>,
): ModelPricing | null {
  const input = readNonNegativeNumber(env.OPENAI_PRICE_INPUT_PER_1M);
  const cached = readNonNegativeNumber(env.OPENAI_PRICE_CACHED_INPUT_PER_1M);
  const output = readNonNegativeNumber(env.OPENAI_PRICE_OUTPUT_PER_1M);

  if (input !== null && cached !== null && output !== null) {
    return {
      inputPerMillion: input,
      cachedInputPerMillion: cached,
      outputPerMillion: output,
      basis: "Environment pricing override",
    };
  }

  const baseUrl = env.OPENAI_BASE_URL?.trim();
  if (baseUrl && !baseUrl.startsWith("https://api.openai.com/")) {
    return null;
  }

  return MODEL_PRICING[model] ?? null;
}

function roundMoney(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

export function createBudgetPlan(
  request: AgentRunRequest,
  model: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
): BudgetPlan {
  const pricing = pricingFor(model, env);
  const webSearchCostPerCall =
    readNonNegativeNumber(env.OPENAI_WEB_SEARCH_COST_PER_CALL) ??
    DEFAULT_WEB_SEARCH_COST_PER_CALL;
  const requiresSearch = request.mode === "market" || request.mode === "competitor";
  const depthTurnLimit = maxTurnsFor(request.depth);
  const searchCallAllowance = requiresSearch
    ? Math.max(
        1,
        Math.min(
          depthTurnLimit - 1,
          Math.floor((request.budgetUsd * 0.2) / webSearchCostPerCall),
        ),
      )
    : 0;
  const maxTurns = requiresSearch
    ? Math.min(depthTurnLimit, searchCallAllowance + 1)
    : depthTurnLimit;
  let maxOutputTokens = OUTPUT_TOKENS_BY_DEPTH[request.depth];

  if (pricing) {
    const estimatedPromptTokens = Math.ceil(request.prompt.length / 3);
    const estimatedSearchTokens = requiresSearch ? 8_000 : 1_500;
    const reservedInputCost =
      ((estimatedPromptTokens + estimatedSearchTokens) * pricing.inputPerMillion) /
      1_000_000;
    const reservedSearchCost = searchCallAllowance * webSearchCostPerCall;
    const safetyBuffer = request.budgetUsd * 0.15;
    const availableForOutput =
      request.budgetUsd - reservedInputCost - reservedSearchCost - safetyBuffer;
    const budgetOutputTokens = Math.floor(
      (availableForOutput * 1_000_000) / pricing.outputPerMillion,
    );

    if (budgetOutputTokens < MIN_OUTPUT_TOKENS) {
      const minimumBudget =
        (reservedInputCost + reservedSearchCost +
          (MIN_OUTPUT_TOKENS * pricing.outputPerMillion) / 1_000_000) /
        0.85;
      throw new BudgetTooLowError(Math.ceil(minimumBudget * 100) / 100);
    }

    maxOutputTokens = Math.min(maxOutputTokens, budgetOutputTokens);
  }

  return {
    pricing,
    webSearchCostPerCall,
    summary: {
      limitUsd: request.budgetUsd,
      estimatedCostUsd: null,
      remainingUsd: null,
      status: "unavailable",
      maxTurns,
      maxOutputTokens,
      timeoutMs: getRunTimeoutMs(request.depth),
      pricingBasis: pricing?.basis ?? null,
    },
  };
}

export function completeBudgetSummary(
  plan: BudgetPlan,
  usage: Pick<RunUsage, "inputTokens" | "cachedInputTokens" | "outputTokens">,
  webSearchCalls: number,
): BudgetSummary {
  if (!plan.pricing) return plan.summary;

  const cachedInputTokens = Math.min(usage.inputTokens, usage.cachedInputTokens);
  const uncachedInputTokens = Math.max(0, usage.inputTokens - cachedInputTokens);
  const tokenCost =
    (uncachedInputTokens * plan.pricing.inputPerMillion) / 1_000_000 +
    (cachedInputTokens * plan.pricing.cachedInputPerMillion) / 1_000_000 +
    (usage.outputTokens * plan.pricing.outputPerMillion) / 1_000_000;
  const estimatedCostUsd = roundMoney(
    tokenCost + webSearchCalls * plan.webSearchCostPerCall,
  );
  const remainingUsd = roundMoney(plan.summary.limitUsd - estimatedCostUsd);

  return {
    ...plan.summary,
    estimatedCostUsd,
    remainingUsd,
    status: remainingUsd >= 0 ? "within" : "exceeded",
  };
}

export function createDemoBudgetSummary(plan: BudgetPlan): BudgetSummary {
  return {
    ...plan.summary,
    estimatedCostUsd: 0,
    remainingUsd: plan.summary.limitUsd,
    status: "within",
  };
}
