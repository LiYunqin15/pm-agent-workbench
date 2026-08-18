import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET as getDocuments, POST as createDocument } from "./documents/route";
import { GET as getDocument } from "./documents/[id]/route";
import { POST as restoreDocument } from "./documents/[id]/restore/route";
import { POST as createVersion } from "./documents/[id]/versions/route";
import { PATCH as updateVersionMetadata } from "./documents/[id]/versions/[versionId]/route";
import { GET as getProducts, POST as createProduct } from "./products/route";
import { GET as getTasks, POST as createTask } from "./tasks/route";
import { GET as getSources, POST as createSource } from "./research/sources/route";
import { PATCH as updateSource } from "./research/sources/[id]/route";
import { POST as verifySource } from "./research/sources/[id]/verify/route";
import { POST as reopenSource } from "./research/sources/[id]/reopen/route";
import { GET as getTaskRun, POST as runTask } from "./tasks/[id]/run/route";
import { POST as cancelTaskRun } from "./tasks/[id]/run/cancel/route";
import { GET as getTaskReview, POST as reviewTask } from "./tasks/[id]/review/route";
import { POST as resubmitTaskReview } from "./tasks/[id]/review/resubmit/route";
import { GET as getApprovals, POST as createApproval } from "./runs/[runId]/approvals/route";
import { POST as approveApproval } from "./approvals/[id]/approve/route";
import { POST as rejectApproval } from "./approvals/[id]/reject/route";
import { GET as getMetrics } from "./metrics/overview/route";
import { GET as getAttachments, POST as uploadAttachment } from "./tasks/[id]/attachments/route";
import { DELETE as deleteAttachment } from "./tasks/[id]/attachments/[attachmentId]/route";
import { POST as parseAttachment } from "./tasks/[id]/attachments/[attachmentId]/parse/route";
import { GET as getAgentSettings, PATCH as updateAgentSettings } from "./settings/agent/route";
import { GET as getOutputSettings, PATCH as updateOutputSettings } from "./settings/output/route";
import { closeWorkspaceDatabase, getWorkspaceDatabase } from "@/lib/workspace/database";
import { executeTaskRun } from "@/lib/tasks/run-service";

let directory = "";
const originalApiKey = process.env.OPENAI_API_KEY;

function jsonRequest(url: string, body: unknown) {
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeAll(() => {
  directory = mkdtempSync(path.join(tmpdir(), "pm-agent-api-"));
  process.env.PM_AGENT_DB_PATH = path.join(directory, "workspace.sqlite");
  process.env.PM_AGENT_ATTACHMENTS_DIR = path.join(directory, "attachments");
  delete process.env.OPENAI_API_KEY;
});

afterAll(() => {
  closeWorkspaceDatabase();
  delete process.env.PM_AGENT_DB_PATH;
  delete process.env.PM_AGENT_ATTACHMENTS_DIR;
  if (originalApiKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = originalApiKey;
  rmSync(directory, { recursive: true, force: true });
});

describe("workspace API routes", () => {
  it("keeps the UI mode and API status in sync", async () => {
    const initialResponse = await getAgentSettings();
    const initial = await initialResponse.json();
    expect(initialResponse.status).toBe(200);
    expect(initial).toMatchObject({ mode: "demo", selectedMode: "demo", preference: "auto", api: { configured: false } });

    const pendingLiveResponse = await updateAgentSettings(
      jsonRequest("http://localhost/api/settings/agent", { mode: "live" }),
    );
    expect(pendingLiveResponse.status).toBe(200);
    expect(await pendingLiveResponse.json()).toMatchObject({
      mode: "demo",
      selectedMode: "live",
      preference: "live",
      api: { configured: false },
    });

    const demoResponse = await updateAgentSettings(
      jsonRequest("http://localhost/api/settings/agent", { mode: "demo" }),
    );
    expect((await demoResponse.json()).preference).toBe("demo");

    process.env.OPENAI_API_KEY = "test-key";
    const liveResponse = await updateAgentSettings(
      jsonRequest("http://localhost/api/settings/agent", { mode: "live" }),
    );
    expect(liveResponse.status).toBe(200);
    expect(await liveResponse.json()).toMatchObject({ mode: "live", selectedMode: "live", api: { configured: true } });

    delete process.env.OPENAI_API_KEY;
    await updateAgentSettings(jsonRequest("http://localhost/api/settings/agent", { mode: "demo" }));
  });

  it("reads and saves output format settings", async () => {
    const initialResponse = await getOutputSettings();
    expect(initialResponse.status).toBe(200);
    expect(await initialResponse.json()).toMatchObject({
      outputFormats: ["markdown", "html", "docx", "pdf"],
      defaultOutputFormat: "markdown",
    });
    const saveResponse = await updateOutputSettings(new Request("http://localhost/api/settings/output", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ outputFormats: ["markdown", "txt"], defaultOutputFormat: "txt" }),
    }));
    expect(saveResponse.status).toBe(200);
    expect(await saveResponse.json()).toMatchObject({ outputFormats: ["markdown", "txt"], defaultOutputFormat: "txt" });
    const invalidResponse = await updateOutputSettings(new Request("http://localhost/api/settings/output", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ outputFormats: ["markdown"], defaultOutputFormat: "txt", updatedAt: "ignored" }),
    }));
    expect(invalidResponse.status).toBe(400);
    await updateOutputSettings(new Request("http://localhost/api/settings/output", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ outputFormats: ["markdown", "html", "docx", "pdf"], defaultOutputFormat: "markdown" }),
    }));
  });

  it("returns real summaries and filtered task rows", async () => {
    const response = await getTasks(new Request("http://localhost/api/tasks?metric=running"));
    const payload = await response.json();
    expect(response.status).toBe(200);
    expect(payload.items.map((task: { id: string }) => task.id)).toEqual(["TASK-0820"]);
    expect(payload.summary).toMatchObject({ runningCount: 1, reviewCount: 1 });
  });

  it("persists and reclassifies research sources through the API", async () => {
    const listResponse = await getSources(new Request("http://localhost/api/research/sources?verification=pending"));
    expect(listResponse.status).toBe(200);
    const list = await listResponse.json();
    expect(list.summary).toMatchObject({ total: 6, high: 3, pending: 1 });
    expect(list.items).toHaveLength(1);
    const pending = list.items[0];

    const editedResponse = await updateSource(new Request(`http://localhost/api/research/sources/${pending.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Zoom 中国区套餐页面", type: "官网", trust: "medium", url: pending.url, taskId: null }),
    }), { params: Promise.resolve({ id: pending.id }) });
    expect(editedResponse.status).toBe(200);
    expect((await editedResponse.json()).title).toBe("Zoom 中国区套餐页面");

    const verifiedResponse = await verifySource(jsonRequest(`http://localhost/api/research/sources/${pending.id}/verify`, { trust: "high", note: "已对照官方套餐页面" }), { params: Promise.resolve({ id: pending.id }) });
    expect(verifiedResponse.status).toBe(200);
    expect(await verifiedResponse.json()).toMatchObject({ verification: "verified", trust: "high" });

    const pendingAfterVerify = await getSources(new Request("http://localhost/api/research/sources?verification=pending"));
    expect((await pendingAfterVerify.json()).items).toHaveLength(0);

    const reopenedResponse = await reopenSource(new Request(`http://localhost/api/research/sources/${pending.id}/reopen`, { method: "POST" }), { params: Promise.resolve({ id: pending.id }) });
    expect(reopenedResponse.status).toBe(200);
    expect(await reopenedResponse.json()).toMatchObject({ verification: "pending", verifiedAt: null });

    const invalidResponse = await createSource(jsonRequest("http://localhost/api/research/sources", { title: "坏链接", type: "报告", url: "ftp://example.com" }));
    expect(invalidResponse.status).toBe(400);
  });

  it("creates products and related tasks", async () => {
    const productResponse = await createProduct(
      jsonRequest("http://localhost/api/products", { name: "路线图中心", description: "管理产品路线图。" }),
    );
    const product = await productResponse.json();
    expect(productResponse.status).toBe(201);

    const taskResponse = await createTask(
      jsonRequest("http://localhost/api/tasks", {
        productId: product.id,
        title: "整理下一季度路线图",
        prompt: "结合当前用户反馈整理下一季度产品路线图和优先级。",
        type: "prd",
        depth: "standard",
        autonomy: "draft",
        budgetCents: 200,
      }),
    );
    const task = await taskResponse.json();
    expect(taskResponse.status).toBe(201);
    expect(task.productId).toBe(product.id);

    const productsResponse = await getProducts(new Request("http://localhost/api/products?tree=1"));
    const products = await productsResponse.json();
    expect(products.items.find((item: { id: string }) => item.id === product.id).tasks).toHaveLength(1);
  });

  it("runs a task in demo mode and archives its primary document", async () => {
    const productResponse = await createProduct(
      jsonRequest("http://localhost/api/products", { name: "反馈助手" }),
    );
    const product = await productResponse.json();
    const taskResponse = await createTask(
      jsonRequest("http://localhost/api/tasks", {
        productId: product.id,
        title: "分析新用户反馈",
        prompt: "分析新用户反馈并输出高频问题、风险和下一步建议。",
        type: "insight",
        depth: "quick",
        autonomy: "draft",
        budgetCents: 100,
      }),
    );
    const task = await taskResponse.json();
    const response = await runTask(new Request(`http://localhost/api/tasks/${task.id}/run`, { method: "POST" }), {
      params: Promise.resolve({ id: task.id }),
    });
    const queued = await response.json();
    expect(response.status).toBe(202);
    expect(queued.run.status).toBe("queued");

    await executeTaskRun(queued.run.id, "test-worker");
    const completedResponse = await getTaskRun(new Request(`http://localhost/api/tasks/${task.id}/run`), {
      params: Promise.resolve({ id: task.id }),
    });
    const payload = await completedResponse.json();
    expect(payload.task.status).toBe("review");
    expect(payload.run.status).toBe("completed");
    expect(payload.document.currentVersionLabel).toBe("v1.0");
    expect(payload.document.currentVersion.source).toBe("agent_demo");

    const database = getWorkspaceDatabase();
    const storedRun = database.prepare("SELECT response_json FROM task_runs WHERE id = ?").get(queued.run.id) as { response_json: string };
    database.prepare("UPDATE task_runs SET response_json = ? WHERE id = ?").run("{legacy-invalid-json", queued.run.id);
    const legacyReviewResponse = await getTaskReview(new Request(`http://localhost/api/tasks/${task.id}/review`), { params: Promise.resolve({ id: task.id }) });
    expect(legacyReviewResponse.status).toBe(200);
    expect(await legacyReviewResponse.json()).toMatchObject({ task: { status: "review" }, document: { id: payload.document.id } });
    database.prepare("UPDATE task_runs SET response_json = ? WHERE id = ?").run(storedRun.response_json, queued.run.id);

    const reviewResponse = await getTaskReview(new Request(`http://localhost/api/tasks/${task.id}/review`), { params: Promise.resolve({ id: task.id }) });
    const reviewDetail = await reviewResponse.json();
    expect(reviewResponse.status).toBe(200);
    expect(reviewDetail).toMatchObject({ task: { status: "review" }, actions: { canReview: true } });

    const invalidReturn = await reviewTask(jsonRequest(`http://localhost/api/tasks/${task.id}/review`, {
      decision: "changes_requested",
      note: "",
      baseUpdatedAt: reviewDetail.task.updatedAt,
    }), { params: Promise.resolve({ id: task.id }) });
    expect(invalidReturn.status).toBe(400);

    const returnedResponse = await reviewTask(jsonRequest(`http://localhost/api/tasks/${task.id}/review`, {
      decision: "changes_requested",
      note: "请补充证据说明。",
      baseUpdatedAt: reviewDetail.task.updatedAt,
    }), { params: Promise.resolve({ id: task.id }) });
    const returned = await returnedResponse.json();
    expect(returned.task.status).toBe("changes_requested");

    const unchangedResponse = await resubmitTaskReview(jsonRequest(`http://localhost/api/tasks/${task.id}/review/resubmit`, {
      baseUpdatedAt: returned.task.updatedAt,
      documentRevision: returned.document.currentRevision,
    }), { params: Promise.resolve({ id: task.id }) });
    expect(unchangedResponse.status).toBe(409);

    const editedDocumentResponse = await createVersion(jsonRequest(`http://localhost/api/documents/${returned.document.id}/versions`, {
      baseRevision: returned.document.currentRevision,
      title: returned.document.title,
      content: `${returned.document.currentVersion.content}\n\n补充审核要求中的证据说明。`,
      changeNote: "响应审核意见",
    }), { params: Promise.resolve({ id: returned.document.id }) });
    const editedDocument = await editedDocumentResponse.json();
    const refreshedReviewResponse = await getTaskReview(new Request(`http://localhost/api/tasks/${task.id}/review`), { params: Promise.resolve({ id: task.id }) });
    const refreshedReview = await refreshedReviewResponse.json();
    const resubmittedResponse = await resubmitTaskReview(jsonRequest(`http://localhost/api/tasks/${task.id}/review/resubmit`, {
      baseUpdatedAt: refreshedReview.task.updatedAt,
      documentRevision: editedDocument.currentRevision,
    }), { params: Promise.resolve({ id: task.id }) });
    const resubmitted = await resubmittedResponse.json();
    expect(resubmitted.task.status).toBe("review");

    const approvedResponse = await reviewTask(jsonRequest(`http://localhost/api/tasks/${task.id}/review`, {
      decision: "approved",
      note: "修改完成，可以进入下一步。",
      baseUpdatedAt: resubmitted.task.updatedAt,
    }), { params: Promise.resolve({ id: task.id }) });
    const approved = await approvedResponse.json();
    expect(approved.task.status).toBe("completed");
    expect(approved.reviews.map((review: { decision: string }) => review.decision)).toEqual(["approved", "resubmitted", "changes_requested"]);
  });

  it("returns an active run, rejects duplicates, and cancels queued work", async () => {
    const productResponse = await createProduct(
      jsonRequest("http://localhost/api/products", { name: "队列取消测试" }),
    );
    const product = await productResponse.json();
    const taskResponse = await createTask(
      jsonRequest("http://localhost/api/tasks", {
        productId: product.id,
        title: "验证取消任务",
        prompt: "验证队列任务取消后的状态和事件记录。",
        type: "prd",
        depth: "quick",
        autonomy: "draft",
        budgetCents: 100,
      }),
    );
    const task = await taskResponse.json();
    const first = await runTask(new Request(`http://localhost/api/tasks/${task.id}/run`, { method: "POST" }), { params: Promise.resolve({ id: task.id }) });
    expect(first.status).toBe(202);
    const duplicate = await runTask(new Request(`http://localhost/api/tasks/${task.id}/run`, { method: "POST" }), { params: Promise.resolve({ id: task.id }) });
    expect(duplicate.status).toBe(409);
    const queued = await first.json();
    const cancelled = await cancelTaskRun(new Request(`http://localhost/api/tasks/${task.id}/run/cancel`, { method: "POST" }), { params: Promise.resolve({ id: task.id }) });
    const cancelledPayload = await cancelled.json();
    expect(cancelled.status).toBe(200);
    expect(cancelledPayload.run.status).toBe("cancelled");
    expect(cancelledPayload.task.status).toBe("cancelled");
    expect(queued.run.id).toBe(cancelledPayload.run.id);
  });

  it("creates, versions, and restores documents with conflict protection", async () => {
    const createResponse = await createDocument(
      jsonRequest("http://localhost/api/documents", {
        taskId: "TASK-0821",
        title: "AI 会议补充 PRD",
        content: "# AI 会议补充 PRD\n\n初始内容。",
        format: "prd",
      }),
    );
    const created = await createResponse.json();
    expect(createResponse.status).toBe(201);

    const versionResponse = await createVersion(
      jsonRequest(`http://localhost/api/documents/${created.id}/versions`, {
        baseRevision: 1,
        title: created.title,
        content: "# AI 会议补充 PRD\n\n第二版内容。",
        changeNote: "完善需求",
      }),
      { params: Promise.resolve({ id: created.id }) },
    );
    const versioned = await versionResponse.json();
    expect(versionResponse.status).toBe(201);
    expect(versioned.currentRevision).toBe(2);

    const staleResponse = await createVersion(
      jsonRequest(`http://localhost/api/documents/${created.id}/versions`, {
        baseRevision: 1,
        title: created.title,
        content: "过期内容",
      }),
      { params: Promise.resolve({ id: created.id }) },
    );
    expect(staleResponse.status).toBe(409);

    const restoreResponse = await restoreDocument(
      jsonRequest(`http://localhost/api/documents/${created.id}/restore`, {
        versionId: versioned.versions.at(-1).id,
        baseRevision: 2,
      }),
      { params: Promise.resolve({ id: created.id }) },
    );
    const restored = await restoreResponse.json();
    expect(restored.currentRevision).toBe(3);
    expect(restored.currentVersion.source).toBe("restore");

    const detailResponse = await getDocument(new Request(`http://localhost/api/documents/${created.id}`), {
      params: Promise.resolve({ id: created.id }),
    });
    expect((await detailResponse.json()).versions).toHaveLength(3);

    const listResponse = await getDocuments(new Request("http://localhost/api/documents?taskId=TASK-0821&format=prd"));
    expect((await listResponse.json()).items.some((document: { id: string }) => document.id === created.id)).toBe(true);

    const current = restored.currentVersion;
    const metadataResponse = await updateVersionMetadata(
      new Request(`http://localhost/api/documents/${created.id}/versions/${current.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          alias: "最终评审版",
          changeNote: "补充验收标准",
          baseMetadataRevision: current.metadataRevision,
        }),
      }),
      { params: Promise.resolve({ id: created.id, versionId: current.id }) },
    );
    expect(metadataResponse.status).toBe(200);
    const metadata = await metadataResponse.json();
    expect(metadata.currentVersion.alias).toBe("最终评审版");
    expect(metadata.currentVersion.content).toBe(restored.currentVersion.content);

    const staleMetadataResponse = await updateVersionMetadata(
      new Request(`http://localhost/api/documents/${created.id}/versions/${current.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ alias: "过期编辑", changeNote: null, baseMetadataRevision: current.metadataRevision }),
      }),
      { params: Promise.resolve({ id: created.id, versionId: current.id }) },
    );
    expect(staleMetadataResponse.status).toBe(409);

    const missingVersionResponse = await updateVersionMetadata(
      new Request(`http://localhost/api/documents/${created.id}/versions/missing`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ alias: null, changeNote: null, baseMetadataRevision: 1 }),
      }),
      { params: Promise.resolve({ id: created.id, versionId: "missing" }) },
    );
    expect(missingVersionResponse.status).toBe(404);

    const invalidMetadataResponse = await updateVersionMetadata(
      new Request(`http://localhost/api/documents/${created.id}/versions/${current.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ alias: "a".repeat(81), changeNote: null, baseMetadataRevision: current.metadataRevision }),
      }),
      { params: Promise.resolve({ id: created.id, versionId: current.id }) },
    );
    expect(invalidMetadataResponse.status).toBe(400);
  });

  it("exposes approval lifecycle and persisted metrics", async () => {
    const productResponse = await createProduct(jsonRequest("http://localhost/api/products", { name: "审批 API 测试产品" }));
    const product = await productResponse.json();
    const taskResponse = await createTask(jsonRequest("http://localhost/api/tasks", {
      productId: product.id,
      title: "审批 API 任务",
      prompt: "验证高风险工具调用在 API 层需要审批并记录审计事件。",
      type: "prd",
      depth: "quick",
      autonomy: "scoped",
      budgetCents: 100,
      researchInput: { allowedDomains: ["example.com"] },
    }));
    const task = await taskResponse.json();
    const runResponse = await runTask(new Request(`http://localhost/api/tasks/${task.id}/run`, { method: "POST" }), { params: Promise.resolve({ id: task.id }) });
    const run = (await runResponse.json()).run;
    const approvalResponse = await createApproval(jsonRequest(`http://localhost/api/runs/${run.id}/approvals`, { toolName: "publish", target: "https://example.com/release" }), { params: Promise.resolve({ runId: run.id }) });
    expect(approvalResponse.status).toBe(201);
    const approval = (await approvalResponse.json()).approval;
    const listResponse = await getApprovals(new Request(`http://localhost/api/runs/${run.id}/approvals`), { params: Promise.resolve({ runId: run.id }) });
    expect((await listResponse.json()).items).toHaveLength(1);
    const approvedResponse = await approveApproval(jsonRequest(`http://localhost/api/approvals/${approval.id}/approve`, { baseRevision: approval.revision }), { params: Promise.resolve({ id: approval.id }) });
    expect(approvedResponse.status).toBe(200);
    const duplicateResponse = await rejectApproval(jsonRequest(`http://localhost/api/approvals/${approval.id}/reject`, { baseRevision: approval.revision, note: "重复操作" }), { params: Promise.resolve({ id: approval.id }) });
    expect(duplicateResponse.status).toBe(409);
    const metricsResponse = await getMetrics(new Request("http://localhost/api/metrics/overview?from=2026-01-01&to=2027-01-01"));
    expect(metricsResponse.status).toBe(200);
    expect((await metricsResponse.json()).metrics).toHaveProperty("taskSuccessRate");
  });

  it("uploads task files, blocks runs until parsing, and never returns parsed source text", async () => {
    const productResponse = await createProduct(jsonRequest("http://localhost/api/products", { name: "附件 API 测试产品" }));
    const product = await productResponse.json();
    const taskResponse = await createTask(jsonRequest("http://localhost/api/tasks", {
      productId: product.id,
      title: "附件解析任务",
      prompt: "读取上传的研究笔记并整理可验证结论。",
      type: "insight",
      depth: "quick",
      autonomy: "draft",
      budgetCents: 100,
    }));
    const task = await taskResponse.json();
    const form = new FormData();
    form.append("file", new File(["内部研究文本"], "notes.txt", { type: "text/plain" }));
    const uploadedResponse = await uploadAttachment(new Request(`http://localhost/api/tasks/${task.id}/attachments`, { method: "POST", body: form }), { params: Promise.resolve({ id: task.id }) });
    expect(uploadedResponse.status).toBe(201);
    const uploaded = await uploadedResponse.json();
    expect(uploaded.attachment.status).toBe("uploaded");
    expect(uploaded.attachment).not.toHaveProperty("parsedText");

    const blockedRunResponse = await runTask(new Request(`http://localhost/api/tasks/${task.id}/run`, { method: "POST" }), { params: Promise.resolve({ id: task.id }) });
    expect(blockedRunResponse.status).toBe(409);
    expect(await blockedRunResponse.json()).toMatchObject({ code: "ATTACHMENTS_NOT_READY" });

    const parsedResponse = await parseAttachment(new Request(`http://localhost/api/tasks/${task.id}/attachments/${uploaded.attachment.id}/parse`, { method: "POST" }), { params: Promise.resolve({ id: task.id, attachmentId: uploaded.attachment.id }) });
    expect(parsedResponse.status).toBe(200);
    const parsed = await parsedResponse.json();
    expect(parsed.attachment).toMatchObject({ status: "ready", errorCode: null });
    expect(parsed.attachment.parseStartedAt).toBeTruthy();
    expect(parsed.attachment.parseCompletedAt).toBeTruthy();
    expect(parsed.attachment).not.toHaveProperty("parsedText");

    const listedResponse = await getAttachments(new Request(`http://localhost/api/tasks/${task.id}/attachments`), { params: Promise.resolve({ id: task.id }) });
    const listed = await listedResponse.json();
    expect(listed.items[0]).toMatchObject({ id: uploaded.attachment.id, status: "ready" });
    expect(listed.items[0]).not.toHaveProperty("parsedText");
  });

  it("persists parse failures, supports retry, and removes unused attachments", async () => {
    const productResponse = await createProduct(jsonRequest("http://localhost/api/products", { name: "附件失败测试产品" }));
    const product = await productResponse.json();
    const taskResponse = await createTask(jsonRequest("http://localhost/api/tasks", {
      productId: product.id,
      title: "附件失败任务",
      prompt: "验证失败附件生命周期。",
      type: "insight",
      depth: "quick",
      autonomy: "draft",
      budgetCents: 100,
    }));
    const task = await taskResponse.json();
    const form = new FormData();
    form.append("file", new File(["unsupported"], "archive.bin", { type: "application/octet-stream" }));
    const uploadResponse = await uploadAttachment(new Request(`http://localhost/api/tasks/${task.id}/attachments`, { method: "POST", body: form }), { params: Promise.resolve({ id: task.id }) });
    const attachment = (await uploadResponse.json()).attachment;

    const firstParse = await parseAttachment(new Request(`http://localhost/api/tasks/${task.id}/attachments/${attachment.id}/parse`, { method: "POST" }), { params: Promise.resolve({ id: task.id, attachmentId: attachment.id }) });
    expect(firstParse.status).toBe(200);
    expect(await firstParse.json()).toMatchObject({ attachment: { status: "failed", errorCode: "PARSE_FAILED" } });

    const retryParse = await parseAttachment(new Request(`http://localhost/api/tasks/${task.id}/attachments/${attachment.id}/parse`, { method: "POST" }), { params: Promise.resolve({ id: task.id, attachmentId: attachment.id }) });
    expect(retryParse.status).toBe(200);
    expect(await retryParse.json()).toMatchObject({ attachment: { status: "failed", errorCode: "PARSE_FAILED" } });

    const removedResponse = await deleteAttachment(new Request(`http://localhost/api/tasks/${task.id}/attachments/${attachment.id}`, { method: "DELETE" }), { params: Promise.resolve({ id: task.id, attachmentId: attachment.id }) });
    expect(removedResponse.status).toBe(200);
    expect(await removedResponse.json()).toEqual({ removed: true, attachmentId: attachment.id });
    const listedResponse = await getAttachments(new Request(`http://localhost/api/tasks/${task.id}/attachments`), { params: Promise.resolve({ id: task.id }) });
    expect((await listedResponse.json()).items).toEqual([]);
  });
});
