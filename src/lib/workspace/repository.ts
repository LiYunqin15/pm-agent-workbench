import { createHash } from "node:crypto";
import type { AgentModePreference, AgentRunResponse, AutonomyLevel, RunDepth, TaskMode } from "@/lib/agent/types";
import { buildAgentPolicy, evaluateToolCall } from "@/lib/agent/policy";
import {
  DOCUMENT_FORMAT_LABELS,
  OUTPUT_DOCUMENT_FORMATS,
  TASK_TYPE_LABELS,
  type DocumentDetail,
  type DocumentFormat,
  type DocumentSummary,
  type DocumentVersion,
  type ProductSummary,
  type ProductTreeNode,
  type TaskRunEvent,
  type TaskRunRecord,
  type TaskRunStage,
  type TaskRunStatus,
  type TaskAttachment,
  type TaskAttachmentStatus,
  type TaskListResponse,
  type TaskMetric,
  type TaskRecord,
  type TaskReviewDecision,
  type TaskReviewRecord,
  type TaskReviewResponse,
  type TaskStatus,
  type TaskSummary,
  type VersionSource,
  type WorkspaceAgentSettings,
  type OutputDocumentFormat,
  type WorkspaceOutputSettings,
  type MetricsOverview,
  type MetricValue,
  type EvaluationResultRecord,
  type ResearchSource,
  type ResearchSourceListResponse,
  type ResearchSourceSummary,
  type ResearchSourceTrust,
  type ResearchSourceType,
  type ResearchSourceVerification,
  type ApprovalRecord,
  type ApprovalStatus,
} from "./types";
import type { AgentAttachmentContext, ResearchInput } from "@/lib/agent/types";
import { getWorkspaceDatabase, type WorkspaceDatabase } from "./database";

export class WorkspaceNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkspaceNotFoundError";
  }
}

export class WorkspaceConflictError extends Error {
  constructor(message: string, readonly code = "VERSION_CONFLICT") {
    super(message);
    this.name = "WorkspaceConflictError";
  }
}

export class WorkspacePolicyError extends Error {
  constructor(readonly code: "POLICY_BLOCKED" | "APPROVAL_REQUIRED" | "BUDGET_EXCEEDED", message: string, readonly details?: Record<string, unknown>) {
    super(message);
    this.name = "WorkspacePolicyError";
  }
}

export class WorkspaceValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkspaceValidationError";
  }
}

type TaskRow = {
  id: string;
  product_id: string;
  product_name: string;
  title: string;
  type: TaskMode;
  status: TaskStatus;
  prompt: string;
  research_context: string;
  attachment_count: number;
  depth: RunDepth;
  autonomy: AutonomyLevel;
  budget_cents: number;
  cost_cents: number | null;
  document_count: number;
  created_at: string;
  updated_at: string;
};

type ProductRow = {
  id: string;
  name: string;
  description: string;
  task_count: number;
  document_count: number;
  updated_at: string;
};

type DocumentRow = {
  id: string;
  product_id: string;
  product_name: string;
  task_id: string;
  task_title: string;
  task_status: TaskStatus;
  format: DocumentFormat;
  owner: string;
  role: "primary" | "additional";
  title: string;
  content: string;
  current_revision: number;
  current_version_label: string;
  created_at: string;
  updated_at: string;
};

type VersionRow = {
  id: string;
  document_id: string;
  revision: number;
  label: string;
  alias: string | null;
  title: string;
  content: string;
  source: VersionSource;
  change_note: string | null;
  created_by: string;
  restored_from_id: string | null;
  created_at: string;
  metadata_revision: number;
  metadata_updated_at: string | null;
  metadata_updated_by: string | null;
};

type ResearchSourceRow = {
  id: string;
  task_id: string | null;
  run_id: string | null;
  task_title: string | null;
  title: string;
  publisher: string;
  type: ResearchSourceType;
  trust: ResearchSourceTrust;
  verification: ResearchSourceVerification;
  url: string;
  domain: string;
  excerpt: string | null;
  claim_type: "fact" | "inference" | "recommendation";
  freshness: string;
  citation_count: number;
  conflict_group: string | null;
  captured_at: string;
  verified_at: string | null;
  verified_by: string | null;
  verification_note: string | null;
  created_at: string;
  updated_at: string;
};

type TaskAttachmentRow = {
  id: string;
  task_id: string;
  file_name: string;
  media_type: string;
  byte_size: number;
  checksum: string;
  storage_path: string;
  status: TaskAttachmentStatus;
  uploaded_by: string;
  error_code: string | null;
  error_message: string | null;
  parsed_text: string | null;
  parse_started_at: string | null;
  parse_completed_at: string | null;
  created_at: string;
  updated_at: string;
};

type TaskRunRow = {
  id: string;
  task_id: string;
  status: TaskRunStatus;
  model: string | null;
  queue_job_id: string | null;
  worker_id: string | null;
  queued_at: string;
  started_at: string | null;
  completed_at: string | null;
  last_heartbeat_at: string | null;
  stage: TaskRunStage;
  stage_index: number;
  progress: number;
  current_action: string;
  current_query: string | null;
  current_url: string | null;
  current_source_title: string | null;
  visited_source_count: number;
  evidence_count: number;
  cancel_requested_at: string | null;
  failure_stage: TaskRunStage | null;
  error_code: string | null;
  error_message: string | null;
  response_json: string | null;
  cost_cents: number | null;
  requires_review: number;
  policy_version: string;
  policy_json: string;
  input_snapshot_hash: string;
  updated_at: string;
};

type ApprovalRow = {
  id: string;
  run_id: string;
  task_id: string;
  tool_name: string;
  target: string | null;
  parameter_hash: string;
  estimated_cost_cents: number | null;
  policy_version: string;
  status: ApprovalStatus;
  requested_at: string;
  resolved_at: string | null;
  resolved_by: string | null;
  note: string | null;
  revision: number;
  expires_at: string;
  consumed_at: string | null;
};

type RunMetricRow = {
  run_id: string;
  task_id: string;
  task_type: TaskMode;
  evaluation_version: string;
  input_snapshot_hash: string;
  policy_version: string;
  model: string | null;
  status: string;
  error_code: string | null;
  citations_returned: number;
  sources_persisted: number;
  fact_citation_coverage: number | null;
  unsupported_claim_rate: number | null;
  accepted_attachments: number;
  ready_attachments: number;
  artifact_count: number;
  duration_ms: number | null;
  cost_cents: number | null;
  budget_compliant: number;
  high_risk_calls: number;
  approved_high_risk_calls: number;
  progress_events: number;
  created_at: string;
};

type EvaluationResultRow = {
  id: string;
  case_id: string;
  evaluation_version: string;
  run_id: string | null;
  passed: number;
  task_type: TaskMode | null;
  model: string | null;
  source_count: number;
  citation_coverage: number | null;
  cost_cents: number | null;
  duration_ms: number | null;
  error_code: string | null;
  diff_summary: string | null;
  created_at: string;
};

type TaskReviewRow = {
  id: string;
  task_id: string;
  run_id: string | null;
  decision: TaskReviewDecision;
  note: string;
  reviewer: string;
  document_id: string | null;
  document_revision: number | null;
  created_at: string;
};

type TaskRunEventRow = {
  id: string;
  run_id: string;
  stage: TaskRunStage;
  type: TaskRunEvent["type"];
  action: string;
  detail: string;
  query: string | null;
  url: string | null;
  source_title: string | null;
  created_at: string;
};

export interface TaskFilters {
  query?: string;
  status?: TaskStatus;
  metric?: TaskMetric;
  productId?: string;
  now?: Date;
}

export interface DocumentFilters {
  query?: string;
  productId?: string;
  taskId?: string;
  format?: DocumentFormat;
}

export interface CreateTaskInput {
  productId: string;
  title: string;
  prompt: string;
  type: TaskMode;
  depth: RunDepth;
  autonomy: AutonomyLevel;
  budgetCents: number;
  researchInput?: ResearchInput;
}

export interface CreateTaskAttachmentInput {
  id?: string;
  taskId: string;
  fileName: string;
  mediaType: string;
  byteSize: number;
  checksum: string;
  storagePath: string;
  status: TaskAttachmentStatus;
  uploadedBy?: string;
  errorCode?: string | null;
  errorMessage?: string | null;
  parsedText?: string | null;
}

export interface CreateDocumentInput {
  taskId: string;
  title: string;
  content: string;
  format: DocumentFormat;
  owner?: string;
  source?: VersionSource;
  changeNote?: string;
  createdBy?: string;
}

export interface ResearchSourceFilters {
  query?: string;
  type?: ResearchSourceType;
  trust?: ResearchSourceTrust;
  verification?: ResearchSourceVerification;
  taskId?: string;
  sort?: "newest" | "oldest";
  now?: Date;
}

export interface CreateResearchSourceInput {
  title: string;
  type: ResearchSourceType;
  url: string;
  taskId?: string | null;
  verificationNote?: string;
}

export interface UpdateResearchSourceInput {
  title: string;
  type: ResearchSourceType;
  trust: ResearchSourceTrust;
  url: string;
  taskId?: string | null;
  baseUpdatedAt?: string;
}

export interface CreateApprovalInput {
  runId: string;
  toolName: string;
  target?: string | null;
  parameterHash?: string;
  estimatedCostCents?: number;
  expiresInMs?: number;
}

export interface ResolveApprovalInput {
  approvalId: string;
  baseRevision: number;
  status: Exclude<ApprovalStatus, "pending" | "expired">;
  note?: string;
  resolvedBy?: string;
}

const TASK_SELECT = `
  SELECT
    t.id,
    t.product_id,
    p.name AS product_name,
    t.title,
    t.type,
    t.status,
    t.prompt,
    t.research_context,
    t.depth,
    t.autonomy,
    t.budget_cents,
    t.cost_cents,
    COUNT(DISTINCT d.id) AS document_count,
    COUNT(DISTINCT a.id) AS attachment_count,
    t.created_at,
    t.updated_at
  FROM tasks t
  JOIN products p ON p.id = t.product_id
  LEFT JOIN documents d ON d.task_id = t.id
  LEFT JOIN task_attachments a ON a.task_id = t.id
`;

const DOCUMENT_SELECT = `
  SELECT
    d.id,
    p.id AS product_id,
    p.name AS product_name,
    t.id AS task_id,
    t.title AS task_title,
    t.status AS task_status,
    d.format,
    d.owner,
    d.role,
    v.title,
    v.content,
    v.revision AS current_revision,
    v.label AS current_version_label,
    d.created_at,
    d.updated_at
  FROM documents d
  JOIN tasks t ON t.id = d.task_id
  JOIN products p ON p.id = t.product_id
  JOIN document_versions v
    ON v.document_id = d.id
   AND v.revision = (SELECT MAX(v2.revision) FROM document_versions v2 WHERE v2.document_id = d.id)
`;

const RESEARCH_SOURCE_SELECT = `
  SELECT
    s.id,
    s.task_id,
    s.run_id,
    t.title AS task_title,
    s.title,
    s.publisher,
    s.type,
    s.trust,
    s.verification,
    s.url,
    s.domain,
    s.excerpt,
    s.claim_type,
    s.freshness,
    s.citation_count,
    s.conflict_group,
    s.captured_at,
    s.verified_at,
    s.verified_by,
    s.verification_note,
    s.created_at,
    s.updated_at
  FROM research_sources s
  LEFT JOIN tasks t ON t.id = s.task_id
`;

function toTask(row: TaskRow): TaskRecord {
  let researchInput: ResearchInput = {};
  try {
    const parsed = JSON.parse(row.research_context || "{}") as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) researchInput = parsed as ResearchInput;
  } catch {
    researchInput = {};
  }
  return {
    id: row.id,
    productId: row.product_id,
    productName: row.product_name,
    title: row.title,
    type: row.type,
    status: row.status,
    prompt: row.prompt,
    researchInput,
    attachmentCount: row.attachment_count ?? 0,
    depth: row.depth,
    autonomy: row.autonomy,
    budgetCents: row.budget_cents,
    costCents: row.cost_cents,
    documentCount: row.document_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toProduct(row: ProductRow): ProductSummary {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    taskCount: row.task_count,
    documentCount: row.document_count,
    updatedAt: row.updated_at,
  };
}

function markdownExcerpt(content: string): string {
  return content
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/[*_`>\-[\]()]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 140);
}

function toDocument(row: DocumentRow): DocumentSummary {
  return {
    id: row.id,
    productId: row.product_id,
    productName: row.product_name,
    taskId: row.task_id,
    taskTitle: row.task_title,
    taskStatus: row.task_status,
    format: row.format,
    owner: row.owner,
    role: row.role,
    title: row.title,
    excerpt: markdownExcerpt(row.content),
    currentRevision: row.current_revision,
    currentVersionLabel: row.current_version_label,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toVersion(row: VersionRow): DocumentVersion {
  return {
    id: row.id,
    documentId: row.document_id,
    revision: row.revision,
    label: row.label,
    alias: row.alias,
    title: row.title,
    content: row.content,
    source: row.source,
    changeNote: row.change_note,
    createdBy: row.created_by,
    restoredFromId: row.restored_from_id,
    createdAt: row.created_at,
    metadataRevision: row.metadata_revision,
    metadataUpdatedAt: row.metadata_updated_at,
    metadataUpdatedBy: row.metadata_updated_by,
  };
}

function toResearchSource(row: ResearchSourceRow): ResearchSource {
  return {
    id: row.id,
    taskId: row.task_id,
    runId: row.run_id,
    taskTitle: row.task_title,
    title: row.title,
    publisher: row.publisher,
    type: row.type,
    trust: row.trust,
    verification: row.verification,
    url: row.url,
    domain: row.domain,
    excerpt: row.excerpt,
    claimType: row.claim_type,
    freshness: row.freshness,
    citationCount: row.citation_count,
    conflictGroup: row.conflict_group,
    capturedAt: row.captured_at,
    verifiedAt: row.verified_at,
    verifiedBy: row.verified_by,
    verificationNote: row.verification_note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toTaskAttachment(row: TaskAttachmentRow): TaskAttachment {
  return {
    id: row.id,
    taskId: row.task_id,
    fileName: row.file_name,
    mediaType: row.media_type,
    byteSize: row.byte_size,
    checksum: row.checksum,
    status: row.status,
    uploadedBy: row.uploaded_by,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    parsedText: row.parsed_text,
    parseStartedAt: row.parse_started_at,
    parseCompletedAt: row.parse_completed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toTaskRunEvent(row: TaskRunEventRow): TaskRunEvent {
  return {
    id: row.id,
    runId: row.run_id,
    stage: row.stage,
    type: row.type,
    action: row.action,
    detail: row.detail,
    query: row.query,
    url: row.url,
    sourceTitle: row.source_title,
    createdAt: row.created_at,
  };
}

function toTaskRun(row: TaskRunRow, events: TaskRunEventRow[]): TaskRunRecord {
  return {
    id: row.id,
    taskId: row.task_id,
    status: row.status,
    model: row.model,
    queueJobId: row.queue_job_id,
    workerId: row.worker_id,
    queuedAt: row.queued_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    lastHeartbeatAt: row.last_heartbeat_at,
    stage: row.stage,
    stageIndex: row.stage_index,
    progress: row.progress,
    currentAction: row.current_action,
    currentQuery: row.current_query,
    currentUrl: row.current_url,
    currentSourceTitle: row.current_source_title,
    visitedSourceCount: row.visited_source_count,
    evidenceCount: row.evidence_count,
    cancelRequestedAt: row.cancel_requested_at,
    failureStage: row.failure_stage,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    responseJson: row.response_json,
    costCents: row.cost_cents,
    requiresReview: Boolean(row.requires_review),
    policyVersion: row.policy_version ?? "",
    policySnapshot: row.policy_json ?? "{}",
    inputSnapshotHash: row.input_snapshot_hash ?? "",
    updatedAt: row.updated_at,
    events: events.map(toTaskRunEvent),
  };
}

function toApproval(row: ApprovalRow): ApprovalRecord {
  return {
    id: row.id,
    runId: row.run_id,
    taskId: row.task_id,
    toolName: row.tool_name,
    target: row.target,
    parameterHash: row.parameter_hash,
    estimatedCostCents: row.estimated_cost_cents,
    policyVersion: row.policy_version,
    status: row.status,
    requestedAt: row.requested_at,
    resolvedAt: row.resolved_at,
    resolvedBy: row.resolved_by,
    note: row.note,
    revision: row.revision,
    expiresAt: row.expires_at,
    consumedAt: row.consumed_at,
  };
}

function toEvaluationResult(row: EvaluationResultRow): EvaluationResultRecord {
  return {
    id: row.id,
    caseId: row.case_id,
    evaluationVersion: row.evaluation_version,
    runId: row.run_id,
    passed: Boolean(row.passed),
    taskType: row.task_type,
    model: row.model,
    sourceCount: row.source_count,
    citationCoverage: row.citation_coverage,
    costCents: row.cost_cents,
    durationMs: row.duration_ms,
    errorCode: row.error_code,
    diffSummary: row.diff_summary,
    createdAt: row.created_at,
  };
}

function metricValue(
  numerator: number,
  denominator: number,
  unit: MetricValue["unit"],
  target: number,
  targetOperator: MetricValue["targetOperator"],
  valueOverride?: number | null,
  warning?: string,
): MetricValue {
  const value = valueOverride === undefined ? (denominator > 0 ? numerator / denominator : null) : valueOverride;
  const hasEnoughData = denominator > 0 && value !== null;
  const meetsTarget = value !== null && (targetOperator === ">=" ? value >= target : value <= target);
  return {
    value,
    unit,
    numerator,
    denominator,
    sampleSize: denominator,
    target,
    targetOperator,
    status: hasEnoughData ? (meetsTarget ? "pass" : "fail") : "insufficient_data",
    ...(hasEnoughData ? {} : { warning: warning ?? "样本不足，暂不计算该指标。" }),
  };
}

function approvalParameterHash(toolName: string, target: string | null, supplied?: string): string {
  if (supplied) return supplied.toLowerCase();
  return createHash("sha256").update(JSON.stringify({ toolName, target })).digest("hex");
}

function targetDomain(target: string | null | undefined): string | undefined {
  if (!target) return undefined;
  try {
    return new URL(target).hostname;
  } catch {
    // A non-URL target is still a valid opaque resource identifier. It is
    // checked by the tool policy only when it can be interpreted as a domain.
    return undefined;
  }
}

function toTaskReview(row: TaskReviewRow): TaskReviewRecord {
  return {
    id: row.id,
    taskId: row.task_id,
    runId: row.run_id,
    decision: row.decision,
    note: row.note,
    reviewer: row.reviewer,
    documentId: row.document_id,
    documentRevision: row.document_revision,
    createdAt: row.created_at,
  };
}

function shanghaiMonthBounds(now: Date): { start: string; end: string } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "numeric",
  }).formatToParts(now);
  const year = Number(parts.find((part) => part.type === "year")?.value);
  const month = Number(parts.find((part) => part.type === "month")?.value);
  const offsetMs = 8 * 60 * 60 * 1000;
  return {
    start: new Date(Date.UTC(year, month - 1, 1) - offsetMs).toISOString(),
    end: new Date(Date.UTC(year, month, 1) - offsetMs).toISOString(),
  };
}

function shanghaiWeekBounds(now: Date): { start: string; end: string } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).formatToParts(now);
  const year = Number(parts.find((part) => part.type === "year")?.value);
  const month = Number(parts.find((part) => part.type === "month")?.value);
  const day = Number(parts.find((part) => part.type === "day")?.value);
  const localDate = new Date(Date.UTC(year, month - 1, day));
  const daysSinceMonday = (localDate.getUTCDay() + 6) % 7;
  const offsetMs = 8 * 60 * 60 * 1000;
  return {
    start: new Date(localDate.getTime() - daysSinceMonday * 24 * 60 * 60 * 1000 - offsetMs).toISOString(),
    end: now.toISOString(),
  };
}

function sourceUrlDetails(value: string): { url: string; domain: string } {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error();
    return { url: parsed.toString(), domain: parsed.hostname };
  } catch {
    throw new WorkspaceValidationError("请输入以 http:// 或 https:// 开头的有效来源地址。");
  }
}

function inferResearchSourceType(title: string, url: string): ResearchSourceType {
  const haystack = `${title} ${url}`.toLowerCase();
  if (/官网|official|pricing|product|docs|.gov/.test(haystack)) return "官网";
  if (/report|报告|研究|白皮书|paper/.test(haystack)) return "报告";
  if (/review|评价|评论|知乎|reddit/.test(haystack)) return "用户评价";
  if (/data|数据|统计|iresearch|statista/.test(haystack)) return "数据平台";
  if (/news|新闻|36kr|媒体/.test(haystack)) return "新闻";
  return "其他";
}

function nextTimestamp(previous?: string): string {
  const minimum = previous ? Date.parse(previous) + 1 : 0;
  return new Date(Math.max(Date.now(), minimum)).toISOString();
}

function bumpVersionLabel(current: string): string {
  const match = /^v(\d+)\.(\d+)$/.exec(current);
  if (!match) return "v1.0";
  return `v${match[1]}.${Number(match[2]) + 1}`;
}

function defaultDocumentFormat(mode: TaskMode): DocumentFormat {
  if (mode === "market") return "research_report";
  if (mode === "competitor") return "competitor_report";
  if (mode === "insight") return "user_research";
  return "prd";
}

function defaultDocumentTitle(task: TaskRecord, output: string): string {
  const heading = output.match(/^#\s+(.+)$/m)?.[1]?.trim();
  return heading || `${task.title} ${DOCUMENT_FORMAT_LABELS[defaultDocumentFormat(task.type)]}`;
}

function parseOutputFormats(value: string | null | undefined): OutputDocumentFormat[] {
  try {
    const parsed = JSON.parse(value ?? "[]") as unknown;
    if (Array.isArray(parsed)) {
      const formats = parsed.filter((item): item is OutputDocumentFormat =>
        typeof item === "string" && (OUTPUT_DOCUMENT_FORMATS as readonly string[]).includes(item),
      );
      if (formats.length > 0) return [...new Set(formats)];
    }
  } catch {
    // Fall back to the stable defaults when an older or manually edited database has invalid JSON.
  }
  return ["markdown", "html", "docx", "pdf"];
}

function parseOutputFormat(value: string | null | undefined): OutputDocumentFormat {
  return typeof value === "string" && (OUTPUT_DOCUMENT_FORMATS as readonly string[]).includes(value)
    ? value as OutputDocumentFormat
    : "markdown";
}

export class WorkspaceRepository {
  constructor(private readonly database: WorkspaceDatabase = getWorkspaceDatabase()) {}

  getAgentSettings(): WorkspaceAgentSettings {
    const row = this.database
      .prepare("SELECT agent_mode, output_formats, default_output_format, updated_at FROM workspace_settings WHERE id = 'default'")
      .get() as { agent_mode: AgentModePreference; output_formats: string; default_output_format: OutputDocumentFormat; updated_at: string } | undefined;
    if (row) {
      return {
        modePreference: row.agent_mode,
        outputFormats: parseOutputFormats(row.output_formats),
        defaultOutputFormat: parseOutputFormat(row.default_output_format),
        updatedAt: row.updated_at,
      };
    }

    const now = new Date().toISOString();
    this.database
      .prepare("INSERT INTO workspace_settings(id, agent_mode, updated_at) VALUES ('default', 'auto', ?)")
      .run(now);
    return {
      modePreference: "auto",
      outputFormats: ["markdown", "html", "docx", "pdf"],
      defaultOutputFormat: "markdown",
      updatedAt: now,
    };
  }

  getOutputSettings(): WorkspaceOutputSettings {
    const settings = this.getAgentSettings();
    return {
      outputFormats: settings.outputFormats,
      defaultOutputFormat: settings.defaultOutputFormat,
      updatedAt: settings.updatedAt,
    };
  }

  setOutputSettings(input: { outputFormats: OutputDocumentFormat[]; defaultOutputFormat: OutputDocumentFormat }): WorkspaceOutputSettings {
    const now = new Date().toISOString();
    this.database
      .prepare(`
        INSERT INTO workspace_settings(id, agent_mode, output_formats, default_output_format, updated_at)
        VALUES ('default', 'auto', ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET output_formats = excluded.output_formats, default_output_format = excluded.default_output_format, updated_at = excluded.updated_at
      `)
      .run(JSON.stringify(input.outputFormats), input.defaultOutputFormat, now);
    return this.getOutputSettings();
  }

  setAgentModePreference(modePreference: AgentModePreference): WorkspaceAgentSettings {
    const now = new Date().toISOString();
    this.database
      .prepare(`
        INSERT INTO workspace_settings(id, agent_mode, updated_at)
        VALUES ('default', ?, ?)
        ON CONFLICT(id) DO UPDATE SET agent_mode = excluded.agent_mode, updated_at = excluded.updated_at
      `)
      .run(modePreference, now);
    return this.getAgentSettings();
  }

  listProducts(): ProductSummary[] {
    const rows = this.database
      .prepare(`
        SELECT
          p.id,
          p.name,
          p.description,
          COUNT(DISTINCT t.id) AS task_count,
          COUNT(DISTINCT d.id) AS document_count,
          MAX(p.updated_at, COALESCE(MAX(t.updated_at), p.updated_at), COALESCE(MAX(d.updated_at), p.updated_at)) AS updated_at
        FROM products p
        LEFT JOIN tasks t ON t.product_id = p.id
        LEFT JOIN documents d ON d.task_id = t.id
        GROUP BY p.id
        ORDER BY updated_at DESC, p.name ASC
      `)
      .all() as ProductRow[];
    return rows.map(toProduct);
  }

  getProductTree(): ProductTreeNode[] {
    return this.listProducts().map((product) => ({
      ...product,
      tasks: this.listTasks({ productId: product.id, metric: "all" }).items,
    }));
  }

  createProduct(name: string, description = ""): ProductSummary {
    const id = `product-${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    this.database
      .prepare("INSERT INTO products(id, name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
      .run(id, name, description, now, now);
    const product = this.listProducts().find((item) => item.id === id);
    if (!product) throw new WorkspaceNotFoundError("产品创建失败。");
    return product;
  }

  getResearchSourceSummary(now = new Date()): ResearchSourceSummary {
    const { start, end } = shanghaiWeekBounds(now);
    const row = this.database.prepare(`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN trust = 'high' THEN 1 ELSE 0 END) AS high,
        SUM(CASE WHEN captured_at >= ? AND captured_at <= ? THEN 1 ELSE 0 END) AS week,
        SUM(CASE WHEN verification = 'pending' THEN 1 ELSE 0 END) AS pending
      FROM research_sources
    `).get(start, end) as { total: number | null; high: number | null; week: number | null; pending: number | null };
    return {
      total: row.total ?? 0,
      high: row.high ?? 0,
      week: row.week ?? 0,
      pending: row.pending ?? 0,
    };
  }

  listResearchSources(filters: ResearchSourceFilters = {}): ResearchSourceListResponse {
    const conditions: string[] = [];
    const parameters: Array<string> = [];
    if (filters.type) {
      conditions.push("s.type = ?");
      parameters.push(filters.type);
    }
    if (filters.trust) {
      conditions.push("s.trust = ?");
      parameters.push(filters.trust);
    }
    if (filters.verification) {
      conditions.push("s.verification = ?");
      parameters.push(filters.verification);
    }
    if (filters.taskId) {
      conditions.push("s.task_id = ?");
      parameters.push(filters.taskId);
    }
    const query = filters.query?.trim();
    if (query) {
      const like = `%${query}%`;
      conditions.push("(s.title LIKE ? OR s.domain LIKE ? OR s.url LIKE ? OR COALESCE(t.title, '') LIKE ?)");
      parameters.push(like, like, like, like);
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const order = filters.sort === "oldest" ? "s.captured_at ASC, s.id ASC" : "s.captured_at DESC, s.id DESC";
    const rows = this.database.prepare(`${RESEARCH_SOURCE_SELECT} ${where} ORDER BY ${order}`).all(...parameters) as ResearchSourceRow[];
    return {
      items: rows.map(toResearchSource),
      summary: this.getResearchSourceSummary(filters.now ?? new Date()),
    };
  }

  getResearchSource(id: string): ResearchSource {
    const row = this.database.prepare(`${RESEARCH_SOURCE_SELECT} WHERE s.id = ?`).get(id) as ResearchSourceRow | undefined;
    if (!row) throw new WorkspaceNotFoundError("研究资料不存在。");
    return toResearchSource(row);
  }

  createResearchSource(input: CreateResearchSourceInput): ResearchSource {
    const { url, domain } = sourceUrlDetails(input.url);
    const taskId = input.taskId?.trim() || null;
    if (taskId && !this.database.prepare("SELECT id FROM tasks WHERE id = ?").get(taskId)) {
      throw new WorkspaceNotFoundError("所选来源任务不存在。");
    }
    const id = `source-${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    this.database.prepare(`
      INSERT INTO research_sources(
        id, task_id, title, type, trust, verification, url, domain, captured_at,
        verified_at, verified_by, verification_note, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'low', 'pending', ?, ?, ?, NULL, NULL, ?, ?, ?)
    `).run(id, taskId, input.title.trim(), input.type, url, domain, now, input.verificationNote?.trim() || null, now, now);
    return this.getResearchSource(id);
  }

  updateResearchSource(id: string, input: UpdateResearchSourceInput): ResearchSource {
    const current = this.getResearchSource(id);
    const { url, domain } = sourceUrlDetails(input.url);
    const taskId = input.taskId === undefined ? current.taskId : input.taskId?.trim() || null;
    if (taskId && !this.database.prepare("SELECT id FROM tasks WHERE id = ?").get(taskId)) {
      throw new WorkspaceNotFoundError("所选来源任务不存在。");
    }
    const expectedUpdatedAt = input.baseUpdatedAt ?? current.updatedAt;
    const now = nextTimestamp(expectedUpdatedAt);
    const changed = this.database.prepare(`
      UPDATE research_sources
      SET task_id = ?, title = ?, type = ?, trust = ?, url = ?, domain = ?, updated_at = ?
      WHERE id = ? AND updated_at = ?
    `).run(taskId, input.title.trim(), input.type, input.trust, url, domain, now, id, expectedUpdatedAt).changes;
    if (changed !== 1) throw new WorkspaceConflictError("资料已在其他位置更新，请刷新后再编辑。");
    return this.getResearchSource(id);
  }

  verifyResearchSource(id: string, trust: ResearchSourceTrust, note?: string, verifiedBy = "PM", baseUpdatedAt?: string): ResearchSource {
    const current = this.getResearchSource(id);
    if (current.verification !== "pending") throw new WorkspaceConflictError("该资料已经验证，可先重新验证再提交。");
    const expectedUpdatedAt = baseUpdatedAt ?? current.updatedAt;
    const now = nextTimestamp(expectedUpdatedAt);
    const changed = this.database.prepare(`
      UPDATE research_sources
      SET trust = ?, verification = 'verified', verified_at = ?, verified_by = ?, verification_note = ?, updated_at = ?
      WHERE id = ? AND verification = 'pending' AND updated_at = ?
    `).run(trust, now, verifiedBy, note?.trim() || null, now, id, expectedUpdatedAt).changes;
    if (changed !== 1) throw new WorkspaceConflictError("资料已在其他位置更新，请刷新后再验证。");
    return this.getResearchSource(id);
  }

  reopenResearchSource(id: string, baseUpdatedAt?: string): ResearchSource {
    const current = this.getResearchSource(id);
    if (current.verification !== "verified") throw new WorkspaceConflictError("该资料当前已经处于待验证状态。");
    const expectedUpdatedAt = baseUpdatedAt ?? current.updatedAt;
    const now = nextTimestamp(expectedUpdatedAt);
    const changed = this.database.prepare(`
      UPDATE research_sources
      SET verification = 'pending', verified_at = NULL, verified_by = NULL, updated_at = ?
      WHERE id = ? AND verification = 'verified' AND updated_at = ?
    `).run(now, id, expectedUpdatedAt).changes;
    if (changed !== 1) throw new WorkspaceConflictError("资料已在其他位置更新，请刷新后再重新验证。");
    return this.getResearchSource(id);
  }

  private persistRunSources(runId: string, response: AgentRunResponse, taskId: string, capturedAt: string): void {
    const candidates = new Map<string, { title: string; publisher: string; excerpt: string | null; cited: boolean; capturedAt: string }>();
    for (const source of response.evidence) {
      try {
        const { url } = sourceUrlDetails(source.url);
        const existing = candidates.get(url);
        candidates.set(url, {
          title: existing?.title || source.title || url,
          publisher: existing?.publisher || source.publisher || new URL(url).hostname,
          excerpt: existing?.excerpt || source.excerpt || null,
          cited: Boolean(existing?.cited || source.cited),
          capturedAt: source.capturedAt || capturedAt,
        });
      } catch {
        this.insertTaskRunEvent({
          runId,
          stage: "evidence",
          type: "error",
          action: "来源未入库",
          detail: `来源 URL 无效，已跳过：${source.url}`,
          url: source.url,
          sourceTitle: source.title,
          createdAt: capturedAt,
        });
      }
    }
    for (const citation of response.citations) {
      try {
        const { url } = sourceUrlDetails(citation.url);
        const existing = candidates.get(url);
        candidates.set(url, {
          title: existing?.title || citation.title || url,
          publisher: existing?.publisher || new URL(url).hostname,
          excerpt: existing?.excerpt || null,
          cited: true,
          capturedAt: existing?.capturedAt || capturedAt,
        });
      } catch {
        this.insertTaskRunEvent({
          runId,
          stage: "evidence",
          type: "error",
          action: "来源未入库",
          detail: `引用 URL 无效，已跳过：${citation.url}`,
          url: citation.url,
          sourceTitle: citation.title,
          createdAt: capturedAt,
        });
      }
    }

    for (const [url, source] of candidates) {
      const current = this.database.prepare("SELECT id, run_id, citation_count FROM research_sources WHERE task_id = ? AND url = ? ORDER BY created_at DESC LIMIT 1").get(taskId, url) as { id: string; run_id: string | null; citation_count: number } | undefined;
      const domain = new URL(url).hostname;
      if (current) {
        this.database.prepare(`
          UPDATE research_sources
          SET run_id = ?, title = ?, publisher = ?, excerpt = COALESCE(?, excerpt),
              captured_at = ?, citation_count = ? , updated_at = ?
          WHERE id = ?
        `).run(
          runId,
          source.title,
          source.publisher,
          source.excerpt,
          source.capturedAt,
          current.run_id === runId ? current.citation_count : current.citation_count + (source.cited ? 1 : 0),
          capturedAt,
          current.id,
        );
      } else {
        this.database.prepare(`
          INSERT INTO research_sources(
            id, task_id, run_id, title, publisher, type, trust, verification, url, domain,
            excerpt, claim_type, freshness, citation_count, conflict_group, captured_at,
            verified_at, verified_by, verification_note, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, 'low', 'pending', ?, ?, ?, 'fact', 'unknown', ?, NULL, ?, NULL, NULL, NULL, ?, ?)
        `).run(
          `source-${crypto.randomUUID()}`,
          taskId,
          runId,
          source.title,
          source.publisher,
          inferResearchSourceType(source.title, url),
          url,
          domain,
          source.excerpt,
          source.cited ? 1 : 0,
          source.capturedAt,
          source.capturedAt,
          capturedAt,
        );
      }
    }
  }

  getTaskSummary(now = new Date()): TaskSummary {
    const { start, end } = shanghaiMonthBounds(now);
    const row = this.database
      .prepare(`
        SELECT
          SUM(CASE WHEN created_at >= ? AND created_at < ? THEN 1 ELSE 0 END) AS month_count,
          SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END) AS running_count,
          SUM(CASE WHEN status = 'review' THEN 1 ELSE 0 END) AS review_count,
          SUM(CASE WHEN status = 'changes_requested' THEN 1 ELSE 0 END) AS changes_requested_count,
          SUM(CASE WHEN created_at >= ? AND created_at < ? THEN COALESCE(cost_cents, 0) ELSE 0 END) AS month_cost_cents
        FROM tasks
      `)
      .get(start, end, start, end) as {
      month_count: number | null;
      running_count: number | null;
      review_count: number | null;
      changes_requested_count: number | null;
      month_cost_cents: number | null;
    };
    return {
      monthCount: row.month_count ?? 0,
      runningCount: row.running_count ?? 0,
      reviewCount: row.review_count ?? 0,
      changesRequestedCount: row.changes_requested_count ?? 0,
      monthCostCents: row.month_cost_cents ?? 0,
    };
  }

  listTasks(filters: TaskFilters = {}): TaskListResponse {
    const conditions: string[] = [];
    const parameters: Array<string> = [];
    const metric = filters.metric ?? "all";
    const now = filters.now ?? new Date();

    if (filters.productId) {
      conditions.push("t.product_id = ?");
      parameters.push(filters.productId);
    }
    if (filters.status) {
      conditions.push("t.status = ?");
      parameters.push(filters.status);
    }
    if (metric === "month") {
      const { start, end } = shanghaiMonthBounds(now);
      conditions.push("t.created_at >= ? AND t.created_at < ?");
      parameters.push(start, end);
    } else if (metric === "running") {
      conditions.push("t.status = 'running'");
    } else if (metric === "review") {
      conditions.push("t.status = 'review'");
    } else if (metric === "changes_requested") {
      conditions.push("t.status = 'changes_requested'");
    }

    const query = filters.query?.trim();
    if (query) {
      const matchingMode = (Object.entries(TASK_TYPE_LABELS) as Array<[TaskMode, string]>).find(
        ([, label]) => label.includes(query) || query.includes(label),
      )?.[0];
      const like = `%${query}%`;
      conditions.push(
        matchingMode
          ? "(t.title LIKE ? OR t.id LIKE ? OR p.name LIKE ? OR t.type = ?)"
          : "(t.title LIKE ? OR t.id LIKE ? OR p.name LIKE ?)",
      );
      parameters.push(like, like, like);
      if (matchingMode) parameters.push(matchingMode);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const rows = this.database
      .prepare(`${TASK_SELECT} ${where} GROUP BY t.id ORDER BY t.created_at DESC, t.id DESC`)
      .all(...parameters) as TaskRow[];
    return { items: rows.map(toTask), summary: this.getTaskSummary(now) };
  }

  getTask(id: string): TaskRecord {
    const row = this.database
      .prepare(`${TASK_SELECT} WHERE t.id = ? GROUP BY t.id`)
      .get(id) as TaskRow | undefined;
    if (!row) throw new WorkspaceNotFoundError("任务不存在。");
    return toTask(row);
  }

  createTask(input: CreateTaskInput): TaskRecord {
    const created = this.database.transaction(() => {
      const product = this.database.prepare("SELECT id FROM products WHERE id = ?").get(input.productId);
      if (!product) throw new WorkspaceNotFoundError("所选产品不存在。");
      const sequence = this.database
        .prepare("SELECT COALESCE(MAX(CAST(SUBSTR(id, 6) AS INTEGER)), 0) + 1 AS next_id FROM tasks")
        .get() as { next_id: number };
      const id = `TASK-${String(sequence.next_id).padStart(4, "0")}`;
      const now = new Date().toISOString();
      this.database
        .prepare(`
          INSERT INTO tasks(id, product_id, title, type, status, prompt, research_context, depth, autonomy, budget_cents, cost_cents, created_at, updated_at)
          VALUES (?, ?, ?, ?, 'running', ?, ?, ?, ?, ?, NULL, ?, ?)
        `)
        .run(
          id,
          input.productId,
          input.title,
          input.type,
          input.prompt,
          JSON.stringify(input.researchInput ?? {}),
          input.depth,
          input.autonomy,
          input.budgetCents,
          now,
          now,
        );
      this.database.prepare("UPDATE products SET updated_at = ? WHERE id = ?").run(now, input.productId);
      return id;
    })();
    return this.getTask(created);
  }

  listTaskAttachments(taskId: string): TaskAttachment[] {
    this.getTask(taskId);
    return (this.database
      .prepare("SELECT * FROM task_attachments WHERE task_id = ? ORDER BY created_at ASC, id ASC")
      .all(taskId) as TaskAttachmentRow[]).map(toTaskAttachment);
  }

  createTaskAttachment(input: CreateTaskAttachmentInput): TaskAttachment {
    this.getTask(input.taskId);
    const existing = this.database
      .prepare("SELECT * FROM task_attachments WHERE task_id = ? AND checksum = ?")
      .get(input.taskId, input.checksum) as TaskAttachmentRow | undefined;
    if (existing) return toTaskAttachment(existing);
    const id = input.id ?? `attachment-${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    this.database.prepare(`
      INSERT INTO task_attachments(
        id, task_id, file_name, media_type, byte_size, checksum, storage_path,
        status, uploaded_by, error_code, error_message, parsed_text,
        parse_started_at, parse_completed_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.taskId,
      input.fileName,
      input.mediaType,
      input.byteSize,
      input.checksum,
      input.storagePath,
      input.status,
      input.uploadedBy ?? "local-user",
      input.errorCode ?? null,
      input.errorMessage ?? null,
      input.parsedText ?? null,
      input.status === "parsing" || input.status === "ready" || input.status === "failed" ? now : null,
      input.status === "ready" || input.status === "failed" ? now : null,
      now,
      now,
    );
    return this.getTaskAttachment(id);
  }

  getTaskAttachment(id: string): TaskAttachment {
    const row = this.database.prepare("SELECT * FROM task_attachments WHERE id = ?").get(id) as TaskAttachmentRow | undefined;
    if (!row) throw new WorkspaceNotFoundError("附件不存在。");
    return toTaskAttachment(row);
  }

  claimTaskAttachmentForParsing(taskId: string, id: string): TaskAttachment & { storagePath: string } {
    return this.database.transaction(() => {
      const row = this.database.prepare("SELECT * FROM task_attachments WHERE id = ? AND task_id = ?").get(id, taskId) as TaskAttachmentRow | undefined;
      if (!row) throw new WorkspaceNotFoundError("附件不存在或不属于该任务。");
      if (row.status === "ready") return { ...toTaskAttachment(row), storagePath: row.storage_path };
      if (row.status === "parsing") throw new WorkspaceConflictError("附件正在解析，请等待当前解析完成。", "ATTACHMENT_PARSE_IN_PROGRESS");
      if (row.status === "rejected") throw new WorkspaceConflictError("附件已被拒绝，不能继续解析。", "ATTACHMENT_REJECTED");
      const now = new Date().toISOString();
      const result = this.database.prepare(`
        UPDATE task_attachments
        SET status = 'parsing', error_code = NULL, error_message = NULL, parsed_text = NULL,
            parse_started_at = ?, parse_completed_at = NULL, updated_at = ?
        WHERE id = ? AND task_id = ? AND status IN ('uploaded', 'failed')
      `).run(now, now, id, taskId);
      if (result.changes !== 1) throw new WorkspaceConflictError("附件状态已变化，请刷新后重试。", "ATTACHMENT_STATE_CONFLICT");
      const updated = this.database.prepare("SELECT * FROM task_attachments WHERE id = ?").get(id) as TaskAttachmentRow;
      return { ...toTaskAttachment(updated), storagePath: updated.storage_path };
    })();
  }

  completeTaskAttachmentParsing(taskId: string, id: string, parsedText: string): TaskAttachment {
    const now = new Date().toISOString();
    const result = this.database.prepare(`
      UPDATE task_attachments
      SET status = 'ready', parsed_text = ?, error_code = NULL, error_message = NULL,
          parse_completed_at = ?, updated_at = ?
      WHERE id = ? AND task_id = ? AND status = 'parsing'
    `).run(parsedText, now, now, id, taskId);
    if (result.changes !== 1) throw new WorkspaceConflictError("附件解析结果无法写入，状态已被其他请求修改。", "ATTACHMENT_STATE_CONFLICT");
    return this.getTaskAttachment(id);
  }

  failTaskAttachmentParsing(taskId: string, id: string, code: string, message: string): TaskAttachment {
    const now = new Date().toISOString();
    const result = this.database.prepare(`
      UPDATE task_attachments
      SET status = 'failed', parsed_text = NULL, error_code = ?, error_message = ?,
          parse_completed_at = ?, updated_at = ?
      WHERE id = ? AND task_id = ? AND status = 'parsing'
    `).run(code, message, now, now, id, taskId);
    if (result.changes !== 1) throw new WorkspaceConflictError("附件失败状态无法写入，状态已被其他请求修改。", "ATTACHMENT_STATE_CONFLICT");
    return this.getTaskAttachment(id);
  }

  deleteTaskAttachment(taskId: string, id: string): { attachment: TaskAttachment; storagePath: string } {
    return this.database.transaction(() => {
      const row = this.database.prepare("SELECT * FROM task_attachments WHERE id = ? AND task_id = ?").get(id, taskId) as TaskAttachmentRow | undefined;
      if (!row) throw new WorkspaceNotFoundError("附件不存在或不属于该任务。");
      if (row.status === "parsing") throw new WorkspaceConflictError("附件正在解析，完成后才能移除。", "ATTACHMENT_PARSE_IN_PROGRESS");
      const result = this.database.prepare("DELETE FROM task_attachments WHERE id = ? AND task_id = ? AND status != 'parsing'").run(id, taskId);
      if (result.changes !== 1) throw new WorkspaceConflictError("附件状态已变化，请刷新后重试。", "ATTACHMENT_STATE_CONFLICT");
      return { attachment: toTaskAttachment(row), storagePath: row.storage_path };
    })();
  }

  getAgentAttachmentContext(taskId: string): AgentAttachmentContext[] {
    return this.listTaskAttachments(taskId)
      .filter((attachment) => attachment.status === "ready" && Boolean(attachment.parsedText))
      .map((attachment) => ({
        id: attachment.id,
        fileName: attachment.fileName,
        mediaType: attachment.mediaType,
        text: attachment.parsedText ?? "",
        createdAt: attachment.createdAt,
      }));
  }

  listDocuments(filters: DocumentFilters = {}): DocumentSummary[] {
    const conditions: string[] = [];
    const parameters: string[] = [];
    if (filters.productId) {
      conditions.push("p.id = ?");
      parameters.push(filters.productId);
    }
    if (filters.taskId) {
      conditions.push("t.id = ?");
      parameters.push(filters.taskId);
    }
    if (filters.format) {
      conditions.push("d.format = ?");
      parameters.push(filters.format);
    }
    if (filters.query?.trim()) {
      const like = `%${filters.query.trim()}%`;
      conditions.push("(v.title LIKE ? OR v.content LIKE ? OR t.title LIKE ?)");
      parameters.push(like, like, like);
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const rows = this.database
      .prepare(`${DOCUMENT_SELECT} ${where} ORDER BY d.updated_at DESC, v.title ASC`)
      .all(...parameters) as DocumentRow[];
    return rows.map(toDocument);
  }

  getDocument(id: string): DocumentDetail {
    const row = this.database
      .prepare(`${DOCUMENT_SELECT} WHERE d.id = ?`)
      .get(id) as DocumentRow | undefined;
    if (!row) throw new WorkspaceNotFoundError("文档不存在。");
    const versions = (this.database
      .prepare("SELECT * FROM document_versions WHERE document_id = ? ORDER BY revision DESC")
      .all(id) as VersionRow[]).map(toVersion);
    const currentVersion = versions[0];
    if (!currentVersion) throw new WorkspaceNotFoundError("文档没有可用版本。");
    return { ...toDocument(row), currentVersion, versions };
  }

  getPrimaryDocument(taskId: string): DocumentDetail | null {
    const row = this.database.prepare("SELECT id FROM documents WHERE task_id = ? AND role = 'primary' ORDER BY updated_at DESC LIMIT 1").get(taskId) as { id: string } | undefined;
    return row ? this.getDocument(row.id) : null;
  }

  createDocument(input: CreateDocumentInput): DocumentDetail {
    const id = `document-${crypto.randomUUID()}`;
    const versionId = `version-${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    this.database.transaction(() => {
      const task = this.getTask(input.taskId);
      this.database
        .prepare("INSERT INTO documents(id, task_id, format, owner, role, created_at, updated_at) VALUES (?, ?, ?, ?, 'additional', ?, ?)")
        .run(id, input.taskId, input.format, input.owner ?? "PM", now, now);
      this.database
        .prepare(`
          INSERT INTO document_versions(id, document_id, revision, label, title, content, source, change_note, created_by, restored_from_id, created_at)
          VALUES (?, ?, 1, 'v1.0', ?, ?, ?, ?, ?, NULL, ?)
        `)
        .run(
          versionId,
          id,
          input.title,
          input.content,
          input.source ?? "manual",
          input.changeNote?.trim() || "创建文档",
          input.createdBy ?? input.owner ?? "PM",
          now,
        );
      this.touchHierarchy(task, now);
    })();
    return this.getDocument(id);
  }

  saveDocumentVersion(input: {
    documentId: string;
    baseRevision: number;
    title: string;
    content: string;
    changeNote?: string;
    createdBy?: string;
    source?: VersionSource;
  }): DocumentDetail {
    this.database.transaction(() => {
      const document = this.getDocument(input.documentId);
      if (document.currentRevision !== input.baseRevision) {
        throw new WorkspaceConflictError("文档已在其他位置更新，请刷新后再保存。");
      }
      const now = new Date().toISOString();
      this.insertVersion({
        documentId: input.documentId,
        revision: document.currentRevision + 1,
        label: bumpVersionLabel(document.currentVersionLabel),
        title: input.title,
        content: input.content,
        source: input.source ?? "manual",
        changeNote: input.changeNote?.trim() || "保存编辑",
        createdBy: input.createdBy ?? "PM",
        restoredFromId: null,
        createdAt: now,
      });
      this.database.prepare("UPDATE documents SET updated_at = ? WHERE id = ?").run(now, input.documentId);
      this.touchHierarchy(this.getTask(document.taskId), now);
    })();
    return this.getDocument(input.documentId);
  }

  updateDocumentVersionMetadata(input: {
    documentId: string;
    versionId: string;
    baseMetadataRevision: number;
    alias: string | null;
    changeNote: string | null;
    updatedBy?: string;
  }): DocumentDetail {
    this.database.transaction(() => {
      this.getDocument(input.documentId);
      const version = this.database
        .prepare("SELECT metadata_revision FROM document_versions WHERE id = ? AND document_id = ?")
        .get(input.versionId, input.documentId) as { metadata_revision: number } | undefined;
      if (!version) throw new WorkspaceNotFoundError("要管理的文档版本不存在。");
      if (version.metadata_revision !== input.baseMetadataRevision) {
        throw new WorkspaceConflictError("版本信息已在其他位置更新，请刷新后再保存。");
      }
      const now = new Date().toISOString();
      const result = this.database
        .prepare(`
          UPDATE document_versions
          SET alias = ?, change_note = ?, metadata_revision = metadata_revision + 1,
              metadata_updated_at = ?, metadata_updated_by = ?
          WHERE id = ? AND document_id = ? AND metadata_revision = ?
        `)
        .run(
          input.alias?.trim() || null,
          input.changeNote?.trim() || null,
          now,
          input.updatedBy ?? "PM",
          input.versionId,
          input.documentId,
          input.baseMetadataRevision,
        );
      if (result.changes !== 1) throw new WorkspaceConflictError("版本信息已在其他位置更新，请刷新后再保存。");
    })();
    return this.getDocument(input.documentId);
  }

  restoreDocumentVersion(input: {
    documentId: string;
    versionId: string;
    baseRevision: number;
    createdBy?: string;
  }): DocumentDetail {
    this.database.transaction(() => {
      const document = this.getDocument(input.documentId);
      if (document.currentRevision !== input.baseRevision) {
        throw new WorkspaceConflictError("文档已在其他位置更新，请刷新后再恢复。");
      }
      const source = document.versions.find((version) => version.id === input.versionId);
      if (!source) throw new WorkspaceNotFoundError("要恢复的历史版本不存在。");
      const now = new Date().toISOString();
      this.insertVersion({
        documentId: input.documentId,
        revision: document.currentRevision + 1,
        label: bumpVersionLabel(document.currentVersionLabel),
        title: source.title,
        content: source.content,
        source: "restore",
        changeNote: `从 ${source.label} 恢复`,
        createdBy: input.createdBy ?? "PM",
        restoredFromId: source.id,
        createdAt: now,
      });
      this.database.prepare("UPDATE documents SET updated_at = ? WHERE id = ?").run(now, input.documentId);
      this.touchHierarchy(this.getTask(document.taskId), now);
    })();
    return this.getDocument(input.documentId);
  }

  createTaskRun(taskId: string, model: string | null = null): TaskRunRecord {
    const task = this.getTask(taskId);
    const active = this.database
      .prepare("SELECT id FROM task_runs WHERE task_id = ? AND status IN ('queued', 'running') ORDER BY queued_at DESC LIMIT 1")
      .get(taskId) as { id: string } | undefined;
    if (active) throw new WorkspaceConflictError(`任务已有运行中的执行记录：${active.id}`);
    const latest = this.database
      .prepare("SELECT requires_review FROM task_runs WHERE task_id = ? ORDER BY queued_at DESC, id DESC LIMIT 1")
      .get(taskId) as { requires_review: number } | undefined;
    const runId = `run-${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    const policy = buildAgentPolicy(task.autonomy, {
      allowedDomains: task.researchInput.allowedDomains,
      budgetCents: task.budgetCents,
    });
    const inputSnapshotHash = createHash("sha256").update(JSON.stringify({
      taskId: task.id,
      prompt: task.prompt,
      type: task.type,
      depth: task.depth,
      autonomy: task.autonomy,
      budgetCents: task.budgetCents,
      researchInput: task.researchInput,
      attachments: this.getAgentAttachmentContext(task.id).map((attachment) => ({ id: attachment.id, fileName: attachment.fileName, createdAt: attachment.createdAt })),
    })).digest("hex");
    const requiresReview = task.status === "review"
      || task.status === "changes_requested"
      || (task.status === "failed" || task.status === "cancelled") && Boolean(latest?.requires_review);
    this.database.transaction(() => {
      this.database.prepare(`
        INSERT INTO task_runs(
          id, task_id, status, model, queued_at, stage, stage_index, progress, current_action, requires_review,
          policy_version, policy_json, input_snapshot_hash, updated_at
        ) VALUES (?, ?, 'queued', ?, ?, 'queued', 0, 0, '等待 Worker 接手', ?, ?, ?, ?, ?)
      `).run(runId, taskId, model, now, requiresReview ? 1 : 0, policy.version, JSON.stringify(policy), inputSnapshotHash, now);
      this.insertTaskRunEvent({
        runId,
        stage: "queued",
        type: "status",
        action: "任务已加入执行队列",
        detail: "等待可用 Worker 接手。",
        createdAt: now,
      });
      this.database.prepare("UPDATE tasks SET status = 'running', updated_at = ? WHERE id = ?").run(now, taskId);
      this.database.prepare("UPDATE products SET updated_at = ? WHERE id = ?").run(now, task.productId);
    })();
    return this.getTaskRun(runId);
  }

  private upsertRunMetrics(run: TaskRunRecord, task: TaskRecord, response?: AgentRunResponse): void {
    const citationsReturned = response?.citations?.length ?? 0;
    const sourcesPersisted = this.database.prepare("SELECT COUNT(*) AS count FROM research_sources WHERE task_id = ? AND run_id = ?").get(task.id, run.id) as { count: number };
    const attachmentCounts = this.database.prepare(`
      SELECT COUNT(CASE WHEN status IN ('uploaded', 'parsing', 'ready', 'failed') THEN 1 END) AS accepted,
             COUNT(CASE WHEN status = 'ready' THEN 1 END) AS ready
      FROM task_attachments WHERE task_id = ?
    `).get(task.id) as { accepted: number; ready: number };
    const artifactCount = this.database.prepare("SELECT COUNT(*) AS count FROM documents WHERE task_id = ?").get(task.id) as { count: number };
    const approvalCounts = this.database.prepare(`
      SELECT COUNT(*) AS total, COUNT(CASE WHEN status = 'approved' OR consumed_at IS NOT NULL THEN 1 END) AS approved
      FROM approvals WHERE run_id = ? AND tool_name IN ('external_write', 'send_message', 'publish', 'delete', 'payment', 'upload_sensitive')
    `).get(run.id) as { total: number; approved: number };
    const eventCount = this.database.prepare("SELECT COUNT(*) AS count FROM task_run_events WHERE run_id = ?").get(run.id) as { count: number };
    const durationMs = run.startedAt && run.completedAt ? Math.max(0, Date.parse(run.completedAt) - Date.parse(run.startedAt)) : null;
    const budgetCompliant = response?.budget ? response.budget.status !== "exceeded" : run.errorCode !== "BUDGET_EXCEEDED";
    this.database.prepare(`
      INSERT INTO run_metrics(
        id, run_id, task_id, task_type, evaluation_version, input_snapshot_hash, policy_version, model,
        status, error_code, citations_returned, sources_persisted, fact_citation_coverage,
        unsupported_claim_rate, accepted_attachments, ready_attachments, artifact_count, duration_ms,
        cost_cents, budget_compliant, high_risk_calls, approved_high_risk_calls, progress_events, created_at
      ) VALUES (?, ?, ?, ?, 'goal-standard-1.0', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(run_id) DO UPDATE SET
        status = excluded.status, error_code = excluded.error_code, citations_returned = excluded.citations_returned,
        sources_persisted = excluded.sources_persisted, fact_citation_coverage = excluded.fact_citation_coverage,
        unsupported_claim_rate = excluded.unsupported_claim_rate, accepted_attachments = excluded.accepted_attachments,
        ready_attachments = excluded.ready_attachments, artifact_count = excluded.artifact_count,
        duration_ms = excluded.duration_ms, cost_cents = excluded.cost_cents, budget_compliant = excluded.budget_compliant,
        high_risk_calls = excluded.high_risk_calls, approved_high_risk_calls = excluded.approved_high_risk_calls,
        progress_events = excluded.progress_events
    `).run(
      `metric-${run.id}`,
      run.id,
      task.id,
      task.type,
      run.inputSnapshotHash,
      run.policyVersion,
      run.model,
      run.status,
      run.errorCode,
      citationsReturned,
      sourcesPersisted.count,
      response?.quality?.factCitationCoverage ?? null,
      null,
      attachmentCounts.accepted ?? 0,
      attachmentCounts.ready ?? 0,
      artifactCount.count ?? 0,
      durationMs,
      run.costCents,
      budgetCompliant ? 1 : 0,
      approvalCounts.total ?? 0,
      approvalCounts.approved ?? 0,
      eventCount.count ?? 0,
      run.completedAt ?? run.updatedAt,
    );
  }

  recordRunMetrics(runId: string): void {
    const run = this.getTaskRun(runId);
    const task = this.getTask(run.taskId);
    let response: AgentRunResponse | undefined;
    if (run.responseJson) {
      try { response = JSON.parse(run.responseJson) as AgentRunResponse; } catch { response = undefined; }
    }
    this.upsertRunMetrics(run, task, response);
  }

  recordEvaluationResult(input: {
    caseId: string;
    evaluationVersion?: string;
    runId?: string | null;
    passed: boolean;
    taskType?: TaskMode | null;
    model?: string | null;
    sourceCount?: number;
    citationCoverage?: number | null;
    costCents?: number | null;
    durationMs?: number | null;
    errorCode?: string | null;
    diffSummary?: string | null;
  }): EvaluationResultRecord {
    const id = `eval-${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    this.database.prepare(`
      INSERT INTO evaluation_results(
        id, case_id, evaluation_version, run_id, passed, task_type, model, source_count,
        citation_coverage, cost_cents, duration_ms, error_code, diff_summary, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.caseId,
      input.evaluationVersion ?? "goal-standard-1.0",
      input.runId ?? null,
      input.passed ? 1 : 0,
      input.taskType ?? null,
      input.model ?? null,
      input.sourceCount ?? 0,
      input.citationCoverage ?? null,
      input.costCents ?? null,
      input.durationMs ?? null,
      input.errorCode ?? null,
      input.diffSummary ?? null,
      now,
    );
    return toEvaluationResult(this.database.prepare("SELECT * FROM evaluation_results WHERE id = ?").get(id) as EvaluationResultRow);
  }

  listEvaluationResults(filters: { from?: string; to?: string; evaluationVersion?: string } = {}): EvaluationResultRecord[] {
    const conditions = ["created_at >= ?", "created_at <= ?"];
    const values: string[] = [filters.from ?? "0000-01-01T00:00:00.000Z", filters.to ?? "9999-12-31T23:59:59.999Z"];
    if (filters.evaluationVersion) { conditions.push("evaluation_version = ?"); values.push(filters.evaluationVersion); }
    return (this.database.prepare(`SELECT * FROM evaluation_results WHERE ${conditions.join(" AND ")} ORDER BY created_at DESC, rowid DESC`).all(...values) as EvaluationResultRow[]).map(toEvaluationResult);
  }

  getMetricsOverview(filters: { from?: string; to?: string; taskType?: TaskMode } = {}): MetricsOverview {
    const now = new Date();
    const defaultFrom = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
    const from = filters.from ?? defaultFrom;
    const to = filters.to ?? now.toISOString();
    const conditions = ["created_at >= ?", "created_at <= ?"];
    const values: string[] = [from, to];
    if (filters.taskType) { conditions.push("task_type = ?"); values.push(filters.taskType); }
    const runConditions = ["r.status IN ('completed', 'failed', 'cancelled')", "COALESCE(r.completed_at, r.updated_at) >= ?", "COALESCE(r.completed_at, r.updated_at) <= ?"];
    const runValues: string[] = [from, to];
    if (filters.taskType) { runConditions.push("t.type = ?"); runValues.push(filters.taskType); }
    const missingMetrics = this.database.prepare(`
      SELECT r.id FROM task_runs r JOIN tasks t ON t.id = r.task_id
      WHERE ${runConditions.join(" AND ")}
        AND NOT EXISTS (SELECT 1 FROM run_metrics m WHERE m.run_id = r.id)
    `).all(...runValues) as Array<{ id: string }>;
    missingMetrics.forEach(({ id }) => this.recordRunMetrics(id));
    const rows = this.database.prepare(`SELECT * FROM run_metrics WHERE ${conditions.join(" AND ")} ORDER BY created_at ASC`).all(...values) as RunMetricRow[];
    const metrics: Record<string, MetricValue> = {};
    const terminal = rows.filter((row) => ["completed", "failed"].includes(row.status) && !["CANCELLED", "QUEUE_UNAVAILABLE"].includes(row.error_code ?? ""));
    const successful = terminal.filter((row) => row.status === "completed").length;
    metrics.taskSuccessRate = metricValue(successful, terminal.length, "ratio", 0.8, ">=");
    const sourceRows = rows.filter((row) => row.citations_returned > 0);
    metrics.sourceIngestCompleteness = metricValue(sourceRows.reduce((sum, row) => sum + Math.min(row.citations_returned, row.sources_persisted), 0), sourceRows.reduce((sum, row) => sum + row.citations_returned, 0), "ratio", 0.99, ">=");
    const coverageRows = rows.filter((row) => row.fact_citation_coverage !== null);
    const coverageAverage = coverageRows.length ? coverageRows.reduce((sum, row) => sum + (row.fact_citation_coverage ?? 0), 0) / coverageRows.length : null;
    metrics.factCitationCoverage = metricValue(coverageRows.reduce((sum, row) => sum + (row.fact_citation_coverage ?? 0), 0), coverageRows.length, "ratio", 0.9, ">=", coverageAverage);
    const unsupportedRows = rows.filter((row) => row.unsupported_claim_rate !== null);
    const unsupportedAverage = unsupportedRows.length ? unsupportedRows.reduce((sum, row) => sum + (row.unsupported_claim_rate ?? 0), 0) / unsupportedRows.length : null;
    metrics.unsupportedClaimRate = metricValue(unsupportedRows.reduce((sum, row) => sum + (row.unsupported_claim_rate ?? 0), 0), unsupportedRows.length, "ratio", 0.05, "<=", unsupportedAverage);
    const accepted = rows.reduce((sum, row) => sum + row.accepted_attachments, 0);
    const ready = rows.reduce((sum, row) => sum + row.ready_attachments, 0);
    metrics.attachmentParseSuccess = metricValue(ready, accepted, "ratio", 0.99, ">=");
    const completedRows = rows.filter((row) => row.status === "completed");
    metrics.artifactGenerationSuccess = metricValue(completedRows.filter((row) => row.artifact_count > 0).length, completedRows.length, "ratio", 0.98, ">=");
    const durations = completedRows.map((row) => row.duration_ms).filter((value): value is number => value !== null).sort((a, b) => a - b);
    const medianMs = durations.length ? durations[Math.floor((durations.length - 1) / 2)] : null;
    metrics.standardTaskP50Latency = metricValue(durations.length, durations.length, "seconds", 180, "<=", medianMs === null ? null : medianMs / 1000);
    const billed = rows.filter((row) => row.cost_cents !== null);
    metrics.budgetCompliance = metricValue(billed.filter((row) => row.budget_compliant === 1).length, billed.length, "ratio", 1, ">=");
    const highRisk = rows.reduce((sum, row) => sum + row.high_risk_calls, 0);
    const approvedHighRisk = rows.reduce((sum, row) => sum + row.approved_high_risk_calls, 0);
    metrics.approvalLeakRate = metricValue(Math.max(0, highRisk - approvedHighRisk), highRisk, "ratio", 0, "<=");
    metrics.progressFreshness = metricValue(0, 0, "seconds", 2, "<=", null, "当前版本只持久化服务端事件，尚未采集浏览器展示时间。");
    const evaluationHistory = this.listEvaluationResults({ from, to });
    const evaluationVersion = evaluationHistory[0]?.evaluationVersion ?? "none";
    const seenCaseIds = new Set<string>();
    const evaluations = evaluationHistory.filter((result) => {
      if (result.evaluationVersion !== evaluationVersion || seenCaseIds.has(result.caseId)) return false;
      seenCaseIds.add(result.caseId);
      return true;
    });
    metrics.evaluationPassRate = metricValue(evaluations.filter((result) => result.passed).length, evaluations.length, "ratio", 0.9, ">=");
    const integrityWarnings: string[] = [];
    if (rows.some((row) => ["completed", "failed", "cancelled"].includes(row.status) && !row.input_snapshot_hash)) integrityWarnings.push("存在缺少输入快照哈希的历史运行。");
    if (rows.length === 0) integrityWarnings.push("当前时间范围没有可用于计算的运行遥测。");
    return { metricDefinitionVersion: "goal-standard-1.2", evaluationVersion, from, to, taskType: filters.taskType ?? null, metrics, integrityWarnings };
  }

  listApprovals(runId: string): ApprovalRecord[] {
    this.getTaskRun(runId);
    const now = new Date().toISOString();
    const expired = this.database.prepare("SELECT id FROM approvals WHERE run_id = ? AND status = 'pending' AND expires_at <= ?").all(runId, now) as Array<{ id: string }>;
    if (expired.length) {
      this.database.transaction(() => {
        expired.forEach(({ id }) => {
          const changed = this.database.prepare(`
            UPDATE approvals
            SET status = 'expired', resolved_at = ?, resolved_by = 'system', note = COALESCE(note, '审批已过期。'), revision = revision + 1
            WHERE id = ? AND status = 'pending'
          `).run(now, id).changes;
          if (changed) this.insertTaskRunEvent({ runId, stage: "planning", type: "status", action: "审批已过期", detail: `审批 ${id} 已超过有效期。`, createdAt: now });
        });
      })();
    }
    return (this.database
      .prepare("SELECT * FROM approvals WHERE run_id = ? ORDER BY requested_at DESC, id DESC")
      .all(runId) as ApprovalRow[]).map(toApproval);
  }

  getApproval(id: string): ApprovalRecord {
    const row = this.database.prepare("SELECT * FROM approvals WHERE id = ?").get(id) as ApprovalRow | undefined;
    if (!row) throw new WorkspaceNotFoundError("审批请求不存在。");
    if (row.status === "pending" && row.expires_at <= new Date().toISOString()) {
      const now = new Date().toISOString();
      const changed = this.database.prepare(`
        UPDATE approvals SET status = 'expired', resolved_at = ?, resolved_by = 'system',
        note = COALESCE(note, '审批已过期。'), revision = revision + 1
      WHERE id = ? AND status = 'pending'
      `).run(now, id).changes;
      if (changed) this.insertTaskRunEvent({ runId: row.run_id, stage: "planning", type: "status", action: "审批已过期", detail: `审批 ${id} 已超过有效期。`, createdAt: now });
      return this.getApproval(id);
    }
    return toApproval(row);
  }

  createApprovalRequest(input: CreateApprovalInput): ApprovalRecord {
    const run = this.getTaskRun(input.runId);
    const task = this.getTask(run.taskId);
    if (!["queued", "running"].includes(run.status)) {
      throw new WorkspaceConflictError("任务运行已经结束，不能新增审批请求。", "RUN_NOT_ACTIVE");
    }
    const toolName = input.toolName.trim();
    const target = input.target?.trim() || null;
    const parameterHash = approvalParameterHash(toolName, target, input.parameterHash);
    const policy = this.policyForRun(run, task);
    let decision: ReturnType<typeof evaluateToolCall>;
    try {
      decision = evaluateToolCall(policy, toolName, {
        targetDomain: targetDomain(target),
        estimatedCostCents: input.estimatedCostCents,
      });
    } catch {
      decision = "blocked";
    }
    if (decision === "blocked") {
      const code = input.estimatedCostCents !== undefined && input.estimatedCostCents > policy.budgetCents
        ? "BUDGET_EXCEEDED"
        : "POLICY_BLOCKED";
      throw new WorkspacePolicyError(code, code === "BUDGET_EXCEEDED" ? "工具预计费用超过当前预算。" : "当前自治级别或域名策略不允许该工具。", { toolName, target });
    }
    if (decision !== "approval_required") {
      throw new WorkspaceValidationError("该工具无需审批，可以直接执行。 ");
    }
    const existing = this.database.prepare(`
      SELECT * FROM approvals
      WHERE run_id = ? AND tool_name = ? AND target IS ? AND parameter_hash = ?
        AND policy_version = ? AND status = 'pending' AND expires_at > ?
      ORDER BY requested_at DESC LIMIT 1
    `).get(run.id, toolName, target, parameterHash, policy.version, new Date().toISOString()) as ApprovalRow | undefined;
    if (existing) return toApproval(existing);
    const now = new Date().toISOString();
    const expiresAt = new Date(Date.now() + Math.min(Math.max(input.expiresInMs ?? 15 * 60_000, 30_000), 24 * 60 * 60_000)).toISOString();
    const id = `approval-${crypto.randomUUID()}`;
    this.database.transaction(() => {
      this.database.prepare(`
        INSERT INTO approvals(
          id, run_id, task_id, tool_name, target, parameter_hash, estimated_cost_cents,
          policy_version, status, requested_at, resolved_at, resolved_by, note, revision, expires_at, consumed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, NULL, NULL, NULL, 1, ?, NULL)
      `).run(id, run.id, task.id, toolName, target, parameterHash, input.estimatedCostCents ?? null, policy.version, now, expiresAt);
      this.insertTaskRunEvent({
        runId: run.id,
        stage: run.stage,
        type: "tool",
        action: "等待人工审批",
        detail: `工具 ${toolName} 需要批准后才能执行。`,
        url: target?.startsWith("http") ? target : undefined,
        createdAt: now,
      });
    })();
    return this.getApproval(id);
  }

  resolveApproval(input: ResolveApprovalInput): ApprovalRecord {
    const approval = this.getApproval(input.approvalId);
    if (approval.status !== "pending") {
      throw new WorkspaceConflictError("该审批请求已经处理，不能重复操作。", "APPROVAL_ALREADY_RESOLVED");
    }
    if (approval.revision !== input.baseRevision) {
      throw new WorkspaceConflictError("审批状态已更新，请刷新后重试。", "APPROVAL_REVISION_CONFLICT");
    }
    const run = this.getTaskRun(approval.runId);
    const task = this.getTask(approval.taskId);
    if (!["queued", "running"].includes(run.status)) {
      throw new WorkspaceConflictError("任务运行已经结束，审批不能再处理。", "RUN_NOT_ACTIVE");
    }
    if (input.status === "approved") {
      const policy = this.policyForRun(run, task);
      if (approval.policyVersion !== policy.version) {
        throw new WorkspaceConflictError("策略版本已变化，请重新申请审批。", "POLICY_VERSION_CHANGED");
      }
      const decision = evaluateToolCall(policy, approval.toolName, {
        targetDomain: targetDomain(approval.target),
        estimatedCostCents: approval.estimatedCostCents ?? undefined,
        approvalStatus: "approved",
      });
      if (decision !== "allowed") {
        const code = approval.estimatedCostCents !== null && approval.estimatedCostCents > policy.budgetCents ? "BUDGET_EXCEEDED" : "POLICY_BLOCKED";
        throw new WorkspacePolicyError(code, "当前策略不再允许批准该工具。", { toolName: approval.toolName });
      }
    }
    const now = new Date().toISOString();
    const note = input.note?.trim() || (input.status === "approved" ? "PM 已批准该工具调用。" : undefined);
    const changed = this.database.transaction(() => {
      const result = this.database.prepare(`
        UPDATE approvals
        SET status = ?, resolved_at = ?, resolved_by = ?, note = ?, revision = revision + 1
        WHERE id = ? AND status = 'pending' AND revision = ?
      `).run(input.status, now, input.resolvedBy ?? "PM", note ?? null, input.approvalId, input.baseRevision);
      if (result.changes !== 1) throw new WorkspaceConflictError("审批状态已更新，请刷新后重试。", "APPROVAL_REVISION_CONFLICT");
      this.insertTaskRunEvent({
        runId: approval.runId,
        stage: run.stage,
        type: "status",
        action: input.status === "approved" ? "审批已通过" : input.status === "rejected" ? "审批已拒绝" : "审批已取消",
        detail: note ?? "",
        createdAt: now,
      });
      return this.getApproval(input.approvalId);
    })();
    return changed;
  }

  /**
   * Authorize one concrete tool call. High-risk approvals are consumed with a
   * conditional update so two workers cannot execute the same approval.
   */
  authorizeToolCall(input: {
    runId: string;
    toolName: string;
    target?: string | null;
    parameterHash?: string;
    estimatedCostCents?: number;
  }): void {
    const run = this.getTaskRun(input.runId);
    const task = this.getTask(run.taskId);
    const policy = this.policyForRun(run, task);
    const target = input.target?.trim() || null;
    const parameterHash = approvalParameterHash(input.toolName, target, input.parameterHash);
    const decision = evaluateToolCall(policy, input.toolName, {
      targetDomain: targetDomain(target),
      estimatedCostCents: input.estimatedCostCents,
    });
    if (decision === "blocked") {
      const code = input.estimatedCostCents !== undefined && input.estimatedCostCents > policy.budgetCents ? "BUDGET_EXCEEDED" : "POLICY_BLOCKED";
      this.insertTaskRunEvent({
        runId: run.id,
        stage: run.stage,
        type: "error",
        action: "策略阻断工具调用",
        detail: `${code}：${input.toolName}`,
        createdAt: new Date().toISOString(),
      });
      throw new WorkspacePolicyError(code, code === "BUDGET_EXCEEDED" ? "工具预计费用超过当前预算。" : "当前策略阻断了该工具调用。", { toolName: input.toolName });
    }
    if (decision === "allowed") {
      this.insertTaskRunEvent({
        runId: run.id,
        stage: run.stage,
        type: "tool",
        action: "策略允许工具调用",
        detail: `工具 ${input.toolName} 已通过服务端策略检查。`,
        createdAt: new Date().toISOString(),
      });
      return;
    }
    const now = new Date().toISOString();
    const approval = this.database.prepare(`
      SELECT * FROM approvals
      WHERE run_id = ? AND tool_name = ? AND target IS ? AND parameter_hash = ?
        AND policy_version = ? AND status = 'approved' AND consumed_at IS NULL AND expires_at > ?
      ORDER BY resolved_at DESC, id DESC LIMIT 1
    `).get(run.id, input.toolName, target, parameterHash, policy.version, now) as ApprovalRow | undefined;
    if (!approval) {
      const requested = this.createApprovalRequest({
        runId: run.id,
        toolName: input.toolName,
        target,
        parameterHash,
        estimatedCostCents: input.estimatedCostCents,
      });
      throw new WorkspacePolicyError("APPROVAL_REQUIRED", "该工具调用尚未获得人工审批。", { approvalId: requested.id, toolName: input.toolName });
    }
    this.database.transaction(() => {
      const result = this.database.prepare(`
        UPDATE approvals SET consumed_at = ?, revision = revision + 1
        WHERE id = ? AND status = 'approved' AND consumed_at IS NULL AND revision = ?
      `).run(now, approval.id, approval.revision);
      if (result.changes !== 1) throw new WorkspaceConflictError("审批已被其他 Worker 消费，请重新申请。", "APPROVAL_ALREADY_CONSUMED");
      this.insertTaskRunEvent({
        runId: run.id,
        stage: run.stage,
        type: "tool",
        action: "已消费审批",
        detail: `已授权工具 ${input.toolName} 执行一次。`,
        createdAt: now,
      });
    })();
  }

  private policyForRun(run: TaskRunRecord, task: TaskRecord) {
    try {
      const parsed = JSON.parse(run.policySnapshot) as ReturnType<typeof buildAgentPolicy>;
      if (parsed && parsed.version && Array.isArray(parsed.allowedTools)) return parsed;
    } catch {
      // Fall back to a fresh immutable snapshot for legacy runs.
    }
    return buildAgentPolicy(task.autonomy, { allowedDomains: task.researchInput.allowedDomains, budgetCents: task.budgetCents });
  }

  getTaskRun(runId: string): TaskRunRecord {
    const row = this.database.prepare("SELECT * FROM task_runs WHERE id = ?").get(runId) as TaskRunRow | undefined;
    if (!row) throw new WorkspaceNotFoundError("运行记录不存在。");
    const events = this.database
      .prepare("SELECT * FROM task_run_events WHERE run_id = ? ORDER BY created_at ASC, id ASC")
      .all(runId) as TaskRunEventRow[];
    return toTaskRun(row, events);
  }

  getLatestTaskRun(taskId: string): TaskRunRecord | null {
    const row = this.database
      .prepare("SELECT * FROM task_runs WHERE task_id = ? ORDER BY queued_at DESC, id DESC LIMIT 1")
      .get(taskId) as TaskRunRow | undefined;
    return row ? toTaskRun(row, this.database.prepare("SELECT * FROM task_run_events WHERE run_id = ? ORDER BY created_at ASC, id ASC").all(row.id) as TaskRunEventRow[]) : null;
  }

  attachTaskRunQueueJob(runId: string, jobId: string): TaskRunRecord {
    const now = new Date().toISOString();
    this.database.prepare("UPDATE task_runs SET queue_job_id = ?, updated_at = ? WHERE id = ? AND status = 'queued'").run(jobId, now, runId);
    return this.getTaskRun(runId);
  }

  claimTaskRun(runId: string, workerId: string): boolean {
    const now = new Date().toISOString();
    const changed = this.database.prepare(`
      UPDATE task_runs
      SET status = 'running', worker_id = ?, started_at = COALESCE(started_at, ?),
          last_heartbeat_at = ?, stage = 'planning', stage_index = 1, progress = 8,
          current_action = 'Worker 已接手，正在理解任务', updated_at = ?
      WHERE id = ? AND status = 'queued'
    `).run(workerId, now, now, now, runId).changes;
    if (changed) {
      this.insertTaskRunEvent({
        runId,
        stage: "planning",
        type: "status",
        action: "Worker 已接手",
        detail: `执行节点 ${workerId} 开始处理任务。`,
        createdAt: now,
      });
    }
    return changed === 1;
  }

  updateTaskRunProgress(input: {
    runId: string;
    stage: TaskRunStage;
    stageIndex: number;
    progress: number;
    action: string;
    detail?: string;
    query?: string;
    url?: string;
    sourceTitle?: string;
    visitedSourceCount?: number;
    evidenceCount?: number;
    eventType?: TaskRunEvent["type"];
  }): TaskRunRecord {
    const now = new Date().toISOString();
    const progress = Math.max(0, Math.min(100, Math.round(input.progress)));
    this.database.transaction(() => {
      this.database.prepare(`
        UPDATE task_runs
        SET stage = ?, stage_index = ?, progress = ?, current_action = ?,
            current_query = COALESCE(?, current_query), current_url = COALESCE(?, current_url),
            current_source_title = COALESCE(?, current_source_title),
            visited_source_count = COALESCE(?, visited_source_count), evidence_count = COALESCE(?, evidence_count),
            last_heartbeat_at = ?, updated_at = ?
        WHERE id = ? AND status IN ('queued', 'running')
      `).run(
        input.stage,
        input.stageIndex,
        progress,
        input.action,
        input.query ?? null,
        input.url ?? null,
        input.sourceTitle ?? null,
        input.visitedSourceCount ?? null,
        input.evidenceCount ?? null,
        now,
        now,
        input.runId,
      );
      this.insertTaskRunEvent({
        runId: input.runId,
        stage: input.stage,
        type: input.eventType ?? (input.url ? "source" : "status"),
        action: input.action,
        detail: input.detail ?? "",
        query: input.query,
        url: input.url,
        sourceTitle: input.sourceTitle,
        createdAt: now,
      });
    })();
    return this.getTaskRun(input.runId);
  }

  heartbeatTaskRun(runId: string): boolean {
    const now = new Date().toISOString();
    return this.database.prepare("UPDATE task_runs SET last_heartbeat_at = ?, updated_at = ? WHERE id = ? AND status = 'running'").run(now, now, runId).changes === 1;
  }

  isTaskRunCancelRequested(runId: string): boolean {
    const row = this.database.prepare("SELECT cancel_requested_at FROM task_runs WHERE id = ?").get(runId) as { cancel_requested_at: string | null } | undefined;
    return Boolean(row?.cancel_requested_at);
  }

  requestTaskRunCancel(runId: string): TaskRunRecord {
    const run = this.getTaskRun(runId);
    const now = new Date().toISOString();
    if (run.status === "queued") {
      this.database.transaction(() => {
        this.database.prepare(`UPDATE task_runs SET status = 'cancelled', cancel_requested_at = ?, completed_at = ?, stage = 'cancelled', progress = 100, current_action = '任务已取消', updated_at = ? WHERE id = ? AND status = 'queued'`).run(now, now, now, runId);
        this.insertTaskRunEvent({ runId, stage: "cancelled", type: "status", action: "任务已取消", detail: "任务尚未开始执行。", createdAt: now });
        this.database.prepare("UPDATE tasks SET status = 'cancelled', updated_at = ? WHERE id = ?").run(now, run.taskId);
      })();
    } else if (run.status === "running") {
      this.database.transaction(() => {
        this.database.prepare("UPDATE task_runs SET cancel_requested_at = ?, current_action = '正在取消任务', updated_at = ? WHERE id = ? AND status = 'running'").run(now, now, runId);
        this.insertTaskRunEvent({ runId, stage: run.stage, type: "status", action: "收到取消请求", detail: "Worker 将在下一个检查点中止执行。", createdAt: now });
      })();
    }
    return this.getTaskRun(runId);
  }

  finishCancelledTaskRun(runId: string): TaskRunRecord {
    const run = this.getTaskRun(runId);
    const now = new Date().toISOString();
    this.database.transaction(() => {
      const changed = this.database.prepare(`UPDATE task_runs SET status = 'cancelled', completed_at = ?, stage = 'cancelled', progress = 100, current_action = '任务已取消', error_code = 'CANCELLED', error_message = '任务已按请求取消。', updated_at = ? WHERE id = ? AND status IN ('queued', 'running')`).run(now, now, runId).changes;
      if (changed) {
        this.insertTaskRunEvent({ runId, stage: "cancelled", type: "status", action: "任务已取消", detail: "执行已中止，未生成新的文档版本。", createdAt: now });
        this.database.prepare("UPDATE tasks SET status = 'cancelled', updated_at = ? WHERE id = ?").run(now, run.taskId);
      }
    })();
    this.recordRunMetrics(runId);
    return this.getTaskRun(runId);
  }

  completeTaskRun(runId: string, response: AgentRunResponse): { task: TaskRecord; document: DocumentDetail } {
    const run = this.getTaskRun(runId);
    const task = this.getTask(run.taskId);
    const source: VersionSource = response.demo ? "agent_demo" : "agent";
    const costCents = response.budget.estimatedCostUsd === null ? task.costCents : Math.round(response.budget.estimatedCostUsd * 100);
    const nextStatus: TaskStatus = run.requiresReview || response.demo || response.quality.status !== "passed" ? "review" : "completed";
    let documentId = "";
    const completedAt = response.completedAt || new Date().toISOString();

    this.database.transaction(() => {
      const changed = this.database.prepare(`
        UPDATE task_runs SET status = 'completed', model = ?, response_json = ?, cost_cents = ?,
          completed_at = ?, started_at = COALESCE(started_at, ?), stage = 'completed', stage_index = 8,
          progress = 100, current_action = '研究结果已归档到产品文档', visited_source_count = ?, evidence_count = ?,
          last_heartbeat_at = ?, updated_at = ?
        WHERE id = ? AND status IN ('queued', 'running')
      `).run(response.model, JSON.stringify(response), costCents, completedAt, response.startedAt, response.citations.length, response.evidence.length, completedAt, completedAt, runId).changes;
      if (changed !== 1) return;
      this.persistRunSources(runId, response, task.id, completedAt);
      this.insertTaskRunEvent({
        runId,
        stage: "completed",
        type: "status",
        action: nextStatus === "review" ? "研究结果已归档，等待审核" : "研究结果已归档",
        detail: nextStatus === "review" ? "主文档已保存到产品文档，并进入人工审核。" : "主文档已保存到产品文档。",
        createdAt: completedAt,
      });
      this.database.prepare("UPDATE tasks SET status = ?, cost_cents = ?, updated_at = ? WHERE id = ?").run(nextStatus, costCents, completedAt, task.id);

      const primary = this.database.prepare("SELECT id FROM documents WHERE task_id = ? AND role = 'primary'").get(task.id) as { id: string } | undefined;
      if (!primary) {
        documentId = `document-${crypto.randomUUID()}`;
        this.database.prepare("INSERT INTO documents(id, task_id, format, owner, role, created_at, updated_at) VALUES (?, ?, ?, 'PM Agent', 'primary', ?, ?)").run(documentId, task.id, defaultDocumentFormat(task.type), response.startedAt || completedAt, completedAt);
        this.insertVersion({ documentId, revision: 1, label: "v1.0", title: defaultDocumentTitle(task, response.output), content: response.output, source, changeNote: "任务完成后自动归档", createdBy: "PM Agent", restoredFromId: null, createdAt: completedAt });
      } else {
        documentId = primary.id;
        const current = this.getDocument(documentId);
        this.insertVersion({ documentId, revision: current.currentRevision + 1, label: bumpVersionLabel(current.currentVersionLabel), title: defaultDocumentTitle(task, response.output), content: response.output, source, changeNote: "任务重新执行后自动归档", createdBy: "PM Agent", restoredFromId: null, createdAt: completedAt });
        this.database.prepare("UPDATE documents SET updated_at = ? WHERE id = ?").run(completedAt, documentId);
      }
      this.database.prepare("UPDATE products SET updated_at = ? WHERE id = ?").run(completedAt, task.productId);
    })();
    this.recordRunMetrics(runId);
    return { task: this.getTask(task.id), document: this.getDocument(documentId || this.getPrimaryDocumentId(task.id)) };
  }

  listTaskReviews(taskId: string): TaskReviewRecord[] {
    this.getTask(taskId);
    return (this.database
      .prepare("SELECT * FROM task_reviews WHERE task_id = ? ORDER BY created_at DESC, id DESC")
      .all(taskId) as TaskReviewRow[]).map(toTaskReview);
  }

  getTaskReview(taskId: string): TaskReviewResponse {
    const task = this.getTask(taskId);
    const document = this.getPrimaryDocument(taskId);
    return {
      task,
      run: this.getLatestTaskRun(taskId),
      document,
      reviews: this.listTaskReviews(taskId),
      actions: {
        canReview: task.status === "review",
        canResubmit: task.status === "changes_requested" && Boolean(document),
        canOpenDocument: Boolean(document),
        canCreateFollowUp: task.status === "completed",
      },
    };
  }

  reviewTask(input: {
    taskId: string;
    decision: Exclude<TaskReviewDecision, "resubmitted">;
    note?: string;
    baseUpdatedAt: string;
    reviewer?: string;
  }): TaskReviewResponse {
    const note = input.note?.trim() ?? "";
    if (input.decision === "changes_requested" && !note) {
      throw new WorkspaceValidationError("退回修改时必须填写修改意见。");
    }
    this.database.transaction(() => {
      const task = this.getTask(input.taskId);
      if (task.status !== "review") throw new WorkspaceConflictError("该任务当前不处于待审核状态，请刷新后重试。");
      const run = this.getLatestTaskRun(input.taskId);
      const document = this.getPrimaryDocument(input.taskId);
      const now = nextTimestamp(input.baseUpdatedAt);
      const nextStatus: TaskStatus = input.decision === "approved" ? "completed" : "changes_requested";
      const changed = this.database.prepare(`
        UPDATE tasks SET status = ?, updated_at = ?
        WHERE id = ? AND status = 'review' AND updated_at = ?
      `).run(nextStatus, now, input.taskId, input.baseUpdatedAt).changes;
      if (changed !== 1) throw new WorkspaceConflictError("任务状态已在其他位置更新，请刷新后再审核。");
      this.database.prepare(`
        INSERT INTO task_reviews(id, task_id, run_id, decision, note, reviewer, document_id, document_revision, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        `review-${crypto.randomUUID()}`,
        input.taskId,
        run?.id ?? null,
        input.decision,
        note,
        input.reviewer ?? "PM",
        document?.id ?? null,
        document?.currentRevision ?? null,
        now,
      );
      if (run) {
        this.insertTaskRunEvent({
          runId: run.id,
          stage: run.stage,
          type: "status",
          action: input.decision === "approved" ? "人工审核通过" : "人工审核退回修改",
          detail: note || "PM 已确认本次结果可以进入后续流程。",
          createdAt: now,
        });
      }
      this.database.prepare("UPDATE products SET updated_at = ? WHERE id = ?").run(now, task.productId);
    })();
    return this.getTaskReview(input.taskId);
  }

  resubmitTaskReview(input: {
    taskId: string;
    baseUpdatedAt: string;
    documentRevision: number;
    note?: string;
    reviewer?: string;
  }): TaskReviewResponse {
    this.database.transaction(() => {
      const task = this.getTask(input.taskId);
      if (task.status !== "changes_requested") throw new WorkspaceConflictError("该任务当前不处于待修改状态，请刷新后重试。");
      const run = this.getLatestTaskRun(input.taskId);
      const document = this.getPrimaryDocument(input.taskId);
      if (!document) throw new WorkspaceNotFoundError("任务尚未生成可提交复审的主文档。");
      if (document.currentRevision !== input.documentRevision) {
        throw new WorkspaceConflictError("产品文档版本已更新，请刷新结果页后再提交复审。");
      }
      const returnedAt = this.database.prepare(`
        SELECT document_revision FROM task_reviews
        WHERE task_id = ? AND decision = 'changes_requested'
        ORDER BY created_at DESC, id DESC LIMIT 1
      `).get(input.taskId) as { document_revision: number | null } | undefined;
      if (returnedAt?.document_revision !== null && returnedAt?.document_revision !== undefined && document.currentRevision <= returnedAt.document_revision) {
        throw new WorkspaceConflictError("产品文档尚未产生新的修订，请先保存修改后再提交复审。");
      }
      const now = nextTimestamp(input.baseUpdatedAt);
      const changed = this.database.prepare(`
        UPDATE tasks SET status = 'review', updated_at = ?
        WHERE id = ? AND status = 'changes_requested' AND updated_at = ?
      `).run(now, input.taskId, input.baseUpdatedAt).changes;
      if (changed !== 1) throw new WorkspaceConflictError("任务状态已在其他位置更新，请刷新后再提交复审。");
      this.database.prepare(`
        INSERT INTO task_reviews(id, task_id, run_id, decision, note, reviewer, document_id, document_revision, created_at)
        VALUES (?, ?, ?, 'resubmitted', ?, ?, ?, ?, ?)
      `).run(
        `review-${crypto.randomUUID()}`,
        input.taskId,
        run?.id ?? null,
        input.note?.trim() || "文档修改完成，提交复审。",
        input.reviewer ?? "PM",
        document.id,
        document.currentRevision,
        now,
      );
      if (run) {
        this.insertTaskRunEvent({
          runId: run.id,
          stage: run.stage,
          type: "status",
          action: "修改完成并提交复审",
          detail: `已提交文档 ${document.currentVersionLabel} 进入人工复审。`,
          createdAt: now,
        });
      }
      this.database.prepare("UPDATE products SET updated_at = ? WHERE id = ?").run(now, task.productId);
    })();
    return this.getTaskReview(input.taskId);
  }

  failTaskRun(runId: string, input: { code: string; message: string; stage?: TaskRunStage }): TaskRunRecord {
    const run = this.getTaskRun(runId);
    const task = this.getTask(run.taskId);
    const completedAt = new Date().toISOString();
    const failureStage = input.stage ?? run.stage;
    this.database.transaction(() => {
      const changed = this.database.prepare(`
        UPDATE task_runs SET status = 'failed', completed_at = ?, stage = 'failed', failure_stage = ?,
          current_action = ?, error_code = ?, error_message = ?, updated_at = ?
        WHERE id = ? AND status IN ('queued', 'running')
      `).run(completedAt, failureStage, input.message, input.code, input.message, completedAt, runId).changes;
      if (changed) {
        this.database.prepare("UPDATE task_runs SET response_json = ? WHERE id = ?").run(JSON.stringify({ error: input.message, code: input.code }), runId);
        this.insertTaskRunEvent({ runId, stage: "failed", type: "error", action: "任务执行失败", detail: `${input.code}：${input.message}`, createdAt: completedAt });
        this.database.prepare("UPDATE tasks SET status = 'failed', updated_at = ? WHERE id = ?").run(completedAt, task.id);
        this.database.prepare("UPDATE products SET updated_at = ? WHERE id = ?").run(completedAt, task.productId);
      }
    })();
    this.recordRunMetrics(runId);
    return this.getTaskRun(runId);
  }

  failStaleTaskRuns(heartbeatBefore: string): number {
    const stale = this.database.prepare("SELECT id FROM task_runs WHERE status = 'running' AND COALESCE(last_heartbeat_at, started_at, queued_at) < ?").all(heartbeatBefore) as Array<{ id: string }>;
    for (const run of stale) {
      this.failTaskRun(run.id, { code: "WORKER_LOST", message: "执行节点超过心跳期限未响应，任务已停止。" });
    }
    return stale.length;
  }

  private getPrimaryDocumentId(taskId: string): string {
    const primary = this.database.prepare("SELECT id FROM documents WHERE task_id = ? AND role = 'primary'").get(taskId) as { id: string } | undefined;
    if (!primary) throw new WorkspaceNotFoundError("任务尚未生成产品文档。");
    return primary.id;
  }

  private insertTaskRunEvent(input: {
    runId: string;
    stage: TaskRunStage;
    type: TaskRunEvent["type"];
    action: string;
    detail?: string;
    query?: string;
    url?: string;
    sourceTitle?: string;
    createdAt: string;
  }) {
    this.database.prepare(`
      INSERT INTO task_run_events(id, run_id, stage, type, action, detail, query, url, source_title, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(`event-${crypto.randomUUID()}`, input.runId, input.stage, input.type, input.action, input.detail ?? "", input.query ?? null, input.url ?? null, input.sourceTitle ?? null, input.createdAt);
  }

  private insertVersion(input: {
    documentId: string;
    revision: number;
    label: string;
    title: string;
    content: string;
    source: VersionSource;
    changeNote: string | null;
    createdBy: string;
    restoredFromId: string | null;
    createdAt: string;
  }) {
    this.database
      .prepare(`
        INSERT INTO document_versions(id, document_id, revision, label, title, content, source, change_note, created_by, restored_from_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        `version-${crypto.randomUUID()}`,
        input.documentId,
        input.revision,
        input.label,
        input.title,
        input.content,
        input.source,
        input.changeNote,
        input.createdBy,
        input.restoredFromId,
        input.createdAt,
      );
  }

  private touchHierarchy(task: TaskRecord, timestamp: string) {
    this.database.prepare("UPDATE tasks SET updated_at = ? WHERE id = ?").run(timestamp, task.id);
    this.database.prepare("UPDATE products SET updated_at = ? WHERE id = ?").run(timestamp, task.productId);
  }
}
