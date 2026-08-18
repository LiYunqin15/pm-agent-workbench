export const TASK_MODES = ["market", "competitor", "insight", "prd"] as const;
export const RUN_DEPTHS = ["quick", "standard", "deep"] as const;
export const AUTONOMY_LEVELS = ["advise", "draft", "scoped"] as const;
export const AGENT_RUNTIME_MODES = ["demo", "live"] as const;
export const AGENT_MODE_PREFERENCES = ["auto", ...AGENT_RUNTIME_MODES] as const;

export type TaskMode = (typeof TASK_MODES)[number];
export type RunDepth = (typeof RUN_DEPTHS)[number];
export type AutonomyLevel = (typeof AUTONOMY_LEVELS)[number];
export type AgentRuntimeMode = (typeof AGENT_RUNTIME_MODES)[number];
export type AgentModePreference = (typeof AGENT_MODE_PREFERENCES)[number];

export interface ResearchInput {
  region?: string;
  timeRange?: string;
  targetUsers?: string;
  researchQuestions?: string[];
  competitorNames?: string[];
  experienceScope?: string;
  allowedDomains?: string[];
  constraints?: string;
}

export interface AgentAttachmentContext {
  id: string;
  fileName: string;
  mediaType: string;
  text: string;
  createdAt: string;
}

export interface AgentRuntimeStatus {
  mode: AgentRuntimeMode;
  selectedMode: AgentRuntimeMode;
  preference: AgentModePreference;
  updatedAt: string | null;
  api: {
    configured: boolean;
    keyHint: string | null;
    baseUrl: string;
    customEndpoint: boolean;
    endpointLabel: string;
    apiMode: "responses" | "chat_completions";
    webSearchAvailable: boolean;
  };
  models: {
    quick: string;
    standard: string;
    deep: string;
  };
}

export type ResearchContext = ResearchInput;

export interface AgentRunRequest {
  prompt: string;
  mode: TaskMode;
  depth: RunDepth;
  autonomy: AutonomyLevel;
  budgetUsd: number;
  context?: ResearchInput;
  attachments?: AgentAttachmentContext[];
  signal?: AbortSignal;
  onProgress?: (update: AgentProgressUpdate) => void | Promise<void>;
}

export interface AgentProgressUpdate {
  stage: "planning" | "searching" | "analyzing" | "evidence" | "archiving";
  stageIndex: number;
  progress: number;
  action: string;
  detail?: string;
  query?: string;
  url?: string;
  sourceTitle?: string;
  visitedSourceCount?: number;
  evidenceCount?: number;
}

export interface Citation {
  title: string;
  url: string;
}

export interface EvidenceSource extends Citation {
  id: string;
  publisher: string;
  capturedAt: string;
  cited: boolean;
  excerpt?: string;
  trust: "unrated";
  freshness: "unknown";
}

export interface AttachmentReference {
  id: string;
  fileName: string;
  referenced: boolean;
}

export interface RunUsage {
  requests: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  totalTokens: number;
  webSearchCalls: number;
  durationMs: number;
}

export interface BudgetSummary {
  limitUsd: number;
  estimatedCostUsd: number | null;
  remainingUsd: number | null;
  status: "within" | "exceeded" | "unavailable";
  maxTurns: number;
  maxOutputTokens: number;
  timeoutMs: number;
  pricingBasis: string | null;
}

export interface RunTraceEvent {
  id: string;
  at: string;
  type: "system" | "model" | "tool" | "quality";
  name: string;
  status: "completed" | "failed";
  detail: string;
}

export interface QualitySummary {
  status: "passed" | "needs_review" | "not_run";
  factCitationCoverage: number | null;
  warnings: string[];
}

export interface RunStage {
  label: string;
  status: "completed" | "pending" | "failed";
  durationMs?: number;
}

export interface AgentRunResponse {
  id: string;
  demo: boolean;
  status: "completed" | "needs_review" | "demo";
  model: string;
  mode: TaskMode;
  output: string;
  citations: Citation[];
  evidence: EvidenceSource[];
  attachmentReferences?: AttachmentReference[];
  stages: RunStage[];
  usage: RunUsage;
  budget: BudgetSummary;
  quality: QualitySummary;
  trace: RunTraceEvent[];
  startedAt: string;
  completedAt: string;
}
