import { Queue } from "bullmq";
import Redis from "ioredis";
import { getQueueName, getRedisUrl } from "./config";
import type { TaskRunJob, TaskRunQueue } from "./types";

const globalQueue = globalThis as typeof globalThis & {
  pmAgentTaskRunQueue?: BullMqTaskRunQueue;
};

class BullMqTaskRunQueue implements TaskRunQueue {
  private readonly redis: Redis;
  private readonly queue: Queue<TaskRunJob>;

  constructor() {
    this.redis = new Redis(getRedisUrl(), {
      maxRetriesPerRequest: 1,
      enableReadyCheck: false,
      lazyConnect: true,
      enableOfflineQueue: false,
      connectTimeout: 3_000,
      retryStrategy: () => null,
    });
    this.queue = new Queue<TaskRunJob>(getQueueName(), {
      connection: this.redis,
      defaultJobOptions: {
        attempts: 1,
        removeOnComplete: { age: 86_400, count: 1_000 },
        removeOnFail: { age: 604_800, count: 2_000 },
      },
    });
    this.redis.on("error", () => undefined);
    this.queue.on("error", () => undefined);
  }

  async enqueue(job: TaskRunJob): Promise<{ jobId: string }> {
    await this.ping();
    const queued = await this.queue.add("execute-task-run", job, { jobId: job.runId, attempts: 1 });
    return { jobId: queued.id ?? job.runId };
  }

  async remove(jobId: string): Promise<void> {
    const job = await this.queue.getJob(jobId);
    if (job) await job.remove();
  }

  async ping(): Promise<number> {
    const start = performance.now();
    if (this.redis.status === "wait" || this.redis.status === "end") await this.redis.connect();
    if (this.redis.status !== "ready") {
      await new Promise<void>((resolve, reject) => {
        const onReady = () => { cleanup(); resolve(); };
        const onError = (error: Error) => { cleanup(); reject(error); };
        const cleanup = () => {
          this.redis.off("ready", onReady);
          this.redis.off("error", onError);
        };
        this.redis.once("ready", onReady);
        this.redis.once("error", onError);
      });
    }
    await this.redis.ping();
    return Math.max(0, Math.round(performance.now() - start));
  }

  async getWorkerCount(): Promise<number> {
    return this.queue.getWorkersCount();
  }

  async close(): Promise<void> {
    await this.queue.close();
    await this.redis.quit();
  }
}

export function getBullMqTaskRunQueue(): TaskRunQueue {
  if (!globalQueue.pmAgentTaskRunQueue) globalQueue.pmAgentTaskRunQueue = new BullMqTaskRunQueue();
  return globalQueue.pmAgentTaskRunQueue;
}
