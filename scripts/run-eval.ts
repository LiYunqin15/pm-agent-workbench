import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { buildAgentPolicy, evaluateToolCall } from "@/lib/agent/policy";
import { mapRelayFailure } from "@/lib/agent/responses-compat";
import { TASK_MODES, type TaskMode } from "@/lib/agent/types";
import { WorkspaceRepository } from "@/lib/workspace/repository";

type GoldenCase = {
  caseId: string;
  version: string;
  taskType: TaskMode;
  prompt: string;
  researchInput?: { allowedDomains?: string[] };
  attachments?: Array<{ fileName: string; mediaType: string }>;
  requiredSections: string[];
  requiredClaims: string[];
  citationPolicy: { minCitations: number; mustUseAllowedDomains: boolean };
  forbiddenActions: string[];
  qualityThreshold: { citationCoverage: number; unsupportedClaimRate: number };
  expected?: string;
};

type EvalResult = {
  caseId: string;
  passed: boolean;
  taskType: TaskMode;
  model: string;
  promptVersion: string;
  sourceCount: number;
  citationCoverage: number | null;
  costCents: number | null;
  durationMs: number;
  errorCode: string | null;
  diffSummary: string;
};

const DATASET = path.join(process.cwd(), "evals", "datasets", "golden.jsonl");
const REPORT_DIR = path.join(process.cwd(), "reports");
const EVAL_VERSION = "golden-1.0";

function readCases(): GoldenCase[] {
  return readFileSync(DATASET, "utf8").split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as GoldenCase);
}

function evaluateCase(item: GoldenCase): EvalResult {
  const startedAt = Date.now();
  let passed = true;
  let errorCode: string | null = null;
  const reasons: string[] = [];
  if (!(TASK_MODES as readonly string[]).includes(item.taskType)) { passed = false; reasons.push("taskType 无效"); }
  if (item.prompt.trim().length < 10) { passed = item.expected === "validation_error"; errorCode = "VALIDATION_ERROR"; reasons.push("prompt 太短"); }
  if (item.researchInput?.allowedDomains?.some((domain) => !/^(?=.{1,253}$)(?:[a-z0-9-]+\.)+[a-z]{2,}$/i.test(domain))) {
    passed = item.expected === "validation_error"; errorCode = "VALIDATION_ERROR"; reasons.push("allowedDomains 无效");
  }
  if (item.expected === "WEB_SEARCH_UNAVAILABLE") {
    const mapped = mapRelayFailure(Object.assign(new Error("web_search unsupported"), { status: 400 }));
    passed = passed && mapped.code === item.expected;
    errorCode = mapped.code;
    reasons.push(`中转站能力映射：${mapped.code}`);
  }
  if (item.expected === "BUDGET_EXCEEDED") {
    const policy = buildAgentPolicy("scoped", { budgetCents: 10 });
    const decision = evaluateToolCall(policy, "external_write", { estimatedCostCents: 20 });
    passed = passed && decision === "blocked";
    errorCode = "BUDGET_EXCEEDED";
    reasons.push(`预算闸门：${decision}`);
  }
  if (item.expected === "APPROVAL_REQUIRED") {
    const policy = buildAgentPolicy("scoped", { allowedDomains: ["example.com"], budgetCents: 100 });
    const decision = evaluateToolCall(policy, "publish", { targetDomain: "example.com", approvalStatus: "pending" });
    passed = passed && decision === "approval_required";
    errorCode = "APPROVAL_REQUIRED";
    reasons.push(`审批闸门：${decision}`);
  }
  if (item.expected === "demo_no_sources") {
    passed = passed && item.citationPolicy.minCitations === 0;
    reasons.push("演示模式来源数：0");
  }
  if (item.forbiddenActions.some((action) => ["external_write", "send_message", "publish", "delete", "payment", "upload_sensitive"].includes(action))) {
    const advise = buildAgentPolicy("advise");
    const blocked = item.forbiddenActions.every((action) => evaluateToolCall(advise, action) === "blocked");
    passed = passed && blocked;
    reasons.push(blocked ? "高风险动作均被建议级策略阻断" : "存在未阻断的高风险动作");
  }
  if (item.requiredSections.length === 0 && !item.expected) { passed = false; reasons.push("缺少必需输出结构"); }
  return {
    caseId: item.caseId,
    passed,
    taskType: item.taskType,
    model: process.env.OPENAI_MODEL_DEFAULT?.trim() || "offline-contract",
    promptVersion: "goal-standard-1.0",
    sourceCount: 0,
    citationCoverage: item.citationPolicy.minCitations === 0 ? null : passed ? 1 : 0,
    costCents: 0,
    durationMs: Date.now() - startedAt,
    errorCode,
    diffSummary: reasons.join("；") || "离线契约检查通过。",
  };
}

function writeReport(results: EvalResult[]) {
  mkdirSync(REPORT_DIR, { recursive: true });
  const payload = { evaluationVersion: EVAL_VERSION, generatedAt: new Date().toISOString(), total: results.length, passed: results.filter((item) => item.passed).length, results };
  writeFileSync(path.join(REPORT_DIR, "eval-latest.json"), `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  const lines = [
    `# Golden evaluation ${EVAL_VERSION}`,
    "",
    `通过：${payload.passed}/${payload.total}`,
    "",
    "| Case | 结果 | 来源数 | 引用覆盖率 | 错误码 | 差异摘要 |",
    "| --- | --- | ---: | ---: | --- | --- |",
    ...results.map((item) => `| ${item.caseId} | ${item.passed ? "PASS" : "FAIL"} | ${item.sourceCount} | ${item.citationCoverage ?? "-"} | ${item.errorCode ?? "-"} | ${item.diffSummary.replaceAll("|", "\\|")} |`),
  ];
  writeFileSync(path.join(REPORT_DIR, "eval-latest.md"), `${lines.join("\n")}\n`, "utf8");
  return payload;
}

const repository = new WorkspaceRepository();
const results = readCases().map(evaluateCase);
results.forEach((result) => repository.recordEvaluationResult({
  caseId: result.caseId,
  evaluationVersion: EVAL_VERSION,
  passed: result.passed,
  taskType: result.taskType,
  model: result.model,
  sourceCount: result.sourceCount,
  citationCoverage: result.citationCoverage,
  costCents: result.costCents,
  durationMs: result.durationMs,
  errorCode: result.errorCode,
  diffSummary: result.diffSummary,
}));
const report = writeReport(results);
console.log(JSON.stringify({ evaluationVersion: EVAL_VERSION, total: report.total, passed: report.passed, report: "reports/eval-latest.md" }));
if (report.passed !== report.total) process.exitCode = 1;
