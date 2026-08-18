import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { closeWorkspaceDatabase } from "@/lib/workspace/database";
import { DELETE, PATCH, POST } from "./connection/route";

let directory = "";
const original = {
  db: process.env.PM_AGENT_DB_PATH,
  env: process.env.PM_AGENT_ENV_PATH,
  key: process.env.OPENAI_API_KEY,
  base: process.env.OPENAI_BASE_URL,
  mode: process.env.OPENAI_API_MODE,
  fast: process.env.OPENAI_MODEL_FAST,
  defaultModel: process.env.OPENAI_MODEL_DEFAULT,
  deep: process.env.OPENAI_MODEL_DEEP,
};

function jsonRequest(body: unknown, method = "PATCH") {
  return new Request("http://localhost/api/settings/agent/connection", {
    method,
    headers: { "Content-Type": "application/json", Origin: "http://localhost" },
    body: method === "DELETE" ? undefined : JSON.stringify(body),
  });
}

beforeAll(() => {
  directory = mkdtempSync(path.join(tmpdir(), "pm-agent-connection-"));
  process.env.PM_AGENT_DB_PATH = path.join(directory, "workspace.sqlite");
  process.env.PM_AGENT_ENV_PATH = path.join(directory, ".env.local");
  delete process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_BASE_URL;
  delete process.env.OPENAI_API_MODE;
});

afterAll(() => {
  vi.unstubAllGlobals();
  closeWorkspaceDatabase();
  const environmentKeys: Record<string, string> = {
    db: "PM_AGENT_DB_PATH",
    env: "PM_AGENT_ENV_PATH",
    key: "OPENAI_API_KEY",
    base: "OPENAI_BASE_URL",
    mode: "OPENAI_API_MODE",
    fast: "OPENAI_MODEL_FAST",
    defaultModel: "OPENAI_MODEL_DEFAULT",
    deep: "OPENAI_MODEL_DEEP",
  };
  for (const [key, value] of Object.entries(original)) {
    const environmentKey = environmentKeys[key];
    if (value === undefined) delete process.env[environmentKey];
    else process.env[environmentKey] = value;
  }
  rmSync(directory, { recursive: true, force: true });
});

describe("agent connection settings", () => {
  it("saves and clears local API configuration without returning the secret", async () => {
    const savedResponse = await PATCH(jsonRequest({
      apiKey: "relay-secret",
      baseUrl: "https://relay.example.com/v1",
      apiMode: "chat_completions",
      modelDefault: "relay-model",
    }));
    const saved = await savedResponse.json();
    expect(savedResponse.status).toBe(200);
    expect(saved.api.configured).toBe(true);
    expect(saved.api.baseUrl).toBe("https://relay.example.com/v1");
    expect(JSON.stringify(saved)).not.toContain("relay-secret");
    expect(readFileSync(process.env.PM_AGENT_ENV_PATH!, "utf8")).toContain("OPENAI_API_KEY");

    const clearedResponse = await DELETE(jsonRequest({}, "DELETE"));
    const cleared = await clearedResponse.json();
    expect(clearedResponse.status).toBe(200);
    expect(cleared.api.configured).toBe(false);
    expect(process.env.OPENAI_API_KEY).toBeUndefined();
  });

  it("tests a configured-compatible endpoint without invoking a model", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const response = await POST(jsonRequest({ apiKey: "test-key", baseUrl: "https://relay.example.com/v1" }, "POST"));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://relay.example.com/v1/models",
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer test-key" }) }),
    );
    delete process.env.OPENAI_API_KEY;
    vi.unstubAllGlobals();
  });

  it("rejects connection tests when no key is available", async () => {
    delete process.env.OPENAI_API_KEY;
    const response = await POST(jsonRequest({ baseUrl: "https://relay.example.com/v1" }, "POST"));
    expect(response.status).toBe(422);
    expect((await response.json()).code).toBe("API_NOT_CONFIGURED");
  });
});
