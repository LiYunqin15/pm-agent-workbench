import os from "node:os";
import { Worker } from "bullmq";
import Redis from "ioredis";
import { loadEnvConfig } from "@next/env";
import { executeTaskRun } from "@/lib/tasks/run-service";
import { WorkspaceRepository } from "@/lib/workspace/repository";
import { getQueueName, getRedisUrl, getWorkerConcurrency, getWorkerId } from "@/lib/queue/config";
import type { TaskRunJob } from "@/lib/queue/types";

loadEnvConfig(process.cwd());

export function startTaskRunWorker() {
  const workerId = getWorkerId();
  const connection = new Redis(getRedisUrl(), { maxRetriesPerRequest: null, enableReadyCheck: false });
  const repository = new WorkspaceRepository();
  const worker = new Worker<TaskRunJob>(
    getQueueName(),
    async (job) => executeTaskRun(job.data.runId, workerId, repository),
    { connection, concurrency: getWorkerConcurrency(), autorun: true, maxStalledCount: 0 },
  );
  const lockKey = `${getQueueName()}:reconciler-lock`;
  const reconcile = async () => {
    const lock = await connection.set(lockKey, workerId, "PX", 12_000, "NX");
    if (lock !== "OK") return;
    const before = new Date(Date.now() - 45_000).toISOString();
    repository.failStaleTaskRuns(before);
  };
  const timer = setInterval(() => void reconcile().catch((error) => console.error("Queue reconciliation failed", error)), 15_000);
  void reconcile();
  worker.on("error", (error) => console.error("Task worker error", error));
  const shutdown = async () => {
    clearInterval(timer);
    await worker.close();
    await connection.quit();
  };
  process.once("SIGINT", () => void shutdown().then(() => process.exit(0)));
  process.once("SIGTERM", () => void shutdown().then(() => process.exit(0)));
  console.log(`PM Agent worker ${workerId} listening on ${os.hostname()} (${getQueueName()})`);
  return worker;
}

if (process.argv[1]?.replaceAll("\\", "/").endsWith("/task-runner.ts")) startTaskRunWorker();
