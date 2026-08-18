import { describe, expect, it } from "vitest";
import { relaySmokeLog, runRelaySmokeTest } from "./relay-smoke";

function response(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "x-request-id": "req_test", ...headers } });
}

describe("relay Web Search smoke contract", () => {
  it("skips unless explicitly enabled", async () => {
    const result = await runRelaySmokeTest({ force: false, fetchImpl: async () => response({}) });
    expect(result.skipped).toBe(true);
  });

  it("extracts real-looking sources without logging secrets", async () => {
    let requestBody = "";
    const result = await runRelaySmokeTest({
      force: true,
      apiKey: "secret-key",
      baseUrl: "https://relay.example.com/v1",
      model: "relay-model",
      fetchImpl: async (_url, init) => {
        requestBody = String(init?.body ?? "");
        return response({
          id: "resp_test",
          output: [{ type: "web_search_call", action: { sources: [{ title: "官方产品页", url: "https://example.com/product" }] } }],
        });
      },
    });
    expect(result).toMatchObject({ skipped: false, sourceCount: 1, requestId: "req_test" });
    expect(result.sources[0]?.url).toBe("https://example.com/product");
    expect(relaySmokeLog(result)).not.toContain("secret-key");
    expect(requestBody).toContain("web_search_preview");
  });

  it("reports unsupported search and auth failures explicitly", async () => {
    const unsupported = await runRelaySmokeTest({ force: true, apiKey: "key", baseUrl: "https://relay.example.com/v1", fetchImpl: async () => response({ error: { message: "web search not supported" } }, 400) });
    expect(unsupported.errorCode).toBe("WEB_SEARCH_UNAVAILABLE");
    const unauthorized = await runRelaySmokeTest({ force: true, apiKey: "key", baseUrl: "https://relay.example.com/v1", fetchImpl: async () => response({ error: { message: "bad key" } }, 401) });
    expect(unauthorized.errorCode).toBe("UPSTREAM_AUTH_ERROR");
  });
});
