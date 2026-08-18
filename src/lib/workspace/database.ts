import { mkdirSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

type WorkspaceDatabase = InstanceType<typeof Database>;

const globalDatabase = globalThis as typeof globalThis & {
  pmAgentWorkspaceDatabase?: WorkspaceDatabase;
};

const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS workspace_settings (
    id TEXT PRIMARY KEY CHECK (id = 'default'),
    agent_mode TEXT NOT NULL CHECK (agent_mode IN ('auto', 'demo', 'live')) DEFAULT 'auto',
    output_formats TEXT NOT NULL DEFAULT '["markdown","html","docx","pdf"]',
    default_output_format TEXT NOT NULL DEFAULT 'markdown',
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    description TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS tasks (
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

  CREATE TABLE IF NOT EXISTS task_runs (
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
    requires_review INTEGER NOT NULL DEFAULT 0 CHECK (requires_review IN (0, 1)),
    policy_version TEXT NOT NULL DEFAULT '',
    policy_json TEXT NOT NULL DEFAULT '{}',
    input_snapshot_hash TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS task_run_events (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES task_runs(id) ON DELETE CASCADE,
    stage TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('system', 'tool', 'source', 'analysis', 'error', 'status')),
    action TEXT NOT NULL,
    detail TEXT NOT NULL DEFAULT '',
    query TEXT,
    url TEXT,
    source_title TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS task_attachments (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    file_name TEXT NOT NULL,
    media_type TEXT NOT NULL,
    byte_size INTEGER NOT NULL CHECK (byte_size >= 0),
    checksum TEXT NOT NULL,
    storage_path TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('uploaded', 'parsing', 'ready', 'failed', 'rejected')),
    uploaded_by TEXT NOT NULL DEFAULT 'local-user',
    error_code TEXT,
    error_message TEXT,
    parsed_text TEXT,
    parse_started_at TEXT,
    parse_completed_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (task_id, checksum)
  );

  CREATE TABLE IF NOT EXISTS documents (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    format TEXT NOT NULL CHECK (format IN ('research_report', 'competitor_report', 'user_research', 'prd', 'outline', 'html', 'markdown')),
    owner TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('primary', 'additional')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS document_versions (
    id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    revision INTEGER NOT NULL CHECK (revision > 0),
    label TEXT NOT NULL,
    alias TEXT,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    source TEXT NOT NULL CHECK (source IN ('manual', 'agent', 'agent_demo', 'restore')),
    change_note TEXT,
    created_by TEXT NOT NULL,
    restored_from_id TEXT REFERENCES document_versions(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL,
    metadata_revision INTEGER NOT NULL DEFAULT 1 CHECK (metadata_revision > 0),
    metadata_updated_at TEXT,
    metadata_updated_by TEXT,
    UNIQUE (document_id, revision)
  );

  CREATE TABLE IF NOT EXISTS task_reviews (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    run_id TEXT REFERENCES task_runs(id) ON DELETE SET NULL,
    decision TEXT NOT NULL CHECK (decision IN ('approved', 'changes_requested', 'resubmitted')),
    note TEXT NOT NULL DEFAULT '',
    reviewer TEXT NOT NULL,
    document_id TEXT REFERENCES documents(id) ON DELETE SET NULL,
    document_revision INTEGER,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS approvals (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES task_runs(id) ON DELETE CASCADE,
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    tool_name TEXT NOT NULL,
    target TEXT,
    parameter_hash TEXT NOT NULL,
    estimated_cost_cents INTEGER,
    policy_version TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled', 'expired')),
    requested_at TEXT NOT NULL,
    resolved_at TEXT,
    resolved_by TEXT,
    note TEXT,
    revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
    expires_at TEXT NOT NULL,
    consumed_at TEXT
  );

  CREATE TABLE IF NOT EXISTS run_metrics (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL UNIQUE REFERENCES task_runs(id) ON DELETE CASCADE,
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    task_type TEXT NOT NULL CHECK (task_type IN ('market', 'competitor', 'insight', 'prd')),
    evaluation_version TEXT NOT NULL,
    input_snapshot_hash TEXT NOT NULL DEFAULT '',
    policy_version TEXT NOT NULL DEFAULT '',
    model TEXT,
    status TEXT NOT NULL,
    error_code TEXT,
    citations_returned INTEGER NOT NULL DEFAULT 0,
    sources_persisted INTEGER NOT NULL DEFAULT 0,
    fact_citation_coverage REAL,
    unsupported_claim_rate REAL,
    accepted_attachments INTEGER NOT NULL DEFAULT 0,
    ready_attachments INTEGER NOT NULL DEFAULT 0,
    artifact_count INTEGER NOT NULL DEFAULT 0,
    duration_ms INTEGER,
    cost_cents INTEGER,
    budget_compliant INTEGER NOT NULL DEFAULT 1 CHECK (budget_compliant IN (0, 1)),
    high_risk_calls INTEGER NOT NULL DEFAULT 0,
    approved_high_risk_calls INTEGER NOT NULL DEFAULT 0,
    progress_events INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS evaluation_results (
    id TEXT PRIMARY KEY,
    case_id TEXT NOT NULL,
    evaluation_version TEXT NOT NULL,
    run_id TEXT,
    passed INTEGER NOT NULL CHECK (passed IN (0, 1)),
    task_type TEXT,
    model TEXT,
    source_count INTEGER NOT NULL DEFAULT 0,
    citation_coverage REAL,
    cost_cents INTEGER,
    duration_ms INTEGER,
    error_code TEXT,
    diff_summary TEXT,
    created_at TEXT NOT NULL,
    UNIQUE (case_id, evaluation_version, id)
  );

  CREATE TABLE IF NOT EXISTS research_sources (
    id TEXT PRIMARY KEY,
    task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
    run_id TEXT REFERENCES task_runs(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    publisher TEXT NOT NULL DEFAULT '',
    type TEXT NOT NULL CHECK (type IN ('官网', '报告', '用户评价', '数据平台', '新闻', '其他')),
    trust TEXT NOT NULL CHECK (trust IN ('high', 'medium', 'low')),
    verification TEXT NOT NULL CHECK (verification IN ('pending', 'verified')) DEFAULT 'pending',
    url TEXT NOT NULL,
    domain TEXT NOT NULL,
    excerpt TEXT,
    claim_type TEXT NOT NULL DEFAULT 'fact' CHECK (claim_type IN ('fact', 'inference', 'recommendation')),
    freshness TEXT NOT NULL DEFAULT 'unknown',
    citation_count INTEGER NOT NULL DEFAULT 0 CHECK (citation_count >= 0),
    conflict_group TEXT,
    captured_at TEXT NOT NULL,
    verified_at TEXT,
    verified_by TEXT,
    verification_note TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_tasks_product ON tasks(product_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_documents_task ON documents(task_id, updated_at DESC);
  CREATE INDEX IF NOT EXISTS idx_versions_document ON document_versions(document_id, revision DESC);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_documents_primary_task ON documents(task_id) WHERE role = 'primary';
  CREATE INDEX IF NOT EXISTS idx_research_sources_verification ON research_sources(verification, updated_at DESC);
  CREATE INDEX IF NOT EXISTS idx_research_sources_trust ON research_sources(trust, captured_at DESC);
  CREATE INDEX IF NOT EXISTS idx_research_sources_task ON research_sources(task_id, captured_at DESC);
  CREATE INDEX IF NOT EXISTS idx_task_reviews_task ON task_reviews(task_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_approvals_run ON approvals(run_id, requested_at DESC);
  CREATE INDEX IF NOT EXISTS idx_approvals_pending ON approvals(status, requested_at DESC);
  CREATE INDEX IF NOT EXISTS idx_run_metrics_task ON run_metrics(task_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_run_metrics_type ON run_metrics(task_type, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_evaluation_results_case ON evaluation_results(case_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_task_attachments_task ON task_attachments(task_id, created_at DESC);
`;

const PRODUCTS = [
  ["product-ai-meeting", "AI 会议助手", "会议研究、智能纪要与会后协同产品。", "2026-08-17T06:30:00.000Z"],
  ["product-collaboration", "协作效率套件", "面向团队协作、知识管理和用户洞察的产品组合。", "2026-08-17T02:12:00.000Z"],
  ["product-growth", "SaaS 增长工作台", "聚焦新用户激活、转化和留存优化。", "2026-08-15T01:18:00.000Z"],
] as const;

const TASKS = [
  ["TASK-0821", "product-ai-meeting", "分析中国 AI 会议产品市场", "market", "completed", "分析中国 AI 会议产品市场，重点关注目标用户、主要竞品、定价和进入机会。", "standard", "draft", 200, 192, "2026-08-17T06:30:00.000Z", "2026-08-17T06:45:00.000Z"],
  ["TASK-0820", "product-collaboration", "协作白板产品竞品功能对比", "competitor", "running", "对比主流协作白板产品的功能、定价和协作体验。", "standard", "draft", 150, 86, "2026-08-17T02:12:00.000Z", "2026-08-17T02:12:00.000Z"],
  ["TASK-0819", "product-collaboration", "聚类 Q2 用户访谈反馈", "insight", "review", "整理 Q2 用户访谈反馈，识别高频痛点和机会。", "standard", "draft", 120, 74, "2026-08-16T08:40:00.000Z", "2026-08-16T09:12:00.000Z"],
  ["TASK-0818", "product-collaboration", "移动端知识库搜索 PRD", "prd", "completed", "为移动端知识库搜索功能输出可评审 PRD。", "standard", "draft", 100, 58, "2026-08-16T03:25:00.000Z", "2026-08-16T10:04:00.000Z"],
  ["TASK-0817", "product-growth", "SaaS 新用户激活机会研究", "market", "paused", "研究 SaaS 新用户激活路径与低成本优化机会。", "quick", "advise", 80, 31, "2026-08-15T01:18:00.000Z", "2026-08-15T02:03:00.000Z"],
] as const;

const DOCUMENTS = [
  ["doc-ai-market", "TASK-0821", "research_report", "PM Agent", "primary", "2026-08-17T06:40:00.000Z", "2026-08-17T06:45:00.000Z"],
  ["doc-ai-roadmap", "TASK-0821", "outline", "PM Agent", "additional", "2026-08-14T02:30:00.000Z", "2026-08-17T06:44:00.000Z"],
  ["doc-whiteboard", "TASK-0820", "competitor_report", "PM Agent", "primary", "2026-08-17T02:15:00.000Z", "2026-08-17T03:20:00.000Z"],
  ["doc-q2-insight", "TASK-0819", "user_research", "李宁", "primary", "2026-08-15T08:12:00.000Z", "2026-08-16T09:12:00.000Z"],
  ["doc-mobile-prd", "TASK-0818", "prd", "陈默", "primary", "2026-08-15T10:04:00.000Z", "2026-08-16T10:04:00.000Z"],
] as const;

const VERSIONS = [
  ["ver-ai-market-1", "doc-ai-market", 1, "v1.2", "AI 会议产品市场分析", "# AI 会议产品市场分析\n\n## 市场概览\n\n中国 AI 会议产品正在从单点会议工具向会后生产力平台演进。\n\n## 初步机会\n\n- 自动纪要与行动项闭环\n- 面向中小团队的低门槛套餐\n", "agent", "形成首版市场判断", "PM Agent", null, "2026-08-17T06:40:00.000Z"],
  ["ver-ai-market-2", "doc-ai-market", 2, "v1.3", "AI 会议产品市场分析", "# AI 会议产品市场分析\n\n## 核心结论\n\n中国 AI 会议产品市场正在从会议工具转向会后生产力平台，自动纪要、行动项和知识沉淀成为主要差异点。\n\n## 目标用户\n\n中小型互联网团队更关注低配置成本、快速上手和跨工具同步。\n\n## 建议\n\n1. 优先验证自动纪要到任务闭环。\n2. 用轻量套餐验证中小团队付费意愿。\n3. 对关键市场数字继续交叉验证。\n", "agent", "补充目标用户和验证建议", "PM Agent", null, "2026-08-17T06:45:00.000Z"],
  ["ver-ai-roadmap-1", "doc-ai-roadmap", 1, "v0.8", "AI 功能路线图评审材料", "# AI 功能路线图评审材料\n\n## 近期\n\n- 自动纪要\n- 行动项提取\n\n## 中期\n\n- 团队知识沉淀\n", "manual", "建立路线图框架", "PM Agent", null, "2026-08-14T02:30:00.000Z"],
  ["ver-ai-roadmap-2", "doc-ai-roadmap", 2, "v0.9", "AI 功能路线图评审材料", "# AI 功能路线图评审材料\n\n## 近期：验证核心闭环\n\n- 自动纪要质量\n- 行动项责任人识别\n- 任务系统同步\n\n## 中期：形成团队资产\n\n- 会议知识检索\n- 决策与风险追踪\n", "manual", "补充阶段目标", "PM Agent", null, "2026-08-17T06:44:00.000Z"],
  ["ver-whiteboard-1", "doc-whiteboard", 1, "v1.0", "协作白板竞品分析", "# 协作白板竞品分析\n\n## 对比范围\n\n覆盖实时协作、模板、评论和导出能力。\n", "agent_demo", "生成竞品框架", "PM Agent", null, "2026-08-17T02:15:00.000Z"],
  ["ver-whiteboard-2", "doc-whiteboard", 2, "v1.1", "协作白板竞品分析", "# 协作白板竞品分析\n\n## 关键差异\n\n- 实时协作稳定性\n- 模板生态与易用性\n- 从白板到项目执行的衔接\n\n## 当前状态\n\n任务仍在执行，结论需要在采集完成后复核。\n", "agent_demo", "补充关键差异", "PM Agent", null, "2026-08-17T03:20:00.000Z"],
  ["ver-insight-1", "doc-q2-insight", 1, "v1.4", "Q2 用户研究洞察", "# Q2 用户研究洞察\n\n## 高频反馈\n\n用户希望减少信息整理和跨系统同步成本。\n", "agent", "整理高频反馈", "李宁", null, "2026-08-15T08:12:00.000Z"],
  ["ver-insight-2", "doc-q2-insight", 2, "v1.5", "Q2 用户研究洞察", "# Q2 用户研究洞察\n\n## 高频反馈\n\n用户希望减少信息整理和跨系统同步成本。\n\n## 待审核洞察\n\n自动归类与建议功能有价值，但需要保留人工确认入口。\n", "manual", "加入待审核洞察", "李宁", null, "2026-08-16T09:12:00.000Z"],
  ["ver-prd-1", "doc-mobile-prd", 1, "v1.9", "移动端知识库搜索 PRD", "# 移动端知识库搜索 PRD\n\n## 目标\n\n让用户在移动端快速定位可信内容。\n\n## 核心需求\n\n- 关键词搜索\n- 最近搜索\n", "manual", "建立需求基线", "陈默", null, "2026-08-15T10:04:00.000Z"],
  ["ver-prd-2", "doc-mobile-prd", 2, "v2.0", "移动端知识库搜索 PRD", "# 移动端知识库搜索 PRD\n\n## 目标\n\n让用户在移动端快速定位可信内容，并明确结果来源与更新时间。\n\n## 核心需求\n\n- 关键词与语义搜索\n- 最近搜索和历史清理\n- 来源、更新时间与权限状态\n- 无结果和弱网状态\n\n## 验收\n\n首屏结果在正常网络下 2 秒内可用。\n", "manual", "补充语义搜索与异常状态", "陈默", null, "2026-08-16T10:04:00.000Z"],
] as const;

const RESEARCH_SOURCES = [
  ["source-ai-market-report", "TASK-0821", "36氪：AI会议产品行业报告", "报告", "high", "verified", "https://www.36kr.com/search/articles/AI%E4%BC%9A%E8%AE%AE", "2026-08-17T06:32:00.000Z", "2026-08-17T06:32:00.000Z", "PM", null],
  ["source-feishu-meeting", "TASK-0820", "飞书会议官网产品页", "官网", "high", "verified", "https://www.feishu.cn/product/meetings", "2026-08-17T06:33:00.000Z", "2026-08-17T06:33:00.000Z", "PM", null],
  ["source-tencent-reviews", "TASK-0819", "腾讯会议用户评价汇总", "用户评价", "medium", "verified", "https://www.zhihu.com/search?type=content&q=%E8%85%BE%E8%AE%AF%E4%BC%9A%E8%AE%AE%20%E7%94%A8%E6%88%B7%E8%AF%84%E4%BB%B7", "2026-08-17T06:35:00.000Z", "2026-08-17T06:35:00.000Z", "PM", null],
  ["source-iresearch-saas", "TASK-0821", "艾瑞咨询 SaaS 市场数据", "数据平台", "high", "verified", "https://www.iresearch.com.cn/", "2026-08-16T02:20:00.000Z", "2026-08-16T02:20:00.000Z", "PM", null],
  ["source-dingtalk-comparison", "TASK-0820", "钉钉会议功能对比", "新闻", "medium", "verified", "https://www.36kr.com/search/articles/%E9%92%89%E9%92%89%E4%BC%9A%E8%AE%AE", "2026-08-16T01:15:00.000Z", "2026-08-16T01:15:00.000Z", "PM", null],
  ["source-zoom-pricing", "TASK-0820", "Zoom 中国区定价策略", "其他", "low", "pending", "https://zoom.us/pricing", "2026-08-15T08:40:00.000Z", null, null, null],
] as const;

function tableColumns(database: WorkspaceDatabase, table: string): Set<string> {
  return new Set(
    (database.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((column) => column.name),
  );
}

function migrateLegacyRunTables(database: WorkspaceDatabase) {
  const taskColumns = tableColumns(database, "tasks");
  const runColumns = tableColumns(database, "task_runs");
  const taskSql = (database.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'tasks'").get() as { sql?: string } | undefined)?.sql ?? "";
  const needsTaskRebuild = taskColumns.size > 0 && !taskSql.includes("'changes_requested'");
  const needsRunRebuild = runColumns.size > 0 && !runColumns.has("queue_job_id");
  const taskResearchContextSelect = taskColumns.has("research_context") ? "research_context" : "'{}'";
  if (needsTaskRebuild || needsRunRebuild) {
    database.pragma("foreign_keys = OFF");
    try {
      database.transaction(() => {
        if (needsTaskRebuild) {
          database.exec(`
          CREATE TABLE tasks_new (
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
          INSERT INTO tasks_new(id, product_id, title, type, status, prompt, research_context, depth, autonomy, budget_cents, cost_cents, created_at, updated_at)
            SELECT id, product_id, title, type, status, prompt, ${taskResearchContextSelect}, depth, autonomy, budget_cents, cost_cents, created_at, updated_at FROM tasks;
          DROP TABLE tasks;
          ALTER TABLE tasks_new RENAME TO tasks;
          `);
        }

        if (needsRunRebuild) {
          database.exec(`
          CREATE TABLE task_runs_new (
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
            requires_review INTEGER NOT NULL DEFAULT 0 CHECK (requires_review IN (0, 1)),
            updated_at TEXT NOT NULL
          );
          INSERT INTO task_runs_new(
            id, task_id, status, model, queued_at, started_at, completed_at, stage, stage_index,
            progress, current_action, response_json, cost_cents, error_code, error_message, requires_review, updated_at
          )
            SELECT
              id, task_id, status, model, started_at, started_at, completed_at,
              CASE WHEN status = 'failed' THEN 'failed' ELSE 'completed' END,
              CASE WHEN status = 'failed' THEN 7 ELSE 8 END,
              100,
              CASE WHEN status = 'failed' THEN '历史运行失败' ELSE '任务已完成' END,
              response_json, cost_cents,
              CASE WHEN status = 'failed' THEN 'LEGACY_FAILURE' ELSE NULL END,
              CASE WHEN status = 'failed' THEN json_extract(response_json, '$.error') ELSE NULL END,
              0,
              completed_at
            FROM task_runs;
          DROP TABLE task_runs;
          ALTER TABLE task_runs_new RENAME TO task_runs;
          `);
        }
      })();
    } finally {
      database.pragma("foreign_keys = ON");
    }
  }

  const refreshedRunColumns = tableColumns(database, "task_runs");
  if (refreshedRunColumns.size > 0 && !refreshedRunColumns.has("requires_review")) {
    database.exec("ALTER TABLE task_runs ADD COLUMN requires_review INTEGER NOT NULL DEFAULT 0 CHECK (requires_review IN (0, 1))");
  }
  const finalRunColumns = tableColumns(database, "task_runs");
  if (finalRunColumns.size > 0 && !finalRunColumns.has("policy_version")) {
    database.exec("ALTER TABLE task_runs ADD COLUMN policy_version TEXT NOT NULL DEFAULT ''");
  }
  if (finalRunColumns.size > 0 && !finalRunColumns.has("policy_json")) {
    database.exec("ALTER TABLE task_runs ADD COLUMN policy_json TEXT NOT NULL DEFAULT '{}'");
  }
  if (finalRunColumns.size > 0 && !finalRunColumns.has("input_snapshot_hash")) {
    database.exec("ALTER TABLE task_runs ADD COLUMN input_snapshot_hash TEXT NOT NULL DEFAULT ''");
  }
}

function migrateTaskAttachmentLifecycle(database: WorkspaceDatabase) {
  const attachmentSql = (database.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'task_attachments'").get() as { sql?: string } | undefined)?.sql ?? "";
  const attachmentColumns = tableColumns(database, "task_attachments");
  const hasLifecycleStatuses = attachmentSql.includes("'uploaded'") && attachmentSql.includes("'parsing'");
  const hasLifecycleColumns = ["uploaded_by", "parse_started_at", "parse_completed_at"].every((column) => attachmentColumns.has(column));
  if (!attachmentSql || (hasLifecycleStatuses && hasLifecycleColumns)) return;

  database.transaction(() => {
    database.exec(`
      CREATE TABLE task_attachments_new (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        file_name TEXT NOT NULL,
        media_type TEXT NOT NULL,
        byte_size INTEGER NOT NULL CHECK (byte_size >= 0),
        checksum TEXT NOT NULL,
        storage_path TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('uploaded', 'parsing', 'ready', 'failed', 'rejected')),
        uploaded_by TEXT NOT NULL DEFAULT 'local-user',
        error_code TEXT,
        error_message TEXT,
        parsed_text TEXT,
        parse_started_at TEXT,
        parse_completed_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (task_id, checksum)
      );
      INSERT INTO task_attachments_new(
        id, task_id, file_name, media_type, byte_size, checksum, storage_path, status,
        uploaded_by, error_code, error_message, parsed_text, parse_started_at,
        parse_completed_at, created_at, updated_at
      )
      SELECT
        id, task_id, file_name, media_type, byte_size, checksum, storage_path, status,
        'local-user', error_code, error_message, parsed_text,
        CASE WHEN status IN ('ready', 'failed') THEN created_at ELSE NULL END,
        CASE WHEN status IN ('ready', 'failed') THEN updated_at ELSE NULL END,
        created_at, updated_at
      FROM task_attachments;
      DROP TABLE task_attachments;
      ALTER TABLE task_attachments_new RENAME TO task_attachments;
    `);
  })();
}

function migrate(database: WorkspaceDatabase) {
  database.exec(SCHEMA_SQL);
  const now = new Date().toISOString();
  const recordMigration = database.prepare(
    "INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (?, ?)",
  );
  const currentVersion = (database.prepare("SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations").get() as { version: number }).version;
  database.transaction(() => {
    if (currentVersion < 1) recordMigration.run(1, now);
    database
      .prepare("INSERT OR IGNORE INTO workspace_settings(id, agent_mode, updated_at) VALUES ('default', 'auto', ?)")
      .run(now);
    if (currentVersion < 2) recordMigration.run(2, now);
  })();
  if (currentVersion < 3) {
    migrateLegacyRunTables(database);
    database.prepare("INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (3, ?)").run(new Date().toISOString());
  }
  // Some databases recorded a later migration number while retaining an older
  // table constraint. This repair is schema-driven and safe to run repeatedly.
  migrateLegacyRunTables(database);
  migrateTaskAttachmentLifecycle(database);
  const taskColumns = tableColumns(database, "tasks");
  if (!taskColumns.has("research_context")) {
    database.exec("ALTER TABLE tasks ADD COLUMN research_context TEXT NOT NULL DEFAULT '{}'");
  }
  const sourceColumns = tableColumns(database, "research_sources");
  if (!sourceColumns.has("run_id")) {
    database.exec("ALTER TABLE research_sources ADD COLUMN run_id TEXT");
  }
  if (!sourceColumns.has("publisher")) {
    database.exec("ALTER TABLE research_sources ADD COLUMN publisher TEXT NOT NULL DEFAULT ''");
  }
  if (!sourceColumns.has("excerpt")) {
    database.exec("ALTER TABLE research_sources ADD COLUMN excerpt TEXT");
  }
  if (!sourceColumns.has("claim_type")) {
    database.exec("ALTER TABLE research_sources ADD COLUMN claim_type TEXT NOT NULL DEFAULT 'fact'");
  }
  if (!sourceColumns.has("freshness")) {
    database.exec("ALTER TABLE research_sources ADD COLUMN freshness TEXT NOT NULL DEFAULT 'unknown'");
  }
  if (!sourceColumns.has("citation_count")) {
    database.exec("ALTER TABLE research_sources ADD COLUMN citation_count INTEGER NOT NULL DEFAULT 0");
  }
  if (!sourceColumns.has("conflict_group")) {
    database.exec("ALTER TABLE research_sources ADD COLUMN conflict_group TEXT");
  }
  if (currentVersion < 8) {
    database.prepare("INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (8, ?)").run(new Date().toISOString());
  }
  const approvalColumns = tableColumns(database, "approvals");
  if (approvalColumns.size > 0 && !approvalColumns.has("estimated_cost_cents")) {
    database.exec("ALTER TABLE approvals ADD COLUMN estimated_cost_cents INTEGER");
  }
  if (approvalColumns.size > 0 && !approvalColumns.has("expires_at")) {
    database.exec("ALTER TABLE approvals ADD COLUMN expires_at TEXT NOT NULL DEFAULT '9999-12-31T23:59:59.999Z'");
  }
  if (approvalColumns.size > 0 && !approvalColumns.has("consumed_at")) {
    database.exec("ALTER TABLE approvals ADD COLUMN consumed_at TEXT");
  }
  if (currentVersion < 9) {
    database.prepare("INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (9, ?)").run(new Date().toISOString());
  }
  if (currentVersion < 10) {
    database.prepare("INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (10, ?)").run(new Date().toISOString());
  }
  if (currentVersion < 11) {
    database.prepare("INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (11, ?)").run(new Date().toISOString());
  }
  database.exec("CREATE INDEX IF NOT EXISTS idx_research_sources_run ON research_sources(run_id, captured_at DESC)");
  // Repair partially-applied settings migrations as well as upgrading older databases.
  // Some early MVP databases recorded migration 4 before the columns were added.
  const settingsColumns = tableColumns(database, "workspace_settings");
  if (!settingsColumns.has("output_formats")) {
    database.exec("ALTER TABLE workspace_settings ADD COLUMN output_formats TEXT NOT NULL DEFAULT '[\"markdown\",\"html\",\"docx\",\"pdf\"]'");
  }
  if (!settingsColumns.has("default_output_format")) {
    database.exec("ALTER TABLE workspace_settings ADD COLUMN default_output_format TEXT NOT NULL DEFAULT 'markdown'");
  }
  if (currentVersion < 4) {
    database.prepare("INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (4, ?)").run(new Date().toISOString());
  }
  if (currentVersion < 5) {
    database.prepare("INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (5, ?)").run(new Date().toISOString());
  }
  const versionColumns = tableColumns(database, "document_versions");
  if (!versionColumns.has("alias")) {
    database.exec("ALTER TABLE document_versions ADD COLUMN alias TEXT");
  }
  if (!versionColumns.has("metadata_revision")) {
    database.exec("ALTER TABLE document_versions ADD COLUMN metadata_revision INTEGER NOT NULL DEFAULT 1 CHECK (metadata_revision > 0)");
  }
  if (!versionColumns.has("metadata_updated_at")) {
    database.exec("ALTER TABLE document_versions ADD COLUMN metadata_updated_at TEXT");
  }
  if (!versionColumns.has("metadata_updated_by")) {
    database.exec("ALTER TABLE document_versions ADD COLUMN metadata_updated_by TEXT");
  }
  if (currentVersion < 6) {
    database.prepare("INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (6, ?)").run(new Date().toISOString());
  }
  if (currentVersion < 7) {
    database.prepare("INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (7, ?)").run(new Date().toISOString());
  }
  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_tasks_product ON tasks(product_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_task_runs_task ON task_runs(task_id, queued_at DESC);
    CREATE INDEX IF NOT EXISTS idx_task_runs_active ON task_runs(status, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_task_run_events_run ON task_run_events(run_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_research_sources_verification ON research_sources(verification, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_research_sources_trust ON research_sources(trust, captured_at DESC);
    CREATE INDEX IF NOT EXISTS idx_research_sources_task ON research_sources(task_id, captured_at DESC);
    CREATE INDEX IF NOT EXISTS idx_task_reviews_task ON task_reviews(task_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_run_metrics_task ON run_metrics(task_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_run_metrics_type ON run_metrics(task_type, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_evaluation_results_case ON evaluation_results(case_id, created_at DESC);
  `);
  database.exec(`
    INSERT OR IGNORE INTO task_run_events(id, run_id, stage, type, action, detail, query, url, source_title, created_at)
    SELECT
      'event-legacy-' || r.id,
      r.id,
      r.stage,
      CASE WHEN r.status = 'failed' THEN 'error' ELSE 'status' END,
      r.current_action,
      COALESCE(r.error_message, '历史运行记录已迁移。'),
      r.current_query,
      r.current_url,
      r.current_source_title,
      COALESCE(r.completed_at, r.updated_at)
    FROM task_runs r
    WHERE NOT EXISTS (SELECT 1 FROM task_run_events e WHERE e.run_id = r.id);
  `);
  database.exec(`
    UPDATE task_runs
    SET error_code = 'TIMEOUT', error_message = '任务在原有 150 秒时限内未完成，已被系统中止。'
    WHERE status = 'failed' AND error_code = 'LEGACY_FAILURE' AND error_message = 'Request was aborted.';
    UPDATE task_run_events
    SET detail = 'TIMEOUT：任务在原有 150 秒时限内未完成，已被系统中止。'
    WHERE type = 'error' AND detail = 'Request was aborted.';
  `);
}

function seed(database: WorkspaceDatabase) {
  const insertProduct = database.prepare(
    "INSERT OR IGNORE INTO products(id, name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
  );
  const insertTask = database.prepare(
    "INSERT OR IGNORE INTO tasks(id, product_id, title, type, status, prompt, depth, autonomy, budget_cents, cost_cents, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  );
  const insertDocument = database.prepare(
    "INSERT OR IGNORE INTO documents(id, task_id, format, owner, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  );
  const insertVersion = database.prepare(
    "INSERT OR IGNORE INTO document_versions(id, document_id, revision, label, title, content, source, change_note, created_by, restored_from_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  );
  const insertSource = database.prepare(
    `INSERT OR IGNORE INTO research_sources(
      id, task_id, title, type, trust, verification, url, domain, captured_at,
      verified_at, verified_by, verification_note, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  database.transaction(() => {
    PRODUCTS.forEach(([id, name, description, timestamp]) =>
      insertProduct.run(id, name, description, timestamp, timestamp),
    );
    TASKS.forEach((task) => insertTask.run(...task));
    DOCUMENTS.forEach((document) => insertDocument.run(...document));
    VERSIONS.forEach((version) => insertVersion.run(...version));
    RESEARCH_SOURCES.forEach(([id, taskId, title, type, trust, verification, url, capturedAt, verifiedAt, verifiedBy, verificationNote]) => {
      insertSource.run(
        id,
        taskId,
        title,
        type,
        trust,
        verification,
        url,
        new URL(url).hostname,
        capturedAt,
        verifiedAt,
        verifiedBy,
        verificationNote,
        capturedAt,
        verifiedAt ?? capturedAt,
      );
    });
  })();
}

export function createWorkspaceDatabase(
  databasePath = process.env.PM_AGENT_DB_PATH?.trim() || path.join(process.cwd(), "data", "pm-agent.sqlite"),
  options: { seed?: boolean } = {},
): WorkspaceDatabase {
  if (databasePath !== ":memory:") mkdirSync(path.dirname(databasePath), { recursive: true });
  const database = new Database(databasePath);
  database.pragma("foreign_keys = ON");
  database.pragma("busy_timeout = 5000");
  if (databasePath !== ":memory:") database.pragma("journal_mode = WAL");
  migrate(database);
  if (options.seed !== false) seed(database);
  return database;
}

export function getWorkspaceDatabase(): WorkspaceDatabase {
  if (!globalDatabase.pmAgentWorkspaceDatabase) {
    globalDatabase.pmAgentWorkspaceDatabase = createWorkspaceDatabase();
  }
  return globalDatabase.pmAgentWorkspaceDatabase;
}

export function closeWorkspaceDatabase() {
  globalDatabase.pmAgentWorkspaceDatabase?.close();
  delete globalDatabase.pmAgentWorkspaceDatabase;
}

export type { WorkspaceDatabase };
