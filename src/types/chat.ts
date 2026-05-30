export type ChatRole = 'user' | 'assistant';

export type ResponseType = 'normal' | 'summary' | 'crisis';

export type RiskLevel = 'none' | 'low' | 'high';

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  responseType?: ResponseType;
}

export interface ChatResponse {
  response_type: ResponseType;
  risk_level: RiskLevel;
  message: string;
  detected_beliefs: string[];
  detected_tensions: string[];
  can_summarize: boolean;
  should_summarize: boolean;
}

export interface ConversationState {
  messages: ChatMessage[];
  detectedBeliefs: string[];
  detectedTensions: string[];
  turnCount: number;
  canSummarize: boolean;
  shouldSummarize: boolean;
  isCrisis: boolean;
}
