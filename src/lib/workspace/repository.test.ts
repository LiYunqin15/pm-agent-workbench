import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { createWorkspaceDatabase } from "./database";
import { WorkspaceConflictError, WorkspacePolicyError, WorkspaceRepository } from "./repository";
import { createDemoResponse } from "@/lib/agent/demo";

const cleanupPaths: string[] = [];

afterEach(() => {
  cleanupPaths.splice(0).forEach((target) => rmSync(target, { recursive: true, force: true }));
});

function createRepository() {
  const database = createWorkspaceDatabase(":memory:");
  return { database, repository: new WorkspaceRepository(database) };
}

describe("WorkspaceRepository", () => {
  it("seeds products, tasks, documents, and real monthly summaries", () => {
    const { database, repository } = createRepository();
    expect(repository.listProducts()).toHaveLength(3);
    expect(repository.listTasks({ metric: "all" }).items).toHaveLength(5);
    expect(repository.listDocuments()).toHaveLength(5);
    expect(repository.getTaskSummary(new Date("2026-08-18T08:00:00.000Z"))).toEqual({
      monthCount: 5,
      runningCount: 1,
      reviewCount: 1,
      changesRequestedCount: 0,
      monthCostCents: 441,
    });
    database.close();
  });

  it("keeps seed initialization idempotent on a file database", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "pm-agent-db-"));
    cleanupPaths.push(directory);
    const databasePath = path.join(directory, "workspace.sqlite");
    const first = createWorkspaceDatabase(databasePath);
    first.close();
    const second = createWorkspaceDatabase(databasePath);
    const counts = second
      .prepare("SELECT (SELECT COUNT(*) FROM tasks) AS tasks, (SELECT COUNT(*) FROM document_versions) AS versions, (SELECT COUNT(*) FROM research_sources) AS sources")
      .get() as { tasks: number; versions: number; sources: number };
    expect(counts).toEqual({ tasks: 5, versions: 10, sources: 6 });
    second.close();
  });

  it("migrates existing document versions without changing their content", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "pm-agent-version-migration-"));
    cleanupPaths.push(directory);
    const databasePath = path.join(directory, "workspace.sqlite");
    const legacy = new Database(databasePath);
    legacy.exec(`
      CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
      INSERT INTO schema_migrations(version, applied_at) VALUES (5, '2026-08-18T00:00:00.000Z');
      CREATE TABLE document_versions (
        id TEXT PRIMARY KEY,
        document_id TEXT NOT NULL,
        revision INTEGER NOT NULL CHECK (revision > 0),
        label TEXT NOT NULL,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        source TEXT NOT NULL CHECK (source IN ('manual', 'agent', 'agent_demo', 'restore')),
        change_note TEXT,
        created_by TEXT NOT NULL,
        restored_from_id TEXT,
        created_at TEXT NOT NULL,
        UNIQUE (document_id, revision)
      );
    `);
    legacy.close();

    const migrated = createWorkspaceDatabase(databasePath);
    try {
      const columns = (migrated.prepare("PRAGMA table_info(document_versions)").all() as Array<{ name: string }>).map((column) => column.name);
      expect(columns).toEqual(expect.arrayContaining(["alias", "metadata_revision", "metadata_updated_at", "metadata_updated_by"]));
      const version = migrated.prepare("SELECT content, metadata_revision FROM document_versions WHERE id = 'ver-ai-market-1'").get() as { content: string; metadata_revision: number };
      expect(version.content).toContain("中国 AI 会议产品正在从单点会议工具");
      expect(version.metadata_revision).toBe(1);
      expect((migrated.prepare("SELECT MAX(version) AS version FROM schema_migrations").get() as { version: number }).version).toBe(11);
    } finally {
      migrated.close();
    }
  });

  it("migrates legacy attachments into the persisted parsing lifecycle", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "pm-agent-attachment-migration-"));
    cleanupPaths.push(directory);
    const databasePath = path.join(directory, "workspace.sqlite");
    const legacy = new Database(databasePath);
    legacy.exec(`
      CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
      INSERT INTO schema_migrations(version, applied_at) VALUES (10, '2026-08-18T00:00:00.000Z');
      CREATE TABLE products (
        id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, description TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE tasks (
        id TEXT PRIMARY KEY,
        product_id TEXT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
        title TEXT NOT NULL,
        type TEXT NOT NULL CHECK (type IN ('market', 'competitor', 'insight', 'prd')),
        status TEXT NOT NULL CHECK (status IN ('running', 'review', 'changes_requested', 'completed', 'paused', 'failed', 'cancelled')),
        prompt TEXT NOT NULL,
        research_context TEXT NOT NULL DEFAULT '{}',
        depth TEXT NOT NULL CHECK (depth IN ('quick', 'standard', 'deep')),
        autonomy TEXT NOT NULL CHECK (autonomy IN ('advise', 'draft', 'scoped')),
        budget_cents INTEGER NOT NULL CHECK (budget_cents >= 0),
        cost_cents INTEGER,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE task_attachments (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        file_name TEXT NOT NULL,
        media_type TEXT NOT NULL,
        byte_size INTEGER NOT NULL CHECK (byte_size >= 0),
        checksum TEXT NOT NULL,
        storage_path TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('ready', 'failed', 'rejected')),
        error_code TEXT,
        error_message TEXT,
        parsed_text TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (task_id, checksum)
      );
      INSERT INTO products VALUES ('legacy-product', '旧附件产品', '', '2026-08-18T00:00:00.000Z', '2026-08-18T00:00:00.000Z');
      INSERT INTO tasks VALUES ('TASK-0001', 'legacy-product', '旧附件任务', 'insight', 'completed', '保留旧附件。', '{}', 'quick', 'draft', 100, 0, '2026-08-18T00:00:00.000Z', '2026-08-18T00:00:00.000Z');
      INSERT INTO task_attachments VALUES ('legacy-attachment', 'TASK-0001', 'notes.txt', 'text/plain', 5, 'checksum', 'notes.txt', 'ready', NULL, NULL, 'notes', '2026-08-18T00:00:00.000Z', '2026-08-18T00:01:00.000Z');
    `);
    legacy.close();

    const migrated = createWorkspaceDatabase(databasePath);
    try {
      const attachment = migrated.prepare("SELECT status, uploaded_by, parse_started_at, parse_completed_at, parsed_text FROM task_attachments WHERE id = 'legacy-attachment'").get();
      expect(attachment).toEqual({
        status: "ready",
        uploaded_by: "local-user",
        parse_started_at: "2026-08-18T00:00:00.000Z",
        parse_completed_at: "2026-08-18T00:01:00.000Z",
        parsed_text: "notes",
      });
      const sql = (migrated.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'task_attachments'").get() as { sql: string }).sql;
      expect(sql).toContain("'uploaded'");
      expect(sql).toContain("'parsing'");
      expect((migrated.prepare("SELECT MAX(version) AS version FROM schema_migrations").get() as { version: number }).version).toBe(11);
    } finally {
      migrated.close();
    }
  });

  it("migrates legacy task constraints and preserves run records", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "pm-agent-review-migration-"));
    cleanupPaths.push(directory);
    const databasePath = path.join(directory, "workspace.sqlite");
    const legacy = new Database(databasePath);
    legacy.exec(`
      CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
      INSERT INTO schema_migrations(version, applied_at) VALUES (6, '2026-08-18T00:00:00.000Z');
      CREATE TABLE products (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        description TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE tasks (
        id TEXT PRIMARY KEY,
        product_id TEXT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
        title TEXT NOT NULL,
        type TEXT NOT NULL CHECK (type IN ('market', 'competitor', 'insight', 'prd')),
        status TEXT NOT NULL CHECK (status IN ('running', 'review', 'completed', 'paused', 'failed', 'cancelled')),
        prompt TEXT NOT NULL,
        depth TEXT NOT NULL CHECK (depth IN ('quick', 'standard', 'deep')),
        autonomy TEXT NOT NULL CHECK (autonomy IN ('advise', 'draft', 'scoped')),
        budget_cents INTEGER NOT NULL CHECK (budget_cents >= 0),
        cost_cents INTEGER,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE task_runs (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled')),
        model TEXT,
        queue_job_id TEXT,
        worker_id TEXT,
        queued_at TEXT NOT NULL,
        started_at TEXT,
        completed_at TEXT,
        last_heartbeat_at TEXT,
        stage TEXT NOT NULL DEFAULT 'queued',
        stage_index INTEGER NOT NULL DEFAULT 0,
        progress INTEGER NOT NULL DEFAULT 0 CHECK (progress >= 0 AND progress <= 100),
        current_action TEXT NOT NULL DEFAULT '',
        current_query TEXT,
        current_url TEXT,
        current_source_title TEXT,
        visited_source_count INTEGER NOT NULL DEFAULT 0,
        evidence_count INTEGER NOT NULL DEFAULT 0,
        cancel_requested_at TEXT,
        failure_stage TEXT,
        error_code TEXT,
        error_message TEXT,
        response_json TEXT,
        cost_cents INTEGER,
        updated_at TEXT NOT NULL
      );
      INSERT INTO products VALUES ('legacy-product', '旧产品', '', '2026-08-18T00:00:00.000Z', '2026-08-18T00:00:00.000Z');
      INSERT INTO tasks VALUES (
        'TASK-0001', 'legacy-product', '旧待审核任务', 'prd', 'review', '保留这条旧任务及其运行记录。',
        'quick', 'draft', 100, 20, '2026-08-18T00:00:00.000Z', '2026-08-18T00:01:00.000Z'
      );
      INSERT INTO task_runs(
        id, task_id, status, model, queued_at, started_at, completed_at, stage, stage_index,
        progress, current_action, visited_source_count, evidence_count, cost_cents, updated_at
      ) VALUES (
        'legacy-run', 'TASK-0001', 'completed', 'gpt-test', '2026-08-18T00:00:00.000Z',
        '2026-08-18T00:00:10.000Z', '2026-08-18T00:01:00.000Z', 'completed', 8, 100,
        '任务已完成', 0, 0, 20, '2026-08-18T00:01:00.000Z'
      );
    `);
    legacy.close();

    const migrated = createWorkspaceDatabase(databasePath, { seed: false });
    try {
      const taskSql = (migrated.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'tasks'").get() as { sql: string }).sql;
      const runColumns = (migrated.prepare("PRAGMA table_info(task_runs)").all() as Array<{ name: string }>).map((column) => column.name);
      expect(taskSql).toContain("'changes_requested'");
      expect(runColumns).toContain("requires_review");
      expect(migrated.prepare("SELECT id, status FROM tasks WHERE id = 'TASK-0001'").get()).toEqual({ id: "TASK-0001", status: "review" });
      expect(migrated.prepare("SELECT id, requires_review FROM task_runs WHERE id = 'legacy-run'").get()).toEqual({ id: "legacy-run", requires_review: 0 });
      expect(migrated.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    } finally {
      migrated.close();
    }
  });

  it("persists research sources, verifies them, reopens them, and protects stale edits", () => {
    const { database, repository } = createRepository();
    expect(repository.getResearchSourceSummary(new Date("2026-08-18T08:00:00.000Z"))).toEqual({ total: 6, high: 3, week: 3, pending: 1 });
    const pending = repository.getResearchSource("source-zoom-pricing");
    expect(pending.verification).toBe("pending");
    const edited = repository.updateResearchSource(pending.id, {
      title: "Zoom 中国区定价与套餐页面",
      type: "官网",
      trust: "medium",
      url: pending.url,
      taskId: null,
    });
    expect(edited.domain).toBe("zoom.us");
    expect(edited.taskId).toBeNull();
    const verified = repository.verifyResearchSource(edited.id, "high", "对照官网套餐说明", "PM");
    expect(verified).toMatchObject({ verification: "verified", trust: "high", verifiedBy: "PM" });
    expect(repository.getResearchSourceSummary(new Date("2026-08-18T08:00:00.000Z"))).toMatchObject({ high: 4, pending: 0 });
    expect(repository.listResearchSources({ verification: "verified", trust: "high" }).items.map((item) => item.id)).toContain(edited.id);
    const reopened = repository.reopenResearchSource(edited.id);
    expect(reopened).toMatchObject({ verification: "pending", verifiedAt: null, verifiedBy: null });
    const stale = repository.getResearchSource(edited.id);
    repository.updateResearchSource(edited.id, { title: "最新标题", type: "官网", trust: "low", url: edited.url, taskId: null });
    expect(() => repository.updateResearchSource(edited.id, { title: stale.title, type: stale.type, trust: stale.trust, url: stale.url, taskId: stale.taskId, baseUpdatedAt: stale.updatedAt })).toThrow(WorkspaceConflictError);
    const created = repository.createResearchSource({ title: "手动补充来源", type: "报告", url: "https://example.com/report", taskId: null });
    expect(created).toMatchObject({ verification: "pending", taskId: null, domain: "example.com" });
    database.close();
  });

  it("persists the agent mode preference without changing seeded workspace data", () => {
    const { database, repository } = createRepository();
    expect(repository.getAgentSettings().modePreference).toBe("auto");
    const live = repository.setAgentModePreference("live");
    expect(live.modePreference).toBe("live");
    expect(repository.listTasks({ metric: "all" }).items).toHaveLength(5);
    const demo = repository.setAgentModePreference("demo");
    expect(demo.modePreference).toBe("demo");
    database.close();
  });

  it("persists output format settings and keeps the default enabled", () => {
    const { database, repository } = createRepository();
    expect(repository.getOutputSettings().outputFormats).toEqual(["markdown", "html", "docx", "pdf"]);
    const saved = repository.setOutputSettings({
      outputFormats: ["markdown", "txt", "pdf"],
      defaultOutputFormat: "txt",
    });
    expect(saved.defaultOutputFormat).toBe("txt");
    expect(repository.getOutputSettings()).toMatchObject({
      outputFormats: ["markdown", "txt", "pdf"],
      defaultOutputFormat: "txt",
    });
    database.close();
  });

  it("combines metric, status, product, and search filters", () => {
    const { database, repository } = createRepository();
    expect(repository.listTasks({ metric: "running" }).items.map((task) => task.id)).toEqual(["TASK-0820"]);
    expect(repository.listTasks({ metric: "review" }).items.map((task) => task.id)).toEqual(["TASK-0819"]);
    expect(repository.listTasks({ query: "PRD" }).items.map((task) => task.id)).toEqual(["TASK-0818"]);
    expect(repository.listTasks({ productId: "product-ai-meeting" }).items.map((task) => task.id)).toEqual(["TASK-0821"]);
    expect(repository.listTasks({ metric: "running", status: "completed" }).items).toHaveLength(0);
    database.close();
  });

  it("creates related products, tasks, and documents", () => {
    const { database, repository } = createRepository();
    const product = repository.createProduct("客户反馈中心", "集中管理客户反馈。");
    const task = repository.createTask({
      productId: product.id,
      title: "整理首批反馈",
      prompt: "整理首批客户反馈并输出问题优先级和后续行动。",
      type: "insight",
      depth: "standard",
      autonomy: "draft",
      budgetCents: 100,
    });
    const document = repository.createDocument({
      taskId: task.id,
      title: "客户反馈分析",
      content: "# 客户反馈分析\n\n首批反馈内容。",
      format: "user_research",
    });
    expect(repository.getTask(task.id).documentCount).toBe(1);
    expect(repository.getDocument(document.id).currentVersionLabel).toBe("v1.0");
    database.close();
  });

  it("creates immutable versions and rejects stale saves", () => {
    const { database, repository } = createRepository();
    const original = repository.getDocument("doc-ai-market");
    const saved = repository.saveDocumentVersion({
      documentId: original.id,
      baseRevision: original.currentRevision,
      title: original.title,
      content: `${original.currentVersion.content}\n\n新增验证结论。`,
      changeNote: "补充验证结论",
    });
    expect(saved.currentRevision).toBe(original.currentRevision + 1);
    expect(saved.currentVersionLabel).toBe("v1.4");
    expect(saved.versions).toHaveLength(3);
    expect(() =>
      repository.saveDocumentVersion({
        documentId: original.id,
        baseRevision: original.currentRevision,
        title: original.title,
        content: "过期内容",
      }),
    ).toThrow(WorkspaceConflictError);
    database.close();
  });

  it("updates version metadata without changing content and rejects stale metadata", () => {
    const { database, repository } = createRepository();
    const original = repository.getDocument("doc-ai-market");
    const version = original.currentVersion;
    const content = version.content;
    const updated = repository.updateDocumentVersionMetadata({
      documentId: original.id,
      versionId: version.id,
      baseMetadataRevision: version.metadataRevision,
      alias: "评审定稿",
      changeNote: "补充定价验证和风险说明",
    });
    expect(updated.currentVersion.alias).toBe("评审定稿");
    expect(updated.currentVersion.changeNote).toBe("补充定价验证和风险说明");
    expect(updated.currentVersion.metadataRevision).toBe(version.metadataRevision + 1);
    expect(updated.currentVersion.metadataUpdatedBy).toBe("PM");
    expect(updated.currentVersion.content).toBe(content);
    expect(updated.currentRevision).toBe(original.currentRevision);
    const cleared = repository.updateDocumentVersionMetadata({
      documentId: original.id,
      versionId: version.id,
      baseMetadataRevision: updated.currentVersion.metadataRevision,
      alias: null,
      changeNote: null,
    });
    expect(cleared.currentVersion.alias).toBeNull();
    expect(cleared.currentVersion.changeNote).toBeNull();
    expect(() => repository.updateDocumentVersionMetadata({
      documentId: original.id,
      versionId: version.id,
      baseMetadataRevision: version.metadataRevision,
      alias: null,
      changeNote: null,
    })).toThrow(WorkspaceConflictError);
    database.close();
  });

  it("restores history by appending a new version", () => {
    const { database, repository } = createRepository();
    const original = repository.getDocument("doc-mobile-prd");
    const oldest = original.versions.at(-1);
    expect(oldest).toBeDefined();
    const restored = repository.restoreDocumentVersion({
      documentId: original.id,
      versionId: oldest!.id,
      baseRevision: original.currentRevision,
    });
    expect(restored.currentRevision).toBe(3);
    expect(restored.currentVersion.source).toBe("restore");
    expect(restored.currentVersion.restoredFromId).toBe(oldest!.id);
    expect(restored.currentVersion.content).toBe(oldest!.content);
    database.close();
  });

  it("persists queued progress events and cancels an active run", () => {
    const { database, repository } = createRepository();
    const run = repository.createTaskRun("TASK-0821", "gpt-5.6-terra");
    expect(run.status).toBe("queued");
    expect(run.events.at(-1)?.action).toBe("任务已加入执行队列");
    expect(repository.claimTaskRun(run.id, "worker-a")).toBe(true);
    repository.updateTaskRunProgress({
      runId: run.id,
      stage: "searching",
      stageIndex: 2,
      progress: 35,
      action: "正在搜索：AI 会议产品定价",
      detail: "等待搜索服务返回来源。",
      query: "AI 会议产品定价",
      visitedSourceCount: 0,
    });
    const requested = repository.requestTaskRunCancel(run.id);
    expect(requested.status).toBe("running");
    expect(requested.cancelRequestedAt).toBeTruthy();
    const cancelled = repository.finishCancelledTaskRun(run.id);
    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.errorCode).toBe("CANCELLED");
    expect(cancelled.events.some((event) => event.action === "任务已取消")).toBe(true);
    expect(repository.getTask("TASK-0821").status).toBe("cancelled");
    database.close();
  });

  it("rejects a second active run for the same task", () => {
    const { database, repository } = createRepository();
    repository.createTaskRun("TASK-0821");
    expect(() => repository.createTaskRun("TASK-0821")).toThrow(/运行中的执行记录/);
    database.close();
  });

  it("closes the review loop and carries review requirements into reruns", async () => {
    const { database, repository } = createRepository();
    const initial = repository.getTask("TASK-0819");
    const returned = repository.reviewTask({
      taskId: initial.id,
      decision: "changes_requested",
      note: "补充用户证据并修正结论。",
      baseUpdatedAt: initial.updatedAt,
    });
    expect(returned.task.status).toBe("changes_requested");
    expect(returned.reviews[0]?.decision).toBe("changes_requested");
    expect(repository.listTasks({ metric: "changes_requested" }).items.map((task) => task.id)).toContain(initial.id);
    expect(() => repository.resubmitTaskReview({
      taskId: initial.id,
      baseUpdatedAt: returned.task.updatedAt,
      documentRevision: returned.document!.currentRevision,
    })).toThrow(/尚未产生新的修订/);

    const editedDocument = repository.saveDocumentVersion({
      documentId: returned.document!.id,
      baseRevision: returned.document!.currentRevision,
      title: returned.document!.title,
      content: `${returned.document!.currentVersion.content}\n\n补充审核要求中的用户证据。`,
      changeNote: "响应审核意见",
    });
    const editedTask = repository.getTask(initial.id);

    const resubmitted = repository.resubmitTaskReview({
      taskId: initial.id,
      baseUpdatedAt: editedTask.updatedAt,
      documentRevision: editedDocument.currentRevision,
    });
    expect(resubmitted.task.status).toBe("review");
    const failedRun = repository.createTaskRun(initial.id);
    expect(failedRun.requiresReview).toBe(true);
    expect(repository.claimTaskRun(failedRun.id, "test-worker-a")).toBe(true);
    repository.failTaskRun(failedRun.id, { code: "UPSTREAM_ERROR", message: "模拟上游失败" });
    const run = repository.createTaskRun(initial.id);
    expect(run.requiresReview).toBe(true);
    expect(repository.claimTaskRun(run.id, "test-worker-b")).toBe(true);
    const response = await createDemoResponse({
      prompt: initial.prompt,
      mode: initial.type,
      depth: initial.depth,
      autonomy: initial.autonomy,
      budgetUsd: initial.budgetCents / 100,
    });
    const completed = repository.completeTaskRun(run.id, response);
    expect(completed.task.status).toBe("review");
    const approved = repository.reviewTask({
      taskId: initial.id,
      decision: "approved",
      baseUpdatedAt: completed.task.updatedAt,
    });
    expect(approved.task.status).toBe("completed");
    expect(approved.reviews[0]?.decision).toBe("approved");
    database.close();
  });

  it("rejects stale or invalid review actions", () => {
    const { database, repository } = createRepository();
    const task = repository.getTask("TASK-0819");
    expect(() => repository.reviewTask({ taskId: task.id, decision: "changes_requested", baseUpdatedAt: task.updatedAt })).toThrow(/必须填写/);
    repository.reviewTask({ taskId: task.id, decision: "approved", baseUpdatedAt: task.updatedAt });
    expect(() => repository.reviewTask({ taskId: task.id, decision: "approved", baseUpdatedAt: task.updatedAt })).toThrow(WorkspaceConflictError);
    database.close();
  });

  it("enforces autonomy policies and consumes scoped approvals once", () => {
    const { database, repository } = createRepository();
    const adviseRun = repository.createTaskRun("TASK-0817");
    expect(adviseRun.policyVersion).toBeTruthy();
    expect(adviseRun.inputSnapshotHash).toMatch(/^[a-f0-9]{64}$/);
    expect(() => repository.createApprovalRequest({ runId: adviseRun.id, toolName: "external_write", target: "https://example.com" })).toThrow(WorkspacePolicyError);

    const product = repository.createProduct("审批策略测试产品");
    const task = repository.createTask({
      productId: product.id,
      title: "有限自治审批测试",
      prompt: "验证有限自治工具调用必须经过审批并且只能消费一次。",
      type: "prd",
      depth: "quick",
      autonomy: "scoped",
      budgetCents: 100,
      researchInput: { allowedDomains: ["example.com"] },
    });
    const run = repository.createTaskRun(task.id);
    expect(repository.claimTaskRun(run.id, "approval-worker")).toBe(true);
    const approval = repository.createApprovalRequest({
      runId: run.id,
      toolName: "external_write",
      target: "https://example.com/resource",
      estimatedCostCents: 10,
    });
    expect(approval.status).toBe("pending");
    const approved = repository.resolveApproval({
      approvalId: approval.id,
      status: "approved",
      baseRevision: approval.revision,
    });
    expect(approved.status).toBe("approved");
    repository.authorizeToolCall({
      runId: run.id,
      toolName: "external_write",
      target: "https://example.com/resource",
      estimatedCostCents: 10,
    });
    expect(repository.getApproval(approval.id).consumedAt).toBeTruthy();
    expect(() => repository.authorizeToolCall({
      runId: run.id,
      toolName: "external_write",
      target: "https://example.com/resource",
      estimatedCostCents: 10,
    })).toThrow(WorkspacePolicyError);
    expect(() => repository.resolveApproval({ approvalId: approval.id, status: "approved", baseRevision: approved.revision })).toThrow(WorkspaceConflictError);
    database.close();
  });

  it("persists run telemetry and exposes traceable metric values", async () => {
    const { database, repository } = createRepository();
    const task = repository.getTask("TASK-0821");
    const run = repository.createTaskRun(task.id);
    expect(repository.claimTaskRun(run.id, "metrics-worker")).toBe(true);
    const response = await createDemoResponse({
      prompt: task.prompt,
      mode: task.type,
      depth: task.depth,
      autonomy: task.autonomy,
      budgetUsd: task.budgetCents / 100,
    });
    response.quality.factCitationCoverage = 0;
    repository.completeTaskRun(run.id, response);
    const stored = database.prepare("SELECT run_id, input_snapshot_hash, policy_version, artifact_count FROM run_metrics WHERE run_id = ?").get(run.id) as { run_id: string; input_snapshot_hash: string; policy_version: string; artifact_count: number };
    expect(stored).toMatchObject({ run_id: run.id });
    expect(stored.artifact_count).toBeGreaterThan(0);
    expect(stored.input_snapshot_hash).toMatch(/^[a-f0-9]{64}$/);
    const overview = repository.getMetricsOverview({ from: "2026-01-01T00:00:00.000Z", to: "2027-01-01T00:00:00.000Z" });
    expect(overview.metrics.taskSuccessRate.sampleSize).toBeGreaterThan(0);
    expect(overview.metrics.taskSuccessRate).toMatchObject({ status: "pass", targetOperator: ">=" });
    expect(overview.metrics.sourceIngestCompleteness.status).toBe("insufficient_data");
    expect(overview.metrics.factCitationCoverage.sampleSize).toBe(1);
    expect(overview.metrics.factCitationCoverage.status).toBe("fail");

    const failedRun = repository.createTaskRun(task.id);
    expect(repository.claimTaskRun(failedRun.id, "metrics-worker")).toBe(true);
    repository.failTaskRun(failedRun.id, { code: "UPSTREAM_ERROR", message: "模拟上游失败" });
    const degraded = repository.getMetricsOverview({ from: "2026-01-01T00:00:00.000Z", to: "2027-01-01T00:00:00.000Z" });
    expect(degraded.metrics.taskSuccessRate).toMatchObject({ value: 0.5, status: "fail", targetOperator: ">=" });
    const evaluation = repository.recordEvaluationResult({ caseId: "offline-001", passed: true, taskType: "market", sourceCount: 0 });
    expect(repository.listEvaluationResults({ evaluationVersion: "goal-standard-1.0" })).toContainEqual(evaluation);
    repository.recordEvaluationResult({ caseId: "offline-001", passed: false, taskType: "market", sourceCount: 0 });
    const latestEvaluationOverview = repository.getMetricsOverview({ from: "2026-01-01T00:00:00.000Z", to: "2027-01-01T00:00:00.000Z" });
    expect(latestEvaluationOverview).toMatchObject({ metricDefinitionVersion: "goal-standard-1.2", evaluationVersion: "goal-standard-1.0" });
    expect(latestEvaluationOverview.metrics.evaluationPassRate).toMatchObject({ sampleSize: 1, value: 0, status: "fail" });
    database.close();
  });

  it("passes structured input and ready attachment text into runs, then persists citations", async () => {
    const { database, repository } = createRepository();
    const task = repository.createTask({
      productId: "product-ai-meeting",
      title: "结构化输入与来源入库测试",
      prompt: "使用结构化研究条件和附件，验证来源会自动进入资料库。",
      type: "market",
      depth: "quick",
      autonomy: "draft",
      budgetCents: 100,
      researchInput: { region: "中国", targetUsers: "产品经理", allowedDomains: ["example.com"] },
    });
    const attachment = repository.createTaskAttachment({
      taskId: task.id,
      fileName: "brief.txt",
      mediaType: "text/plain",
      byteSize: 12,
      checksum: "a".repeat(64),
      storagePath: "data/attachments/test.txt",
      status: "ready",
      parsedText: "用户关注证据链。",
    });
    expect(repository.getTask(task.id).attachmentCount).toBe(1);
    expect(repository.getAgentAttachmentContext(task.id)[0]?.text).toContain("证据链");
    const run = repository.createTaskRun(task.id);
    expect(run.inputSnapshotHash).toMatch(/^[a-f0-9]{64}$/);
    expect(run.policySnapshot).toContain("example.com");
    expect(attachment.status).toBe("ready");
    expect(repository.claimTaskRun(run.id, "source-worker")).toBe(true);
    const base = await createDemoResponse({ prompt: task.prompt, mode: task.type, depth: task.depth, autonomy: task.autonomy, budgetUsd: 1, attachments: repository.getAgentAttachmentContext(task.id) });
    const response = {
      ...base,
      demo: false,
      status: "completed" as const,
      citations: [{ title: "示例来源", url: "https://example.com/research" }],
      evidence: [{ id: "evidence-1", title: "示例来源", url: "https://example.com/research", publisher: "example.com", capturedAt: new Date().toISOString(), cited: true, trust: "unrated" as const, freshness: "unknown" as const, excerpt: "可核验摘录" }],
      budget: { ...base.budget, estimatedCostUsd: 0.01, status: "within" as const },
      quality: { ...base.quality, status: "passed" as const, factCitationCoverage: 1 },
    };
    repository.completeTaskRun(run.id, response);
    const sources = repository.listResearchSources({ taskId: task.id }).items;
    expect(sources).toHaveLength(1);
    expect(sources[0]).toMatchObject({ runId: run.id, url: "https://example.com/research", verification: "pending" });
    database.close();
  });

  it("enforces attachment parsing transitions and rejects concurrent claims", () => {
    const { database, repository } = createRepository();
    const task = repository.getTask("TASK-0821");
    const attachment = repository.createTaskAttachment({
      taskId: task.id,
      fileName: "research.txt",
      mediaType: "text/plain",
      byteSize: 8,
      checksum: "attachment-state-checksum",
      storagePath: "data/attachments/research.txt",
      status: "uploaded",
    });

    const claimed = repository.claimTaskAttachmentForParsing(task.id, attachment.id);
    expect(claimed.status).toBe("parsing");
    expect(claimed.parseStartedAt).toBeTruthy();
    expect(() => repository.claimTaskAttachmentForParsing(task.id, attachment.id)).toThrowError(
      expect.objectContaining({ code: "ATTACHMENT_PARSE_IN_PROGRESS" }),
    );
    expect(() => repository.deleteTaskAttachment(task.id, attachment.id)).toThrowError(
      expect.objectContaining({ code: "ATTACHMENT_PARSE_IN_PROGRESS" }),
    );

    const failed = repository.failTaskAttachmentParsing(task.id, attachment.id, "PARSE_FAILED", "测试失败");
    expect(failed).toMatchObject({ status: "failed", errorCode: "PARSE_FAILED", errorMessage: "测试失败" });
    expect(repository.claimTaskAttachmentForParsing(task.id, attachment.id).status).toBe("parsing");
    const ready = repository.completeTaskAttachmentParsing(task.id, attachment.id, "# 已解析");
    expect(ready).toMatchObject({ status: "ready", parsedText: "# 已解析" });
    database.close();
  });
});
