import { FormEvent, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  BookOpenText,
  Check,
  CircleHelp,
  FileText,
  MessageSquareText,
  RefreshCcw,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { requestSummary, sendChatTurn } from './lib/chatClient';
import type { ChatMessage, ConversationState } from './types/chat';

const CONSENT_KEY = 'jingguan-consent-v1';

const initialConversation: ConversationState = {
  messages: [],
  detectedBeliefs: [],
  detectedTensions: [],
  turnCount: 0,
  canSummarize: false,
  shouldSummarize: false,
  isCrisis: false,
};

function createId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function App() {
  const [view, setView] = useState<'home' | 'chat'>('home');
  const [showConsent, setShowConsent] = useState(false);
  const [conversation, setConversation] = useState<ConversationState>(initialConversation);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  const hasConsent = useMemo(() => window.localStorage.getItem(CONSENT_KEY) === 'accepted', []);

  function beginChat() {
    if (window.localStorage.getItem(CONSENT_KEY) === 'accepted') {
      setView('chat');
      window.setTimeout(() => inputRef.current?.focus(), 80);
      return;
    }
    setShowConsent(true);
  }

  function acceptConsent() {
    window.localStorage.setItem(CONSENT_KEY, 'accepted');
    setShowConsent(false);
    setView('chat');
    window.setTimeout(() => inputRef.current?.focus(), 80);
  }

  function resetConversation() {
    setConversation(initialConversation);
    setInput('');
    window.setTimeout(() => inputRef.current?.focus(), 80);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const text = input.trim();
    if (!text || isLoading || conversation.isCrisis) return;

    const userMessage: ChatMessage = {
      id: createId('user'),
      role: 'user',
      content: text,
    };

    const history = [...conversation.messages, userMessage];
    setConversation((current) => ({
      ...current,
      messages: history,
      turnCount: current.turnCount + 1,
    }));
    setInput('');
    setIsLoading(true);

    try {
      const response = await sendChatTurn({
        text,
        history: conversation.messages,
        detectedBeliefs: conversation.detectedBeliefs,
        detectedTensions: conversation.detectedTensions,
      });

      const assistantMessage: ChatMessage = {
        id: createId('assistant'),
        role: 'assistant',
        content: response.message,
        responseType: response.response_type,
      };

      setConversation((current) => ({
        ...current,
        messages: [...current.messages, assistantMessage],
        detectedBeliefs: response.detected_beliefs,
        detectedTensions: response.detected_tensions,
        canSummarize: response.can_summarize,
        shouldSummarize: response.should_summarize,
        isCrisis: response.response_type === 'crisis',
      }));
    } finally {
      setIsLoading(false);
    }
  }

  async function handleSummary() {
    if (isLoading || conversation.isCrisis) return;
    setIsLoading(true);
    try {
      const response = await requestSummary({
        detectedBeliefs: conversation.detectedBeliefs,
        detectedTensions: conversation.detectedTensions,
      });
      const assistantMessage: ChatMessage = {
        id: createId('summary'),
        role: 'assistant',
        content: response.message,
        responseType: 'summary',
      };
      setConversation((current) => ({
        ...current,
        messages: [...current.messages, assistantMessage],
        canSummarize: true,
        shouldSummarize: false,
      }));
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <button className="brand" type="button" onClick={() => setView('home')}>
          <span className="brand-mark">镜</span>
          <span>
            <strong>镜观</strong>
            <small>思想分析</small>
          </span>
        </button>
        <nav aria-label="主导航">
          <button type="button" className="nav-link" onClick={() => setView('home')}>
            产品
          </button>
          <button type="button" className="nav-link" onClick={beginChat}>
            开始对话
          </button>
        </nav>
      </header>

      {view === 'home' ? (
        <HomeScreen onStart={beginChat} hasConsent={hasConsent} />
      ) : (
        <ChatScreen
          conversation={conversation}
          input={input}
          inputRef={inputRef}
          isLoading={isLoading}
          onInputChange={setInput}
          onSubmit={handleSubmit}
          onSummary={handleSummary}
          onReset={resetConversation}
        />
      )}

      {showConsent ? <ConsentDialog onAccept={acceptConsent} onClose={() => setShowConsent(false)} /> : null}
    </main>
  );
}

function HomeScreen({ onStart, hasConsent }: { onStart: () => void; hasConsent: boolean }) {
  return (
    <section className="home-grid">
      <div className="home-copy">
        <p className="eyebrow">不是心理咨询，也不是答案机器</p>
        <h1>把你的困惑说清楚</h1>
        <p className="lead">
          镜观通过苏格拉底式追问，帮助你把模糊的困惑整理为核心信念、理由前提与冲突关系。
        </p>
        <div className="home-actions">
          <button className="primary-action" type="button" onClick={onStart}>
            <MessageSquareText aria-hidden="true" />
            开始一次对话
            <ArrowRight aria-hidden="true" />
          </button>
          <span className="consent-note">{hasConsent ? '已确认使用须知' : '开始前需确认使用须知'}</span>
        </div>
      </div>

      <div className="home-panel" aria-label="产品边界和流程">
        <div className="principle-list">
          <Principle icon={<BookOpenText />} title="思想分析" text="处理信念、理由、前提之间的结构关系。" />
          <Principle icon={<CircleHelp />} title="苏格拉底式追问" text="先映射你的问题，再提出具体澄清问题。" />
          <Principle icon={<ShieldCheck />} title="边界清楚" text="不做心理治疗，不给人生建议，不替你下结论。" />
        </div>
        <div className="example-card">
          <span className="card-label">示例对话</span>
          <p className="example-user">
            我想去大城市发展，但父母希望我留在老家。我知道陪伴家人很重要，也怕自己以后后悔。
          </p>
          <p className="example-ai">
            让我先确认：你同时重视家庭陪伴和个人发展，而这两个信念在地点选择上发生了张力。我理解得对吗？
          </p>
        </div>
      </div>
    </section>
  );
}

function Principle({ icon, title, text }: { icon: JSX.Element; title: string; text: string }) {
  return (
    <div className="principle">
      <span className="principle-icon">{icon}</span>
      <div>
        <h2>{title}</h2>
        <p>{text}</p>
      </div>
    </div>
  );
}

function ChatScreen({
  conversation,
  input,
  inputRef,
  isLoading,
  onInputChange,
  onSubmit,
  onSummary,
  onReset,
}: {
  conversation: ConversationState;
  input: string;
  inputRef: React.MutableRefObject<HTMLTextAreaElement | null>;
  isLoading: boolean;
  onInputChange: (value: string) => void;
  onSubmit: (event: FormEvent) => void;
  onSummary: () => void;
  onReset: () => void;
}) {
  return (
    <section className="chat-layout">
      <aside className="session-panel" aria-label="会话状态">
        <div className="panel-block">
          <span className="card-label">会话结构</span>
          <h2>信念与张力</h2>
          <p>这里会沉淀本轮对话中已经浮现的核心信念、冲突关系和阶段性总结状态。</p>
        </div>

        <div className="status-grid">
          <StatusItem label="用户轮数" value={String(conversation.turnCount)} />
          <StatusItem label="可总结" value={conversation.canSummarize ? '是' : '否'} />
          <StatusItem label="危机状态" value={conversation.isCrisis ? '已中断' : '无'} />
        </div>

        <StructureList title="已识别信念" items={conversation.detectedBeliefs} empty="等待对话中提取" />
        <StructureList title="已识别张力" items={conversation.detectedTensions} empty="等待对话中确认" />

        <button className="secondary-action full-width" type="button" onClick={onReset}>
          <RefreshCcw aria-hidden="true" />
          重新开始
        </button>
      </aside>

      <div className="conversation-area">
        <div className="conversation-header">
          <div>
            <span className="card-label">对话页</span>
            <h1>一次思想分析</h1>
          </div>
          <button
            className="secondary-action"
            type="button"
            onClick={onSummary}
            disabled={isLoading || conversation.isCrisis || !conversation.canSummarize}
          >
            <FileText aria-hidden="true" />
            生成总结
          </button>
        </div>

        {conversation.shouldSummarize && !conversation.isCrisis ? (
          <div className="summary-nudge">
            <Sparkles aria-hidden="true" />
            <span>目前已经可以整理阶段性信念结构。</span>
            <button type="button" onClick={onSummary} disabled={isLoading}>
              现在总结
            </button>
          </div>
        ) : null}

        {conversation.isCrisis ? (
          <div className="crisis-banner" role="alert">
            <AlertTriangle aria-hidden="true" />
            <div>
              <strong>对话已切换为安全提示</strong>
              <p>当前不继续思想分析。请优先联系可信任的人、专业机构或当地紧急服务。</p>
            </div>
          </div>
        ) : null}

        <div className="message-list" aria-live="polite">
          {conversation.messages.length === 0 ? (
            <div className="empty-state">
              <MessageSquareText aria-hidden="true" />
              <h2>写下一个真实的困惑</h2>
              <p>可以是一件选择、一个矛盾，或一个你说不清理由的信念。AI 第一轮会先复述并确认理解。</p>
            </div>
          ) : (
            conversation.messages.map((message) => <MessageBubble key={message.id} message={message} />)
          )}
          {isLoading ? (
            <div className="message assistant loading">
              <span />
              <span />
              <span />
            </div>
          ) : null}
        </div>

        <form className="composer" onSubmit={onSubmit}>
          <textarea
            ref={inputRef}
            value={input}
            onChange={(event) => onInputChange(event.target.value)}
            placeholder="把你最近在思考的一个问题、一个矛盾，或一个困扰你的信念写下来……"
            rows={3}
            disabled={conversation.isCrisis}
          />
          <button className="send-button" type="submit" disabled={!input.trim() || isLoading || conversation.isCrisis}>
            <ArrowRight aria-hidden="true" />
          </button>
        </form>
      </div>
    </section>
  );
}

function StatusItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="status-item">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function StructureList({ title, items, empty }: { title: string; items: string[]; empty: string }) {
  return (
    <div className="structure-list">
      <h3>{title}</h3>
      {items.length > 0 ? (
        <ul>
          {items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      ) : (
        <p>{empty}</p>
      )}
    </div>
  );
}

function MessageBubble({ message }: { message: ChatMessage }) {
  return (
    <article className={`message ${message.role} ${message.responseType ?? ''}`}>
      <span className="message-author">{message.role === 'user' ? '你' : message.responseType === 'summary' ? '结构总结' : '镜观'}</span>
      <p>{message.content}</p>
    </article>
  );
}

function ConsentDialog({ onAccept, onClose }: { onAccept: () => void; onClose: () => void }) {
  return (
    <div className="dialog-backdrop" role="presentation">
      <section className="dialog" role="dialog" aria-modal="true" aria-labelledby="consent-title">
        <span className="dialog-icon">
          <ShieldCheck aria-hidden="true" />
        </span>
        <h2 id="consent-title">开始前确认</h2>
        <p>
          镜观提供的是思想分析，不是心理咨询或危机干预。它不会替你做决定，也不会提供医疗或心理治疗建议。
        </p>
        <div className="dialog-actions">
          <button className="secondary-action" type="button" onClick={onClose}>
            返回
          </button>
          <button className="primary-action compact" type="button" onClick={onAccept}>
            <Check aria-hidden="true" />
            我理解，开始对话
          </button>
        </div>
      </section>
    </div>
  );
}

export default App;
