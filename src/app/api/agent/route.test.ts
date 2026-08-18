import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { GET, POST } from "./route";

const originalApiKey = process.env.OPENAI_API_KEY;

const validPayload = {
  prompt: "分析中国 AI 会议产品市场和关键机会。",
  mode: "market",
  depth: "standard",
  autonomy: "draft",
  budgetUsd: 2,
};

function post(body: string, contentType = "application/json") {
  return POST(
    new Request("http://localhost/api/agent", {
      method: "POST",
      headers: { "content-type": contentType },
      body,
    }),
  );
}

beforeEach(() => {
  delete process.env.OPENAI_API_KEY;
});

afterAll(() => {
  if (originalApiKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = originalApiKey;
});

describe("agent API", () => {
  it("reports server mode without exposing credentials", async () => {
    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body.mode).toBe("demo");
    expect(JSON.stringify(body)).not.toContain("OPENAI_API_KEY");
  });

  it("returns an auditable demo response when no API key is configured", async () => {
    const response = await post(JSON.stringify(validPayload));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      demo: true,
      status: "demo",
      evidence: [],
      usage: { requests: 0 },
      quality: { status: "not_run" },
    });
    expect(body.trace).toHaveLength(3);
  });

  it("rejects invalid JSON and unsupported content types", async () => {
    const invalidJson = await post("{");
    const unsupported = await post(JSON.stringify(validPayload), "text/plain");

    expect(invalidJson.status).toBe(400);
    expect((await invalidJson.json()).code).toBe("INVALID_JSON");
    expect(unsupported.status).toBe(415);
    expect((await unsupported.json()).code).toBe("UNSUPPORTED_MEDIA_TYPE");
  });

  it("returns field-level validation issues", async () => {
    const response = await post(JSON.stringify({ ...validPayload, prompt: "太短" }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.code).toBe("INVALID_REQUEST");
    expect(body.issues[0].path).toBe("prompt");
  });

  it("rejects oversized request bodies", async () => {
    const response = await post(JSON.stringify({ ...validPayload, prompt: "a".repeat(70_000) }));

    expect(response.status).toBe(413);
    expect((await response.json()).code).toBe("PAYLOAD_TOO_LARGE");
  });

  it("rejects a task that cannot fit its declared budget", async () => {
    const response = await post(
      JSON.stringify({
        ...validPayload,
        prompt: "a".repeat(12_000),
        depth: "deep",
        budgetUsd: 0.1,
      }),
    );

    expect(response.status).toBe(422);
    expect((await response.json()).code).toBe("BUDGET_TOO_LOW");
  });
});
