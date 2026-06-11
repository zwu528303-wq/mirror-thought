import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ChatMessage, ChatResponse, ResponseChoice, ResponseMode, ResponsePhase, ResponseType, RiskLevel } from '../src/types/chat';

type AnthropicRole = 'user' | 'assistant';

interface AnthropicMessage {
  role: AnthropicRole;
  content: string;
}

interface RuntimeRequest {
  mode: 'chat' | 'summary';
  text?: string;
  history: ChatMessage[];
  detectedBeliefs: string[];
  detectedTensions: string[];
}

interface EndpointErrorBody {
  error: string;
  detail?: string;
}

interface EndpointHealthBody {
  ok: boolean;
  service: 'jingguan-api';
  mode: 'anthropic' | 'mock';
  anthropic_configured: boolean;
  has_api_key: boolean;
  has_model: boolean;
  model: string | null;
  prompt_loaded: boolean;
  api_url: string;
  api_version: string;
  max_tokens: number;
  commit_sha: string | null;
  timestamp: string;
}

export interface EndpointResult {
  status: number;
  body: ChatResponse | EndpointErrorBody | EndpointHealthBody;
}

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SYSTEM_PROMPT_PATH = path.join(PROJECT_ROOT, 'prompts', 'jingguan-system-prompt.md');
const DEFAULT_ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const DEFAULT_ANTHROPIC_VERSION = '2023-06-01';
const DEFAULT_MAX_TOKENS = 1200;
const MAX_HISTORY_MESSAGES = 16;
const REPAIR_TEXT_LIMIT = 8000;

const responseTypes = new Set<ResponseType>(['normal', 'summary', 'crisis']);
const riskLevels = new Set<RiskLevel>(['none', 'low', 'high']);
const phases = new Set<ResponsePhase>(['intake', 'mapping', 'clarification', 'tension_analysis', 'summary', 'crisis']);
const responseModes = new Set<ResponseMode>(['free_text', 'choice']);
const RESPONSE_TOOL_NAME = 'format_jingguan_response';

const responseTool = {
  name: RESPONSE_TOOL_NAME,
  description: 'Return the Jingguan thought-analysis response in the exact structured format consumed by the product.',
  input_schema: {
    type: 'object',
    additionalProperties: false,
    required: [
      'response_type',
      'risk_level',
      'phase',
      'message',
      'mapping',
      'question',
      'response_mode',
      'choices',
      'allow_free_text',
      'detected_beliefs',
      'detected_tensions',
      'detected_assumptions',
      'unclear_concepts',
      'can_summarize',
      'should_summarize',
    ],
    properties: {
      response_type: {
        type: 'string',
        enum: ['normal', 'summary', 'crisis'],
      },
      risk_level: {
        type: 'string',
        enum: ['none', 'low', 'high'],
      },
      phase: {
        type: 'string',
        enum: ['intake', 'mapping', 'clarification', 'tension_analysis', 'summary', 'crisis'],
      },
      message: {
        type: 'string',
        minLength: 1,
      },
      mapping: {
        type: ['string', 'null'],
      },
      question: {
        type: ['string', 'null'],
      },
      response_mode: {
        type: 'string',
        enum: ['free_text', 'choice'],
      },
      choices: {
        type: 'array',
        maxItems: 4,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'label', 'description', 'meaning', 'client_followup', 'requires_api_after_choice'],
          properties: {
            id: {
              type: 'string',
              minLength: 1,
            },
            label: {
              type: 'string',
              minLength: 1,
            },
            description: {
              type: 'string',
              minLength: 1,
            },
            meaning: {
              type: 'string',
              minLength: 1,
            },
            client_followup: {
              type: ['string', 'null'],
            },
            requires_api_after_choice: {
              type: 'boolean',
            },
          },
        },
      },
      allow_free_text: {
        type: 'boolean',
      },
      detected_beliefs: {
        type: 'array',
        maxItems: 5,
        items: { type: 'string', minLength: 1 },
      },
      detected_tensions: {
        type: 'array',
        maxItems: 4,
        items: { type: 'string', minLength: 1 },
      },
      detected_assumptions: {
        type: 'array',
        maxItems: 5,
        items: { type: 'string', minLength: 1 },
      },
      unclear_concepts: {
        type: 'array',
        maxItems: 5,
        items: { type: 'string', minLength: 1 },
      },
      can_summarize: {
        type: 'boolean',
      },
      should_summarize: {
        type: 'boolean',
      },
    },
  },
};

let systemPromptPromise: Promise<string> | null = null;

class PublicEndpointError extends Error {
  status: number;
  detail?: string;

  constructor(status: number, message: string, detail?: string) {
    super(message);
    this.status = status;
    this.detail = detail;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readStringArray(value: unknown, maxItems: number) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, maxItems);
}

function readHistory(value: unknown) {
  if (!Array.isArray(value)) return [];

  return value
    .filter((item): item is ChatMessage => {
      return (
        isRecord(item) &&
        (item.role === 'user' || item.role === 'assistant') &&
        typeof item.content === 'string' &&
        item.content.trim().length > 0
      );
    })
    .slice(-MAX_HISTORY_MESSAGES);
}

function endpointError(error: unknown): EndpointResult {
  if (error instanceof PublicEndpointError) {
    return {
      status: error.status,
      body: {
        error: error.message,
        detail: error.detail,
      },
    };
  }

  console.error(error);
  return {
    status: 500,
    body: {
      error: '服务端生成回应时出现问题。',
    },
  };
}

function getRequiredText(body: Record<string, unknown>, key: string) {
  const value = body[key];
  return typeof value === 'string' ? value.trim() : '';
}

function getRuntimeRequest(payload: unknown, mode: 'chat' | 'summary'): RuntimeRequest {
  if (!isRecord(payload)) {
    throw new PublicEndpointError(400, '请求体必须是 JSON object。');
  }

  const text = getRequiredText(payload, 'text');
  if (mode === 'chat' && !text) {
    throw new PublicEndpointError(400, '缺少本轮用户输入。');
  }

  return {
    mode,
    text,
    history: readHistory(payload.history),
    detectedBeliefs: readStringArray(payload.detectedBeliefs, 5),
    detectedTensions: readStringArray(payload.detectedTensions, 4),
  };
}

function readConfigValues() {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  const model = process.env.ANTHROPIC_MODEL?.trim();
  const apiUrl = process.env.ANTHROPIC_MESSAGES_URL?.trim() || DEFAULT_ANTHROPIC_API_URL;
  const apiVersion = process.env.ANTHROPIC_VERSION?.trim() || DEFAULT_ANTHROPIC_VERSION;
  const betaHeaders = process.env.ANTHROPIC_BETA_HEADERS?.trim();
  const maxTokensValue = Number(process.env.ANTHROPIC_MAX_TOKENS ?? DEFAULT_MAX_TOKENS);
  const maxTokens = Number.isFinite(maxTokensValue) && maxTokensValue > 0 ? Math.floor(maxTokensValue) : DEFAULT_MAX_TOKENS;

  return {
    apiKey,
    model,
    apiUrl,
    apiVersion,
    betaHeaders,
    maxTokens,
  };
}

function getConfig() {
  const config = readConfigValues();
  const { apiKey, model } = config;

  if (!apiKey || !model) {
    const missing = [apiKey ? null : 'ANTHROPIC_API_KEY', model ? null : 'ANTHROPIC_MODEL'].filter(Boolean);
    throw new PublicEndpointError(501, `Anthropic API 尚未配置：缺少 ${missing.join(', ')}。`);
  }

  return {
    ...config,
    apiKey,
    model,
  };
}

async function isSystemPromptReadable() {
  try {
    await fs.access(SYSTEM_PROMPT_PATH);
    return true;
  } catch {
    return false;
  }
}

export async function handleHealthPayload(): Promise<EndpointResult> {
  const config = readConfigValues();
  const mode = process.env.VITE_JINGGUAN_API_MODE?.trim() === 'mock' ? 'mock' : 'anthropic';
  const promptLoaded = await isSystemPromptReadable();
  const anthropicConfigured = Boolean(config.apiKey && config.model);

  return {
    status: 200,
    body: {
      ok: mode === 'mock' || (anthropicConfigured && promptLoaded),
      service: 'jingguan-api',
      mode,
      anthropic_configured: anthropicConfigured,
      has_api_key: Boolean(config.apiKey),
      has_model: Boolean(config.model),
      model: config.model || null,
      prompt_loaded: promptLoaded,
      api_url: config.apiUrl,
      api_version: config.apiVersion,
      max_tokens: config.maxTokens,
      commit_sha: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
      timestamp: new Date().toISOString(),
    },
  };
}

async function getSystemPrompt() {
  systemPromptPromise ??= fs.readFile(SYSTEM_PROMPT_PATH, 'utf8').then((prompt) => {
    return [
      prompt.trim(),
      '',
      '## 运行时补充',
      '',
      '- 你会收到当前会话的结构化状态，previous_detected_beliefs / previous_detected_tensions 只作为暂定上下文。',
      '- 如果本轮任务是 summary，response_type 必须为 "summary"，phase 必须为 "summary"，question 必须为 null。',
      '- 如果本轮任务是 chat，除危机场景外 response_type 必须为 "normal"，并保持一个核心追问。',
      '- 第一轮或用户表达仍不清楚时，优先使用 response_mode "choice"，给 2-4 个澄清选项，并保留自由输入。',
      '- choices 必须是 JSON array，不要把数组序列化成字符串。',
      '- 如果选项点击后只需要用户补充一句，不需要立即再次调用模型，则该选项 requires_api_after_choice 设为 false，并写入 client_followup。',
      '- 你必须调用 format_jingguan_response 工具返回结构化结果，不要输出自由文本。',
    ].join('\n');
  });
  return systemPromptPromise;
}

function messageText(message: ChatMessage) {
  if (message.responseType === 'normal') {
    return [message.mapping, message.question].filter(Boolean).join('\n\n') || message.content;
  }
  return message.content;
}

function mergeConsecutiveMessages(messages: AnthropicMessage[]) {
  const merged: AnthropicMessage[] = [];

  for (const message of messages) {
    const content = message.content.trim();
    if (!content) continue;

    const previous = merged.at(-1);
    if (previous?.role === message.role) {
      previous.content = `${previous.content}\n\n${content}`;
    } else {
      merged.push({ role: message.role, content });
    }
  }

  return merged;
}

function buildRuntimeTask(request: RuntimeRequest) {
  const userTurnCount =
    request.history.filter((message) => message.role === 'user').length + (request.mode === 'chat' ? 1 : 0);
  const state = {
    product: '镜观',
    mode: request.mode,
    current_user_turn_count: userTurnCount,
    previous_detected_beliefs: request.detectedBeliefs,
    previous_detected_tensions: request.detectedTensions,
  };

  if (request.mode === 'summary') {
    return [
      '【运行时状态】',
      JSON.stringify(state, null, 2),
      '',
      '【本轮任务】',
      '请基于当前会话生成阶段性思想分析小结。只呈现核心信念、张力、仍需澄清的问题和暂时抵达的位置；不要给建议、行动方案、安慰或结论。',
      '必须只输出符合 system prompt schema 的 JSON object。',
    ].join('\n');
  }

  return [
    '【运行时状态】',
    JSON.stringify(state, null, 2),
    '',
    '【本轮任务】',
    '请处理用户本轮输入，先形成可分析的“惑”，再给出一个最关键追问。必须只输出符合 system prompt schema 的 JSON object。',
    '',
    '【用户本轮输入】',
    request.text,
  ].join('\n');
}

function buildMessages(request: RuntimeRequest) {
  const historyMessages: AnthropicMessage[] = request.history.map((message) => ({
    role: message.role,
    content: messageText(message),
  }));

  const messages = mergeConsecutiveMessages([
    ...historyMessages,
    {
      role: 'user',
      content: buildRuntimeTask(request),
    },
  ]);

  if (messages[0]?.role === 'assistant') {
    messages.unshift({
      role: 'user',
      content: '以下是当前会话中已有的分析内容，仅作为上下文，请继续遵守镜观运行时边界。',
    });
  }

  return messages;
}

async function callAnthropic(system: string, messages: AnthropicMessage[]) {
  const config = getConfig();
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-api-key': config.apiKey,
    'anthropic-version': config.apiVersion,
  };

  if (config.betaHeaders) {
    headers['anthropic-beta'] = config.betaHeaders;
  }

  const response = await fetch(config.apiUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: config.model,
      max_tokens: config.maxTokens,
      system,
      messages,
      tools: [responseTool],
      tool_choice: {
        type: 'tool',
        name: RESPONSE_TOOL_NAME,
      },
    }),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new PublicEndpointError(
      response.status >= 500 ? 502 : response.status,
      'Claude API 请求失败。',
      text.slice(0, 700),
    );
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new PublicEndpointError(502, 'Claude API 返回了不可解析的 JSON。', text.slice(0, 700));
  }
}

function extractAssistantText(value: unknown) {
  if (!isRecord(value) || !Array.isArray(value.content)) {
    throw new Error('Anthropic response is missing content array');
  }

  const text = value.content
    .map((block) => (isRecord(block) && block.type === 'text' && typeof block.text === 'string' ? block.text : ''))
    .join('\n')
    .trim();

  if (!text) {
    throw new Error('Anthropic response did not contain text');
  }

  return text;
}

function extractAssistantPayload(value: unknown) {
  if (!isRecord(value) || !Array.isArray(value.content)) {
    throw new Error('Anthropic response is missing content array');
  }

  const toolUse = value.content.find((block) => {
    return isRecord(block) && block.type === 'tool_use' && block.name === RESPONSE_TOOL_NAME && isRecord(block.input);
  });

  if (isRecord(toolUse) && isRecord(toolUse.input)) {
    return toolUse.input;
  }

  return parseJsonObject(extractAssistantText(value));
}

function stringifyAssistantPayload(value: unknown) {
  try {
    return JSON.stringify(extractAssistantPayload(value), null, 2);
  } catch {
    try {
      return extractAssistantText(value);
    } catch {
      return JSON.stringify(value, null, 2);
    }
  }
}

function parseJsonObject(text: string) {
  const trimmed = text.trim();
  const withoutFence = trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  const firstBrace = withoutFence.indexOf('{');
  const lastBrace = withoutFence.lastIndexOf('}');

  if (firstBrace < 0 || lastBrace < firstBrace) {
    throw new Error('model output is not a JSON object');
  }

  return JSON.parse(withoutFence.slice(firstBrace, lastBrace + 1));
}

function assertEnum<T extends string>(value: unknown, allowed: Set<T>, field: string): T {
  if (typeof value === 'string' && allowed.has(value as T)) {
    return value as T;
  }
  throw new Error(`${field} must be one of ${[...allowed].join(', ')}`);
}

function assertNullableString(value: unknown, field: string) {
  if (value === null || typeof value === 'string') return value;
  throw new Error(`${field} must be string or null`);
}

function assertBoolean(value: unknown, field: string) {
  if (typeof value === 'boolean') return value;
  throw new Error(`${field} must be boolean`);
}

function readBoolean(value: unknown, fallback: boolean) {
  return typeof value === 'boolean' ? value : fallback;
}

function stripLooseQuotes(value: string): string {
  let item = value.trim().replace(/\\"/g, '"');
  if (item.length >= 2 && item.startsWith('"') && item.endsWith('"')) {
    item = item.slice(1, -1).trim();
  }
  return item;
}

function parseLooseStringArray(value: string): string[] | null {
  const trimmed = stripLooseQuotes(value);
  if (!trimmed.startsWith('[') || !trimmed.endsWith(']')) return null;

  const inner = trimmed.slice(1, -1).trim();
  if (!inner) return [];

  return inner
    .split(/,\s*(?=")/)
    .map(stripLooseQuotes)
    .filter(Boolean);
}

function parseSerializedStringArray(value: string, field: string, maxItems: number): string[] {
  const item = value.trim();
  if (!item) return [];

  if ((item.startsWith('[') && item.endsWith(']')) || (item.startsWith('"') && item.includes('['))) {
    try {
      const parsed = JSON.parse(item);
      return assertStringArray(parsed, field, maxItems);
    } catch {
      const looseItems = parseLooseStringArray(item);
      if (looseItems) return looseItems.slice(0, maxItems);
    }
  }

  return [stripLooseQuotes(item)].slice(0, maxItems);
}

function assertStringArray(value: unknown, field: string, maxItems: number): string[] {
  if (value === null || value === undefined) {
    return [];
  }

  if (typeof value === 'string') {
    return parseSerializedStringArray(value, field, maxItems);
  }

  if (!Array.isArray(value)) {
    throw new Error(`${field} must be an array`);
  }

  const items = value.flatMap((item) => {
    if (typeof item !== 'string' || !item.trim()) {
      throw new Error(`${field} must contain non-empty strings`);
    }
    return parseSerializedStringArray(item, field, maxItems);
  });

  if (items.length > maxItems) {
    throw new Error(`${field} must contain at most ${maxItems} items`);
  }

  return items;
}

function readResponseMode(value: unknown, fallback: ResponseMode): ResponseMode {
  return typeof value === 'string' && responseModes.has(value as ResponseMode) ? (value as ResponseMode) : fallback;
}

function cleanLooseValue(value: string) {
  return value.replace(/\\"/g, '"').trim();
}

function readLooseField(source: string, field: string, nextField?: string) {
  const escapedField = field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (nextField) {
    const escapedNextField = nextField.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const betweenFields = new RegExp(`"${escapedField}"\\s*:\\s*"([\\s\\S]*?)"\\s*,\\s*"${escapedNextField}"`);
    const betweenMatch = source.match(betweenFields);
    if (betweenMatch?.[1]) return cleanLooseValue(betweenMatch[1]);
  }

  const regular = new RegExp(`"${escapedField}"\\s*:\\s*"([^"]*)"`);
  const match = source.match(regular);
  return match?.[1] ? cleanLooseValue(match[1]) : '';
}

function parseLooseChoiceObjects(value: string): ResponseChoice[] | null {
  const firstBracket = value.indexOf('[');
  const lastBracket = value.lastIndexOf(']');
  const arrayText = firstBracket >= 0 && lastBracket > firstBracket ? value.slice(firstBracket + 1, lastBracket) : value;
  const chunks = arrayText
    .split(/\}\s*,\s*\{/)
    .map((chunk, index, items) => {
      let normalized = chunk.trim();
      if (index > 0) normalized = `{${normalized}`;
      if (index < items.length - 1) normalized = `${normalized}}`;
      return normalized;
    })
    .filter((chunk) => chunk.includes('"label"') || chunk.includes('"description"'));

  const choices = chunks
    .map((chunk, index): ResponseChoice | null => {
      const id = readLooseField(chunk, 'id') || String.fromCharCode(65 + index);
      const label = readLooseField(chunk, 'label', 'description');
      const description = readLooseField(chunk, 'description', 'meaning') || label;
      const meaning = readLooseField(chunk, 'meaning', 'client_followup') || `choice_${index + 1}`;
      const clientFollowup = readLooseField(chunk, 'client_followup', 'requires_api_after_choice');
      const requiresMatch = chunk.match(/"requires_api_after_choice"\s*:\s*(true|false)/);

      if (!label || !description) return null;
      return {
        id,
        label,
        description,
        meaning,
        client_followup: clientFollowup || undefined,
        requires_api_after_choice: requiresMatch ? requiresMatch[1] === 'true' : true,
      };
    })
    .filter((choice): choice is ResponseChoice => Boolean(choice))
    .slice(0, 4);

  return choices.length >= 2 ? choices : null;
}

function parseSerializedChoices(value: unknown): ResponseChoice[] | null {
  if (typeof value !== 'string') return null;

  const trimmed = value
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  if (!trimmed.startsWith('[') && !trimmed.startsWith('{') && !trimmed.startsWith('"')) {
    return null;
  }

  try {
    const parsed = JSON.parse(trimmed);
    if (parsed === value) return null;
    return readChoices(parsed);
  } catch {
    const looseChoices = parseLooseChoiceObjects(trimmed);
    if (looseChoices) return looseChoices;

    const firstBracket = trimmed.indexOf('[');
    const lastBracket = trimmed.lastIndexOf(']');
    if (firstBracket >= 0 && lastBracket > firstBracket) {
      try {
        return readChoices(JSON.parse(trimmed.slice(firstBracket, lastBracket + 1)));
      } catch {
        return null;
      }
    }
    return null;
  }
}

function normalizeChoice(value: unknown, index: number): ResponseChoice | null {
  if (typeof value === 'string') {
    const label = value.trim();
    if (!label) return null;
    return {
      id: String.fromCharCode(65 + index),
      label,
      description: label,
      meaning: `choice_${index + 1}`,
      requires_api_after_choice: true,
    };
  }

  if (!isRecord(value)) return null;

  const idValue = typeof value.id === 'string' ? value.id.trim() : '';
  const labelValue = typeof value.label === 'string' ? value.label.trim() : '';
  const descriptionValue = typeof value.description === 'string' ? value.description.trim() : '';
  const meaningValue = typeof value.meaning === 'string' ? value.meaning.trim() : '';
  const titleValue = typeof value.title === 'string' ? value.title.trim() : '';
  const textValue = typeof value.text === 'string' ? value.text.trim() : '';
  const clientFollowupValue =
    value.client_followup === null || value.client_followup === undefined
      ? undefined
      : typeof value.client_followup === 'string'
        ? value.client_followup.trim()
        : undefined;

  const label = labelValue || titleValue || textValue || descriptionValue;
  const description = descriptionValue || textValue || label;
  if (!label || !description) return null;

  return {
    id: idValue || String.fromCharCode(65 + index),
    label,
    description,
    meaning: meaningValue || `choice_${index + 1}`,
    client_followup: clientFollowupValue || undefined,
    requires_api_after_choice: readBoolean(value.requires_api_after_choice, true),
  };
}

function readChoices(value: unknown): ResponseChoice[] {
  if (value === null || value === undefined) {
    return [];
  }

  if (typeof value === 'string') {
    const parsed = parseSerializedChoices(value);
    if (parsed) return parsed;
  }

  if (Array.isArray(value) && value.every((item) => typeof item === 'string')) {
    const joined = value.join('\n');
    const parsed = parseSerializedChoices(joined);
    if (parsed) return parsed;
  }

  if (Array.isArray(value) && value.length === 1 && isRecord(value[0])) {
    for (const key of ['choices', 'label', 'description', 'text']) {
      const parsed = parseSerializedChoices(value[0][key]);
      if (parsed) return parsed;
    }
  }

  const rawChoices = Array.isArray(value)
    ? value
    : isRecord(value)
      ? Object.values(value)
      : typeof value === 'string'
        ? value
            .split(/\n+/)
            .map((item) => item.replace(/^[A-Da-d][.、)\s]+/, '').trim())
            .filter(Boolean)
        : [];

  return rawChoices
    .map((item, index) => normalizeChoice(item, index))
    .filter((item): item is ResponseChoice => Boolean(item))
    .slice(0, 4);
}

function validateChatResponse(value: unknown): ChatResponse {
  if (!isRecord(value)) {
    throw new Error('model output must be a JSON object');
  }

  const response_type = assertEnum(value.response_type, responseTypes, 'response_type');
  const risk_level = assertEnum(value.risk_level, riskLevels, 'risk_level');
  const phase = assertEnum(value.phase, phases, 'phase');
  const message = typeof value.message === 'string' && value.message.trim() ? value.message.trim() : null;
  if (!message) {
    throw new Error('message must be a non-empty string');
  }

  const mapping = assertNullableString(value.mapping, 'mapping');
  const question = assertNullableString(value.question, 'question');
  let choices = readChoices(value.choices);
  let response_mode = choices.length >= 2 ? 'choice' : readResponseMode(value.response_mode, 'free_text');
  let allow_free_text = readBoolean(value.allow_free_text, response_type !== 'crisis');
  const detected_beliefs = assertStringArray(value.detected_beliefs, 'detected_beliefs', 5);
  const detected_tensions = assertStringArray(value.detected_tensions, 'detected_tensions', 4);
  const detected_assumptions = assertStringArray(value.detected_assumptions, 'detected_assumptions', 5);
  const unclear_concepts = assertStringArray(value.unclear_concepts, 'unclear_concepts', 5);
  const can_summarize = readBoolean(value.can_summarize, false);
  const should_summarize = readBoolean(value.should_summarize, false);

  if (response_type === 'crisis') {
    if (risk_level !== 'high') throw new Error('crisis response must use high risk_level');
    if (phase !== 'crisis') throw new Error('crisis response must use crisis phase');
    if (question !== null) throw new Error('crisis response question must be null');
    if (can_summarize || should_summarize) throw new Error('crisis response cannot summarize');
    response_mode = 'free_text';
    choices = [];
    allow_free_text = false;
  }

  if (response_type === 'summary') {
    if (phase !== 'summary') throw new Error('summary response must use summary phase');
    if (question !== null) throw new Error('summary response question must be null');
    response_mode = 'free_text';
    choices = [];
  }

  if (response_mode === 'choice' && response_type === 'normal') {
    response_mode = choices.length >= 2 ? 'choice' : 'free_text';
  }

  if (response_mode === 'free_text' && response_type === 'normal') {
    choices = [];
  }

  return {
    response_type,
    risk_level,
    phase,
    message,
    mapping,
    question,
    response_mode,
    choices,
    allow_free_text,
    has_tension: detected_tensions.length > 0,
    detected_beliefs,
    detected_tensions,
    detected_assumptions,
    unclear_concepts,
    can_summarize,
    should_summarize,
  };
}

async function generateWithClaude(request: RuntimeRequest) {
  const system = await getSystemPrompt();
  const messages = buildMessages(request);
  const firstResponse = await callAnthropic(system, messages);
  const firstPayload = extractAssistantPayload(firstResponse);

  try {
    return validateChatResponse(firstPayload);
  } catch (firstError) {
    const repairMessages = mergeConsecutiveMessages([
      ...messages,
      {
        role: 'user',
        content: [
          '上一条输出无法通过镜观 JSON schema 校验。',
          `校验错误：${firstError instanceof Error ? firstError.message : 'unknown validation error'}`,
          '上一条输出如下：',
          stringifyAssistantPayload(firstResponse).slice(0, REPAIR_TEXT_LIMIT),
          '请重新调用 format_jingguan_response 工具，返回修正后的结构化结果。',
        ].join('\n'),
      },
    ]);
    const repairedResponse = await callAnthropic(system, repairMessages);
    return validateChatResponse(extractAssistantPayload(repairedResponse));
  }
}

export async function handleChatPayload(payload: unknown): Promise<EndpointResult> {
  try {
    const request = getRuntimeRequest(payload, 'chat');
    return {
      status: 200,
      body: await generateWithClaude(request),
    };
  } catch (error) {
    return endpointError(error);
  }
}

export async function handleSummaryPayload(payload: unknown): Promise<EndpointResult> {
  try {
    const request = getRuntimeRequest(payload, 'summary');
    return {
      status: 200,
      body: await generateWithClaude(request),
    };
  } catch (error) {
    return endpointError(error);
  }
}
