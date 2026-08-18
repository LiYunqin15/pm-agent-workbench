# PM Agent Workbench

面向互联网产品经理的日常工作 Agent。当前版本提供任务工作台、模型路由、权限等级、预算约束、产品文档版本管理和 OpenAI Agents SDK 接入骨架。

## 启动

1. 安装依赖：`npm install`
2. 复制 `.env.example` 为 `.env.local`
3. 在“项目设置 → API 与模型”填写 API 配置，或直接在 `.env.local` 中填写 `OPENAI_API_KEY`
4. 启动：`npm run dev`

未配置 API Key 时应用仍可运行，但只返回明确标记的演示结果，不会伪造外部研究证据。

### 异步任务队列

任务执行通过 Redis 6.2+ 和 BullMQ 队列异步处理。Next.js 进程只负责 API/UI，至少启动一个独立 Worker：

```bash
# Redis 默认地址：redis://127.0.0.1:6379
npm run dev
npm run worker
```

多实例部署时，所有 Next.js 实例和 Worker 使用同一个 `PM_AGENT_REDIS_URL`、`PM_AGENT_QUEUE_NAME` 和 `PM_AGENT_DB_PATH`。Worker 会写入心跳并巡检失联运行；任务不会自动重试，用户可以从失败页面主动重新执行。

可通过 `PM_AGENT_WORKER_CONCURRENCY` 调整单个 Worker 的并发数，`PM_AGENT_RUN_TIMEOUT_QUICK_MS`、`PM_AGENT_RUN_TIMEOUT_STANDARD_MS` 和 `PM_AGENT_RUN_TIMEOUT_DEEP_MS` 调整 Agent 执行时限。执行页面会显示 Redis 连接、Worker 数量、队列状态、当前搜索词和真实来源事件。

### 运行模式

项目设置页提供“演示模式 / 正式模式”开关。模式偏好保存在本地工作区数据库中，侧边栏、API 设置页和 Agent 接口会读取同一份状态。

- 演示模式不会调用外部模型，即使服务端已经配置 API Key 也可以主动开启。
- 正式模式可以提前选择并保存；Key 缺失时会显示“待连接”并暂时返回演示结果，配置完成后自动启用正式调用。
- API 设置页会把配置写入本机 `.env.local` 并立即更新当前服务；前端不会回显或保存 API Key 明文。

### 本地工作区数据

产品、任务、运行结果、文档和历史版本默认保存到 `data/pm-agent.sqlite`。首次访问接口时会自动创建表并导入演示数据；重复启动不会覆盖已有内容。

需要更换路径时，在 `.env.local` 中配置：

```dotenv
PM_AGENT_DB_PATH=D:/path/to/pm-agent.sqlite
```

每次明确保存文档、重新执行任务或恢复历史版本都会新增不可变的 Markdown 正文快照。恢复历史不会删除或覆盖原版本。

### 三方中转站

中转站兼容 OpenAI Responses API 时，配置：

```dotenv
OPENAI_API_KEY=your-relay-key
OPENAI_BASE_URL=https://relay.example.com/v1
OPENAI_API_MODE=responses
```

如果中转站只兼容 Chat Completions，将 `OPENAI_API_MODE` 设为 `chat_completions`。此模式可以完成基础模型调用和结构化输出，但没有 OpenAI 托管的 Web Search，研究结果会自动标记为需要复核。

中转站模型名称与默认值不同时，通过 `OPENAI_MODEL_FAST`、`OPENAI_MODEL_DEFAULT` 和 `OPENAI_MODEL_DEEP` 覆盖。自定义中转站默认不估算费用；确有需要时再配置 `.env.example` 中的价格变量。

## 验证

- `npm run check`
- `npm run build`

产品范围见 [MVP PRD](docs/MVP-PRD.md)，技术设计见[系统架构](docs/ARCHITECTURE.md)，研发验收口径见[目标衡量标准](docs/GOAL-MEASUREMENT-STANDARD.md)。

## 官方技术依据

- [Responses API](https://developers.openai.com/api/docs/guides/migrate-to-responses)
- [Agents SDK](https://developers.openai.com/api/docs/guides/agents)
- [Web search](https://developers.openai.com/api/docs/guides/tools-web-search)
- [Guardrails and human review](https://developers.openai.com/api/docs/guides/agents/guardrails-approvals)
