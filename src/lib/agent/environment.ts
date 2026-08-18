import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";

export type EnvironmentUpdate = {
  apiKey?: string | null;
  baseUrl?: string | null;
  apiMode?: string | null;
  modelFast?: string | null;
  modelDefault?: string | null;
  modelDeep?: string | null;
};

const ENV_KEYS: Record<keyof EnvironmentUpdate, string> = {
  apiKey: "OPENAI_API_KEY",
  baseUrl: "OPENAI_BASE_URL",
  apiMode: "OPENAI_API_MODE",
  modelFast: "OPENAI_MODEL_FAST",
  modelDefault: "OPENAI_MODEL_DEFAULT",
  modelDeep: "OPENAI_MODEL_DEEP",
};

function envFilePath(): string {
  return process.env.PM_AGENT_ENV_PATH?.trim() || path.join(process.cwd(), ".env.local");
}

function encodeEnvValue(value: string): string {
  return JSON.stringify(value).replace(/\$/g, "\\$");
}

function updateLines(content: string, updates: Record<string, string | null>): string {
  const lines = content ? content.split(/\r?\n/) : [];
  const seen = new Set<string>();
  const output: string[] = [];

  for (const line of lines) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line);
    const key = match?.[1];
    if (!key || !Object.prototype.hasOwnProperty.call(updates, key)) {
      output.push(line);
      continue;
    }
    if (seen.has(key)) continue;
    seen.add(key);
    const value = updates[key];
    if (value !== null) output.push(`${key}=${encodeEnvValue(value)}`);
  }

  for (const [key, value] of Object.entries(updates)) {
    if (value !== null && !seen.has(key)) output.push(`${key}=${encodeEnvValue(value)}`);
  }

  while (output.length > 0 && output[output.length - 1] === "") output.pop();
  return `${output.join("\n")}\n`;
}

export function updateLocalEnvironment(update: EnvironmentUpdate): string {
  const filePath = envFilePath();
  const current = existsSync(/* turbopackIgnore: true */ filePath) ? readFileSync(/* turbopackIgnore: true */ filePath, "utf8") : "";
  const updates: Record<string, string | null> = {};

  for (const [field, key] of Object.entries(ENV_KEYS) as Array<[keyof EnvironmentUpdate, string]>) {
    if (!Object.prototype.hasOwnProperty.call(update, field)) continue;
    const value = update[field];
    updates[key] = value === undefined || value === null ? null : value.trim();
  }

  mkdirSync(/* turbopackIgnore: true */ path.dirname(filePath), { recursive: true });
  writeFileSync(/* turbopackIgnore: true */ filePath, updateLines(current, updates), { encoding: "utf8", mode: 0o600 });

  if (Object.prototype.hasOwnProperty.call(update, "apiKey")) {
    const value = update.apiKey?.trim();
    if (value) process.env.OPENAI_API_KEY = value;
    else delete process.env.OPENAI_API_KEY;
  }
  if (Object.prototype.hasOwnProperty.call(update, "baseUrl")) {
    const value = update.baseUrl?.trim();
    if (value) process.env.OPENAI_BASE_URL = value;
    else delete process.env.OPENAI_BASE_URL;
  }
  if (Object.prototype.hasOwnProperty.call(update, "apiMode")) {
    const value = update.apiMode?.trim();
    if (value) process.env.OPENAI_API_MODE = value;
    else delete process.env.OPENAI_API_MODE;
  }
  if (Object.prototype.hasOwnProperty.call(update, "modelFast")) {
    const value = update.modelFast?.trim();
    if (value) process.env.OPENAI_MODEL_FAST = value;
    else delete process.env.OPENAI_MODEL_FAST;
  }
  if (Object.prototype.hasOwnProperty.call(update, "modelDefault")) {
    const value = update.modelDefault?.trim();
    if (value) process.env.OPENAI_MODEL_DEFAULT = value;
    else delete process.env.OPENAI_MODEL_DEFAULT;
  }
  if (Object.prototype.hasOwnProperty.call(update, "modelDeep")) {
    const value = update.modelDeep?.trim();
    if (value) process.env.OPENAI_MODEL_DEEP = value;
    else delete process.env.OPENAI_MODEL_DEEP;
  }

  return filePath;
}

export function connectionBaseUrl(): string {
  return process.env.OPENAI_BASE_URL?.trim() || "https://api.openai.com/v1";
}

export function safeBaseUrl(): string {
  const configured = process.env.OPENAI_BASE_URL?.trim();
  if (!configured) return "";
  try {
    const url = new URL(configured);
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return `${url.origin}${url.pathname}`.replace(/\/$/, "");
  } catch {
    return "";
  }
}

export function apiKeyHint(): string | null {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) return null;
  return key.length > 8 ? `末四位 ${key.slice(-4)}` : "已配置";
}
