"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Activity,
  AlertTriangle,
  ArrowDownToLine,
  BarChart3,
  Bell,
  BookOpen,
  Bot,
  Boxes,
  BrainCircuit,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  Code2,
  Download,
  Eye,
  ExternalLink,
  FileBarChart,
  FileCheck2,
  FileText,
  FilePlus2,
  Filter,
  FolderTree,
  FolderOpen,
  Gauge,
  Globe2,
  HelpCircle,
  History,
  Inbox,
  KeyRound,
  LayoutDashboard,
  Link2,
  ListChecks,
  LoaderCircle,
  Menu,
  MessageSquareText,
  Moon,
  MoreHorizontal,
  Paperclip,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Square,
  Sun,
  TableProperties,
  Upload,
  Users,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AgentRunResponse, AgentRuntimeStatus, AutonomyLevel, ResearchInput, RunDepth, TaskMode } from "@/lib/agent/types";
import {
  operationLogs,
  settingsTabs,
} from "@/lib/prototype-data";
import {
  DOCUMENT_FORMAT_LABELS,
  TASK_STATUS_LABELS,
  TASK_TYPE_LABELS,
  VERSION_SOURCE_LABELS,
  type DocumentDetail,
  type DocumentFormat,
  type DocumentSummary,
  type DocumentVersion,
  OUTPUT_DOCUMENT_FORMAT_LABELS,
  type OutputDocumentFormat,
  type WorkspaceOutputSettings,
  type ProductSummary,
  type ProductTreeNode,
  RESEARCH_SOURCE_TYPES,
  type ResearchSource,
  type ResearchSourceListResponse,
  type ResearchSourceTrust,
  type ResearchSourceType,
  type TaskListResponse,
  type TaskAttachment,
  type TaskMetric,
  type TaskRecord,
  type TaskReviewResponse,
  type TaskRunRecord,
  type TaskRunStage,
  type TaskRunStatusResponse,
  type TaskStatus,
} from "@/lib/workspace/types";
import { summarizeVersionDiff } from "@/lib/workspace/version-diff";

type RouteKey =
  | ""
  | "tasks"
  | "tasks/running"
  | "tasks/result"
  | "research"
  | "docs"
  | "evidence"
  | "logs"
  | "settings"
  | "settings/api"
  | "settings/team"
  | "settings/notifications"
  | "profile";

type DraftTask = {
  productId?: string;
  taskId?: string;
  title?: string;
  prompt: string;
  mode: TaskMode;
  depth: RunDepth;
  autonomy: AutonomyLevel;
};

type DraftInspectorState = {
  mode: TaskMode;
  depth: RunDepth;
  autonomy: AutonomyLevel;
};

const DEFAULT_TASK_BUDGET_CENTS = 200;

type PrototypeQuery = {
  productId?: string;
  taskId?: string;
  documentId?: string;
  followUpTaskId?: string;
};

type QueueHealth = {
  connected: boolean;
  workers: number;
  latencyMs: number | null;
  queueName: string;
  error?: string;
};

async function requestJson<T>(input: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body && !(init.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const response = await fetch(input, {
    ...init,
    headers,
  });
  const payload = await response.json().catch(() => ({ error: "服务返回了无效响应。" }));
  if (!response.ok) {
    throw new Error((payload as { error?: string }).error ?? "请求失败，请稍后重试。");
  }
  return payload as T;
}

function formatCurrency(cents: number | null): string {
  return cents === null ? "--" : `$${(cents / 100).toFixed(2)}`;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function upsertAttachment(items: TaskAttachment[], attachment: TaskAttachment): TaskAttachment[] {
  const index = items.findIndex((item) => item.id === attachment.id);
  if (index < 0) return [...items, attachment];
  return items.map((item) => item.id === attachment.id ? attachment : item);
}

function formatWorkspaceDate(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value)).replace("/", "-");
}

function documentHref(task: Pick<TaskRecord, "id" | "productId">, documentId?: string): string {
  const params = new URLSearchParams({ productId: task.productId, taskId: task.id });
  if (documentId) params.set("documentId", documentId);
  return `/docs?${params.toString()}`;
}

function taskHref(task: Pick<TaskRecord, "id" | "productId" | "status">): string {
  if (task.status === "running" || task.status === "failed" || task.status === "cancelled") {
    return `/tasks/running?taskId=${encodeURIComponent(task.id)}`;
  }
  if (task.status === "review" || task.status === "changes_requested") {
    return `/tasks/result?taskId=${encodeURIComponent(task.id)}`;
  }
  return documentHref(task);
}

function taskActionLabel(status: TaskStatus): string {
  if (status === "review") return "开始审核";
  if (status === "changes_requested") return "处理修改";
  return status === "running" || status === "failed" || status === "cancelled" ? "查看进度" : "查看文档";
}

const workflowOptions: Array<{
  mode: TaskMode;
  label: string;
  description: string;
  icon: typeof Globe2;
}> = [
  { mode: "market", label: "市场研究", description: "了解行业趋势、市场空间和用户需求。", icon: Globe2 },
  { mode: "competitor", label: "竞品分析", description: "比较竞品定位、功能、价格和用户体验。", icon: RefreshCw },
  { mode: "insight", label: "用户洞察", description: "整理访谈、评论、工单和用户反馈。", icon: Users },
  { mode: "prd", label: "PRD 草拟", description: "把产品想法整理成可评审的需求文档。", icon: FileText },
];

const documentTransformOptions = [
  { value: "rewrite", label: "智能改写", description: "改善结构、表达和可读性，保留原始事实。" },
  { value: "summarize", label: "提炼摘要", description: "提取核心结论、风险和下一步动作。" },
  { value: "to_prd", label: "转换为 PRD", description: "整理为背景、需求范围和验收标准。" },
  { value: "to_outline", label: "整理为汇报提纲", description: "将长文整理为适合汇报的章节结构。" },
  { value: "translate_en", label: "翻译为英文", description: "将正文翻译为英文 Markdown。" },
  { value: "convert", label: "转换文档类型", description: "按目标类型重新组织文档内容。" },
] as const;

type DocumentTransformActionValue = (typeof documentTransformOptions)[number]["value"];

const navItems = [
  { href: "/", label: "工作台", icon: LayoutDashboard, match: (route: string) => route === "" },
  { href: "/tasks", label: "我的任务", icon: ListChecks, match: (route: string) => route.startsWith("tasks") },
  { href: "/research", label: "研究资料", icon: BookOpen, match: (route: string) => ["research", "evidence", "logs"].includes(route) },
  { href: "/docs", label: "产品文档", icon: FolderOpen, match: (route: string) => route === "docs" },
  { href: "/settings", label: "项目设置", icon: Settings, match: (route: string) => route.startsWith("settings") },
];

const routeTitles: Record<RouteKey, { title: string; subtitle: string }> = {
  "": { title: "今天要推进什么？", subtitle: "描述一个产品任务，Agent 会先理解目标，再开始执行。" },
  tasks: { title: "我的任务", subtitle: "查看任务状态、成本、执行记录和交付结果。" },
  "tasks/running": { title: "任务执行", subtitle: "实时查看 Agent 执行任务的进度、阶段和中间结果。" },
  "tasks/result": { title: "执行结果", subtitle: "查看 Agent 任务的完成结果、核心摘要和详细输出。" },
  research: { title: "研究资料", subtitle: "所有任务采集的资料、来源和证据集中在此查看和管理。" },
  docs: { title: "产品文档", subtitle: "管理 Agent 生成和团队维护的 PRD、报告与汇报材料。" },
  evidence: { title: "证据来源", subtitle: "审查关键结论对应的事实、推断、来源和可信度。" },
  logs: { title: "操作记录", subtitle: "追踪模型、工具、审批和文件生成的完整运行轨迹。" },
  settings: { title: "项目设置", subtitle: "管理项目偏好、输出规则和默认执行策略。" },
  "settings/api": { title: "项目设置", subtitle: "管理 API 连接、模型选择和团队成员配置。" },
  "settings/team": { title: "项目设置", subtitle: "管理 API 连接、模型选择和团队成员配置。" },
  "settings/notifications": { title: "项目设置", subtitle: "管理 API 连接、模型选择和团队成员配置。" },
  profile: { title: "个人中心", subtitle: "管理个人资料、偏好、审批和最近活动。" },
};

export function PrototypeApp({ route, query = {} }: { route: string; query?: PrototypeQuery }) {
  const currentRoute = route as RouteKey;
  const [menuOpen, setMenuOpen] = useState(false);
  const [toast, setToast] = useState("");
  const [inspectorTab, setInspectorTab] = useState<"info" | "evidence" | "logs">("info");
  const [model, setModel] = useState("GPT-5.6 Terra");
  const [runtimeStatus, setRuntimeStatus] = useState<AgentRuntimeStatus | null>(null);
  const [draftInspector, setDraftInspector] = useState<DraftInspectorState>({
    mode: "market",
    depth: "standard",
    autonomy: "draft",
  });
  const page = routeTitles[currentRoute];
  const useFluidPage = ["tasks", "research", "docs"].includes(currentRoute) || currentRoute.startsWith("settings");

  const refreshRuntime = useCallback(async () => {
    const status = await requestJson<AgentRuntimeStatus>("/api/settings/agent", { cache: "no-store" });
    setRuntimeStatus(status);
    return status;
  }, []);

  useEffect(() => {
    setMenuOpen(false);
  }, [route]);

  useEffect(() => {
    const load = () => { void refreshRuntime().catch(() => undefined); };
    load();
    window.addEventListener("focus", load);
    return () => window.removeEventListener("focus", load);
  }, [refreshRuntime]);

  function notify(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(""), 2400);
  }

  const showInspector = ["", "tasks/running", "tasks/result"].includes(route);

  return (
    <main className={`prototype-shell ${currentRoute === "" ? "is-workbench" : ""}`}>
      <Topbar model={model} setModel={setModel} onMenu={() => setMenuOpen(true)} />
      <Sidebar route={route} open={menuOpen} onClose={() => setMenuOpen(false)} runtimeStatus={runtimeStatus} />
      {menuOpen && <button className="sidebar-scrim" onClick={() => setMenuOpen(false)} aria-label="关闭菜单" />}

      <div className={`prototype-body ${showInspector ? "with-inspector" : ""}`}>
        <section className={`page-content ${currentRoute === "" ? "workbench-page-content" : ""} ${useFluidPage ? "fluid-page-content" : ""}`}>
          <PageHeader title={page.title} subtitle={page.subtitle} />
          <ViewRouter
            route={currentRoute}
            query={query}
            notify={notify}
            runtimeStatus={runtimeStatus}
            onRuntimeStatusChange={setRuntimeStatus}
            refreshRuntime={refreshRuntime}
            onDraftChange={setDraftInspector}
          />
        </section>
        {showInspector && <TaskInspector tab={inspectorTab} setTab={setInspectorTab} route={currentRoute} taskId={query.taskId} draft={draftInspector} model={model} />}
      </div>

      {toast && <div className="toast" role="status"><CheckCircle2 size={16} />{toast}</div>}
    </main>
  );
}

function Topbar({
  model,
  setModel,
  onMenu,
}: {
  model: string;
  setModel: (model: string) => void;
  onMenu: () => void;
}) {
  return (
    <header className="prototype-topbar">
      <div className="topbar-brand">
        <button className="plain-icon-button mobile-only" onClick={onMenu} title="打开菜单"><Menu size={17} /></button>
        <Link href="/" className="wordmark">PM Agent<span>.</span></Link>
      </div>
      <div className="topbar-tools">
        <label className="model-select">
          <BrainCircuit size={14} />
          <select value={model} onChange={(event) => setModel(event.target.value)} aria-label="当前模型">
            <option>GPT-5.6 Terra</option>
            <option>GPT-5.6 Luna</option>
            <option>GPT-5.6 Sol</option>
          </select>
          <ChevronDown size={13} />
        </label>
        <ThemeToggle />
        <button className="plain-icon-button" title="帮助"><HelpCircle size={16} /></button>
        <Link href="/profile" className="top-avatar" title="个人中心">P</Link>
      </div>
    </header>
  );
}

type ColorTheme = "light" | "dark";

function ThemeToggle() {
  const [theme, setTheme] = useState<ColorTheme | null>(null);

  useEffect(() => {
    const activeTheme = document.documentElement.dataset.theme === "dark" ? "dark" : "light";
    setTheme(activeTheme);
  }, []);

  function toggleTheme() {
    const activeTheme = document.documentElement.dataset.theme === "dark" ? "dark" : "light";
    const nextTheme: ColorTheme = activeTheme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = nextTheme;
    document.documentElement.style.colorScheme = nextTheme;
    try {
      localStorage.setItem("pm-agent-theme", nextTheme);
    } catch {
      // The visual preference still applies when browser storage is unavailable.
    }
    setTheme(nextTheme);
  }

  const targetTheme = theme === null ? null : theme === "dark" ? "白色" : "暗调";
  const toggleLabel = targetTheme ? `切换至${targetTheme}模式` : "切换颜色模式";

  return (
    <button
      type="button"
      className="plain-icon-button theme-toggle"
      onClick={toggleTheme}
      aria-label={toggleLabel}
      aria-pressed={theme === null ? undefined : theme === "dark"}
      title={toggleLabel}
    >
      <Moon className="theme-icon theme-icon-moon" size={16} />
      <Sun className="theme-icon theme-icon-sun" size={16} />
    </button>
  );
}

function Sidebar({ route, open, onClose, runtimeStatus }: {
  route: string;
  open: boolean;
  onClose: () => void;
  runtimeStatus: AgentRuntimeStatus | null;
}) {
  const apiLabel = runtimeStatus === null ? "检测中" : runtimeStatus.api.configured ? "已连接" : "未连接";
  const selectedMode = runtimeStatus?.selectedMode;
  const livePending = selectedMode === "live" && runtimeStatus?.mode !== "live";
  return (
    <aside className={`prototype-sidebar ${open ? "is-open" : ""}`}>
      <div className="sidebar-brand">
        <Image src="/assets/agentkit.svg" width={28} height={28} alt="" loading="eager" />
        <div><strong>PM Agent</strong><span>产品经理工作台</span></div>
        <button className="plain-icon-button mobile-only" onClick={onClose} title="关闭菜单"><X size={17} /></button>
      </div>
      <nav className="prototype-nav" aria-label="主导航">
        {navItems.map((item) => {
          const Icon = item.icon;
          return (
            <Link key={item.href} href={item.href} className={item.match(route) ? "active" : ""}>
              <Icon size={17} /><span>{item.label}</span>
            </Link>
          );
        })}
      </nav>
      <div className="sidebar-project">
        <strong>默认项目</strong>
        <span className={`api-state ${runtimeStatus?.api.configured ? "is-connected" : "is-disconnected"}`}><i />API: {apiLabel}</span>
        <span className={`mode-state ${livePending ? "is-pending" : selectedMode === "live" ? "is-live" : selectedMode === "demo" ? "is-demo" : "is-loading"}`}>
          {selectedMode === "live" ? <Activity size={12} /> : <Sparkles size={12} />}
          {livePending ? "正式模式（待连接）" : selectedMode === "live" ? "正式模式" : selectedMode === "demo" ? "演示模式" : "读取模式"}
        </span>
        <Link href="/profile" className="profile-row"><span className="avatar-small">PM</span><span>PM</span><MoreHorizontal size={16} /></Link>
      </div>
    </aside>
  );
}

function PageHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="page-header">
      <h1>{title}</h1>
      <p>{subtitle}</p>
    </div>
  );
}

function ViewRouter({
  route,
  query,
  notify,
  runtimeStatus,
  onRuntimeStatusChange,
  refreshRuntime,
  onDraftChange,
}: {
  route: RouteKey;
  query: PrototypeQuery;
  notify: (message: string) => void;
  runtimeStatus: AgentRuntimeStatus | null;
  onRuntimeStatusChange: (status: AgentRuntimeStatus) => void;
  refreshRuntime: () => Promise<AgentRuntimeStatus>;
  onDraftChange: (draft: DraftInspectorState) => void;
}) {
  if (route === "") return <WorkbenchView notify={notify} followUpTaskId={query.followUpTaskId} onDraftChange={onDraftChange} />;
  if (route === "tasks") return <TasksView />;
  if (route === "tasks/running") return <RunningView taskId={query.taskId} />;
  if (route === "tasks/result") return <ResultView taskId={query.taskId} notify={notify} />;
  if (route === "research") return <ResearchView notify={notify} />;
  if (route === "docs") return <DocumentsView initialQuery={query} notify={notify} />;
  if (route === "evidence") return <EvidenceView />;
  if (route === "logs") return <LogsView />;
  if (route === "profile") return <ProfileView notify={notify} />;
  return (
    <SettingsView
      route={route}
      notify={notify}
      runtimeStatus={runtimeStatus}
      onRuntimeStatusChange={onRuntimeStatusChange}
      refreshRuntime={refreshRuntime}
    />
  );
}

function WorkbenchView({ notify, followUpTaskId, onDraftChange }: {
  notify: (message: string) => void;
  followUpTaskId?: string;
  onDraftChange: (draft: DraftInspectorState) => void;
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<TaskMode>("market");
  const [depth, setDepth] = useState<RunDepth>("standard");
  const [autonomy, setAutonomy] = useState<AutonomyLevel>("draft");
  const [taskTitle, setTaskTitle] = useState("");
  const [prompt, setPrompt] = useState("");
  const [researchInput, setResearchInput] = useState<ResearchInput>({});
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [attachments, setAttachments] = useState<TaskAttachment[]>([]);
  const [persistedTaskId, setPersistedTaskId] = useState("");
  const [attachmentActionId, setAttachmentActionId] = useState("");
  const [products, setProducts] = useState<ProductSummary[]>([]);
  const [productId, setProductId] = useState("");
  const [productDialogOpen, setProductDialogOpen] = useState(false);
  const [researchBoundaryOpen, setResearchBoundaryOpen] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    onDraftChange({ mode, depth, autonomy });
  }, [autonomy, depth, mode, onDraftChange]);

  useEffect(() => {
    let active = true;
    requestJson<{ items: ProductSummary[] }>("/api/products")
      .then(({ items }) => {
        if (!active) return;
        setProducts(items);
        setProductId((current) => current || items[0]?.id || "");
      })
      .catch((reason: Error) => active && setError(reason.message));
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!followUpTaskId) return;
    let active = true;
    requestJson<TaskReviewResponse>(`/api/tasks/${encodeURIComponent(followUpTaskId)}/review`, { cache: "no-store" })
      .then((detail) => {
        if (!active) return;
        const sourceTask = detail.task;
        const resultContext = (detail.result?.output || detail.document?.currentVersion.content || "暂无可读取的结果正文。")
          .slice(0, 4_000);
        const followUpPrefix = `基于任务“${sourceTask.title}”的已审核结果继续推进。\n\n原任务背景：`;
        const followUpSuffix = `\n\n已归档结果：\n${resultContext}\n\n请结合以上结果，明确下一阶段目标、交付物和验收标准。`;
        const sourcePromptBudget = Math.max(0, 12_000 - followUpPrefix.length - followUpSuffix.length);
        setProductId(sourceTask.productId);
        setMode(sourceTask.type);
        setDepth(sourceTask.depth);
        setAutonomy(sourceTask.autonomy);
        const followUpTitle = `基于“${sourceTask.title}”的后续任务`;
        setTaskTitle(followUpTitle.length > 200 ? `${followUpTitle.slice(0, 199)}…` : followUpTitle);
        setPrompt(`${followUpPrefix}${sourceTask.prompt.slice(0, sourcePromptBudget)}${followUpSuffix}`);
      })
      .catch((reason: Error) => active && setError(reason.message));
    return () => { active = false; };
  }, [followUpTaskId]);

  async function startTask() {
    if (!productId) {
      setError("请先选择任务所属产品。");
      return;
    }
    const effectivePrompt = prompt.trim() || "分析中国 AI 会议产品市场，重点关注目标用户、主要竞品、定价和进入机会。";
    const generatedTitle = effectivePrompt.replace(/\s+/g, " ");
    const title = taskTitle.trim() || (generatedTitle.length > 42 ? `${generatedTitle.slice(0, 42)}…` : generatedTitle);
    setStarting(true);
    setError("");
    try {
      const normalizedResearchInput: ResearchInput = {
        ...researchInput,
        researchQuestions: researchInput.researchQuestions?.filter(Boolean),
        competitorNames: researchInput.competitorNames?.filter(Boolean),
        allowedDomains: researchInput.allowedDomains?.filter(Boolean),
      };
      let taskId = persistedTaskId;
      if (!taskId) {
        const persisted = await requestJson<TaskRecord>("/api/tasks", {
          method: "POST",
          body: JSON.stringify({
            productId,
            title,
            prompt: effectivePrompt,
            type: mode,
            depth,
            autonomy,
            budgetCents: DEFAULT_TASK_BUDGET_CENTS,
            researchInput: normalizedResearchInput,
          }),
        });
        taskId = persisted.id;
        setPersistedTaskId(taskId);
      }

      let prepared = [...attachments];
      let remainingFiles = [...pendingFiles];
      for (const file of pendingFiles) {
        const form = new FormData();
        form.set("file", file);
        const result = await requestJson<{ attachment: TaskAttachment }>(`/api/tasks/${encodeURIComponent(taskId)}/attachments`, {
          method: "POST",
          body: form,
        });
        prepared = upsertAttachment(prepared, result.attachment);
        setAttachments(prepared);
        remainingFiles = remainingFiles.slice(1);
        setPendingFiles(remainingFiles);
      }

      for (const attachment of prepared) {
        if (attachment.status !== "uploaded" && attachment.status !== "failed") continue;
        setAttachments((current) => current.map((item) => item.id === attachment.id ? { ...item, status: "parsing", errorCode: null, errorMessage: null } : item));
        const result = await requestJson<{ attachment: TaskAttachment; error?: string }>(
          `/api/tasks/${encodeURIComponent(taskId)}/attachments/${encodeURIComponent(attachment.id)}/parse`,
          { method: "POST" },
        );
        prepared = upsertAttachment(prepared, result.attachment);
        setAttachments(prepared);
      }

      const blocked = prepared.filter((attachment) => attachment.status !== "ready");
      if (blocked.length > 0) {
        setError(`${blocked.length} 个附件尚未就绪，请重试解析或移除后再执行。`);
        return;
      }

      const task: DraftTask = { productId, taskId, title, prompt: effectivePrompt, mode, depth, autonomy };
      sessionStorage.setItem("pm-agent-draft-task", JSON.stringify(task));
      sessionStorage.setItem("pm-agent-task-id", taskId);
      sessionStorage.setItem("pm-agent-start-task-id", taskId);
      sessionStorage.removeItem("pm-agent-result");
      router.push(`/tasks/running?taskId=${encodeURIComponent(taskId)}`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "任务创建失败。");
    } finally {
      setStarting(false);
    }
  }

  async function retryAttachment(attachment: TaskAttachment) {
    if (!persistedTaskId) return;
    setAttachmentActionId(attachment.id);
    setError("");
    setAttachments((current) => current.map((item) => item.id === attachment.id ? { ...item, status: "parsing", errorCode: null, errorMessage: null } : item));
    try {
      const result = await requestJson<{ attachment: TaskAttachment; error?: string }>(
        `/api/tasks/${encodeURIComponent(persistedTaskId)}/attachments/${encodeURIComponent(attachment.id)}/parse`,
        { method: "POST" },
      );
      setAttachments((current) => upsertAttachment(current, result.attachment));
      if (result.attachment.status === "failed") setError(result.attachment.errorMessage ?? "附件解析失败。");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "附件重试失败。");
      const listed = await requestJson<{ items: TaskAttachment[] }>(`/api/tasks/${encodeURIComponent(persistedTaskId)}/attachments`, { cache: "no-store" }).catch(() => null);
      if (listed) setAttachments(listed.items);
    } finally {
      setAttachmentActionId("");
    }
  }

  async function removeAttachment(attachment: TaskAttachment) {
    if (!persistedTaskId) return;
    setAttachmentActionId(attachment.id);
    setError("");
    try {
      await requestJson<{ removed: boolean }>(
        `/api/tasks/${encodeURIComponent(persistedTaskId)}/attachments/${encodeURIComponent(attachment.id)}`,
        { method: "DELETE" },
      );
      setAttachments((current) => current.filter((item) => item.id !== attachment.id));
      notify(`已移除附件“${attachment.fileName}”`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "附件移除失败。");
    } finally {
      setAttachmentActionId("");
    }
  }

  function handleProductCreated(product: ProductSummary) {
    setProducts((current) => [product, ...current]);
    setProductId(product.id);
    setProductDialogOpen(false);
    notify(`已创建产品“${product.name}”`);
  }

  return (
    <div className="workbench-stack">
      <div className="workflow-grid">
        {workflowOptions.map((option) => {
          const Icon = option.icon;
          return (
            <button key={option.mode} className={`workflow-card ${mode === option.mode ? "active" : ""}`} onClick={() => setMode(option.mode)}>
              <Icon size={21} />
              <strong>{option.label}</strong>
              <span>{option.description}</span>
              {mode === option.mode && <Check size={15} className="workflow-check" />}
            </button>
          );
        })}
      </div>

      <section className="task-builder panel">
        <label className="workbench-field" htmlFor="task-title">
          <span className="workbench-field-label">任务标题 <small>可选</small></span>
          <input
            id="task-title"
            value={taskTitle}
            maxLength={200}
            autoComplete="off"
            onChange={(event) => setTaskTitle(event.target.value)}
            placeholder="例如：AI 会议产品下一阶段增长验证"
          />
        </label>

        <label className="workbench-field" htmlFor="task-prompt">
          <span className="workbench-field-label">任务描述</span>
          <textarea
            id="task-prompt"
            value={prompt}
            maxLength={12_000}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder="例如：分析中国 AI 会议产品市场，重点关注目标用户、主要竞品、定价和进入机会。"
          />
        </label>

        <div className="builder-toolbar">
          <input ref={fileRef} type="file" hidden multiple accept=".md,.markdown,.txt,.html,.htm,.pdf,.docx,.pptx,.xlsx,.csv,.json" onChange={(event) => {
            setPendingFiles((current) => [...current, ...Array.from(event.target.files ?? [])]);
            event.target.value = "";
          }} />
          <button className="workbench-attachment-button" type="button" onClick={() => fileRef.current?.click()}><Paperclip size={14} />{pendingFiles.length > 0 ? `附件 ${pendingFiles.length} 个` : "附件"}</button>
          {attachments.length > 0 && <span className="toolbar-note">{attachments.filter((attachment) => attachment.status === "ready").length}/{attachments.length} 已就绪</span>}
          <div className="workbench-type-picker">
            <span>任务类型</span>
            <Segmented
              items={workflowOptions.map((item) => ({ value: item.mode, label: item.label }))}
              value={mode}
              onChange={(value) => setMode(value as TaskMode)}
            />
          </div>
        </div>

        {(pendingFiles.length > 0 || attachments.length > 0) && <div className="workbench-attachment-list" aria-live="polite">
          {pendingFiles.map((file, index) => <div className="workbench-attachment-row" key={`${file.name}-${file.size}-${file.lastModified}-${index}`}>
            <FileText size={16} />
            <span><strong title={file.name}>{file.name}</strong><small>{formatFileSize(file.size)} · 等待上传</small></span>
            <Tag tone="gray">待上传</Tag>
            <button type="button" className="icon-button" title="移除附件" aria-label={`移除 ${file.name}`} disabled={starting} onClick={() => setPendingFiles((current) => current.filter((_, itemIndex) => itemIndex !== index))}><X size={15} /></button>
          </div>)}
          {attachments.map((attachment) => {
            const statusLabel = attachment.status === "uploaded" ? "已上传" : attachment.status === "parsing" ? "解析中" : attachment.status === "ready" ? "已就绪" : attachment.status === "failed" ? "解析失败" : "已拒绝";
            const statusTone = attachment.status === "ready" ? "green" : attachment.status === "failed" || attachment.status === "rejected" ? "red" : attachment.status === "parsing" ? "blue" : "gray";
            const busy = attachmentActionId === attachment.id || attachment.status === "parsing";
            return <div className={`workbench-attachment-row status-${attachment.status}`} key={attachment.id}>
              {attachment.status === "parsing" ? <LoaderCircle size={16} className="spin" /> : attachment.status === "failed" || attachment.status === "rejected" ? <AlertTriangle size={16} /> : <FileText size={16} />}
              <span><strong title={attachment.fileName}>{attachment.fileName}</strong><small>{attachment.errorMessage || `${formatFileSize(attachment.byteSize)} · ${attachment.status === "ready" ? "可供 Agent 引用" : "状态已保存"}`}</small></span>
              <Tag tone={statusTone}>{statusLabel}</Tag>
              {(attachment.status === "failed" || attachment.status === "rejected") && <button type="button" className="icon-button" title="重试解析" aria-label={`重试解析 ${attachment.fileName}`} disabled={busy || starting} onClick={() => void retryAttachment(attachment)}><RefreshCw size={15} /></button>}
              <button type="button" className="icon-button" title="移除附件" aria-label={`移除 ${attachment.fileName}`} disabled={busy || starting} onClick={() => void removeAttachment(attachment)}><X size={15} /></button>
            </div>;
          })}
        </div>}

        <section className={`workbench-boundary ${researchBoundaryOpen ? "is-open" : ""}`} aria-label="研究边界">
          <button type="button" className="workbench-boundary-toggle" aria-expanded={researchBoundaryOpen} onClick={() => setResearchBoundaryOpen((open) => !open)}>
            <ChevronRight size={14} />
            <strong>研究边界</strong>
            <span className="workbench-optional-tag">可选</span>
            <small>这些字段会随任务保存，并作为 Agent 的正式上下文</small>
          </button>
          <div className="workbench-boundary-body">
            <div className="research-input-grid">
              <label>目标地区<input value={researchInput.region ?? ""} onChange={(event) => setResearchInput((current) => ({ ...current, region: event.target.value }))} placeholder="例如：中国大陆" /></label>
              <label>时间范围<input value={researchInput.timeRange ?? ""} onChange={(event) => setResearchInput((current) => ({ ...current, timeRange: event.target.value }))} placeholder="例如：2025-2026" /></label>
              <label>目标用户<input value={researchInput.targetUsers ?? ""} onChange={(event) => setResearchInput((current) => ({ ...current, targetUsers: event.target.value }))} placeholder="例如：50-500 人的互联网团队" /></label>
              <label>允许域名<input value={researchInput.allowedDomains?.join(", ") ?? ""} onChange={(event) => setResearchInput((current) => ({ ...current, allowedDomains: event.target.value.split(/[,，\s]+/).map((item) => item.trim().toLowerCase()).filter(Boolean) }))} placeholder="例如：36kr.com, gov.cn" /></label>
              {(mode === "competitor" || mode === "market") && <label className="is-wide">竞品名称<input value={researchInput.competitorNames?.join(", ") ?? ""} onChange={(event) => setResearchInput((current) => ({ ...current, competitorNames: event.target.value.split(/[,，\n]+/).map((item) => item.trim()).filter(Boolean) }))} placeholder="例如：飞书会议、腾讯会议、Zoom" /></label>}
              {(mode === "competitor" || mode === "insight") && <label className="is-wide">体验/样本范围<input value={researchInput.experienceScope ?? ""} onChange={(event) => setResearchInput((current) => ({ ...current, experienceScope: event.target.value }))} placeholder="例如：注册、核心流程和定价页" /></label>}
            </div>
          </div>
        </section>

        <label className="workbench-field">
          <span className="workbench-field-label">研究问题</span>
          <textarea className="workbench-textarea-small" value={researchInput.researchQuestions?.join("\n") ?? ""} onChange={(event) => setResearchInput((current) => ({ ...current, researchQuestions: event.target.value.split(/\n+/).map((item) => item.trim()).filter(Boolean) }))} placeholder="每行一个要验证的问题" />
        </label>

        <label className="workbench-field">
          <span className="workbench-field-label">其他约束</span>
          <textarea className="workbench-textarea-small" value={researchInput.constraints ?? ""} onChange={(event) => setResearchInput((current) => ({ ...current, constraints: event.target.value }))} placeholder="例如：仅使用公开信息，不进行外部访问" />
        </label>

        <label className="workbench-field">
          <span className="workbench-field-label">所属产品</span>
          <span className="workbench-select">
            <select
              value={productId}
              onChange={(event) => {
                if (event.target.value === "__create__") setProductDialogOpen(true);
                else setProductId(event.target.value);
              }}
              aria-label="所属产品"
            >
              {products.length === 0 && <option value="">暂无产品</option>}
              {products.map((product) => <option value={product.id} key={product.id}>{product.name}</option>)}
              <option value="__create__">+ 新建产品</option>
            </select>
          </span>
        </label>

        <div className="builder-options">
          <OptionGroup label="执行深度" hint="标准深度平衡速度与质量，适合大多数任务。">
            <Segmented items={[{ value: "quick", label: "快速" }, { value: "standard", label: "标准" }, { value: "deep", label: "深度" }]} value={depth} onChange={(value) => setDepth(value as RunDepth)} />
          </OptionGroup>
          <OptionGroup label="自治级别" hint="Agent 会先生成草稿，关键步骤需你确认。">
            <Segmented items={[{ value: "advise", label: "仅建议" }, { value: "draft", label: "生成草稿" }, { value: "scoped", label: "有限执行" }]} value={autonomy} onChange={(value) => setAutonomy(value as AutonomyLevel)} />
            {autonomy === "scoped" && <div className="workbench-autonomy-warning"><AlertTriangle size={14} />有限执行下 Agent 可直接调用工具，请确认任务范围。</div>}
          </OptionGroup>
        </div>

        {error && <div className="builder-error" role="alert"><AlertTriangle size={14} />{error}</div>}
        <div className="builder-footer">
          <span><HelpCircle size={14} />Agent 仅使用公开信息，外部访问受域名白名单限制</span>
          <button className="primary-button" disabled={starting || !productId} onClick={startTask}>{starting ? <LoaderCircle size={15} className="spin" /> : <Play size={15} fill="currentColor" />}{starting ? "正在准备附件" : persistedTaskId ? "继续执行" : "开始执行"}</button>
        </div>
      </section>
      {productDialogOpen && <ProductDialog onClose={() => setProductDialogOpen(false)} onCreated={handleProductCreated} />}
    </div>
  );
}

function Segmented({ items, value, onChange }: { items: Array<{ value: string; label: string }>; value: string; onChange: (value: string) => void }) {
  return (
    <div className="segmented">
      {items.map((item) => <button key={item.value} className={value === item.value ? "active" : ""} onClick={() => onChange(item.value)}>{item.label}</button>)}
    </div>
  );
}

function OptionGroup({ label, hint, children }: { label: string; hint: string; children: React.ReactNode }) {
  return <div className="option-group" role="group" aria-label={label}><span className="option-label">{label}</span>{children}<p>{hint}</p></div>;
}

function TasksView() {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<TaskStatus | "">("");
  const [metric, setMetric] = useState<TaskMetric>("month");
  const [data, setData] = useState<TaskListResponse>({
    items: [],
    summary: { monthCount: 0, runningCount: 0, reviewCount: 0, changesRequestedCount: 0, monthCostCents: 0 },
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [costOpen, setCostOpen] = useState(false);
  const [costTasks, setCostTasks] = useState<TaskRecord[]>([]);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams({ metric });
      if (query.trim()) params.set("query", query.trim());
      if (status) params.set("status", status);
      setLoading(true);
      setError("");
      requestJson<TaskListResponse>(`/api/tasks?${params.toString()}`, { signal: controller.signal })
        .then(setData)
        .catch((reason: Error) => {
          if (reason.name !== "AbortError") setError(reason.message);
        })
        .finally(() => setLoading(false));
    }, 180);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [metric, query, status]);

  useEffect(() => {
    if (!costOpen) return;
    requestJson<TaskListResponse>("/api/tasks?metric=month")
      .then(({ items }) => setCostTasks([...items].sort((a, b) => (b.costCents ?? -1) - (a.costCents ?? -1))))
      .catch((reason: Error) => setError(reason.message));
  }, [costOpen]);

  const hasFilters = Boolean(query.trim()) || Boolean(status) || metric !== "month";
  const resetFilters = () => { setQuery(""); setStatus(""); setMetric("month"); };
  return (
    <div className="data-page tasks-page">
      <div className="table-toolbar">
        <label className="search-field"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索任务名称或类型" /></label>
        <select value={status} onChange={(event) => setStatus(event.target.value as TaskStatus | "")} aria-label="任务状态">
          <option value="">全部状态</option>
          {(Object.entries(TASK_STATUS_LABELS) as Array<[TaskStatus, string]>).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
        </select>
        <Link className="primary-button" href="/"><Plus size={15} />新建任务</Link>
      </div>
      <div className="metrics-row task-metrics-row">
        <Metric label="本月任务" value={String(data.summary.monthCount)} icon={ListChecks} tone="blue" active={metric === "month"} onClick={() => setMetric("month")} />
        <Metric label="执行中" value={String(data.summary.runningCount)} icon={Activity} tone="green" active={metric === "running"} onClick={() => setMetric("running")} />
        <Metric label="待审核" value={String(data.summary.reviewCount)} icon={ShieldCheck} tone="amber" active={metric === "review"} onClick={() => setMetric("review")} />
        <Metric label="待修改" value={String(data.summary.changesRequestedCount ?? 0)} icon={Pencil} tone="red" active={metric === "changes_requested"} onClick={() => setMetric("changes_requested")} />
        <Metric label="本月费用" value={formatCurrency(data.summary.monthCostCents)} icon={CircleDollarSign} tone="violet" active={costOpen} onClick={() => setCostOpen(true)} />
      </div>
      <div className="research-filter-summary"><span>{loading ? "正在读取任务" : `当前显示 ${data.items.length} 个任务`}</span>{hasFilters && <button className="text-button" onClick={resetFilters}><X size={13} />清除筛选</button>}</div>
      {error && <div className="notice warning" role="alert"><AlertTriangle size={15} />{error}</div>}
      <DataTable headers={["任务", "类型", "状态", "创建时间", "费用", "操作"]}>
        {data.items.map((task) => (
          <tr key={task.id}>
            <td data-label="任务"><Link href={taskHref(task)} className="table-title">{task.title}</Link><small>{task.id} · {task.productName}</small></td>
            <td data-label="类型"><Tag tone="blue">{TASK_TYPE_LABELS[task.type]}</Tag></td>
            <td data-label="状态"><Status value={TASK_STATUS_LABELS[task.status]} /></td>
            <td data-label="创建时间" className="mono">{formatWorkspaceDate(task.createdAt)}</td>
            <td data-label="费用" className="mono">{formatCurrency(task.costCents)}</td>
            <td data-label="操作"><Link className="table-action" href={taskHref(task)}>{taskActionLabel(task.status)}<ExternalLink size={13} /></Link></td>
          </tr>
        ))}
        {!loading && data.items.length === 0 && <tr><td colSpan={6}><div className="empty-table-state"><ListChecks size={18} /><strong>没有符合条件的任务</strong><span>调整状态、统计卡片或搜索词后重新查看。</span><button className="secondary-button" onClick={resetFilters}>清除筛选</button></div></td></tr>}
      </DataTable>
      {costOpen && (
        <Modal title="本月费用明细" subtitle={`共 ${costTasks.length} 个任务，累计 ${formatCurrency(data.summary.monthCostCents)}`} onClose={() => setCostOpen(false)}>
          <div className="cost-breakdown">
            {costTasks.map((task) => <Link href={documentHref(task)} key={task.id}><div><strong>{task.title}</strong><span>{task.productName} · {task.id}</span></div><b>{formatCurrency(task.costCents)}</b><ChevronRight size={15} /></Link>)}
            {costTasks.length === 0 && <div className="dialog-empty">本月暂无任务费用。</div>}
          </div>
        </Modal>
      )}
    </div>
  );
}

function RunningView({ taskId }: { taskId?: string }) {
  const router = useRouter();
  const [task, setTask] = useState<TaskRecord | null>(null);
  const [run, setRun] = useState<TaskRunRecord | null>(null);
  const [result, setResult] = useState<AgentRunResponse | null>(null);
  const [documentId, setDocumentId] = useState("");
  const [error, setError] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const [starting, setStarting] = useState(false);
  const [canceling, setCanceling] = useState(false);
  const [queueHealth, setQueueHealth] = useState<QueueHealth | null>(null);

  useEffect(() => {
    const activeTaskId = taskId || sessionStorage.getItem("pm-agent-task-id") || "";
    if (!activeTaskId) {
      setError("没有找到要执行的任务，请返回工作台重新创建。");
      return;
    }

    let disposed = false;
    let pollTimer = 0;
    let startRequested = sessionStorage.getItem("pm-agent-start-task-id") === activeTaskId;
    if (startRequested) sessionStorage.removeItem("pm-agent-start-task-id");

    const applyPayload = (payload: TaskRunStatusResponse) => {
      setTask(payload.task);
      setRun(payload.run);
      if (payload.result) {
        setResult(payload.result);
        setDocumentId(payload.document?.id ?? "");
        sessionStorage.setItem("pm-agent-result", JSON.stringify(payload.result));
        sessionStorage.setItem("pm-agent-document-id", payload.document?.id ?? "");
      }
      if (payload.run.status === "failed") setError(payload.run.errorMessage ?? "任务执行失败。");
      if (payload.run.status === "cancelled") setError(payload.run.errorMessage ?? "任务已取消。");
    };

    const poll = async () => {
      if (disposed) return;
      try {
        const record = await requestJson<TaskRecord>(`/api/tasks/${encodeURIComponent(activeTaskId)}`);
        // Load the task header independently from the run. Existing tasks may not
        // have a queued run yet, but the progress page should still identify them.
        if (!disposed) setTask(record);
        if (startRequested) {
          startRequested = false;
          const queued = await requestJson<TaskRunStatusResponse>(`/api/tasks/${encodeURIComponent(activeTaskId)}/run`, { method: "POST" });
          if (!disposed) applyPayload(queued);
        } else {
          try {
            const status = await requestJson<TaskRunStatusResponse>(`/api/tasks/${encodeURIComponent(activeTaskId)}/run`, { cache: "no-store" });
            if (!disposed) applyPayload(status);
          } catch (reason) {
            // A task can be opened from a deep link before its first run. Keep the
            // progress surface usable instead of treating that empty state as a failure.
            if (!(reason instanceof Error) || !reason.message.includes("还没有运行记录")) throw reason;
            if (!disposed) {
              setRun(null);
              setResult(null);
              setDocumentId("");
              setError("");
            }
          }
        }
        if (!disposed) pollTimer = window.setTimeout(() => void poll(), 800);
      } catch (reason) {
        if (!disposed) setError(reason instanceof Error ? reason.message : "读取运行状态失败。");
      }
    };

    void poll();
    const ticker = window.setInterval(() => setNow(Date.now()), 1000);
    const refreshQueue = () => void requestJson<QueueHealth>("/api/settings/queue", { cache: "no-store" }).then(setQueueHealth).catch(() => setQueueHealth({ connected: false, workers: 0, latencyMs: null, queueName: "pm-agent-runs" }));
    refreshQueue();
    const queueTicker = window.setInterval(refreshQueue, 5_000);
    return () => { disposed = true; window.clearTimeout(pollTimer); window.clearInterval(ticker); window.clearInterval(queueTicker); };
  }, [taskId]);

  const steps = ["理解任务", "制定研究计划", "收集信息", "分析与交叉验证", "生成交付物"];
  const terminal = !run || run.status === "completed" || run.status === "failed" || run.status === "cancelled";
  const complete = run?.status === "completed";
  const stageIndex = timelineStageIndex(run?.status === "failed" ? run.failureStage ?? run.stage : run?.stage);
  const elapsedStart = run?.startedAt ?? run?.queuedAt;
  const elapsedEnd = terminal && run?.completedAt ? new Date(run.completedAt).getTime() : now;
  const elapsed = elapsedStart ? Math.max(0, Math.round((elapsedEnd - new Date(elapsedStart).getTime()) / 1000)) : 0;
  const currentAction = run?.currentAction || (run?.status === "queued" ? "等待 Worker 接手" : run ? "正在读取运行状态" : "尚未开始执行");

  async function cancelTask() {
    if (!task || !run || run.status !== "running" && run.status !== "queued") return;
    setCanceling(true);
    try {
      const payload = await requestJson<TaskRunStatusResponse>(`/api/tasks/${encodeURIComponent(task.id)}/run/cancel`, { method: "POST" });
      setRun(payload.run);
      setTask(payload.task);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "取消任务失败。");
    } finally {
      setCanceling(false);
    }
  }

  async function startTaskRun() {
    if (!task || starting) return;
    setStarting(true);
    setError("");
    try {
      const payload = await requestJson<TaskRunStatusResponse>(`/api/tasks/${encodeURIComponent(task.id)}/run`, { method: "POST" });
      setTask(payload.task);
      setRun(payload.run);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "任务启动失败。");
    } finally {
      setStarting(false);
    }
  }

  function retryTask() {
    if (!task) return;
    sessionStorage.setItem("pm-agent-task-id", task.id);
    sessionStorage.setItem("pm-agent-start-task-id", task.id);
    window.location.assign(`/tasks/running?taskId=${encodeURIComponent(task.id)}&retry=${Date.now()}`);
  }

  return (
    <div className="running-page">
      {result?.demo && <div className="notice warning"><AlertTriangle size={16} />演示模式会保存任务与文档，但不会把示例内容当作真实研究结论。</div>}
      {queueHealth && !queueHealth.connected && <div className="notice danger"><AlertTriangle size={16} />Redis 队列未连接，无法启动新的任务。</div>}
      {queueHealth?.connected && queueHealth.workers === 0 && <div className="notice warning"><AlertTriangle size={16} />队列已连接，但暂无可用 Worker。请启动独立 Worker。</div>}
      {queueHealth?.connected && queueHealth.workers > 0 && <div className="notice success"><CheckCircle2 size={16} />队列已连接 · {queueHealth.workers} 个 Worker 可用 · {queueHealth.latencyMs} ms</div>}
      {error && <div className="notice danger" role="alert"><AlertTriangle size={16} /><span>任务在{run?.failureStage ? runStageLabel(run.failureStage) : "历史运行"}阶段失败 · {run?.errorCode ?? "RUN_FAILED"}：{error}</span></div>}
      <div className="task-strip panel"><div><strong>{task?.title ?? "正在读取任务"}</strong>{task && <Tag tone="blue">{TASK_TYPE_LABELS[task.type]}</Tag>}</div><div><span>{run?.model ?? "等待 Worker"}</span>{run && (run.status === "running" || run.status === "queued") && <button className="danger-button" onClick={() => void cancelTask()} disabled={canceling}><Square size={13} />{canceling ? "正在取消" : "取消任务"}</button>}</div></div>
      <section className="panel stage-panel">
        <div className="panel-title"><h2>执行阶段</h2><Tag tone={complete ? "green" : run?.status === "failed" || run?.status === "cancelled" ? "amber" : "blue"}>{runStatusLabel(run?.status, task?.status)}</Tag></div>
        <ol className="timeline">
          {steps.map((label, index) => {
            const done = Boolean(run) && (complete || index < stageIndex);
            const active = Boolean(run) && !terminal && index === stageIndex;
            return <li key={label} className={done ? "done" : active ? "active" : ""}><span>{done ? <Check size={12} /> : active ? <LoaderCircle size={12} className="spin" /> : index + 1}</span><strong>{label}</strong><small>{done ? "已完成" : active ? "进行中" : "未开始"}</small></li>;
          })}
        </ol>
      </section>
      <div className={`live-status ${!run ? "is-idle" : run.status === "failed" || run.status === "cancelled" ? "is-terminal" : ""}`}><LoaderCircle size={16} className={terminal ? "" : "spin"} /><strong>{error ? currentAction : complete ? "研究结果已归档到产品文档" : currentAction}</strong><span>已用 {elapsed} 秒 · 进度 {run?.progress ?? 0}%</span></div>
      <div className="metrics-row">
        <Metric label="已用时间" value={`${elapsed} 秒`} icon={Clock3} tone="blue" />
        <Metric label="实际费用" value={run?.costCents === null || run?.costCents === undefined ? (terminal ? "--" : "计算中") : formatCurrency(run.costCents)} icon={CircleDollarSign} tone="green" />
        <Metric label="已访问来源" value={String(run?.visitedSourceCount ?? 0)} icon={Globe2} tone="violet" />
        <Metric label="已形成证据" value={String(run?.evidenceCount ?? 0)} icon={ShieldCheck} tone="amber" />
      </div>
      {run?.currentQuery && <div className="run-query panel"><Search size={15} /><div><span>当前搜索词</span><strong>{run.currentQuery}</strong></div></div>}
      <section className="run-events panel"><div className="panel-title"><h2>执行详情</h2><span>{run?.events.length ?? 0} 条记录</span></div>{run?.events.length ? <div className="run-event-list">{run.events.slice().reverse().map((event) => <div className="run-event" key={event.id}><time>{formatWorkspaceDate(event.createdAt)}</time><div><strong>{event.action}</strong><p>{event.detail}</p>{event.url && <a href={event.url} target="_blank" rel="noreferrer">{event.sourceTitle || event.url}<ExternalLink size={12} /></a>}</div></div>)}</div> : <div className="run-events-empty">任务入队后，Worker 会在这里记录实时执行过程。</div>}</section>
      <div className="running-actions">
        {!run ? <button className="primary-button" disabled={!task || starting || !queueHealth?.connected || queueHealth.workers === 0} onClick={() => void startTaskRun()}>{starting ? <LoaderCircle size={15} className="spin" /> : <Play size={15} fill="currentColor" />}{starting ? "正在启动" : "开始执行"}</button> : <>
          {(run.status === "failed" || run.status === "cancelled") && <button className="secondary-button" onClick={retryTask}><RefreshCw size={15} />重新执行</button>}
          <button className="primary-button" disabled={!complete || !task} onClick={() => router.push(`/tasks/result?taskId=${encodeURIComponent(task!.id)}${documentId ? `&documentId=${encodeURIComponent(documentId)}` : ""}`)}>查看结果<ChevronRight size={15} /></button>
        </>}
      </div>
    </div>
  );
}

function timelineStageIndex(stage?: TaskRunStage): number {
  if (!stage) return -1;
  if (stage === "queued" || stage === "planning") return 0;
  if (stage === "searching") return 2;
  if (stage === "analyzing" || stage === "evidence") return 3;
  return 4;
}

function runStatusLabel(status?: TaskRunRecord["status"], taskStatus?: TaskStatus): string {
  if (status === "queued") return "排队中";
  if (status === "running") return "运行中";
  if (taskStatus === "review") return "待审核";
  if (taskStatus === "changes_requested") return "待修改";
  if (status === "completed") return "已完成";
  if (status === "failed") return "执行失败";
  if (status === "cancelled") return "已取消";
  if (taskStatus === "failed") return "任务失败";
  if (taskStatus === "cancelled") return "已取消";
  if (taskStatus === "completed") return "已完成";
  return "未开始";
}

function runStageLabel(stage: TaskRunStage): string {
  if (stage === "queued") return "排队";
  if (stage === "planning") return "任务理解与规划";
  if (stage === "searching") return "信息收集";
  if (stage === "analyzing") return "分析与交叉验证";
  if (stage === "evidence") return "证据检查";
  if (stage === "archiving") return "文档归档";
  if (stage === "cancelled") return "取消";
  return "执行";
}

function ResultView({ taskId, notify }: { taskId?: string; notify: (message: string) => void }) {
  const router = useRouter();
  const [generating, setGenerating] = useState("");
  const [agentOutput, setAgentOutput] = useState<AgentRunResponse | null>(null);
  const [task, setTask] = useState<TaskRecord | null>(null);
  const [reviewDetail, setReviewDetail] = useState<TaskReviewResponse | null>(null);
  const [reviewDialog, setReviewDialog] = useState<"approved" | "changes_requested" | null>(null);
  const [reviewNote, setReviewNote] = useState("");
  const [savingReview, setSavingReview] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadReview = useCallback(async () => {
    const activeTaskId = taskId || sessionStorage.getItem("pm-agent-task-id");
    if (!activeTaskId) {
      setError("没有找到要审核的任务。");
      setLoading(false);
      return;
    }
    setError("");
    try {
      const detail = await requestJson<TaskReviewResponse>(`/api/tasks/${encodeURIComponent(activeTaskId)}/review`, { cache: "no-store" });
      setReviewDetail(detail);
      setTask(detail.task);
      setAgentOutput(detail.result ?? null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "审核详情加载失败。");
    } finally {
      setLoading(false);
    }
  }, [taskId]);

  useEffect(() => { void loadReview(); }, [loadReview]);

  async function generate(name: string, format: DocumentFormat) {
    if (!task) return;
    setGenerating(name);
    setError("");
    try {
      const document = await requestJson<DocumentDetail>("/api/documents", {
        method: "POST",
        body: JSON.stringify({
          taskId: task.id,
          title: `${task.title} · ${DOCUMENT_FORMAT_LABELS[format]}`,
          content: agentOutput?.output ?? `# ${task.title}\n\n该文档由任务结果创建，内容等待进一步完善。`,
          format,
          owner: "PM",
        }),
      });
      notify(`${DOCUMENT_FORMAT_LABELS[format]} 已保存到产品文档`);
      router.push(documentHref(task, document.id));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "文档保存失败。");
    } finally {
      setGenerating("");
    }
  }

  async function submitReview() {
    if (!task || !reviewDialog) return;
    setSavingReview(true);
    setError("");
    try {
      const detail = await requestJson<TaskReviewResponse>(`/api/tasks/${encodeURIComponent(task.id)}/review`, {
        method: "POST",
        body: JSON.stringify({ decision: reviewDialog, note: reviewNote, baseUpdatedAt: task.updatedAt }),
      });
      setReviewDetail(detail);
      setTask(detail.task);
      setAgentOutput(detail.result ?? agentOutput);
      setReviewDialog(null);
      setReviewNote("");
      notify(reviewDialog === "approved" ? "审核已通过，任务已完成。" : "任务已退回修改。提交修改或重新执行后可再次审核。");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "审核提交失败。");
    } finally {
      setSavingReview(false);
    }
  }

  async function resubmitReview() {
    if (!task || !reviewDetail?.document) return;
    setSavingReview(true);
    setError("");
    try {
      await requestJson<TaskReviewResponse>(`/api/tasks/${encodeURIComponent(task.id)}/review/resubmit`, {
        method: "POST",
        body: JSON.stringify({
          baseUpdatedAt: task.updatedAt,
          documentRevision: reviewDetail.document.currentRevision,
          note: "产品文档已修改完成，提交复审。",
        }),
      });
      await loadReview();
      notify("文档已提交复审，任务重新进入待审核。");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "提交复审失败。");
    } finally {
      setSavingReview(false);
    }
  }

  function rerunTask() {
    if (!task) return;
    sessionStorage.setItem("pm-agent-task-id", task.id);
    sessionStorage.setItem("pm-agent-start-task-id", task.id);
    window.location.assign(`/tasks/running?taskId=${encodeURIComponent(task.id)}&retry=${Date.now()}`);
  }

  const latestReview = reviewDetail?.reviews[0];
  const completed = task?.status === "completed";
  const reviewPending = task?.status === "review";
  const changesRequested = task?.status === "changes_requested";
  const reviewStatusLabel = task ? TASK_STATUS_LABELS[task.status] : loading ? "读取中" : "未知";

  if (loading && !task) {
    return <div className="result-page"><div className="notice warning"><LoaderCircle size={15} className="spin" />正在读取服务端审核详情...</div></div>;
  }
  if (!task) {
    return <div className="result-page"><div className="notice danger" role="alert"><AlertTriangle size={15} />{error || "审核任务不存在。"}</div></div>;
  }

  return (
    <div className="result-page">
      {error && <div className="notice danger" role="alert"><AlertTriangle size={15} />{error}</div>}
      <section className="result-hero panel">
        <div className="result-title"><span className={`success-icon ${reviewPending ? "is-review" : changesRequested ? "is-changes" : ""}`}>{completed ? <Check size={18} /> : changesRequested ? <Pencil size={17} /> : <ShieldCheck size={17} />}</span><div><h2>{task?.title ?? "任务执行结果"}</h2><p>{task ? `${task.productName} · ${formatWorkspaceDate(task.updatedAt)}` : "正在读取任务信息"} · <strong>{reviewStatusLabel}</strong> · 总成本 {task ? formatCurrency(task.costCents) : "--"}</p></div></div>
        <div className="result-actions">
          {completed && task && <button className="secondary-button" onClick={() => router.push(`/?followUpTaskId=${encodeURIComponent(task.id)}`)}><FilePlus2 size={14} />新建后续任务</button>}
          {task && reviewDetail?.actions.canOpenDocument && <button className="primary-button" onClick={() => router.push(documentHref(task, reviewDetail.document?.id))}><FolderOpen size={14} />打开产品文档</button>}
        </div>
      </section>
      {reviewPending && <section className="panel review-action-panel"><div><ShieldCheck size={20} /><span><strong>等待人工审核</strong><small>确认结果可进入后续流程，或给出具体修改意见。</small></span></div><div><button className="secondary-button" onClick={() => { setReviewNote(""); setReviewDialog("changes_requested"); }}><RotateCcw size={14} />退回修改</button><button className="primary-button" onClick={() => { setReviewNote(""); setReviewDialog("approved"); }}><Check size={14} />审核通过</button></div></section>}
      {changesRequested && <section className="panel review-action-panel is-changes"><div><MessageSquareText size={20} /><span><strong>需要修改后重新提交</strong><small>{latestReview?.decision === "changes_requested" ? latestReview.note : "请根据最近审核意见完善产品文档，或重新执行 Agent。"}</small></span></div><div>{reviewDetail?.document && task && <button className="secondary-button" onClick={() => router.push(documentHref(task, reviewDetail.document?.id))}><Pencil size={14} />编辑文档</button>}<button className="secondary-button" onClick={rerunTask}><RefreshCw size={14} />重新执行 Agent</button><button className="primary-button" disabled={savingReview || !reviewDetail?.document} onClick={() => void resubmitReview()}>{savingReview ? <LoaderCircle size={14} className="spin" /> : <FileCheck2 size={14} />}提交复审</button></div></section>}
      {completed && latestReview?.decision === "approved" && <div className="notice success"><CheckCircle2 size={15} />审核结论：已由 {latestReview.reviewer} 审核通过{latestReview.note ? ` · ${latestReview.note}` : ""}</div>}
      <section className="panel summary-section">
        <h2>结果摘要</h2>
        <div className="insight-grid">
          <Insight title="质量检查" tone={agentOutput?.quality.status === "passed" ? "green" : "amber"}>{agentOutput ? agentOutput.quality.status === "passed" ? "质量检查已通过，可结合证据进行人工审核。" : agentOutput.quality.warnings.join("；") || "结果需要人工复核。" : "该历史任务暂无可读取的结构化运行结果，请以主文档为准。"}</Insight>
          <Insight title="证据与来源" tone="blue">本次结果包含 {agentOutput?.evidence.length ?? 0} 条证据和 {agentOutput?.citations.length ?? 0} 个引用来源。</Insight>
          <Insight title="文档归档" tone="green">{reviewDetail?.document ? `主文档 ${reviewDetail.document.currentVersionLabel} 已归档，可继续编辑和保留版本。` : "当前尚未生成主文档。"}</Insight>
          <Insight title="审核状态" tone={changesRequested ? "red" : reviewPending ? "amber" : "green"}>{changesRequested ? "已退回修改，完成文档修改或重新执行后提交复审。" : reviewPending ? "等待 PM 人工确认结果。" : "审核已闭环，可进入后续产品工作。"}</Insight>
        </div>
      </section>
      {agentOutput?.attachmentReferences?.length ? <section className="panel attachment-reference-panel"><div className="panel-title"><h2>任务附件引用</h2><span>{agentOutput.attachmentReferences.filter((item) => item.referenced).length}/{agentOutput.attachmentReferences.length} 已引用</span></div><div className="attachment-reference-list">{agentOutput.attachmentReferences.map((attachment) => <div key={attachment.id}><Paperclip size={14} /><span><strong>{attachment.fileName}</strong><small>{attachment.referenced ? "结果中检测到引用" : "已提供给 Agent，结果未明确引用"}</small></span><Tag tone={attachment.referenced ? "green" : "gray"}>{attachment.referenced ? "已引用" : "未引用"}</Tag></div>)}</div></section> : null}
      {agentOutput && <section className="panel agent-output"><div className="panel-title"><h2>本次 Agent 输出</h2><Tag tone={agentOutput.demo ? "amber" : "green"}>{agentOutput.demo ? "演示模式" : "实时结果"}</Tag></div><pre>{agentOutput.output}</pre></section>}
      {agentOutput?.evidence.length ? <section className="panel review-evidence"><div className="panel-title"><h2>证据来源</h2><span>{agentOutput.evidence.length} 条</span></div>{agentOutput.evidence.map((item) => <a href={item.url} target="_blank" rel="noreferrer" key={item.id}><div><strong>{item.title}</strong><span>{item.publisher} · {item.excerpt || "打开来源查看详情"}</span></div><ExternalLink size={14} /></a>)}</section> : null}
      <section className="panel review-history"><div className="panel-title"><h2>审核历史</h2><span>{reviewDetail?.reviews.length ?? 0} 条</span></div>{reviewDetail?.reviews.length ? reviewDetail.reviews.map((review) => <div className="review-history-item" key={review.id}><span className={`review-decision decision-${review.decision}`}>{review.decision === "approved" ? "审核通过" : review.decision === "changes_requested" ? "退回修改" : "提交复审"}</span><div><strong>{review.note || "未填写备注"}</strong><small>{review.reviewer} · {formatWorkspaceDate(review.createdAt)}{review.documentRevision ? ` · 文档修订 ${review.documentRevision}` : ""}</small></div></div>) : <div className="dialog-empty">暂无审核记录。</div>}</section>
      <section className="panel deliverables-section">
        <h2>保存为其他文档</h2>
        <div className="deliverable-actions">
          {[{ label: "保存为 PRD", format: "prd" as const, icon: FileText }, { label: "保存为竞品报告", format: "competitor_report" as const, icon: FileBarChart }, { label: "保存为汇报提纲", format: "outline" as const, icon: BarChart3 }, { label: "保存为 HTML", format: "html" as const, icon: Code2 }, { label: "保存为 Markdown", format: "markdown" as const, icon: ArrowDownToLine }].map((item) => {
            const Icon = item.icon;
            return <button key={item.label} className="secondary-button" disabled={!task || Boolean(generating)} onClick={() => generate(item.label, item.format)}>{generating === item.label ? <LoaderCircle size={14} className="spin" /> : <Icon size={14} />}{item.label}</button>;
          })}
        </div>
      </section>
      {reviewDialog && <Modal title={reviewDialog === "approved" ? "审核通过" : "退回修改"} subtitle={reviewDialog === "approved" ? "通过后任务进入已完成，可打开文档或新建后续任务。" : "请明确说明需要调整的内容，任务会进入待修改。"} onClose={() => !savingReview && setReviewDialog(null)}>
        <form className="dialog-form" onSubmit={(event) => { event.preventDefault(); void submitReview(); }}>
          <label>{reviewDialog === "approved" ? "审核备注（可选）" : "修改意见"}<textarea autoFocus value={reviewNote} onChange={(event) => setReviewNote(event.target.value)} placeholder={reviewDialog === "approved" ? "记录通过原因或后续关注点" : "说明需要补充、修正或重新验证的内容"} /></label>
          <div className="dialog-actions"><button type="button" className="secondary-button" disabled={savingReview} onClick={() => setReviewDialog(null)}>取消</button><button type="submit" className={reviewDialog === "approved" ? "primary-button" : "danger-button"} disabled={savingReview || reviewDialog === "changes_requested" && !reviewNote.trim()}>{savingReview ? <LoaderCircle size={14} className="spin" /> : reviewDialog === "approved" ? <Check size={14} /> : <RotateCcw size={14} />}{savingReview ? "正在保存" : reviewDialog === "approved" ? "确认通过" : "确认退回"}</button></div>
        </form>
      </Modal>}
    </div>
  );
}

function ResearchView({ notify }: { notify: (message: string) => void }) {
  const [query, setQuery] = useState("");
  const [type, setType] = useState<ResearchSourceType | "">("");
  const [trust, setTrust] = useState<ResearchSourceTrust | "">("");
  const [metricFilter, setMetricFilter] = useState<"all" | "week" | "pending">("all");
  const [trustMenuOpen, setTrustMenuOpen] = useState(false);
  const [newestFirst, setNewestFirst] = useState(true);
  const [data, setData] = useState<ResearchSourceListResponse>({ items: [], summary: { total: 0, high: 0, week: 0, pending: 0 } });
  const [overviewSources, setOverviewSources] = useState<ResearchSource[]>([]);
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reloadVersion, setReloadVersion] = useState(0);
  const [dialog, setDialog] = useState<"create" | "edit" | "verify" | null>(null);
  const [selectedSource, setSelectedSource] = useState<ResearchSource | null>(null);
  const [reopenSource, setReopenSource] = useState<ResearchSource | null>(null);
  const trustMenuRef = useRef<HTMLDivElement>(null);
  const researchClock = useMemo(() => {
    const now = new Date();
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - ((now.getDay() + 6) % 7));
    weekStart.setHours(0, 0, 0, 0);
    return { now, weekStart };
  }, []);

  useEffect(() => {
    let active = true;
    requestJson<{ items: ProductTreeNode[] }>("/api/products?tree=1")
      .then(({ items }) => active && setTasks(items.flatMap((product) => product.tasks)))
      .catch(() => active && setTasks([]));
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!trustMenuOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !trustMenuRef.current?.contains(event.target)) setTrustMenuOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setTrustMenuOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [trustMenuOpen]);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams({ sort: newestFirst ? "newest" : "oldest" });
      if (query.trim()) params.set("query", query.trim());
      if (type) params.set("type", type);
      if (trust) params.set("trust", trust);
      if (metricFilter === "pending") params.set("verification", "pending");
      setLoading(true);
      setError("");
      Promise.all([
        requestJson<ResearchSourceListResponse>(`/api/research/sources?${params.toString()}`, { signal: controller.signal }),
        requestJson<ResearchSourceListResponse>("/api/research/sources?sort=newest", { signal: controller.signal }),
      ])
        .then(([filtered, overview]) => {
          if (!active) return;
          setData(filtered);
          setOverviewSources(overview.items);
        })
        .catch((reason: Error) => {
          if (active && reason.name !== "AbortError") setError(reason.message);
        })
        .finally(() => active && setLoading(false));
    }, 180);
    return () => { active = false; window.clearTimeout(timer); controller.abort(); };
  }, [metricFilter, newestFirst, query, reloadVersion, trust, type]);

  const overview = useMemo(() => {
    const total = data.summary.total;
    const typeRows = RESEARCH_SOURCE_TYPES.map((label, index) => ({
      label,
      tone: (["blue", "blue", "violet", "cyan", "amber", "gray"] as const)[index],
      value: overviewSources.filter((item) => item.type === label).length,
    }));
    const trustRows = [
      { label: "高", tone: "green", value: overviewSources.filter((item) => item.trust === "high").length },
      { label: "中", tone: "amber", value: overviewSources.filter((item) => item.trust === "medium").length },
      { label: "低", tone: "red", value: overviewSources.filter((item) => item.trust === "low").length },
    ].map((row) => ({ ...row, percentage: total === 0 ? 0 : Math.round((row.value / total) * 100) }));
    return { ...data.summary, typeRows, trustRows, recentSources: overviewSources.slice(0, 4) };
  }, [data.summary, overviewSources]);

  const visible = useMemo(() => data.items.filter((item) => {
    if (metricFilter === "pending" && item.verification !== "pending") return false;
    if (metricFilter === "week") {
      const capturedAt = new Date(item.capturedAt);
      if (capturedAt < researchClock.weekStart || capturedAt > researchClock.now) return false;
    }
    return true;
  }), [data.items, metricFilter, researchClock]);

  const hasFilters = Boolean(query.trim()) || Boolean(type) || Boolean(trust) || metricFilter !== "all";
  const resetFilters = () => {
    setQuery("");
    setType("");
    setTrust("");
    setMetricFilter("all");
    setTrustMenuOpen(false);
  };
  const closeDialog = () => { setDialog(null); setSelectedSource(null); };
  const openDialog = (next: "create" | "edit" | "verify", source?: ResearchSource) => {
    setSelectedSource(source ?? null);
    setDialog(next);
  };
  const reload = () => setReloadVersion((value) => value + 1);
  const trustFilterOptions: Array<{ value: ResearchSourceTrust | ""; label: string; count: number; tone: "gray" | "green" | "amber" | "red" }> = [
    { value: "", label: "全部可信度", count: overview.total, tone: "gray" },
    { value: "high", label: "高可信度", count: overview.trustRows[0].value, tone: "green" },
    { value: "medium", label: "中可信度", count: overview.trustRows[1].value, tone: "amber" },
    { value: "low", label: "低可信度", count: overview.trustRows[2].value, tone: "red" },
  ];
  const selectedTrustOption = trustFilterOptions.find((option) => option.value === trust);

  return (
    <div className="split-page research-layout">
      <div className="data-page">
        <div className="table-toolbar">
          <label className="search-field"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索资料标题或来源" /></label>
          <select value={type} onChange={(event) => setType(event.target.value as ResearchSourceType | "")} aria-label="资料类型"><option value="">全部类型</option>{RESEARCH_SOURCE_TYPES.map((value) => <option value={value} key={value}>{value}</option>)}</select>
          <button className="secondary-button" onClick={() => setNewestFirst((value) => !value)} aria-label="切换采集时间排序"><Filter size={14} />{newestFirst ? "时间从新到旧" : "时间从旧到新"}</button>
          <button className="primary-button" onClick={() => openDialog("create")}><Plus size={15} />添加资料</button>
        </div>
        <div className="metrics-row">
          <Metric label="资料总数" value={String(overview.total)} icon={FileText} tone="blue" active={metricFilter === "all" && !trust} onClick={() => { setMetricFilter("all"); setTrust(""); setTrustMenuOpen(false); }} />
          <div className={`metric-filter-menu ${trustMenuOpen ? "is-open" : ""}`} ref={trustMenuRef}>
            <button type="button" className={`metric-card metric-filter trust-metric-trigger tone-green ${trust || trustMenuOpen ? "active" : ""}`} aria-haspopup="menu" aria-expanded={trustMenuOpen} aria-controls="research-trust-filter-menu" onClick={() => setTrustMenuOpen((open) => !open)}>
              <div><strong>{trust ? selectedTrustOption?.count ?? 0 : overview.high}</strong><span>{trust ? selectedTrustOption?.label ?? "可信度筛选" : "高可信度"}</span></div>
              <span className="trust-metric-icon" aria-hidden="true"><ShieldCheck size={18} /><ChevronDown className="trust-menu-chevron" size={13} /></span>
            </button>
            <div id="research-trust-filter-menu" className="trust-filter-popover" role="menu" aria-label="可信度筛选" aria-hidden={!trustMenuOpen}>
              <div className="trust-filter-popover-title">可信度筛选</div>
              {trustFilterOptions.map((option) => {
                const selected = trust === option.value;
                return <button type="button" role="menuitemradio" aria-checked={selected} tabIndex={trustMenuOpen ? 0 : -1} className={`trust-filter-option ${selected ? "selected" : ""}`} key={option.value || "all"} onClick={() => { setTrust(option.value); setTrustMenuOpen(false); }}><span className={`trust-filter-dot tone-${option.tone}`} /><span>{option.label}</span><strong>{option.count}</strong>{selected && <Check size={13} />}</button>;
              })}
            </div>
          </div>
          <Metric label="本周新增" value={String(overview.week)} icon={Activity} tone="violet" active={metricFilter === "week"} onClick={() => setMetricFilter("week")} />
          <Metric label="待验证" value={String(overview.pending)} icon={AlertTriangle} tone="amber" active={metricFilter === "pending"} onClick={() => setMetricFilter("pending")} />
        </div>
        <div className="research-filter-summary"><span>{loading ? "正在读取资料" : `当前陈列 ${visible.length} 条资料`}</span>{hasFilters && <button className="text-button" onClick={resetFilters}><X size={13} />清除筛选</button>}</div>
        {error && <div className="notice danger" role="alert"><AlertTriangle size={15} />{error}</div>}
        <DataTable headers={["来源标题", "类型", "可信度", "采集时间", "来源任务", "操作"]}>
          {visible.map((item) => <tr key={item.id}>
            <td data-label="来源标题"><a className="source-title-link" href={item.url} target="_blank" rel="noopener noreferrer"><strong>{item.title}</strong><ExternalLink size={11} /></a><a className="source-domain-link" href={item.url} target="_blank" rel="noopener noreferrer">{item.domain}</a></td>
            <td data-label="类型"><Tag tone="blue">{item.type}</Tag></td>
            <td data-label="可信度"><Trust value={item.trust === "high" ? "高" : item.trust === "medium" ? "中" : "低"} /></td>
            <td data-label="采集时间" className="mono">{formatWorkspaceDate(item.capturedAt)}</td>
            <td data-label="来源任务">{item.taskId ? <Link className="source-task-link" href={`/tasks/running?taskId=${encodeURIComponent(item.taskId)}`}>{item.taskTitle ?? item.taskId}</Link> : <span className="muted-text">未关联任务</span>}</td>
            <td data-label="操作"><div className="source-row-actions">{item.verification === "pending" && <button className="table-action" onClick={() => openDialog("verify", item)}>验证<ShieldCheck size={12} /></button>}<button className="table-action" onClick={() => openDialog("edit", item)}>编辑<Pencil size={12} /></button>{item.verification === "verified" && <button className="table-action" onClick={() => setReopenSource(item)}>重新验证<RotateCcw size={12} /></button>}<a className="table-action" href={item.url} target="_blank" rel="noopener noreferrer">打开来源<ExternalLink size={12} /></a></div></td>
          </tr>)}
          {!loading && visible.length === 0 && <tr><td colSpan={6}><div className="empty-table-state"><Search size={18} /><strong>没有符合条件的资料</strong><span>调整筛选条件或清除筛选后重新查看。</span><button className="secondary-button" onClick={resetFilters}>清除筛选</button></div></td></tr>}
        </DataTable>
      </div>
      <aside className="context-panel">
        <h2>资料概览</h2>
        <section className="research-summary-section">
          <h3>类型分布</h3>
          {overview.typeRows.map((row)=><div className="bar-row" key={row.label}><span>{row.label}</span><i><b className={row.tone} style={{width:`${overview.total === 0 ? 0 : (row.value / overview.total) * 100}%`}} /></i><small>{row.value}</small></div>)}
        </section>
        <section className="research-summary-section">
          <h3>可信度分布</h3>
          <div className="distribution">{overview.trustRows.map((row)=><span key={row.label}><i className={row.tone} />{row.label}<strong>{row.value} 条 ({row.percentage}%)</strong></span>)}</div>
        </section>
        <section className="research-summary-section">
          <h3>最近采集</h3>
          {overview.recentSources.map((source)=><a className="recent-source" href={source.url} target="_blank" rel="noopener noreferrer" key={source.id}><strong>{source.title}</strong><span>{formatWorkspaceDate(source.capturedAt)}</span></a>)}
        </section>
      </aside>
      {dialog === "create" && <ResearchSourceDialog tasks={tasks} onClose={closeDialog} onSaved={() => { closeDialog(); reload(); notify("资料已添加，并进入待验证列表。"); }} />}
      {dialog === "edit" && selectedSource && <ResearchSourceDialog source={selectedSource} tasks={tasks} onClose={closeDialog} onSaved={(verified) => { closeDialog(); reload(); notify(verified ? "资料修改已保存并标记为已验证。" : "资料修改已保存。"); }} />}
      {dialog === "verify" && selectedSource && <ResearchSourceVerifyDialog source={selectedSource} onClose={closeDialog} onSaved={() => { closeDialog(); reload(); notify("资料验证结果已保存，统计已同步更新。"); }} />}
      {reopenSource && <ResearchSourceReopenDialog source={reopenSource} onClose={() => setReopenSource(null)} onSaved={() => { setReopenSource(null); reload(); notify("资料已重新进入待验证列表。"); }} />}
    </div>
  );
}

function ResearchSourceDialog({ source, tasks, onClose, onSaved }: { source?: ResearchSource; tasks: TaskRecord[]; onClose: () => void; onSaved: (verified: boolean) => void }) {
  const [title, setTitle] = useState(source?.title ?? "");
  const [type, setType] = useState<ResearchSourceType>(source?.type ?? "其他");
  const [trust, setTrust] = useState<ResearchSourceTrust>(source?.trust ?? "low");
  const [url, setUrl] = useState(source?.url ?? "https://");
  const [taskId, setTaskId] = useState(source?.taskId ?? "");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  async function save(verifyAfterSave: boolean) {
    setSaving(true);
    setError("");
    try {
      const saved = source
        ? await requestJson<ResearchSource>(`/api/research/sources/${encodeURIComponent(source.id)}`, { method: "PATCH", body: JSON.stringify({ title, type, trust, url, taskId: taskId || null, baseUpdatedAt: source.updatedAt }) })
        : await requestJson<ResearchSource>("/api/research/sources", { method: "POST", body: JSON.stringify({ title, type, url, taskId: taskId || null, verificationNote: note.trim() || undefined }) });
      if (verifyAfterSave && saved.verification === "pending") {
        await requestJson<ResearchSource>(`/api/research/sources/${encodeURIComponent(saved.id)}/verify`, { method: "POST", body: JSON.stringify({ trust, baseUpdatedAt: saved.updatedAt }) });
      }
      onSaved(verifyAfterSave);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "资料保存失败。");
      setSaving(false);
    }
  }
  function submit(event: React.FormEvent) {
    event.preventDefault();
    void save(false);
  }
  const cannotSave = saving || !title.trim() || !url.trim();
  return <Modal title={source ? "编辑研究资料" : "添加研究资料"} subtitle={source ? "修改后会保留当前验证状态；待验证资料可明确保存并完成验证。" : "新资料默认进入待验证，确认来源后再归类。"} onClose={onClose}>
    <form className="dialog-form research-source-dialog" onSubmit={submit}>
      <label>资料标题<input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} placeholder="例如：某产品定价页面" /></label>
      {source ? <div className="dialog-grid"><label>资料类型<select value={type} onChange={(event) => setType(event.target.value as ResearchSourceType)}>{RESEARCH_SOURCE_TYPES.map((value) => <option value={value} key={value}>{value}</option>)}</select></label><label>可信度<select value={trust} onChange={(event) => setTrust(event.target.value as ResearchSourceTrust)}><option value="high">高</option><option value="medium">中</option><option value="low">低</option></select></label></div> : <label>资料类型<select value={type} onChange={(event) => setType(event.target.value as ResearchSourceType)}>{RESEARCH_SOURCE_TYPES.map((value) => <option value={value} key={value}>{value}</option>)}</select></label>}
      <label>来源 URL<input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://example.com/source" /></label>
      <label>来源任务<select value={taskId} onChange={(event) => setTaskId(event.target.value)}><option value="">不关联任务</option>{tasks.map((task) => <option value={task.id} key={task.id}>{task.title} · {task.id}</option>)}</select></label>
      {!source && <label>初始备注 <span>可选</span><textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="记录资料用途、采集背景或后续验证重点" /></label>}
      {source && <div className="dialog-meta">采集时间：{formatWorkspaceDate(source.capturedAt)} · 当前状态：{source.verification === "pending" ? "待验证" : "已验证"}</div>}
      {error && <div className="dialog-error" role="alert">{error}</div>}
      <div className="dialog-actions"><button type="button" className="secondary-button" onClick={onClose}>取消</button>{source?.verification === "pending" && <button type="submit" className="secondary-button" disabled={cannotSave}>{saving ? <LoaderCircle size={14} className="spin" /> : <Save size={14} />}{saving ? "保存中" : "保存修改"}</button>}{source?.verification === "pending" && <button type="button" className="primary-button" disabled={cannotSave} onClick={() => void save(true)}>{saving ? <LoaderCircle size={14} className="spin" /> : <ShieldCheck size={14} />}{saving ? "保存中" : "保存并标记为已验证"}</button>}{source?.verification === "verified" && <button type="submit" className="primary-button" disabled={cannotSave}>{saving ? <LoaderCircle size={14} className="spin" /> : <Save size={14} />}{saving ? "保存中" : "保存修改"}</button>}{!source && <button type="submit" className="primary-button" disabled={cannotSave}>{saving ? <LoaderCircle size={14} className="spin" /> : <Plus size={14} />}{saving ? "添加中" : "添加资料"}</button>}</div>
    </form>
  </Modal>;
}

function ResearchSourceVerifyDialog({ source, onClose, onSaved }: { source: ResearchSource; onClose: () => void; onSaved: () => void }) {
  const [trust, setTrust] = useState<ResearchSourceTrust>(source.trust);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await requestJson<ResearchSource>(`/api/research/sources/${encodeURIComponent(source.id)}/verify`, { method: "POST", body: JSON.stringify({ trust, note: note.trim() || undefined, baseUpdatedAt: source.updatedAt }) });
      onSaved();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "资料验证失败。");
      setSaving(false);
    }
  }
  return <Modal title="验证研究资料" subtitle="确认来源内容后选择可信度，验证结果会同步到筛选统计。" onClose={onClose}>
    <form className="dialog-form research-source-dialog" onSubmit={submit}>
      <div className="source-verify-summary"><strong>{source.title}</strong><span>{source.domain}</span><a href={source.url} target="_blank" rel="noopener noreferrer">打开原网页<ExternalLink size={12} /></a>{source.taskTitle && <small>来源任务：{source.taskTitle}</small>}</div>
      <label>验证后的可信度<select value={trust} onChange={(event) => setTrust(event.target.value as ResearchSourceTrust)}><option value="high">高可信度</option><option value="medium">中可信度</option><option value="low">低可信度</option></select></label>
      <label>验证说明 <span>可选</span><textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="记录交叉验证依据或需要后续关注的风险" /></label>
      {error && <div className="dialog-error" role="alert">{error}</div>}
      <div className="dialog-actions"><button type="button" className="secondary-button" onClick={onClose}>取消</button><button className="primary-button" disabled={saving}>{saving ? <LoaderCircle size={14} className="spin" /> : <ShieldCheck size={14} />}{saving ? "验证中" : "保存并标记为已验证"}</button></div>
    </form>
  </Modal>;
}

function ResearchSourceReopenDialog({ source, onClose, onSaved }: { source: ResearchSource; onClose: () => void; onSaved: () => void }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  async function submit() {
    setSaving(true);
    setError("");
    try {
      await requestJson<ResearchSource>(`/api/research/sources/${encodeURIComponent(source.id)}/reopen`, { method: "POST", body: JSON.stringify({ baseUpdatedAt: source.updatedAt }) });
      onSaved();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "重新验证失败。");
      setSaving(false);
    }
  }
  return <Modal title="重新验证研究资料" subtitle="资料将重新进入待验证列表，原有内容和历史可信度会保留。" onClose={onClose}>
    <div className="dialog-form research-source-dialog">
      <div className="source-verify-summary"><strong>{source.title}</strong><span>{source.domain} · 当前可信度：{source.trust === "high" ? "高" : source.trust === "medium" ? "中" : "低"}</span><a href={source.url} target="_blank" rel="noopener noreferrer">打开原网页<ExternalLink size={12} /></a>{source.taskTitle && <small>来源任务：{source.taskTitle}</small>}</div>
      <div className="reopen-confirm-copy">重新验证后，需要再次确认来源内容并选择新的可信度。此操作不会删除资料，也不会修改原始采集时间。</div>
      {error && <div className="dialog-error" role="alert">{error}</div>}
      <div className="dialog-actions"><button type="button" className="secondary-button" onClick={onClose}>取消</button><button type="button" className="primary-button" disabled={saving} onClick={() => void submit()}>{saving ? <LoaderCircle size={14} className="spin" /> : <RotateCcw size={14} />}{saving ? "处理中" : "确认重新验证"}</button></div>
    </div>
  </Modal>;
}

function DocumentsView({ initialQuery, notify }: { initialQuery: PrototypeQuery; notify: (message: string) => void }) {
  const router = useRouter();
  const [tree, setTree] = useState<ProductTreeNode[]>([]);
  const [selectedProductId, setSelectedProductId] = useState(initialQuery.productId ?? "");
  const [selectedTaskId, setSelectedTaskId] = useState(initialQuery.taskId ?? "");
  const [selectedDocumentId, setSelectedDocumentId] = useState(initialQuery.documentId ?? "");
  const [documents, setDocuments] = useState<DocumentSummary[]>([]);
  const [detail, setDetail] = useState<DocumentDetail | null>(null);
  const [query, setQuery] = useState("");
  const [format, setFormat] = useState<DocumentFormat | "">("");
  const [editorMode, setEditorMode] = useState<"edit" | "preview">("preview");
  const [draftTitle, setDraftTitle] = useState("");
  const [draftContent, setDraftContent] = useState("");
  const [changeNote, setChangeNote] = useState("");
  const [previewVersionId, setPreviewVersionId] = useState("");
  const [versionDialogId, setVersionDialogId] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingDocument, setLoadingDocument] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [dirty, setDirty] = useState(false);
  const [newDocumentOpen, setNewDocumentOpen] = useState(false);
  const [transformOpen, setTransformOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState<OutputDocumentFormat | "">("");
  const [outputSettings, setOutputSettings] = useState<WorkspaceOutputSettings | null>(null);
  const importFileRef = useRef<HTMLInputElement>(null);
  const [treeRevision, setTreeRevision] = useState(0);
  const [documentRevision, setDocumentRevision] = useState(0);

  const selectedProduct = tree.find((product) => product.id === selectedProductId) ?? null;
  const selectedTask = selectedProduct?.tasks.find((task) => task.id === selectedTaskId) ?? null;
  const previewVersion = previewVersionId
    ? detail?.versions.find((version) => version.id === previewVersionId) ?? null
    : null;
  const managedVersion = versionDialogId
    ? detail?.versions.find((version) => version.id === versionDialogId) ?? null
    : null;
  const managedPreviousVersion = managedVersion
    ? detail?.versions.find((version) => version.revision === managedVersion.revision - 1) ?? null
    : null;

  useEffect(() => {
    let active = true;
    requestJson<WorkspaceOutputSettings>("/api/settings/output", { cache: "no-store" })
      .then((settings) => active && setOutputSettings(settings))
      .catch(() => active && setOutputSettings({
        outputFormats: ["markdown", "html", "docx", "pdf"],
        defaultOutputFormat: "markdown",
        updatedAt: "",
      }));
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    requestJson<{ items: ProductTreeNode[] }>("/api/products?tree=1")
      .then(({ items }) => {
        if (!active) return;
        setTree(items);
        const queryTask = items.flatMap((product) => product.tasks).find((task) => task.id === initialQuery.taskId);
        const requestedProduct = items.find((product) => product.id === initialQuery.productId);
        const currentProduct = items.find((product) => product.id === selectedProductId);
        const currentTask = items.flatMap((product) => product.tasks).find((task) => task.id === selectedTaskId);
        const nextProductId = requestedProduct?.id || queryTask?.productId || currentProduct?.id || items[0]?.id || "";
        setSelectedProductId(nextProductId);
        setSelectedTaskId(
          queryTask?.productId === nextProductId
            ? queryTask.id
            : !initialQuery.productId && currentTask?.productId === nextProductId
              ? currentTask.id
              : "",
        );
        if (initialQuery.documentId) setSelectedDocumentId(initialQuery.documentId);
        setError("");
      })
      .catch((reason: Error) => active && setError(reason.message));
    return () => { active = false; };
  }, [initialQuery.documentId, initialQuery.productId, initialQuery.taskId, treeRevision]);

  useEffect(() => {
    if (!selectedProductId) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams({ productId: selectedProductId });
      if (selectedTaskId) params.set("taskId", selectedTaskId);
      if (query.trim()) params.set("query", query.trim());
      if (format) params.set("format", format);
      setLoading(true);
      requestJson<{ items: DocumentSummary[] }>(`/api/documents?${params.toString()}`, { signal: controller.signal })
        .then(({ items }) => {
          setDocuments(items);
          setError("");
          if (!selectedDocumentId && items[0]) setSelectedDocumentId(items[0].id);
          if (selectedDocumentId && !items.some((document) => document.id === selectedDocumentId) && !dirty) {
            setSelectedDocumentId(items[0]?.id ?? "");
          }
        })
        .catch((reason: Error) => {
          if (reason.name !== "AbortError") setError(reason.message);
        })
        .finally(() => setLoading(false));
    }, 160);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [dirty, documentRevision, format, query, selectedDocumentId, selectedProductId, selectedTaskId]);

  useEffect(() => {
    if (!selectedDocumentId) {
      setDetail(null);
      return;
    }
    let active = true;
    setLoadingDocument(true);
    requestJson<DocumentDetail>(`/api/documents/${encodeURIComponent(selectedDocumentId)}`)
      .then((document) => {
        if (!active) return;
        setDetail(document);
        setError("");
        setDraftTitle(document.currentVersion.title);
        setDraftContent(document.currentVersion.content);
        setChangeNote("");
        setPreviewVersionId("");
        setVersionDialogId("");
        setDirty(false);
      })
      .catch((reason: Error) => active && setError(reason.message))
      .finally(() => active && setLoadingDocument(false));
    return () => { active = false; };
  }, [selectedDocumentId]);

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirty) return;
      event.preventDefault();
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [dirty]);

  function canLeaveDocument() {
    return !dirty || window.confirm("当前文档有未保存的修改，确定放弃并切换吗？");
  }

  function replaceDocumentUrl(productId: string, taskId?: string, documentId?: string) {
    const params = new URLSearchParams({ productId });
    if (taskId) params.set("taskId", taskId);
    if (documentId) params.set("documentId", documentId);
    router.replace(`/docs?${params.toString()}`);
  }

  function chooseProduct(productId: string) {
    if (!canLeaveDocument()) return;
    setSelectedProductId(productId);
    setSelectedTaskId("");
    setSelectedDocumentId("");
    setDetail(null);
    setDirty(false);
    replaceDocumentUrl(productId);
  }

  function chooseTask(task: TaskRecord) {
    if (!canLeaveDocument()) return;
    setSelectedProductId(task.productId);
    setSelectedTaskId(task.id);
    setSelectedDocumentId("");
    setDetail(null);
    setDirty(false);
    replaceDocumentUrl(task.productId, task.id);
  }

  function chooseDocument(document: DocumentSummary) {
    if (document.id === selectedDocumentId || !canLeaveDocument()) return;
    setSelectedProductId(document.productId);
    setSelectedTaskId(document.taskId);
    setSelectedDocumentId(document.id);
    setDirty(false);
    replaceDocumentUrl(document.productId, document.taskId, document.id);
  }

  async function saveVersion() {
    if (!detail || previewVersion) return;
    setSaving(true);
    setError("");
    try {
      const saved = await requestJson<DocumentDetail>(`/api/documents/${encodeURIComponent(detail.id)}/versions`, {
        method: "POST",
        body: JSON.stringify({
          baseRevision: detail.currentRevision,
          title: draftTitle,
          content: draftContent,
          changeNote: changeNote.trim() || undefined,
        }),
      });
      setDetail(saved);
      setDraftTitle(saved.currentVersion.title);
      setDraftContent(saved.currentVersion.content);
      setChangeNote("");
      setDirty(false);
      setPreviewVersionId("");
      setDocumentRevision((value) => value + 1);
      setTreeRevision((value) => value + 1);
      notify(`已保存 ${saved.currentVersionLabel}`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "文档保存失败。");
    } finally {
      setSaving(false);
    }
  }

  async function restoreVersion(version: DocumentVersion) {
    if (!detail || !version || version.id === detail.currentVersion.id) return;
    if (!canLeaveDocument()) return;
    setSaving(true);
    setError("");
    try {
      const restored = await requestJson<DocumentDetail>(`/api/documents/${encodeURIComponent(detail.id)}/restore`, {
        method: "POST",
        body: JSON.stringify({ versionId: version.id, baseRevision: detail.currentRevision }),
      });
      setDetail(restored);
      setDraftTitle(restored.currentVersion.title);
      setDraftContent(restored.currentVersion.content);
      setPreviewVersionId("");
      setVersionDialogId("");
      setDirty(false);
      setDocumentRevision((value) => value + 1);
      setTreeRevision((value) => value + 1);
      notify(`已从 ${version.label} 恢复并创建 ${restored.currentVersionLabel}`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "版本恢复失败。");
    } finally {
      setSaving(false);
    }
  }

  function previewVersionInEditor(version: DocumentVersion) {
    if (version.id !== detail?.currentVersion.id && !canLeaveDocument()) return;
    if (version.id !== detail?.currentVersion.id && dirty && detail) {
      setDraftTitle(detail.currentVersion.title);
      setDraftContent(detail.currentVersion.content);
      setChangeNote("");
      setDirty(false);
    }
    setPreviewVersionId(version.id === detail?.currentVersion.id ? "" : version.id);
    setEditorMode("preview");
    setVersionDialogId("");
  }

  function handleVersionMetadataUpdated(document: DocumentDetail, versionId: string) {
    setDetail(document);
    setVersionDialogId(versionId);
    notify("版本信息已保存");
  }

  function handleDocumentCreated(document: DocumentDetail) {
    setNewDocumentOpen(false);
    setTransformOpen(false);
    setSelectedProductId(document.productId);
    setSelectedTaskId(document.taskId);
    setSelectedDocumentId(document.id);
    setTreeRevision((value) => value + 1);
    setDocumentRevision((value) => value + 1);
    replaceDocumentUrl(document.productId, document.taskId, document.id);
    notify(`已创建“${document.title}”`);
  }

  async function handleImport(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!selectedTaskId) {
      notify("请先选择一个任务，再导入文档。");
      return;
    }
    setImporting(true);
    setError("");
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("taskId", selectedTaskId);
      const response = await requestJson<{ document: DocumentDetail; fileName: string }>("/api/documents/import", {
        method: "POST",
        body: form,
      });
      handleDocumentCreated(response.document);
      notify(`已导入“${response.fileName}”`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "文件导入失败。");
    } finally {
      setImporting(false);
    }
  }

  function exportDocument(format: OutputDocumentFormat) {
    if (!detail) return;
    setExporting(format);
    const url = `/api/documents/${encodeURIComponent(detail.id)}/export?format=${encodeURIComponent(format)}`;
    window.open(url, "_blank", "noopener,noreferrer");
    window.setTimeout(() => setExporting(""), 800);
    notify(format === "pdf" ? "已打开打印页，可在浏览器中选择保存为 PDF" : `已开始导出 ${OUTPUT_DOCUMENT_FORMAT_LABELS[format]}`);
  }

  function openTransform() {
    if (!detail) return;
    if (dirty && !window.confirm("当前文档有未保存修改，AI 转换将基于最近保存的版本。继续吗？")) return;
    setTransformOpen(true);
  }

  function handleDocumentTransformed(
    document: DocumentDetail,
    destination: "new_version" | "new_document",
    result: { demo: boolean; model: string },
  ) {
    if (destination === "new_document") {
      handleDocumentCreated(document);
    } else {
      setTransformOpen(false);
      setDetail(document);
      setDraftTitle(document.currentVersion.title);
      setDraftContent(document.currentVersion.content);
      setChangeNote("");
      setPreviewVersionId("");
      setDirty(false);
      setDocumentRevision((value) => value + 1);
      setTreeRevision((value) => value + 1);
      notify(`已创建 ${document.currentVersionLabel} · ${result.demo ? "演示模式" : result.model}`);
    }
  }

  const groupedDocuments = useMemo(() => {
    const groups = new Map<string, { taskTitle: string; documents: DocumentSummary[] }>();
    documents.forEach((document) => {
      const group = groups.get(document.taskId) ?? { taskTitle: document.taskTitle, documents: [] };
      group.documents.push(document);
      groups.set(document.taskId, group);
    });
    return [...groups.entries()];
  }, [documents]);

  return (
    <div className="documents-workspace">
      <aside className="document-tree">
        <div className="document-tree-title"><div><FolderTree size={16} /><strong>产品与任务</strong></div><span>{tree.length} 个产品</span></div>
        <div className="document-tree-scroll">
          {tree.map((product) => (
            <div className="product-tree-group" key={product.id}>
              <button className={selectedProductId === product.id && !selectedTaskId ? "active" : ""} onClick={() => chooseProduct(product.id)}>
                <FolderOpen size={15} /><span><strong>{product.name}</strong><small>{product.taskCount} 个任务 · {product.documentCount} 份文档</small></span><ChevronRight size={14} />
              </button>
              <div className="product-task-list">
                {product.tasks.map((task) => <button className={selectedTaskId === task.id ? "active" : ""} onClick={() => chooseTask(task)} key={task.id}><span><strong>{task.title}</strong><small>{TASK_STATUS_LABELS[task.status]} · {task.documentCount} 份文档</small></span></button>)}
              </div>
            </div>
          ))}
        </div>
      </aside>

      <section className="document-work-area">
        <div className="document-mobile-context">
          <select value={selectedProductId} onChange={(event) => chooseProduct(event.target.value)} aria-label="选择产品">{tree.map((product) => <option value={product.id} key={product.id}>{product.name}</option>)}</select>
          <select value={selectedTaskId} onChange={(event) => { const task = selectedProduct?.tasks.find((item) => item.id === event.target.value); if (task) chooseTask(task); }} aria-label="选择任务"><option value="">产品全部任务</option>{selectedProduct?.tasks.map((task) => <option value={task.id} key={task.id}>{task.title}</option>)}</select>
        </div>

        <div className="document-context-header">
          <div><span>{selectedProduct?.name ?? "产品文档"}</span><h2>{selectedTask?.title ?? "全部任务文档"}</h2>{selectedTask && <p>{selectedTask.id} · <Status value={TASK_STATUS_LABELS[selectedTask.status]} /></p>}</div>
          <div className="document-context-actions">
            <input ref={importFileRef} type="file" hidden accept=".docx,.pptx,.xlsx,.pdf,.html,.htm,.md,.markdown,.csv,.txt,.json,.odt,.odp,.ods,.rtf,.epub" onChange={(event) => void handleImport(event)} />
            <button className="secondary-button" disabled={!selectedTaskId || importing} onClick={() => importFileRef.current?.click()} title={selectedTaskId ? "导入文件并关联当前任务" : "先选择一个任务"}>{importing ? <LoaderCircle size={14} className="spin" /> : <Upload size={14} />}{importing ? "导入中" : "导入文件"}</button>
            <button className="primary-button" disabled={tree.flatMap((product) => product.tasks).length === 0} onClick={() => setNewDocumentOpen(true)}><FilePlus2 size={15} />新建文档</button>
          </div>
        </div>

        <div className="document-toolbar">
          <label className="search-field"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索当前产品文档" /></label>
          <select value={format} onChange={(event) => setFormat(event.target.value as DocumentFormat | "")} aria-label="文档类型"><option value="">全部类型</option>{(Object.entries(DOCUMENT_FORMAT_LABELS) as Array<[DocumentFormat, string]>).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select>
          {detail && <label className="document-export-select"><Download size={14} /><select value="" onChange={(event) => { const value = event.target.value as OutputDocumentFormat; if (value) exportDocument(value); }} disabled={Boolean(exporting)} aria-label="导出文档"><option value="">{exporting ? "导出中" : "导出"}</option>{(outputSettings?.outputFormats ?? ["markdown", "html", "docx", "pdf"]).map((value) => <option value={value} key={value}>{OUTPUT_DOCUMENT_FORMAT_LABELS[value]}</option>)}</select></label>}
        </div>

        {error && <div className="notice danger" role="alert"><AlertTriangle size={15} />{error}<button onClick={() => setError("")} title="关闭"><X size={13} /></button></div>}

        <div className="document-collection" aria-label="文档列表">
          {loading && documents.length === 0 && <div className="document-loading"><LoaderCircle size={16} className="spin" />正在读取文档</div>}
          {!loading && groupedDocuments.length === 0 && <div className="document-empty"><FileText size={22} /><strong>{selectedTask ? "该任务尚未产出文档" : "该产品暂无匹配文档"}</strong><span>{selectedTask?.status === "running" ? "任务仍在执行，完成后主文档会自动归档。" : "可以立即新建一份可编辑文档。"}</span><button className="secondary-button" onClick={() => setNewDocumentOpen(true)}><Plus size={14} />新建文档</button></div>}
          {groupedDocuments.map(([taskId, group]) => (
            <section className="document-task-group" key={taskId}>
              {!selectedTaskId && <div className="document-task-heading"><strong>{group.taskTitle}</strong><span>{group.documents.length} 份</span></div>}
              <div className="document-switcher">
                {group.documents.map((document) => <button className={selectedDocumentId === document.id ? "active" : ""} onClick={() => chooseDocument(document)} key={document.id}><span className="document-format-icon"><FileText size={15} /></span><span><strong>{document.title}</strong><small>{DOCUMENT_FORMAT_LABELS[document.format]} · {document.currentVersionLabel} · {formatWorkspaceDate(document.updatedAt)}</small></span><ChevronRight size={14} /></button>)}
              </div>
            </section>
          ))}
        </div>

        {detail && (
          <div className="document-editor-layout">
            <section className="document-editor">
              <div className="document-editor-header">
                <div><Tag tone="blue">{DOCUMENT_FORMAT_LABELS[detail.format]}</Tag><span>{previewVersion ? `正在查看 ${previewVersion.label}` : `当前 ${detail.currentVersionLabel}`}</span></div>
                <div className="document-editor-actions">
                  {!previewVersion && <button className="secondary-button" onClick={openTransform}><Sparkles size={14} />AI 生成/转换</button>}
                  {!previewVersion && <div className="segmented compact"><button className={editorMode === "edit" ? "active" : ""} onClick={() => setEditorMode("edit")}><Pencil size={13} />编辑</button><button className={editorMode === "preview" ? "active" : ""} onClick={() => setEditorMode("preview")}><Eye size={13} />预览</button></div>}
                  {previewVersion ? <button className="primary-button" disabled={saving} onClick={() => void restoreVersion(previewVersion)}>{saving ? <LoaderCircle size={14} className="spin" /> : <RotateCcw size={14} />}恢复为新版本</button> : <button className="primary-button" disabled={saving || !dirty || !draftTitle.trim()} onClick={saveVersion}>{saving ? <LoaderCircle size={14} className="spin" /> : <Save size={14} />}保存新版本</button>}
                </div>
              </div>

              {loadingDocument ? <div className="document-loading"><LoaderCircle size={17} className="spin" />正在读取正文</div> : previewVersion ? (
                <><div className="version-preview-banner"><History size={14} />历史版本只读预览，恢复后会创建新的最新版本。<button className="text-button" onClick={() => setPreviewVersionId("")}>返回当前版本</button></div><div className="markdown-preview"><ReactMarkdown remarkPlugins={[remarkGfm]}>{previewVersion.content}</ReactMarkdown></div></>
              ) : editorMode === "edit" ? (
                <div className="markdown-editor"><input value={draftTitle} onChange={(event) => { const value = event.target.value; setDraftTitle(value); setDirty(value !== detail.currentVersion.title || draftContent !== detail.currentVersion.content); }} aria-label="文档标题" /><textarea value={draftContent} onChange={(event) => { const value = event.target.value; setDraftContent(value); setDirty(draftTitle !== detail.currentVersion.title || value !== detail.currentVersion.content); }} aria-label="Markdown 正文" /><label>版本说明 <span>可选</span><input value={changeNote} onChange={(event) => setChangeNote(event.target.value)} placeholder="例如：补充验收标准" /></label></div>
              ) : <div className="markdown-preview"><ReactMarkdown remarkPlugins={[remarkGfm]}>{draftContent}</ReactMarkdown></div>}
            </section>

            <aside className="version-history">
              <div className="version-history-title"><div><History size={15} /><strong>版本历史</strong></div><span>{detail.versions.length} 个版本</span></div>
              <div className="version-list">
                {detail.versions.map((version, index) => <button className={(versionDialogId === version.id || previewVersionId === version.id || (!versionDialogId && !previewVersionId && index === 0)) ? "active" : ""} onClick={() => setVersionDialogId(version.id)} aria-label={`管理 ${version.label}`} key={version.id}><span><strong>{version.label}</strong>{index === 0 && <Tag tone="green">当前</Tag>}</span>{version.alias && <b>{version.alias}</b>}<small>{VERSION_SOURCE_LABELS[version.source]} · {formatWorkspaceDate(version.createdAt)}</small><p>{version.changeNote || "未填写修改日志"}</p><em>{version.createdBy}</em></button>)}
              </div>
            </aside>
          </div>
        )}
      </section>

      {newDocumentOpen && <NewDocumentDialog tree={tree} initialProductId={selectedProductId} initialTaskId={selectedTaskId} onClose={() => setNewDocumentOpen(false)} onCreated={handleDocumentCreated} />}
      {transformOpen && detail && <DocumentTransformDialog document={detail} onClose={() => setTransformOpen(false)} onCompleted={handleDocumentTransformed} />}
      {detail && managedVersion && <VersionMetadataDialog
        key={`${managedVersion.id}-${managedVersion.metadataRevision}`}
        document={detail}
        version={managedVersion}
        previousVersion={managedPreviousVersion}
        busy={saving}
        onClose={() => setVersionDialogId("")}
        onUpdated={handleVersionMetadataUpdated}
        onPreview={previewVersionInEditor}
        onRestore={(version) => void restoreVersion(version)}
      />}
    </div>
  );
}

function VersionMetadataDialog({
  document,
  version,
  previousVersion,
  busy,
  onClose,
  onUpdated,
  onPreview,
  onRestore,
}: {
  document: DocumentDetail;
  version: DocumentVersion;
  previousVersion: DocumentVersion | null;
  busy: boolean;
  onClose: () => void;
  onUpdated: (document: DocumentDetail, versionId: string) => void;
  onPreview: (version: DocumentVersion) => void;
  onRestore: (version: DocumentVersion) => void;
}) {
  const [alias, setAlias] = useState(version.alias ?? "");
  const [changeLog, setChangeLog] = useState(version.changeNote ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const isCurrent = version.id === document.currentVersion.id;
  const restoredFrom = version.restoredFromId
    ? document.versions.find((candidate) => candidate.id === version.restoredFromId) ?? null
    : null;
  const diff = useMemo(
    () => summarizeVersionDiff(previousVersion?.content ?? null, version.content),
    [previousVersion?.content, version.content],
  );
  const metadataChanged = alias.trim() !== (version.alias ?? "") || changeLog.trim() !== (version.changeNote ?? "");

  async function saveMetadata(event: React.FormEvent) {
    event.preventDefault();
    if (!metadataChanged) return;
    setSaving(true);
    setError("");
    try {
      const updated = await requestJson<DocumentDetail>(
        `/api/documents/${encodeURIComponent(document.id)}/versions/${encodeURIComponent(version.id)}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            alias: alias.trim() || null,
            changeNote: changeLog.trim() || null,
            baseMetadataRevision: version.metadataRevision,
          }),
        },
      );
      onUpdated(updated, version.id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "版本信息保存失败。");
    } finally {
      setSaving(false);
    }
  }

  return <Modal title="版本信息管理" subtitle={`${version.label}${version.alias ? ` · ${version.alias}` : ""}`} onClose={onClose}>
    <form className="dialog-form version-metadata-dialog" onSubmit={(event) => void saveMetadata(event)}>
      <div className="version-dialog-heading">
        <div><History size={17} /><span><strong>{version.label}</strong><small>{isCurrent ? "当前版本" : "历史版本"}</small></span></div>
        <Tag tone={isCurrent ? "green" : "blue"}>{VERSION_SOURCE_LABELS[version.source]}</Tag>
      </div>

      <dl className="version-detail-grid">
        <div><dt>文件标题</dt><dd title={version.title}>{version.title}</dd></div>
        <div><dt>创建人</dt><dd>{version.createdBy}</dd></div>
        <div><dt>创建时间</dt><dd>{formatWorkspaceDate(version.createdAt)}</dd></div>
        <div><dt>正文修订</dt><dd>第 {version.revision} 次</dd></div>
        <div><dt>最近管理</dt><dd>{version.metadataUpdatedAt ? `${version.metadataUpdatedBy ?? "PM"} · ${formatWorkspaceDate(version.metadataUpdatedAt)}` : "尚未修改"}</dd></div>
      </dl>

      {restoredFrom && <div className="version-restore-origin"><RotateCcw size={14} /><span>由 <strong>{restoredFrom.label}{restoredFrom.alias ? ` · ${restoredFrom.alias}` : ""}</strong> 恢复创建，原历史版本仍完整保留。</span></div>}

      <label>版本名称 <span>可选，用于快速识别该版本；自动版本号不会改变。</span><input value={alias} maxLength={80} onChange={(event) => setAlias(event.target.value)} placeholder="例如：评审定稿" /></label>
      <label>修改日志 <span>{changeLog.length}/500，记录本版本的主要变化。</span><textarea value={changeLog} maxLength={500} onChange={(event) => setChangeLog(event.target.value)} placeholder="例如：补充验收标准并调整优先级" /></label>

      <section className="version-diff-summary" aria-label="版本变化摘要">
        <div className="version-diff-title"><div><History size={14} /><strong>与上一版本相比</strong></div>{previousVersion && <span>{previousVersion.label} → {version.label}</span>}</div>
        {!previousVersion ? <p className="version-diff-empty">这是首个版本，没有上一版本可比较。</p> : <>
          <div className="version-diff-counts"><span className="added">+{diff.addedLines} 行新增</span><span className="removed">-{diff.removedLines} 行删除</span></div>
          {diff.segments.length === 0 ? <p className="version-diff-empty">正文内容与上一版本一致。</p> : <div className="version-diff-segments">{diff.segments.map((segment, index) => <div className={segment.type} key={`${segment.type}-${index}`}><span>{segment.type === "added" ? "+" : "-"}</span><code>{segment.text}</code></div>)}</div>}
        </>}
      </section>

      {error && <div className="dialog-error" role="alert">{error}</div>}
      <div className="dialog-actions version-dialog-actions">
        <button type="button" className="secondary-button" onClick={() => onPreview(version)}><Eye size={14} />在编辑区预览</button>
        {!isCurrent && <button type="button" className="secondary-button" disabled={busy || saving} onClick={() => onRestore(version)}><RotateCcw size={14} />恢复为新版本</button>}
        <button type="submit" className="primary-button" disabled={busy || saving || !metadataChanged}>{saving ? <LoaderCircle size={14} className="spin" /> : <Save size={14} />}{saving ? "保存中" : "保存信息"}</button>
      </div>
    </form>
  </Modal>;
}

function EvidenceView() {
  const [selectedId, setSelectedId] = useState("");
  const [sources, setSources] = useState<ResearchSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    setLoading(true);
    requestJson<ResearchSourceListResponse>("/api/research/sources?sort=newest", { cache: "no-store" })
      .then((payload) => {
        if (!active) return;
        setSources(payload.items);
        setSelectedId((current) => current && payload.items.some((item) => item.id === current) ? current : payload.items[0]?.id ?? "");
        setError("");
      })
      .catch((reason: Error) => active && setError(reason.message))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, []);
  const evidence = sources.find((source) => source.id === selectedId) ?? sources[0] ?? null;
  const claimTypeLabel = evidence?.claimType === "inference" ? "推断" : evidence?.claimType === "recommendation" ? "建议" : "事实";
  return (
    <div className="evidence-layout">
      <section className="evidence-list panel">
        <div className="panel-title"><h2>关键证据</h2><span>{sources.length} 条</span></div>
        {loading && <div className="empty-state">正在读取服务端证据……</div>}
        {!loading && error && <div className="empty-state error-state">{error}</div>}
        {!loading && !error && sources.length === 0 && <div className="empty-state">暂无已入库来源。正式运行完成后，真实引用会自动出现在这里。</div>}
        {!loading && !error && sources.map((item) => {
          const itemType = item.claimType === "inference" ? "推断" : item.claimType === "recommendation" ? "建议" : "事实";
          return <button className={evidence?.id === item.id ? "active" : ""} key={item.id} onClick={() => setSelectedId(item.id)}><div><Tag tone={itemType === "事实" ? "blue" : itemType === "推断" ? "violet" : "green"}>{itemType}</Tag><strong>{item.title}</strong><span>{item.domain} · {item.verification === "pending" ? "待验证" : "已验证"}</span></div><ChevronRight size={16} /></button>;
        })}
      </section>
      <section className="evidence-detail panel">
        <div className="panel-title"><h2>证据详情</h2>{evidence && <Trust value={evidence.trust === "high" ? "高" : evidence.trust === "medium" ? "中" : "低"} />}</div>
        {!evidence ? <div className="empty-state">选择一条服务端来源后查看详情。</div> : <>
          <div className="evidence-quote">“{evidence.excerpt || "该来源暂未保存页面摘录，请打开原网页核验内容。"}”</div>
          <dl>
            <div><dt>证据类型</dt><dd>{claimTypeLabel}</dd></div>
            <div><dt>来源类型</dt><dd>{evidence.type}</dd></div>
            <div><dt>主要来源</dt><dd><a href={evidence.url} target="_blank" rel="noopener noreferrer">{evidence.publisher || evidence.domain}<ExternalLink size={12} /></a></dd></div>
            <div><dt>引用次数</dt><dd>{evidence.citationCount}</dd></div>
            <div><dt>采集时间</dt><dd>{formatWorkspaceDate(evidence.capturedAt)}</dd></div>
            <div><dt>验证状态</dt><dd>{evidence.verification === "pending" ? "待验证" : `已验证 · ${evidence.verifiedBy ?? "PM"}`}</dd></div>
            {evidence.taskTitle && <div><dt>关联任务</dt><dd><Link href={evidence.taskId ? `/tasks/result?taskId=${encodeURIComponent(evidence.taskId)}` : "/tasks"}>{evidence.taskTitle}</Link></dd></div>}
          </dl>
          <h3>当前资料</h3>
          <div className="source-line"><Globe2 size={15} /><div><strong>{evidence.title}</strong><span>{evidence.domain}</span></div><Trust value={evidence.trust === "high" ? "高" : evidence.trust === "medium" ? "中" : "低"} /></div>
        </>}
      </section>
    </div>
  );
}

function LogsView() {
  return (
    <div className="data-page"><div className="table-toolbar"><label className="search-field"><Search size={15} /><input placeholder="搜索操作、目标或执行人" /></label><select aria-label="操作类型"><option>全部操作</option><option>模型调用</option><option>网页检索</option></select><button className="secondary-button"><Download size={14} />导出日志</button></div><DataTable headers={["时间", "操作", "对象", "执行人", "状态", "详情"]}>{operationLogs.map(log=><tr key={log.time}><td className="mono">{log.time}</td><td><strong>{log.action}</strong></td><td className="mono">{log.target}</td><td>{log.actor}</td><td><Status value={log.status} /></td><td>{log.detail}</td></tr>)}</DataTable></div>
  );
}

function SettingsView({
  route,
  notify,
  runtimeStatus,
  onRuntimeStatusChange,
  refreshRuntime,
}: {
  route: RouteKey;
  notify: (message: string) => void;
  runtimeStatus: AgentRuntimeStatus | null;
  onRuntimeStatusChange: (status: AgentRuntimeStatus) => void;
  refreshRuntime: () => Promise<AgentRuntimeStatus>;
}) {
  return (
    <div className="settings-layout">
      <div className="settings-main">
        <nav className="settings-tabs">{settingsTabs.map(tab=><Link key={tab.href} href={tab.href} className={(route === "settings" && tab.href === "/settings") || route === tab.href.slice(1) ? "active" : ""}>{tab.label}</Link>)}</nav>
        {route === "settings/api" ? (
          <ApiSettings notify={notify} runtimeStatus={runtimeStatus} refreshRuntime={refreshRuntime} />
        ) : route === "settings/team" ? (
          <TeamSettings notify={notify} />
        ) : route === "settings/notifications" ? (
          <NotificationSettings notify={notify} />
        ) : (
          <GeneralSettings
            notify={notify}
            runtimeStatus={runtimeStatus}
            onRuntimeStatusChange={onRuntimeStatusChange}
          />
        )}
      </div>
      <aside className="context-panel model-details"><h2>{route === "settings/team" ? "权限说明" : "模型详情"}</h2>{route === "settings/team" ? <><p>成员权限遵循最小授权原则。只有管理员可以修改 API 和外部集成。</p><div className="permission-row"><ShieldCheck size={16}/><span>管理员</span><strong>全部权限</strong></div><div className="permission-row"><FileCheck2 size={16}/><span>编辑者</span><strong>运行和编辑</strong></div><div className="permission-row"><BookOpen size={16}/><span>查看者</span><strong>只读</strong></div></> : <><div className="model-name">GPT-5.6 Terra <Tag tone="blue">推荐</Tag></div><dl><div><dt>上下文窗口</dt><dd>1M tokens</dd></div><div><dt>最大输出</dt><dd>128K tokens</dd></div><div><dt>支持功能</dt><dd>文本 · 推理 · 工具</dd></div></dl><h3>适用任务</h3><p>平衡质量与成本，适合市场研究、竞品分析和 PRD 草拟。</p></>}</aside>
    </div>
  );
}

function GeneralSettings({
  notify,
  runtimeStatus,
  onRuntimeStatusChange,
}: {
  notify: (message: string) => void;
  runtimeStatus: AgentRuntimeStatus | null;
  onRuntimeStatusChange: (status: AgentRuntimeStatus) => void;
}) {
  const [language,setLanguage]=useState("简体中文");
  const [changingMode, setChangingMode] = useState(false);
  const [modeError, setModeError] = useState("");
  const selectedMode = runtimeStatus?.selectedMode;
  const livePending = selectedMode === "live" && runtimeStatus?.mode !== "live";

  async function changeMode(mode: "demo" | "live") {
    if (!runtimeStatus || changingMode || mode === selectedMode) return;
    setChangingMode(true);
    setModeError("");
    try {
      const next = await requestJson<AgentRuntimeStatus>("/api/settings/agent", {
        method: "PATCH",
        body: JSON.stringify({ mode }),
      });
      onRuntimeStatusChange(next);
      notify(mode === "live" && !next.api.configured ? "已选择正式模式，连接 API 后自动生效" : mode === "live" ? "已切换到正式模式" : "已切换到演示模式");
    } catch (reason) {
      setModeError(reason instanceof Error ? reason.message : "运行模式切换失败。");
    } finally {
      setChangingMode(false);
    }
  }

  return (
    <div className="settings-stack">
      <section className="panel form-section runtime-mode-section">
        <div className="section-icon-title">
          <SlidersHorizontal size={18}/>
          <div>
            <h2>Agent 运行模式</h2>
            <p>演示模式不会调用外部模型；正式模式会使用服务端配置的 API。</p>
          </div>
          {runtimeStatus && <Tag tone={livePending ? "amber" : selectedMode === "live" ? "green" : "amber"}>{livePending ? "正式待连接" : selectedMode === "live" ? "正式运行" : "演示运行"}</Tag>}
        </div>
        <div className="mode-segmented" role="group" aria-label="Agent 运行模式">
          <button
            type="button"
            className={selectedMode === "demo" ? "active demo" : ""}
            onClick={() => void changeMode("demo")}
            disabled={!runtimeStatus || changingMode}
            aria-pressed={selectedMode === "demo"}
          >
            <Sparkles size={14}/><span>演示模式</span><small>不调用 API</small>
          </button>
          <button
            type="button"
            className={selectedMode === "live" ? "active live" : ""}
            onClick={() => void changeMode("live")}
            disabled={!runtimeStatus || changingMode}
            aria-pressed={selectedMode === "live"}
          >
            <Activity size={14}/><span>正式模式</span><small>{runtimeStatus?.api.configured ? "调用已配置 API" : "可先选择，连接后生效"}</small>
          </button>
        </div>
        {modeError && <div className="builder-error" role="alert"><AlertTriangle size={14}/>{modeError}</div>}
        {livePending && <div className="notice warning"><AlertTriangle size={14}/>已选择正式模式。当前 API 尚未连接，任务会暂时返回演示结果；配置完成后会自动使用正式调用。</div>}
      </section>
      <section className="panel form-section">
        <div className="section-icon-title"><Settings size={18}/><div><h2>常规设置</h2><p>设置项目名称、语言和默认工作方式。</p></div></div>
        <label>项目名称<input defaultValue="默认项目" /></label>
        <label>界面语言<select value={language} onChange={(e)=>setLanguage(e.target.value)}><option>简体中文</option><option>English</option></select></label>
        <label className="switch-row"><span><strong>默认保留执行轨迹</strong><small>用于审计、调试和评测</small></span><input type="checkbox" defaultChecked /></label>
        <button className="primary-button" onClick={()=>notify("常规设置已保存")}>保存设置</button>
      </section>
      <OutputFormatSettings notify={notify} />
    </div>
  );
}

function OutputFormatSettings({ notify }: { notify: (message: string) => void }) {
  const [settings, setSettings] = useState<WorkspaceOutputSettings>({
    outputFormats: ["markdown", "html", "docx", "pdf"],
    defaultOutputFormat: "markdown",
    updatedAt: "",
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    requestJson<WorkspaceOutputSettings>("/api/settings/output", { cache: "no-store" })
      .then((next) => active && setSettings(next))
      .catch((reason: Error) => active && setError(reason.message))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, []);

  function toggleFormat(format: OutputDocumentFormat) {
    setSettings((current) => {
      const enabled = current.outputFormats.includes(format);
      if (enabled && current.outputFormats.length === 1) return current;
      const outputFormats = enabled ? current.outputFormats.filter((item) => item !== format) : [...current.outputFormats, format];
      return {
        outputFormats,
        defaultOutputFormat: outputFormats.includes(current.defaultOutputFormat) ? current.defaultOutputFormat : outputFormats[0],
        updatedAt: current.updatedAt,
      };
    });
  }

  async function save() {
    setSaving(true);
    setError("");
    try {
      const next = await requestJson<WorkspaceOutputSettings>("/api/settings/output", {
        method: "PATCH",
        body: JSON.stringify({
          outputFormats: settings.outputFormats,
          defaultOutputFormat: settings.defaultOutputFormat,
        }),
      });
      setSettings(next);
      notify("输出格式设置已保存");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "输出格式设置保存失败。");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="panel form-section output-format-section">
      <div className="section-icon-title"><FileCheck2 size={18} /><div><h2>输出文档格式</h2><p>选择文档导出入口显示的格式，并设置默认格式。</p></div></div>
      <div className="output-format-grid">{(Object.entries(OUTPUT_DOCUMENT_FORMAT_LABELS) as Array<[OutputDocumentFormat, string]>).map(([format, label]) => <label className="output-format-option" key={format}><input type="checkbox" checked={settings.outputFormats.includes(format)} onChange={() => toggleFormat(format)} disabled={loading || (settings.outputFormats.length === 1 && settings.outputFormats.includes(format))} /><span><strong>{label}</strong><small>{format === "pdf" ? "打开打印页保存为 PDF" : `导出 .${format === "markdown" ? "md" : format}`}</small></span></label>)}</div>
      <label>默认输出格式<select value={settings.defaultOutputFormat} onChange={(event) => setSettings((current) => ({ ...current, defaultOutputFormat: event.target.value as OutputDocumentFormat }))} disabled={loading}>{settings.outputFormats.map((format) => <option value={format} key={format}>{OUTPUT_DOCUMENT_FORMAT_LABELS[format]}</option>)}</select></label>
      {error && <div className="notice danger" role="alert"><AlertTriangle size={14} />{error}</div>}
      <button className="primary-button" onClick={() => void save()} disabled={loading || saving}>{saving ? <LoaderCircle size={14} className="spin" /> : <Save size={14} />}{saving ? "保存中" : "保存设置"}</button>
    </section>
  );
}

function ApiSettings({
  notify,
  runtimeStatus,
  refreshRuntime,
}: {
  notify: (message: string) => void;
  runtimeStatus: AgentRuntimeStatus | null;
  refreshRuntime: () => Promise<AgentRuntimeStatus>;
}) {
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiMode, setApiMode] = useState<"responses" | "chat_completions">("responses");
  const [modelFast, setModelFast] = useState("");
  const [modelDefault, setModelDefault] = useState("");
  const [modelDeep, setModelDeep] = useState("");
  const [formDirty, setFormDirty] = useState(false);
  const [connectionMessage, setConnectionMessage] = useState("");
  const [connectionError, setConnectionError] = useState("");

  useEffect(() => {
    if (!runtimeStatus || formDirty) return;
    setBaseUrl(runtimeStatus.api.baseUrl);
    setApiMode(runtimeStatus.api.apiMode);
    setModelFast(runtimeStatus.models.quick);
    setModelDefault(runtimeStatus.models.standard);
    setModelDeep(runtimeStatus.models.deep);
  }, [runtimeStatus, formDirty]);

  async function refreshStatus() {
    setRefreshing(true);
    try {
      await refreshRuntime();
      notify("API 状态已刷新");
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : "API 状态读取失败");
    } finally {
      setRefreshing(false);
    }
  }

  function markDirty() {
    setFormDirty(true);
    setConnectionMessage("");
    setConnectionError("");
  }

  const connectionPayload = () => ({
    ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
    baseUrl,
    apiMode,
    modelFast,
    modelDefault,
    modelDeep,
  });

  async function testConnection() {
    setTesting(true);
    setConnectionMessage("");
    setConnectionError("");
    try {
      const result = await requestJson<{ ok: boolean; error?: string; endpoint?: string; latencyMs?: number }>("/api/settings/agent/connection", {
        method: "POST",
        body: JSON.stringify(connectionPayload()),
      });
      setConnectionMessage(`连接成功：${result.endpoint ?? "API 服务"}${result.latencyMs ? ` · ${result.latencyMs} ms` : ""}`);
    } catch (reason) {
      setConnectionError(reason instanceof Error ? reason.message : "连接测试失败。");
    } finally {
      setTesting(false);
    }
  }

  async function saveConnection() {
    setSaving(true);
    setConnectionMessage("");
    setConnectionError("");
    try {
      await requestJson<AgentRuntimeStatus>("/api/settings/agent/connection", {
        method: "PATCH",
        body: JSON.stringify(connectionPayload()),
      });
      await refreshRuntime();
      setApiKey("");
      setFormDirty(false);
      notify("API 配置已保存");
    } catch (reason) {
      setConnectionError(reason instanceof Error ? reason.message : "API 配置保存失败。");
    } finally {
      setSaving(false);
    }
  }

  async function clearConnection() {
    if (!window.confirm("确定清除当前 API 配置吗？清除后正式模式会等待新的 API Key。")) return;
    setSaving(true);
    setConnectionMessage("");
    setConnectionError("");
    try {
      await requestJson<AgentRuntimeStatus>("/api/settings/agent/connection", { method: "DELETE" });
      await refreshRuntime();
      setApiKey("");
      setBaseUrl("");
      setFormDirty(false);
      notify("API 配置已清除");
    } catch (reason) {
      setConnectionError(reason instanceof Error ? reason.message : "API 配置清除失败。");
    } finally {
      setSaving(false);
    }
  }

  const configured = runtimeStatus?.api.configured ?? false;
  const livePending = runtimeStatus?.selectedMode === "live" && runtimeStatus.mode !== "live";
  return (
    <div className="settings-stack">
      <section className="panel form-section">
        <div className="section-icon-title">
          <KeyRound size={18}/>
          <div><h2>API 连接与配置</h2><p>配置 OpenAI 或兼容中转站。Key 只写入本机 `.env.local`，不会回显到页面。</p></div>
          <Tag tone={configured ? "green" : "red"}>{configured ? "已配置" : "未配置"}</Tag>
        </div>
        <dl className="api-connection-list">
          <div><dt>模式选择</dt><dd>{livePending ? "正式模式（待连接）" : runtimeStatus?.selectedMode === "live" ? "正式模式" : runtimeStatus?.selectedMode === "demo" ? "演示模式" : "读取中"}</dd></div>
          <div><dt>实际执行</dt><dd>{runtimeStatus?.mode === "live" ? "正式调用" : runtimeStatus?.mode === "demo" ? "演示结果" : "读取中"}</dd></div>
          <div><dt>服务提供方</dt><dd>{runtimeStatus?.api.endpointLabel ?? "读取中"}</dd></div>
          <div><dt>调用协议</dt><dd>{runtimeStatus?.api.apiMode === "chat_completions" ? "Chat Completions" : "Responses API"}</dd></div>
          <div><dt>网页搜索</dt><dd>{runtimeStatus?.api.webSearchAvailable ? "可用" : "不可用（需复核）"}</dd></div>
          <div><dt>标准模型</dt><dd>{runtimeStatus?.models.standard ?? "读取中"}</dd></div>
          <div><dt>Key 状态</dt><dd>{runtimeStatus?.api.keyHint ?? "未配置"}</dd></div>
        </dl>
        {!configured && <div className="notice warning"><AlertTriangle size={14}/>{livePending ? "已选择正式模式，但尚未配置 API Key。填写下方配置并保存后即可调用。" : "尚未配置 API Key。你可以先填写下方配置，再切换到正式模式。"}</div>}
        {configured && <div className="notice success"><CheckCircle2 size={14}/>服务端已读取 API 配置；侧边栏、设置页与 Agent 接口会同步更新。</div>}
        <label>API Key <span className="optional">留空保持现有配置</span><div className="password-field"><input aria-label="API Key" type={showKey ? "text" : "password"} value={apiKey} onChange={(event) => { setApiKey(event.target.value); markDirty(); }} placeholder={runtimeStatus?.api.keyHint ? `当前已配置（${runtimeStatus.api.keyHint}）` : "sk-..."} autoComplete="new-password"/><button type="button" onClick={() => setShowKey(!showKey)}>{showKey ? "隐藏" : "显示"}</button></div></label>
        <label>中转站 Base URL <span className="optional">留空使用 OpenAI 官方地址</span><input aria-label="中转站 Base URL" value={baseUrl} onChange={(event) => { setBaseUrl(event.target.value); markDirty(); }} placeholder="https://api.openai.com/v1" /></label>
        <label>调用协议<select aria-label="调用协议" value={apiMode} onChange={(event) => { setApiMode(event.target.value as "responses" | "chat_completions"); markDirty(); }}><option value="responses">Responses API（支持 Web Search）</option><option value="chat_completions">Chat Completions（兼容中转站）</option></select></label>
        {connectionMessage && <div className="notice success" role="status"><CheckCircle2 size={14}/>{connectionMessage}</div>}
        {connectionError && <div className="notice danger" role="alert"><AlertTriangle size={14}/>{connectionError}</div>}
        <div className="inline-actions api-actions"><button className="secondary-button" onClick={() => void testConnection()} disabled={testing || saving}>{testing ? <LoaderCircle size={14} className="spin" /> : <Globe2 size={14}/>}测试连接</button><button className="primary-button" onClick={() => void saveConnection()} disabled={saving || testing}>{saving ? <LoaderCircle size={14} className="spin" /> : <Save size={14}/>}保存配置</button><button className="text-button danger-text" onClick={() => void clearConnection()} disabled={saving || testing}><X size={14}/>清除配置</button><button className="text-button" onClick={() => void refreshStatus()} disabled={refreshing || saving}>{refreshing ? <LoaderCircle size={14} className="spin" /> : <RefreshCw size={14}/>}刷新状态</button></div>
      </section>
      <section className="panel model-picker">
        <div className="section-icon-title"><BrainCircuit size={18}/><div><h2>模型配置</h2><p>可覆盖三种执行深度使用的模型名称。</p></div></div>
        <label className="model-config-row">快速模型<input aria-label="快速模型" value={modelFast} onChange={(event) => { setModelFast(event.target.value); markDirty(); }} /></label>
        <label className="model-config-row">标准模型 <Tag tone="blue">默认</Tag><input aria-label="标准模型" value={modelDefault} onChange={(event) => { setModelDefault(event.target.value); markDirty(); }} /></label>
        <label className="model-config-row">深度模型<input aria-label="深度模型" value={modelDeep} onChange={(event) => { setModelDeep(event.target.value); markDirty(); }} /></label>
      </section>
    </div>
  );
}

function TeamSettings({ notify }: { notify: (message: string) => void }) {
  const members=[{name:"陈默",mail:"chenmo@example.com",role:"管理员",avatar:"陈"},{name:"李宁",mail:"lining@example.com",role:"编辑者",avatar:"李"},{name:"王安",mail:"wangan@example.com",role:"查看者",avatar:"王"}];
  return <div className="settings-stack"><section className="panel team-section"><div className="panel-title"><div><h2>团队成员</h2><p>管理项目访问与审批权限。</p></div><button className="primary-button" onClick={()=>notify("邀请链接已生成") }><Plus size={14}/>邀请成员</button></div>{members.map((member)=><div className="member-row" key={member.mail}><span className="member-avatar">{member.avatar}</span><div><strong>{member.name}</strong><span>{member.mail}</span></div><select defaultValue={member.role}><option>管理员</option><option>编辑者</option><option>查看者</option></select><button className="plain-icon-button"><MoreHorizontal size={16}/></button></div>)}</section></div>;
}

function NotificationSettings({ notify }: { notify: (message: string) => void }) {
  return <div className="settings-stack"><section className="panel form-section"><div className="section-icon-title"><Bell size={18}/><div><h2>通知规则</h2><p>选择需要提醒的执行事件和审批动作。</p></div></div>{["任务完成","任务需要审批","外部工具执行失败"].map((label,index)=><label className="switch-row" key={label}><span><strong>{label}</strong><small>{index===0?"任务交付物准备好后通知":"通过应用内通知提醒相关成员"}</small></span><input type="checkbox" defaultChecked={index<2}/></label>)}<button className="primary-button" onClick={()=>notify("通知规则已保存")}>保存设置</button></section><section className="panel integration-section"><div className="section-icon-title"><Link2 size={18}/><div><h2>外部集成</h2><p>连接团队协作和项目管理工具。</p></div></div>{["飞书","Notion","Jira","Linear"].map((item)=><div className="integration-row" key={item}><span>{item.slice(0,1)}</span><strong>{item}</strong><Tag tone="gray">未连接</Tag><button className="secondary-button" onClick={()=>notify(`${item} 连接流程尚未启用`)}>连接</button></div>)}</section></div>;
}

function ProfileView({ notify }: { notify: (message: string) => void }) {
  return <div className="profile-layout"><section className="panel profile-card"><div className="profile-hero"><span>PM</span><div><h2>产品经理</h2><p>pm@example.com</p><Tag tone="green">项目管理员</Tag></div></div><div className="profile-stats"><div><strong>24</strong><span>本月任务</span></div><div><strong>18</strong><span>完成任务</span></div><div><strong>7</strong><span>审批操作</span></div></div></section><section className="panel form-section"><div className="section-icon-title"><Users size={18}/><div><h2>个人资料</h2><p>用于团队协作与审批记录。</p></div></div><label>显示名称<input defaultValue="产品经理" /></label><label>邮箱<input defaultValue="pm@example.com" /></label><label>默认角色<select defaultValue="产品经理"><option>产品经理</option><option>产品负责人</option><option>研究员</option></select></label><button className="primary-button" onClick={()=>notify("个人资料已更新")}>保存资料</button></section></div>;
}

function DocumentTransformDialog({
  document,
  onClose,
  onCompleted,
}: {
  document: DocumentDetail;
  onClose: () => void;
  onCompleted: (document: DocumentDetail, destination: "new_version" | "new_document", result: { demo: boolean; model: string }) => void;
}) {
  const [action, setAction] = useState<DocumentTransformActionValue>("rewrite");
  const [targetFormat, setTargetFormat] = useState<DocumentFormat>(document.format);
  const [destination, setDestination] = useState<"new_version" | "new_document">("new_version");
  const [instruction, setInstruction] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const isConvert = action === "convert";

  function selectAction(value: DocumentTransformActionValue) {
    setAction(value);
    if (value === "to_prd") setTargetFormat("prd");
    if (value === "to_outline") setTargetFormat("outline");
    if (value === "translate_en" && targetFormat === document.format) setTargetFormat("markdown");
  }

  function selectTarget(value: DocumentFormat) {
    setTargetFormat(value);
    if (value !== document.format) setDestination("new_document");
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const response = await requestJson<{ document: DocumentDetail; result: { demo: boolean; model: string } }>(`/api/documents/${encodeURIComponent(document.id)}/transform`, {
        method: "POST",
        body: JSON.stringify({
          baseRevision: document.currentRevision,
          action,
          targetFormat,
          destination,
          instruction: instruction.trim() || undefined,
        }),
      });
      onCompleted(response.document, destination, response.result);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "AI 文档转换失败。");
      setSaving(false);
    }
  }

  return (
    <Modal title="AI 生成 / 转换文档" subtitle="基于当前已保存版本生成内容，可保存为新版本或独立文档。" onClose={onClose}>
      <form className="dialog-form transform-dialog" onSubmit={submit}>
        <div className="transform-action-grid">
          {documentTransformOptions.map((option) => <button type="button" key={option.value} className={action === option.value ? "active" : ""} onClick={() => selectAction(option.value)}><Sparkles size={14} /><span><strong>{option.label}</strong><small>{option.description}</small></span></button>)}
        </div>
        <div className="dialog-grid">
          <label className={isConvert ? "transform-format-choice" : undefined}>
            {isConvert ? <><span>转换为什么文档类型</span><small>选择转换后的文档结构和使用场景。</small></> : "目标文档类型"}
            <select aria-label={isConvert ? "转换为什么文档类型" : "目标文档类型"} value={targetFormat} onChange={(event) => selectTarget(event.target.value as DocumentFormat)}>{(Object.entries(DOCUMENT_FORMAT_LABELS) as Array<[DocumentFormat, string]>).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select>
          </label>
          <label>保存方式<select value={destination} onChange={(event) => setDestination(event.target.value as "new_version" | "new_document")}><option value="new_version">保存为当前文档新版本</option><option value="new_document">创建关联任务下的新文档</option></select></label>
        </div>
        {destination === "new_version" && targetFormat !== document.format && <div className="notice warning"><AlertTriangle size={14} />保存为当前文档新版本时会保持原文档类型；要切换类型，请选择“创建新文档”。</div>}
        <label>补充要求 <span>可选</span><textarea value={instruction} onChange={(event) => setInstruction(event.target.value)} placeholder="例如：面向管理层，突出结论、风险和下一步动作" /></label>
        {error && <div className="dialog-error" role="alert">{error}</div>}
        <div className="dialog-actions"><button type="button" className="secondary-button" onClick={onClose}>取消</button><button className="primary-button" disabled={saving}>{saving ? <LoaderCircle size={14} className="spin" /> : <Sparkles size={14} />}{saving ? "生成中" : "开始生成"}</button></div>
      </form>
    </Modal>
  );
}

function Modal({ title, subtitle, onClose, children }: { title: string; subtitle?: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="modal-panel" role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <div className="modal-header"><div><h2 id="modal-title">{title}</h2>{subtitle && <p>{subtitle}</p>}</div><button className="plain-icon-button" onClick={onClose} title="关闭"><X size={16} /></button></div>
        <div className="modal-content">{children}</div>
      </section>
    </div>
  );
}

function ProductDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (product: ProductSummary) => void }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const product = await requestJson<ProductSummary>("/api/products", {
        method: "POST",
        body: JSON.stringify({ name, description }),
      });
      onCreated(product);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "产品创建失败。");
      setSaving(false);
    }
  }

  return (
    <Modal title="新建产品" subtitle="任务和文档都会归档到所选产品。" onClose={onClose}>
      <form className="dialog-form" onSubmit={submit}>
        <label>产品名称<input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：客户反馈中心" /></label>
        <label>产品描述 <span>可选</span><textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="简要说明产品目标与范围" /></label>
        {error && <div className="dialog-error" role="alert">{error}</div>}
        <div className="dialog-actions"><button type="button" className="secondary-button" onClick={onClose}>取消</button><button className="primary-button" disabled={saving || !name.trim()}>{saving ? <LoaderCircle size={14} className="spin" /> : <Plus size={14} />}创建产品</button></div>
      </form>
    </Modal>
  );
}

function NewDocumentDialog({
  tree,
  initialProductId,
  initialTaskId,
  onClose,
  onCreated,
}: {
  tree: ProductTreeNode[];
  initialProductId: string;
  initialTaskId: string;
  onClose: () => void;
  onCreated: (document: DocumentDetail) => void;
}) {
  const [productId, setProductId] = useState(initialProductId || tree[0]?.id || "");
  const availableTasks = tree.find((product) => product.id === productId)?.tasks ?? [];
  const [taskId, setTaskId] = useState(initialTaskId || availableTasks[0]?.id || "");
  const [title, setTitle] = useState("");
  const [format, setFormat] = useState<DocumentFormat>("prd");
  const [content, setContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!availableTasks.some((task) => task.id === taskId)) setTaskId(availableTasks[0]?.id ?? "");
  }, [availableTasks, taskId]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const document = await requestJson<DocumentDetail>("/api/documents", {
        method: "POST",
        body: JSON.stringify({
          taskId,
          title,
          format,
          content: content.trim() || `# ${title}\n\n`,
          owner: "PM",
        }),
      });
      onCreated(document);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "文档创建失败。");
      setSaving(false);
    }
  }

  return (
    <Modal title="新建产品文档" subtitle="新文档将从 v1.0 开始记录历史版本。" onClose={onClose}>
      <form className="dialog-form" onSubmit={submit}>
        <div className="dialog-grid"><label>所属产品<select value={productId} onChange={(event) => setProductId(event.target.value)}>{tree.map((product) => <option value={product.id} key={product.id}>{product.name}</option>)}</select></label><label>来源任务<select value={taskId} onChange={(event) => setTaskId(event.target.value)}>{availableTasks.map((task) => <option value={task.id} key={task.id}>{task.title}</option>)}</select></label></div>
        <div className="dialog-grid"><label>文档标题<input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} placeholder="输入文档标题" /></label><label>文档类型<select value={format} onChange={(event) => setFormat(event.target.value as DocumentFormat)}>{(Object.entries(DOCUMENT_FORMAT_LABELS) as Array<[DocumentFormat, string]>).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label></div>
        <label>初始正文 <span>可选</span><textarea className="document-create-content" value={content} onChange={(event) => setContent(event.target.value)} placeholder="# 文档标题" /></label>
        {error && <div className="dialog-error" role="alert">{error}</div>}
        <div className="dialog-actions"><button type="button" className="secondary-button" onClick={onClose}>取消</button><button className="primary-button" disabled={saving || !taskId || !title.trim()}>{saving ? <LoaderCircle size={14} className="spin" /> : <FilePlus2 size={14} />}创建文档</button></div>
      </form>
    </Modal>
  );
}

function InspectorEmpty() {
  return <div className="inspector-empty"><Inbox size={40} /><span>暂无数据</span></div>;
}

function TaskInspector({ tab, setTab, route, taskId, draft, model }: {
  tab: "info" | "evidence" | "logs";
  setTab: (tab: "info" | "evidence" | "logs") => void;
  route: RouteKey;
  taskId?: string;
  draft: DraftInspectorState;
  model: string;
}) {
  const [task, setTask] = useState<TaskRecord | null>(null);
  const [run, setRun] = useState<TaskRunRecord | null>(null);
  const [sources, setSources] = useState<ResearchSource[]>([]);
  useEffect(() => {
    if (!taskId) {
      setTask(null);
      setRun(null);
      return;
    }
    let active = true;
    const load = async () => {
      try {
        const record = await requestJson<TaskRecord>(`/api/tasks/${encodeURIComponent(taskId)}`);
        if (active) setTask(record);
        try {
          const payload = await requestJson<TaskRunStatusResponse>(`/api/tasks/${encodeURIComponent(taskId)}/run`, { cache: "no-store" });
          if (active) setRun(payload.run);
        } catch {
          if (active) setRun(null);
        }
      } catch {
        // Keep the inspector in its loading state when the task is unavailable.
      }
    };
    load();
    const timer = window.setInterval(load, 1_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [taskId]);
  useEffect(() => {
    if (!taskId) {
      setSources([]);
      return;
    }
    let active = true;
    requestJson<ResearchSourceListResponse>(`/api/research/sources?taskId=${encodeURIComponent(taskId)}&sort=newest`, { cache: "no-store" }).then((payload) => active && setSources(payload.items.slice(0, 5))).catch(() => active && setSources([]));
    return () => { active = false; };
  }, [taskId]);
  const isDraft = route === "";
  const status = task ? TASK_STATUS_LABELS[task.status] : route === "tasks/running" ? "执行中" : route === "tasks/result" ? "已完成" : "草稿";
  const type = task ? TASK_TYPE_LABELS[task.type] : isDraft ? TASK_TYPE_LABELS[draft.mode] : "--";
  const depth = task ? ({ quick: "快速", standard: "标准", deep: "深度" } as const)[task.depth] : isDraft ? ({ quick: "快速", standard: "标准", deep: "深度" } as const)[draft.depth] : "--";
  const autonomy = task ? ({ advise: "仅建议", draft: "生成草稿", scoped: "有限执行" } as const)[task.autonomy] : isDraft ? ({ advise: "仅建议", draft: "生成草稿", scoped: "有限执行" } as const)[draft.autonomy] : "--";
  const currentModel = run?.model ?? (isDraft ? model : "等待 Worker");

  return (
    <aside className="task-inspector">
      <div className="inspector-tabs">
        <button className={tab === "info" ? "active" : ""} onClick={() => setTab("info")}>任务信息</button>
        <button className={tab === "evidence" ? "active" : ""} onClick={() => setTab("evidence")}>证据来源</button>
        <button className={tab === "logs" ? "active" : ""} onClick={() => setTab("logs")}>操作记录</button>
      </div>
      <div className="inspector-body">
        {tab === "info" && (
          <dl className="kv-list">
            <div><dt>任务类型</dt><dd>{type}</dd></div>
            <div><dt>执行深度</dt><dd>{depth}</dd></div>
            <div><dt>自治级别</dt><dd>{autonomy}</dd></div>
            <div><dt>当前模型</dt><dd>{currentModel}</dd></div>
            <div><dt>创建时间</dt><dd>{task ? formatWorkspaceDate(task.createdAt) : isDraft ? "尚未创建" : "--"}</dd></div>
            <div><dt>任务状态</dt><dd><Status value={status} /></dd></div>
          </dl>
        )}
        {tab === "evidence" && (sources.length > 0 ? (
          <div className="inspector-list">
            {sources.map((source) => <Link href="/evidence" key={source.id}><strong>{source.title}</strong><span>{source.domain}<Trust value={source.trust === "high" ? "高" : source.trust === "medium" ? "中" : "低"} /></span></Link>)}
          </div>
        ) : <InspectorEmpty />)}
        {tab === "logs" && (!isDraft && operationLogs.length > 0 ? (
          <div className="inspector-logs">{operationLogs.slice(0, 6).map((log) => <div key={log.time}><span>{log.time}</span><strong>{log.action}</strong><p>{log.detail}</p></div>)}</div>
        ) : <InspectorEmpty />)}
      </div>
    </aside>
  );
}

function Metric({ label, value, icon: Icon, tone, active = false, onClick }: { label:string; value:string; icon:typeof Activity; tone:string; active?:boolean; onClick?:()=>void }) { const content=<><div><strong>{value}</strong><span>{label}</span></div><Icon size={18}/></>; return onClick?<button type="button" className={`metric-card metric-filter tone-${tone} ${active?"active":""}`} aria-pressed={active} onClick={onClick}>{content}</button>:<div className={`metric-card tone-${tone}`}>{content}</div>; }
function DataTable({ headers, children }: { headers:string[]; children:React.ReactNode }) { return <div className="data-table-wrap"><table className="data-table"><thead><tr>{headers.map(header=><th key={header}>{header}</th>)}</tr></thead><tbody>{children}</tbody></table></div>; }
function Tag({ children, tone }: { children:React.ReactNode; tone:"blue"|"green"|"amber"|"red"|"violet"|"gray" }) { return <span className={`tag tag-${tone}`}>{children}</span>; }
function Status({ value }: { value:string }) { const tone=value==="已完成"||value==="成功"?"green":value==="执行中"?"blue":value==="待审核"?"amber":value==="待修改"||value==="已暂停"||value==="失败"?"red":"gray"; return <Tag tone={tone}>{value}</Tag>; }
function Trust({ value }: { value:string }) { return <Tag tone={value==="高"?"green":value==="中"?"amber":"red"}>{value}</Tag>; }
function Insight({ title, tone, children }: { title:string; tone:"blue"|"green"|"amber"|"red"; children:React.ReactNode }) { return <article className={`insight tone-${tone}`}><strong>{title}</strong><p>{children}</p></article>; }
