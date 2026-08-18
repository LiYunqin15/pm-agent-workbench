export const operationLogs = [
  { time: "14:45:18", action: "任务完成", target: "TASK-0821", actor: "PM Agent", status: "成功", detail: "市场研究任务完成，生成 4 个交付物" },
  { time: "14:44:52", action: "文件生成", target: "市场分析报告", actor: "PM Agent", status: "成功", detail: "完成 Markdown 与 PPT 提纲校验" },
  { time: "14:42:10", action: "模型调用", target: "GPT-5.6 Terra", actor: "PM Agent", status: "成功", detail: "汇总 8 个来源并生成核心结论" },
  { time: "14:38:33", action: "交叉验证", target: "市场规模数据", actor: "PM Agent", status: "成功", detail: "对比 3 个独立来源" },
  { time: "14:34:07", action: "网页检索", target: "zhihu.com", actor: "PM Agent", status: "成功", detail: "采集用户评价样本" },
  { time: "14:33:21", action: "网页检索", target: "feishu.cn", actor: "PM Agent", status: "成功", detail: "采集官网功能与定价信息" },
  { time: "14:30:02", action: "任务启动", target: "TASK-0821", actor: "陈默", status: "成功", detail: "批准公开网页检索" },
];

export const settingsTabs = [
  { href: "/settings", label: "常规设置" },
  { href: "/settings/api", label: "API与模型" },
  { href: "/settings/team", label: "团队成员" },
  { href: "/settings/notifications", label: "通知与集成" },
];
