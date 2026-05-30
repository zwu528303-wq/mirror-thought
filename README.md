# 镜观 Jingguan

镜观是一个思想分析网站的 MVP 原型。它通过苏格拉底式追问，帮助用户把模糊困惑整理为核心信念、理由前提与冲突关系。

当前版本先搭起产品流和工程骨架，AI 部分使用 mock response。哲学判断层、正式 system prompt 和测试案例会在小组材料确定后接入。

## 当前范围

- 首页定位说明
- 使用须知确认
- 对话页消息流
- mock AI 对话
- 文字版信念结构总结
- 危机中断状态
- 侧边栏信念与张力状态

暂不包含：

- 登录 / 注册
- 历史记录
- 可视化思想地图
- 付费系统
- 真实模型 API

## 本地运行

```bash
npm install
npm run dev
```

默认地址：

```text
http://127.0.0.1:5173/
```

## 构建检查

```bash
npm run build
```

## 项目结构

```text
src/
  App.tsx              # 页面、状态和核心交互
  main.tsx             # React 入口
  styles.css           # 全局样式
  lib/
    chatClient.ts      # 聊天客户端接口，当前接 mock AI
    mockAi.ts          # mock AI 逻辑
  types/
    chat.ts            # 对话类型和 AI 输出协议
```

## 下一步

1. 哲学组提交判断材料和对话案例。
2. 将 mock AI 替换为真实 `/api/chat`。
3. 接入 system prompt 和结构化 JSON 输出。
4. 用哲学组测试案例验收 AI 行为。
5. 根据反馈迭代 prompt、文案和 UI。

## 产品文档

- `镜观_产品Spec.md`
- `镜观_产品Spec_给Cofounder.docx`

