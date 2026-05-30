import { generateSummary, mockChatResponse } from './mockAi';
import type { ChatMessage, ChatResponse } from '../types/chat';

const MOCK_LATENCY_MS = 520;

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export async function sendChatTurn(args: {
  text: string;
  history: ChatMessage[];
  detectedBeliefs: string[];
  detectedTensions: string[];
}): Promise<ChatResponse> {
  await wait(MOCK_LATENCY_MS);
  return mockChatResponse(args.text, args.history, args.detectedBeliefs, args.detectedTensions);
}

export async function requestSummary(args: {
  detectedBeliefs: string[];
  detectedTensions: string[];
}): Promise<ChatResponse> {
  await wait(320);
  return generateSummary(args.detectedBeliefs, args.detectedTensions);
}
