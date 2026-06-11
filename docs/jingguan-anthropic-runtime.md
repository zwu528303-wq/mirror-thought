# 镜观 Anthropic Runtime 接入说明

这份说明把“面对用户的 AI”拆成三层：

1. `prompts/jingguan-system-prompt.md`：每轮都生效的运行时边界。
2. `anthropic-skills/jingguan-dialogue-engine/`：可上传为 Anthropic custom skill 的方法包。
3. `eval/` + `scripts/eval-jingguan-output.mjs`：本地评测案例和输出检查器。

## 推荐调用结构

运行时不要只依赖 skill。镜观的产品边界必须放在 system prompt 中，因为这些规则每轮都必须生效：不建议、不安慰、不诊断、不做哲学百科、危机中断、结构化 JSON。

Skill 负责按需加载更长的方法材料：文献提炼、苏格拉底追问类型、输出评测规则。

## Anthropic API 注意

Anthropic Skills 属于 API 的 tool/code-execution 能力。接入时请以 Anthropic 官方文档为准确认：

- 当前可用模型名；
- 需要启用的 beta header；
- custom skill 上传和版本 ID；
- `container.skills` 或等价字段的最新请求结构；
- code execution / container 的权限和费用设置。

不要在产品 spec 或前端代码里写死模型名。把模型名、skill version、beta headers、最大 token、危机资源文案都放在后端配置或环境变量中。

## 请求示意

下面是结构示意，不是锁定的 API 版本代码：

```ts
import Anthropic from '@anthropic-ai/sdk';
import fs from 'node:fs/promises';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const system = await fs.readFile('prompts/jingguan-system-prompt.md', 'utf8');

const response = await anthropic.messages.create({
  model: process.env.ANTHROPIC_MODEL,
  max_tokens: 1200,
  system,
  messages: [
    {
      role: 'user',
      content: userInput,
    },
  ],
  // 根据 Anthropic 官方文档挂载已上传的 custom skill。
  // container: {
  //   skills: [
  //     {
  //       type: 'custom',
  //       skill_id: process.env.JINGGUAN_SKILL_ID,
  //       version: process.env.JINGGUAN_SKILL_VERSION,
  //     },
  //   ],
  // },
});
```

服务端收到模型文本后应：

1. 解析 JSON。
2. 按 `prompts/jingguan-response-schema.json` 校验字段。
3. 若解析失败，重试一次并把错误作为 developer message 提供给模型修复 JSON。
4. 若仍失败，返回产品化错误状态，不向用户展示技术栈。
5. 对 `response_type = crisis` 做前端中断展示。

## 评测用法

先检查内置金样例：

```bash
npm run eval:jingguan
```

检查真实模型输出：

```bash
node scripts/eval-jingguan-output.mjs --input eval/model-outputs.json
```

`eval/model-outputs.json` 推荐格式：

```json
[
  {
    "case_id": "friendship-distance",
    "output": {
      "response_type": "normal",
      "risk_level": "none",
      "phase": "mapping",
      "message": "...",
      "mapping": "...",
      "question": "...？",
      "detected_beliefs": [],
      "detected_tensions": [],
      "detected_assumptions": [],
      "unclear_concepts": [],
      "can_summarize": false,
      "should_summarize": false
    }
  }
]
```

评测脚本只抓结构和高风险跑偏，不能替代人工哲学判断。每次改 prompt 或 skill 后，至少人工抽看友情、爱情、亲情、工作、AI 自我、模糊输入、寻求安慰、危机这几类。
