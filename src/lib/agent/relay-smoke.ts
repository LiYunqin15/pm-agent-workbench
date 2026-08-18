import { mapRelayFailure, RelayIntegrationError } from "./responses-compat";

export interface RelaySmokeResult {
  skipped: boolean;
  endpoint: string | null;
  model: string | null;
  requestId: string | null;
  statusCode: number | null;
  durationMs: number;
  sourceCount: number;
  sources: Array<{ title: string; url: string }>;
  errorCode?: string;
  error?: string;
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

function endpointOrigin(value: string): string {
  try {
    const url = new URL(value);
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/+$/, "");
  } catch {
    throw new RelayIntegrationError("UPSTREAM_ERROR", "中转站地址无效。");
  }
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function collectSources(value: unknown, output: Array<{ title: string; url: string }>): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((item) => collectSources(item, output));
    return;
  }
  const record = value as Record<string, unknown>;
  const url = stringValue(record.url) ?? stringValue(record.uri);
  const title = stringValue(record.title) ?? stringValue(record.name) ?? url;
  if (url && /^https?:\/\//i.test(url) && title) {
    if (!output.some((source) => source.url === url)) output.push({ title, url });
  }
  Object.values(record).forEach((child) => collectSources(child, output));
}

export async function runRelaySmokeTest(options: {
  fetchImpl?: FetchLike;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  timeoutMs?: number;
  force?: boolean;
} = {}): Promise<RelaySmokeResult> {
  const enabled = options.force || process.env.PM_AGENT_RELAY_SMOKE === "1";
  if (!enabled) {
    return { skipped: true, endpoint: null, model: null, requestId: null, statusCode: null, durationMs: 0, sourceCount: 0, sources: [] };
  }
  const apiKey = options.apiKey?.trim() || process.env.OPENAI_API_KEY?.trim();
  const configuredBaseUrl = options.baseUrl?.trim() || process.env.OPENAI_BASE_URL?.trim();
  const model = options.model?.trim() || process.env.OPENAI_MODEL_DEFAULT?.trim() || "gpt-4o-mini";
  if (!apiKey || !configuredBaseUrl) {
    return { skipped: true, endpoint: configuredBaseUrl ? endpointOrigin(configuredBaseUrl) : null, model, requestId: null, statusCode: null, durationMs: 0, sourceCount: 0, sources: [], errorCode: "RELAY_NOT_CONFIGURED", error: "未配置中转站 API Key 或地址。" };
  }
  const endpoint = endpointOrigin(configuredBaseUrl);
  const startedAt = Date.now();
  const fetchImpl = options.fetchImpl ?? fetch;
  try {
    const response = await fetchImpl(`${endpoint}/responses`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        input: "请用一句话说明产品经理的工作，并给出一个可核验的网页来源。",
        tools: [{ type: "web_search_preview" }],
        tool_choice: "required",
        max_output_tokens: 180,
        store: false,
      }),
      signal: AbortSignal.timeout(options.timeoutMs ?? 45_000),
    });
    const text = await response.text();
    let payload: unknown = null;
    try { payload = text ? JSON.parse(text) : null; } catch { payload = { message: text.slice(0, 500) }; }
    if (!response.ok) {
      const error = new Error(typeof payload === "object" && payload && "error" in payload ? JSON.stringify((payload as { error: unknown }).error) : `HTTP ${response.status}`) as Error & { status?: number };
      error.status = response.status;
      throw error;
    }
    const sources: Array<{ title: string; url: string }> = [];
    collectSources(payload, sources);
    if (sources.length === 0) throw new RelayIntegrationError("WEB_SEARCH_UNAVAILABLE", "中转站响应未返回可核验的 Web Search 来源。", response.status);
    const headers = response.headers;
    return {
      skipped: false,
      endpoint,
      model,
      requestId: headers.get("x-request-id") || (typeof payload === "object" && payload && "id" in payload ? stringValue((payload as { id?: unknown }).id) : null),
      statusCode: response.status,
      durationMs: Date.now() - startedAt,
      sourceCount: sources.length,
      sources,
    };
  } catch (error) {
    const mapped = mapRelayFailure(error);
    return {
      skipped: false,
      endpoint,
      model,
      requestId: null,
      statusCode: mapped.status ?? null,
      durationMs: Date.now() - startedAt,
      sourceCount: 0,
      sources: [],
      errorCode: mapped.code,
      error: mapped.message,
    };
  }
}

export function relaySmokeLog(result: RelaySmokeResult): string {
  const endpoint = result.endpoint ? (() => { try { return new URL(result.endpoint).host; } catch { return "unknown"; } })() : "none";
  return JSON.stringify({ endpoint, model: result.model, requestId: result.requestId, statusCode: result.statusCode, durationMs: result.durationMs, sourceCount: result.sourceCount, skipped: result.skipped, errorCode: result.errorCode });
}
