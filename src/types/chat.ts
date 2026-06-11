export type ChatRole = 'user' | 'assistant';

export type ResponseType = 'normal' | 'summary' | 'crisis';

export type RiskLevel = 'none' | 'low' | 'high';

export type ResponsePhase = 'intake' | 'mapping' | 'clarification' | 'tension_analysis' | 'summary' | 'crisis';

export type ResponseMode = 'free_text' | 'choice';

export interface ResponseChoice {
  id: string;
  label: string;
  description: string;
  meaning: string;
  client_followup?: string;
  requires_api_after_choice?: boolean;
}

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  responseType?: ResponseType;
  phase?: ResponsePhase;
  mapping?: string;
  question?: string;
  hasTension?: boolean;
  isSavedRecord?: boolean;
  responseMode?: ResponseMode;
  choices?: ResponseChoice[];
  allowFreeText?: boolean;
  selectedChoice?: ResponseChoice;
  isLocalOnly?: boolean;
}

export interface ChatResponse {
  response_type: ResponseType;
  risk_level: RiskLevel;
  phase: ResponsePhase;
  message: string;
  mapping: string | null;
  question: string | null;
  response_mode: ResponseMode;
  choices: ResponseChoice[];
  allow_free_text: boolean;
  has_tension?: boolean;
  detected_beliefs: string[];
  detected_tensions: string[];
  detected_assumptions: string[];
  unclear_concepts: string[];
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
