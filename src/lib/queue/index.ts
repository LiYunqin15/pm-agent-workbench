import { getBullMqTaskRunQueue } from "./bullmq";
import { MemoryTaskRunQueue } from "./memory";
import type { TaskRunQueue } from "./types";

const globalQueue = globalThis as typeof globalThis & {
  pmAgentMemoryTaskRunQueue?: MemoryTaskRunQueue;
};

export function getTaskRunQueue(): TaskRunQueue {
  if (process.env.PM_AGENT_QUEUE_DRIVER === "memory" || process.env.NODE_ENV === "test") {
    if (!globalQueue.pmAgentMemoryTaskRunQueue) globalQueue.pmAgentMemoryTaskRunQueue = new MemoryTaskRunQueue();
    return globalQueue.pmAgentMemoryTaskRunQueue;
  }
  return getBullMqTaskRunQueue();
}

export type { TaskRunJob, TaskRunQueue } from "./types";
