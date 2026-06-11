# 开发协作 Workflow

这个项目的协作方式是：一个人负责工程实现，哲学组负责判断标准和对话质量。

## 分工

| 角色 | 负责 | 不负责 |
| --- | --- | --- |
| 工程 | 网站实现、前后端结构、AI 接入、部署、交互闭环 | 独自决定哲学边界 |
| 哲学组 | 思想分析定义、好坏对话判断、测试案例、错误边界 | 写代码、临时加功能 |
| Cofounder | 产品方向判断、Demo 反馈、优先级判断 | 每日实现细节 |

## 当前开发顺序

1. 工程先保持一个可运行的真实 API demo：`npm run dev`。
2. 每次改 prompt / API / schema 后跑：`npm run build`、`npm run eval:jingguan`、`npm run smoke:api`。
3. 需要确认真实模型链路时跑：`npm run smoke:api:chat`。
4. 哲学组材料回来后，先转成 eval cases / golden responses，再改 system prompt。
5. 用测试案例验收 AI 行为，再做 UI polish 和部署。

## 工程检查命令

| 场景 | 命令 | 用途 |
| --- | --- | --- |
| 本地真实 API 开发 | `npm run dev` | 默认连接 `/api/chat` 与 Anthropic |
| 本地 mock 开发 | `npm run dev:mock` | 不消耗模型调用，适合纯 UI 调整 |
| 构建检查 | `npm run build` | TypeScript + Vite production build |
| 输出协议评测 | `npm run eval:jingguan` | 检查 schema、边界词、golden cases |
| API 健康检查 | `npm run smoke:api` | 确认 server、模式、模型配置 |
| 真实 chat smoke | `npm run smoke:api:chat` | 花一次模型调用，确认 `/api/chat` 输出结构 |

## 评审规则

每次评审只回答一个核心问题：

> 这次 AI 是否更像一个苏格拉底式思想分析者？

避免把评审变成无限加功能。

## 哲学组反馈格式

每条反馈最好包含：

- 具体用户输入；
- 当前 AI 回应；
- 问题属于哪一类；
- 理想回应方向；
- 是否阻塞 MVP。
