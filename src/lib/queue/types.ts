export interface TaskRunJob {
  runId: string;
  taskId: string;
}

export interface TaskRunQueue {
  enqueue(job: TaskRunJob): Promise<{ jobId: string }>;
  remove(jobId: string): Promise<void>;
  ping(): Promise<number>;
  getWorkerCount(): Promise<number>;
  close(): Promise<void>;
}
