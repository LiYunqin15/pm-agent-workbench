import { getQueueName } from "@/lib/queue/config";
import { getTaskRunQueue } from "@/lib/queue";
import { workspaceJson } from "@/lib/workspace/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const queue = getTaskRunQueue();
    const latencyMs = await queue.ping();
    const workers = await queue.getWorkerCount();
    return workspaceJson({ connected: true, workers, latencyMs, queueName: getQueueName() });
  } catch {
    return workspaceJson({ connected: false, workers: 0, latencyMs: null, queueName: getQueueName(), error: "Redis 队列连接失败。" });
  }
}
