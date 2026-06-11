import { generateSummary, mockChatResponse } from './mockAi';
import type { ChatMessage, ChatResponse } from '../types/chat';

const MOCK_LATENCY_MS = 520;
const USE_MOCK_AI = import.meta.env.VITE_JINGGUAN_API_MODE === 'mock';

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function postChatResponse(endpoint: string, payload: unknown): Promise<ChatResponse> {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => null);

  if (!response.ok) {
    const message =
      data && typeof data.error === 'string'
        ? data.error
        : `API 请求失败，HTTP ${response.status}`;
    throw new Error(message);
  }

  return data as ChatResponse;
}

export async function sendChatTurn(args: {
  text: string;
  history: ChatMessage[];
  detectedBeliefs: string[];
  detectedTensions: string[];
}): Promise<ChatResponse> {
  if (USE_MOCK_AI) {
    await wait(MOCK_LATENCY_MS);
    return mockChatResponse(args.text, args.history, args.detectedBeliefs, args.detectedTensions);
  }

  return postChatResponse('/api/chat', args);
}

export async function requestSummary(args: {
  history: ChatMessage[];
  detectedBeliefs: string[];
  detectedTensions: string[];
}): Promise<ChatResponse> {
  if (USE_MOCK_AI) {
    await wait(320);
    return generateSummary(args.detectedBeliefs, args.detectedTensions);
  }

  return postChatResponse('/api/summary', args);
}
