import type { AgentModePreference, AutonomyLevel, ResearchInput, RunDepth, TaskMode } from "@/lib/agent/types";

export const TASK_STATUSES = ["running", "review", "changes_requested", "completed", "paused", "failed", "cancelled"] as const;
export const DOCUMENT_FORMATS = [
  "research_report",
  "competitor_report",
  "user_research",
  "prd",
  "outline",
  "html",
  "markdown",
] as const;
export const VERSION_SOURCES = ["manual", "agent", "agent_demo", "restore"] as const;
export const OUTPUT_DOCUMENT_FORMATS = ["markdown", "html", "txt", "docx", "pdf"] as const;
export const RESEARCH_SOURCE_TYPES = ["官网", "报告", "用户评价", "数据平台", "新闻", "其他"] as const;
export const RESEARCH_SOURCE_TRUSTS = ["high", "medium", "low"] as const;
export const RESEARCH_SOURCE_VERIFICATIONS = ["pending", "verified"] as const;
export const APPROVAL_STATUSES = ["pending", "approved", "rejected", "cancelled", "expired"] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];
export type DocumentFormat = (typeof DOCUMENT_FORMATS)[number];
export type VersionSource = (typeof VERSION_SOURCES)[number];
export type OutputDocumentFormat = (typeof OUTPUT_DOCUMENT_FORMATS)[number];
export type ResearchSourceType = (typeof RESEARCH_SOURCE_TYPES)[number];
export type ResearchSourceTrust = (typeof RESEARCH_SOURCE_TRUSTS)[number];
export type ResearchSourceVerification = (typeof RESEARCH_SOURCE_VERIFICATIONS)[number];
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];
export type TaskMetric = "all" | "month" | "running" | "review" | "changes_requested";

export const TASK_TYPE_LABELS: Record<TaskMode, string> = {
  market: "市场研究",
  competitor: "竞品分析",
  insight: "用户洞察",
  prd: "PRD 草拟",
};

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  running: "执行中",
  review: "待审核",
  changes_requested: "待修改",
  completed: "已完成",
  paused: "已暂停",
  failed: "失败",
  cancelled: "已取消",
};

export const DOCUMENT_FORMAT_LABELS: Record<DocumentFormat, string> = {
  research_report: "研究报告",
  competitor_report: "竞品报告",
  user_research: "用户研究",
  prd: "PRD",
  outline: "汇报提纲",
  html: "HTML",
  markdown: "Markdown",
};

export const VERSION_SOURCE_LABELS: Record<VersionSource, string> = {
  manual: "手动编辑",
  agent: "Agent 生成",
  agent_demo: "演示生成",
  restore: "历史恢复",
};

export const OUTPUT_DOCUMENT_FORMAT_LABELS: Record<OutputDocumentFormat, string> = {
  markdown: "Markdown",
  html: "HTML",
  txt: "纯文本",
  docx: "Word（DOCX）",
  pdf: "PDF（打印）",
};

export interface ProductSummary {
  id: string;
  name: string;
  description: string;
  taskCount: number;
  documentCount: number;
  updatedAt: string;
}

export interface TaskRecord {
  id: string;
  productId: string;
  productName: string;
  title: string;
  type: TaskMode;
  status: TaskStatus;
  prompt: string;
  researchInput: ResearchInput;
  attachmentCount: number;
  depth: RunDepth;
  autonomy: AutonomyLevel;
  budgetCents: number;
  costCents: number | null;
  documentCount: number;
  createdAt: string;
  updatedAt: string;
}

export const TASK_ATTACHMENT_STATUSES = ["uploaded", "parsing", "ready", "failed", "rejected"] as const;

export type TaskAttachmentStatus = (typeof TASK_ATTACHMENT_STATUSES)[number];

export interface TaskAttachment {
  id: string;
  taskId: string;
  fileName: string;
  mediaType: string;
  byteSize: number;
  checksum: string;
  status: TaskAttachmentStatus;
  uploadedBy: string;
  errorCode: string | null;
  errorMessage: string | null;
  parsedText: string | null;
  parseStartedAt: string | null;
  parseCompletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ApprovalRecord {
  id: string;
  runId: string;
  taskId: string;
  toolName: string;
  target: string | null;
  parameterHash: string;
  estimatedCostCents: number | null;
  policyVersion: string;
  status: ApprovalStatus;
  requestedAt: string;
  resolvedAt: string | null;
  resolvedBy: string | null;
  note: string | null;
  revision: number;
  expiresAt: string;
  consumedAt: string | null;
}

export interface TaskSummary {
  monthCount: number;
  runningCount: number;
  reviewCount: number;
  changesRequestedCount: number;
  monthCostCents: number;
}

export interface TaskListResponse {
  items: TaskRecord[];
  summary: TaskSummary;
}

export interface ProductTreeNode extends ProductSummary {
  tasks: TaskRecord[];
}

export interface DocumentSummary {
  id: string;
  productId: string;
  productName: string;
  taskId: string;
  taskTitle: string;
  taskStatus: TaskStatus;
  format: DocumentFormat;
  owner: string;
  role: "primary" | "additional";
  title: string;
  excerpt: string;
  currentRevision: number;
  currentVersionLabel: string;
  createdAt: string;
  updatedAt: string;
}

export interface DocumentVersion {
  id: string;
  documentId: string;
  revision: number;
  label: string;
  alias: string | null;
  title: string;
  content: string;
  source: VersionSource;
  changeNote: string | null;
  createdBy: string;
  restoredFromId: string | null;
  createdAt: string;
  metadataRevision: number;
  metadataUpdatedAt: string | null;
  metadataUpdatedBy: string | null;
}

export interface DocumentDetail extends DocumentSummary {
  currentVersion: DocumentVersion;
  versions: DocumentVersion[];
}

export interface ResearchSource {
  id: string;
  taskId: string | null;
  runId: string | null;
  taskTitle: string | null;
  title: string;
  publisher: string;
  type: ResearchSourceType;
  trust: ResearchSourceTrust;
  verification: ResearchSourceVerification;
  url: string;
  domain: string;
  excerpt: string | null;
  claimType: "fact" | "inference" | "recommendation";
  freshness: string;
  citationCount: number;
  conflictGroup: string | null;
  capturedAt: string;
  verifiedAt: string | null;
  verifiedBy: string | null;
  verificationNote: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ResearchSourceSummary {
  total: number;
  high: number;
  week: number;
  pending: number;
}

export interface ResearchSourceListResponse {
  items: ResearchSource[];
  summary: ResearchSourceSummary;
}

export const TASK_RUN_STATUSES = ["queued", "running", "completed", "failed", "cancelled"] as const;
export type TaskRunStatus = (typeof TASK_RUN_STATUSES)[number];

export type TaskRunStage = "queued" | "planning" | "searching" | "analyzing" | "evidence" | "archiving" | "completed" | "failed" | "cancelled";

export interface TaskRunEvent {
  id: string;
  runId: string;
  stage: TaskRunStage;
  type: "system" | "tool" | "source" | "analysis" | "error" | "status";
  action: string;
  detail: string;
  query: string | null;
  url: string | null;
  sourceTitle: string | null;
  createdAt: string;
}

export interface TaskRunRecord {
  id: string;
  taskId: string;
  status: TaskRunStatus;
  model: string | null;
  queueJobId: string | null;
  workerId: string | null;
  queuedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  lastHeartbeatAt: string | null;
  stage: TaskRunStage;
  stageIndex: number;
  progress: number;
  currentAction: string;
  currentQuery: string | null;
  currentUrl: string | null;
  currentSourceTitle: string | null;
  visitedSourceCount: number;
  evidenceCount: number;
  cancelRequestedAt: string | null;
  failureStage: TaskRunStage | null;
  errorCode: string | null;
  errorMessage: string | null;
  responseJson: string | null;
  costCents: number | null;
  requiresReview: boolean;
  policyVersion: string;
  policySnapshot: string;
  inputSnapshotHash: string;
  updatedAt: string;
  events: TaskRunEvent[];
}

export interface TaskRunStatusResponse {
  run: TaskRunRecord;
  task: TaskRecord;
  result?: import("@/lib/agent/types").AgentRunResponse;
  document?: DocumentDetail;
}

export const TASK_REVIEW_DECISIONS = ["approved", "changes_requested", "resubmitted"] as const;
export type TaskReviewDecision = (typeof TASK_REVIEW_DECISIONS)[number];

export interface TaskReviewRecord {
  id: string;
  taskId: string;
  runId: string | null;
  decision: TaskReviewDecision;
  note: string;
  reviewer: string;
  documentId: string | null;
  documentRevision: number | null;
  createdAt: string;
}

export interface TaskReviewActions {
  canReview: boolean;
  canResubmit: boolean;
  canOpenDocument: boolean;
  canCreateFollowUp: boolean;
}

export interface TaskReviewResponse {
  task: TaskRecord;
  run: TaskRunRecord | null;
  document: DocumentDetail | null;
  reviews: TaskReviewRecord[];
  actions: TaskReviewActions;
  result?: import("@/lib/agent/types").AgentRunResponse;
}

export type MetricStatus = "pass" | "fail" | "insufficient_data";
export type MetricTargetOperator = ">=" | "<=";

export interface MetricValue {
  value: number | null;
  unit: "ratio" | "seconds" | "count";
  numerator: number;
  denominator: number;
  sampleSize: number;
  target: number;
  targetOperator: MetricTargetOperator;
  status: MetricStatus;
  warning?: string;
}

export interface MetricsOverview {
  metricDefinitionVersion: string;
  evaluationVersion: string;
  from: string;
  to: string;
  taskType: TaskMode | null;
  metrics: Record<string, MetricValue>;
  integrityWarnings: string[];
}

export interface EvaluationResultRecord {
  id: string;
  caseId: string;
  evaluationVersion: string;
  runId: string | null;
  passed: boolean;
  taskType: TaskMode | null;
  model: string | null;
  sourceCount: number;
  citationCoverage: number | null;
  costCents: number | null;
  durationMs: number | null;
  errorCode: string | null;
  diffSummary: string | null;
  createdAt: string;
}

export interface WorkspaceAgentSettings {
  modePreference: AgentModePreference;
  outputFormats: OutputDocumentFormat[];
  defaultOutputFormat: OutputDocumentFormat;
  updatedAt: string;
}

export interface WorkspaceOutputSettings {
  outputFormats: OutputDocumentFormat[];
  defaultOutputFormat: OutputDocumentFormat;
  updatedAt: string;
}
