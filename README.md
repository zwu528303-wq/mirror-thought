# 镜观 Jingguan

镜观是一个思想分析网站的 MVP 原型。它通过苏格拉底式追问，帮助用户把模糊困惑整理为核心信念、理由前提与冲突关系。

当前版本已经接入 `/api/chat` 与 `/api/summary`，服务端通过 Anthropic Messages API 调用真实模型；未配置 API key 时可以切回 mock。

## 当前范围

- 首页定位说明
- 使用须知确认
- 对话页消息流
- 真实 API 对话，支持 mock 回退
- 文字版信念结构总结
- 手动保存阶段性思想小结
- 危机中断状态
- 侧边栏信念与张力状态

暂不包含：

- 登录 / 注册
- 自动保存完整历史记录
- 可视化思想地图
- 付费系统

## 本地运行

```bash
npm install
cp .env.example .env.local
npm run dev
```

默认地址：

```text
http://127.0.0.1:5173/
```

如果要明确使用本地 mock 回答：

```bash
npm run dev:mock
```

## API 配置

在 `.env.local` 中配置服务端变量：

```bash
ANTHROPIC_API_KEY=sk-ant-...
ANTHROPIC_MODEL=<your-claude-model>
ANTHROPIC_VERSION=2023-06-01
ANTHROPIC_MAX_TOKENS=1200
```

浏览器只请求本项目的 `/api/chat` 和 `/api/summary`，不会直接拿到 Anthropic key。

如果暂时不想连真实模型，可以加：

```bash
VITE_JINGGUAN_API_MODE=mock
```

## API 健康检查

本地 dev server 启动后，可以用 health endpoint 确认当前模式与配置状态：

```bash
curl http://127.0.0.1:5173/api/health
```

也可以使用 smoke script：

```bash
npm run smoke:api
```

这只检查 `/api/health`，不会消耗模型调用。需要真实打一轮 `/api/chat` 并校验输出结构时运行：

```bash
npm run smoke:api:chat
```

## 构建检查

```bash
npm run build
```

Prompt / 输出协议的 golden case 检查：

```bash
npm run eval:jingguan
```

## 项目结构

```text
src/
  App.tsx              # 页面、状态和核心交互
  main.tsx             # React 入口
  styles.css           # 全局样式
  lib/
    chatClient.ts      # 聊天客户端接口，默认接 /api，支持 mock 回退
    mockAi.ts          # mock AI 逻辑
  types/
    chat.ts            # 对话类型和 AI 输出协议
server/
  jingguanRuntime.ts   # 读取 system prompt、调用 Anthropic、解析校验 JSON
  devApiPlugin.ts      # Vite 本地开发用 /api middleware
api/
  chat.ts              # 部署环境的聊天 API route
  summary.ts           # 部署环境的小结 API route
  health.ts            # 部署环境的 API 配置健康检查
scripts/
  smoke-api.mjs        # 本地/部署 API smoke test
  eval-jingguan-output.mjs # 镜观输出协议与边界检查
```

## 下一步

1. 哲学组提交判断材料和对话案例。
2. 用哲学组测试案例验收 AI 行为。
3. 根据反馈迭代 prompt、文案和 UI。
4. 部署前确认生产环境变量与模型权限。

## 产品文档

- `镜观_产品Spec.md`
- `镜观_产品Spec_给Cofounder.docx`
