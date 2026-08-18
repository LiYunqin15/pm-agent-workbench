export function getRedisUrl(): string {
  return process.env.PM_AGENT_REDIS_URL?.trim() || "redis://127.0.0.1:6379";
}

export function getQueueName(): string {
  return process.env.PM_AGENT_QUEUE_NAME?.trim() || "pm-agent-runs";
}

export function getWorkerId(): string {
  return process.env.PM_AGENT_WORKER_ID?.trim() || `${process.env.COMPUTERNAME || process.env.HOSTNAME || "worker"}-${process.pid}`;
}

export function getWorkerConcurrency(): number {
  const value = Number(process.env.PM_AGENT_WORKER_CONCURRENCY || "2");
  return Number.isFinite(value) && value > 0 ? Math.max(1, Math.min(32, Math.floor(value))) : 2;
}

export function getRunTimeoutMs(depth: "quick" | "standard" | "deep"): number {
  const defaults = { quick: 90_000, standard: 240_000, deep: 295_000 } as const;
  const key = `PM_AGENT_RUN_TIMEOUT_${depth.toUpperCase()}_MS` as const;
  const value = Number(process.env[key] || defaults[depth]);
  return Number.isFinite(value) && value > 0 ? value : defaults[depth];
}
