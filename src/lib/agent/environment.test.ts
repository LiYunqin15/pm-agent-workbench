import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { updateLocalEnvironment } from "./environment";

const originalEnvironment = {
  PM_AGENT_ENV_PATH: process.env.PM_AGENT_ENV_PATH,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  OPENAI_BASE_URL: process.env.OPENAI_BASE_URL,
  OPENAI_API_MODE: process.env.OPENAI_API_MODE,
  OPENAI_MODEL_FAST: process.env.OPENAI_MODEL_FAST,
  OPENAI_MODEL_DEFAULT: process.env.OPENAI_MODEL_DEFAULT,
  OPENAI_MODEL_DEEP: process.env.OPENAI_MODEL_DEEP,
};

afterEach(() => {
  for (const [key, value] of Object.entries(originalEnvironment)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("local API environment", () => {
  it("writes compatible settings without exposing or overwriting unrelated lines", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "pm-agent-env-"));
    const filePath = path.join(directory, ".env.local");
    process.env.PM_AGENT_ENV_PATH = filePath;

    updateLocalEnvironment({
      apiKey: "relay$key with spaces",
      baseUrl: "https://relay.example.com/v1",
      apiMode: "chat_completions",
      modelDefault: "relay-model",
    });
    const first = readFileSync(filePath, "utf8");
    expect(first).toContain('OPENAI_API_KEY="relay\\$key with spaces"');
    expect(first).toContain('OPENAI_BASE_URL="https://relay.example.com/v1"');
    expect(first).toContain('OPENAI_API_MODE="chat_completions"');
    expect(first).toContain('OPENAI_MODEL_DEFAULT="relay-model"');
    expect(process.env.OPENAI_API_KEY).toBe("relay$key with spaces");

    updateLocalEnvironment({ apiKey: null, baseUrl: null, apiMode: null });
    const second = readFileSync(filePath, "utf8");
    expect(second).not.toContain("OPENAI_API_KEY");
    expect(second).not.toContain("OPENAI_BASE_URL");
    expect(second).not.toContain("OPENAI_API_MODE");
    expect(second).toContain("OPENAI_MODEL_DEFAULT");
    rmSync(directory, { recursive: true, force: true });
  });
});
