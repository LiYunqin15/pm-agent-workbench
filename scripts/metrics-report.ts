import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { WorkspaceRepository } from "@/lib/workspace/repository";

const repository = new WorkspaceRepository();
const overview = repository.getMetricsOverview({
  from: process.env.METRICS_FROM,
  to: process.env.METRICS_TO,
  taskType: process.env.METRICS_TASK_TYPE as "market" | "competitor" | "insight" | "prd" | undefined,
});
const reportDir = path.join(process.cwd(), "reports");
mkdirSync(reportDir, { recursive: true });
writeFileSync(path.join(reportDir, "metrics-latest.json"), `${JSON.stringify(overview, null, 2)}\n`, "utf8");
const lines = [
  "# PM Agent metrics",
  "",
  `时间范围：${overview.from} 至 ${overview.to}`,
  `指标定义版本：${overview.metricDefinitionVersion}`,
  `评测数据版本：${overview.evaluationVersion}`,
  "",
  "| 指标 | 值 | 样本 | 目标 | 状态 |",
  "| --- | ---: | ---: | ---: | --- |",
  ...Object.entries(overview.metrics).map(([name, metric]) => `| ${name} | ${metric.value ?? "-"} | ${metric.sampleSize} | ${metric.targetOperator} ${metric.target} | ${metric.status} |`),
  "",
  ...(overview.integrityWarnings.length ? ["## 数据完整性告警", "", ...overview.integrityWarnings.map((warning) => `- ${warning}`)] : []),
];
writeFileSync(path.join(reportDir, "metrics-latest.md"), `${lines.join("\n")}\n`, "utf8");
console.log(JSON.stringify({ report: "reports/metrics-latest.md", integrityWarnings: overview.integrityWarnings.length }));
