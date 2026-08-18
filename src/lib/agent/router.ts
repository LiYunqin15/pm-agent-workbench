import type { RunDepth } from "./types";

const DEFAULT_MODELS: Record<RunDepth, string> = {
  quick: "gpt-5.6-luna",
  standard: "gpt-5.6-terra",
  deep: "gpt-5.6-sol",
};

export function selectModel(
  depth: RunDepth,
  env: Readonly<Record<string, string | undefined>> = process.env,
): string {
  const overrides: Record<RunDepth, string | undefined> = {
    quick: env.OPENAI_MODEL_FAST,
    standard: env.OPENAI_MODEL_DEFAULT,
    deep: env.OPENAI_MODEL_DEEP,
  };

  return overrides[depth]?.trim() || DEFAULT_MODELS[depth];
}

export function maxTurnsFor(depth: RunDepth): number {
  return depth === "quick" ? 4 : depth === "standard" ? 8 : 14;
}
