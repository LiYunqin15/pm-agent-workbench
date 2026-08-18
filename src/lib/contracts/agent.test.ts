import { describe, expect, it } from "vitest";
import { agentRunRequestSchema } from "./agent";

const validRequest = {
  prompt: "分析中国 AI 会议产品市场和关键机会。",
  mode: "market",
  depth: "standard",
  autonomy: "draft",
  budgetUsd: 2,
};

describe("agent request contract", () => {
  it("accepts and normalizes research boundaries", () => {
    const result = agentRunRequestSchema.parse({
      ...validRequest,
      context: {
        region: "中国",
        allowedDomains: ["OPENAI.COM", "example.org"],
      },
    });

    expect(result.context?.allowedDomains).toEqual(["openai.com", "example.org"]);
  });

  it("rejects URL-shaped domain filters", () => {
    expect(() =>
      agentRunRequestSchema.parse({
        ...validRequest,
        context: { allowedDomains: ["https://example.com/path"] },
      }),
    ).toThrow();
  });

  it("rejects unknown request fields", () => {
    expect(() =>
      agentRunRequestSchema.parse({ ...validRequest, apiKey: "must-not-be-accepted" }),
    ).toThrow();
  });
});
