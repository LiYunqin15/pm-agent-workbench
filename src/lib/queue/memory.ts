import type { TaskRunJob, TaskRunQueue } from "./types";

export class MemoryTaskRunQueue implements TaskRunQueue {
  readonly jobs = new Map<string, TaskRunJob>();

  async enqueue(job: TaskRunJob): Promise<{ jobId: string }> {
    this.jobs.set(job.runId, job);
    return { jobId: job.runId };
  }

  async remove(jobId: string): Promise<void> {
    this.jobs.delete(jobId);
  }

  async ping(): Promise<number> {
    return 0;
  }

  async getWorkerCount(): Promise<number> {
    return 1;
  }

  async close(): Promise<void> {
    this.jobs.clear();
  }
}
