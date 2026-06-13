import { FormEvent, MutableRefObject, useRef, useState } from 'react';
import { requestSummary, sendChatTurn } from './lib/chatClient';
import type { ChatMessage, ChatResponse, ConversationState, ResponseChoice } from './types/chat';

const NOTEBOOK_DATE = '2026.05.31';
const SUGGEST_SUMMARY_TURNS = 8;
const MAX_TURNS = 12;
const SAVED_RECORDS_KEY = 'jingguan-saved-thought-records-v1';
const MAX_SAVED_RECORDS = 20;

interface SavedThoughtRecord {
  id: string;
  title: string;
  createdAt: string;
  content: string;
  beliefs: string[];
  tensions: string[];
}

const initialConversation: ConversationState = {
  messages: [],
  detectedBeliefs: [],
  detectedTensions: [],
  turnCount: 0,
  canSummarize: false,
  shouldSummarize: false,
  isCrisis: false,
  isClosed: false,
};

function createId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function createAssistantMessage(response: ChatResponse): ChatMessage {
  return {
    id: createId(response.response_type === 'summary' ? 'summary' : 'analyst'),
    role: 'assistant',
    content: response.message,
    responseType: response.response_type,
    phase: response.phase,
    mapping: response.mapping ?? undefined,
    question: response.question ?? undefined,
    responseMode: response.response_mode,
    choices: response.choices,
    allowFreeText: response.allow_free_text,
    hasTension: response.has_tension,
  };
}

function readSavedRecords(): SavedThoughtRecord[] {
  if (typeof window === 'undefined') return [];

  try {
    const raw = window.localStorage.getItem(SAVED_RECORDS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    return parsed
      .filter((item): item is SavedThoughtRecord => {
        return (
          typeof item?.id === 'string' &&
          typeof item?.title === 'string' &&
          typeof item?.createdAt === 'string' &&
          typeof item?.content === 'string' &&
          Array.isArray(item?.beliefs) &&
          Array.isArray(item?.tensions)
        );
      })
      .slice(0, MAX_SAVED_RECORDS);
  } catch {
    return [];
  }
}

function writeSavedRecords(records: SavedThoughtRecord[]) {
  window.localStorage.setItem(SAVED_RECORDS_KEY, JSON.stringify(records.slice(0, MAX_SAVED_RECORDS)));
}

function getLatestSummary(messages: ChatMessage[]) {
  return [...messages]
    .reverse()
    .find((message) => message.role === 'assistant' && message.responseType === 'summary' && !message.isSavedRecord);
}

function getFirstUserText(messages: ChatMessage[]) {
  return messages.find((message) => message.role === 'user')?.content.trim() ?? '';
}

function createRecordTitle(messages: ChatMessage[]) {
  const firstUserText = getFirstUserText(messages).replace(/\s+/g, ' ');
  if (!firstUserText) return '思想分析记录';
  return firstUserText.length > 18 ? `${firstUserText.slice(0, 18)}...` : firstUserText;
}

function formatRecordDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const pad = (part: number) => String(part).padStart(2, '0');
  return `${date.getFullYear()}.${pad(date.getMonth() + 1)}.${pad(date.getDate())} ${pad(date.getHours())}:${pad(
    date.getMinutes(),
  )}`;
}

function choiceDisplayText(choice: ResponseChoice) {
  return `我选择：${choice.label}\n${choice.description}`;
}

function choiceApiText(choice: ResponseChoice) {
  return [
    `用户选择了选项 ${choice.id}「${choice.label}」。`,
    `选项含义：${choice.description}`,
    `结构化语义：${choice.meaning}`,
  ].join('\n');
}

function App() {
  const [view, setView] = useState<'home' | 'chat'>('home');
  const [showConsent, setShowConsent] = useState(false);
  const [pendingConsentAction, setPendingConsentAction] = useState<'start' | 'new'>('start');
  const [conversation, setConversation] = useState<ConversationState>(initialConversation);
  const [savedRecords, setSavedRecords] = useState<SavedThoughtRecord[]>(readSavedRecords);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const latestSummary = getLatestSummary(conversation.messages);
  const latestSummarySaved = latestSummary
    ? savedRecords.some((record) => record.content === latestSummary.content)
    : false;

  function beginChat() {
    setPendingConsentAction('start');
    setShowConsent(true);
  }

  function acceptConsent() {
    setShowConsent(false);
    setApiError(null);
    if (pendingConsentAction === 'new') {
      resetConversation();
      return;
    }
    setView('chat');
    window.setTimeout(() => inputRef.current?.focus(), 80);
  }

  function requestNewConversation() {
    setPendingConsentAction('new');
    setShowConsent(true);
  }

  function resetConversation() {
    setConversation(initialConversation);
    setInput('');
    setApiError(null);
    setView('chat');
    window.setTimeout(() => inputRef.current?.focus(), 80);
  }

  async function submitUserTurn({
    text,
    displayContent,
    selectedChoice,
  }: {
    text: string;
    displayContent?: string;
    selectedChoice?: ResponseChoice;
  }) {
    const userMessage: ChatMessage = {
      id: createId('visitor'),
      role: 'user',
      content: displayContent ?? text,
      selectedChoice,
    };

    const history = [...conversation.messages, userMessage];
    setConversation((current) => ({
      ...current,
      messages: history,
      turnCount: current.turnCount + 1,
    }));
    setInput('');
    setApiError(null);
    setIsLoading(true);

    try {
      const response = await sendChatTurn({
        text,
        history: conversation.messages,
        detectedBeliefs: conversation.detectedBeliefs,
        detectedTensions: conversation.detectedTensions,
      });

      const assistantMessage = createAssistantMessage(response);

      setConversation((current) => ({
        ...current,
        messages: [...current.messages, assistantMessage],
        detectedBeliefs: response.detected_beliefs,
        detectedTensions: response.detected_tensions,
        canSummarize: response.can_summarize,
        shouldSummarize: response.should_summarize,
        isCrisis: response.response_type === 'crisis',
        isClosed: response.response_type === 'summary' && current.turnCount >= MAX_TURNS,
      }));
    } catch (error) {
      setConversation((current) => ({
        ...current,
        messages: current.messages.filter((message) => message.id !== userMessage.id),
        turnCount: Math.max(0, current.turnCount - 1),
      }));
      setInput(selectedChoice ? '' : displayContent ?? text);
      setApiError(error instanceof Error ? error.message : '连接 API 时出现问题。');
    } finally {
      setIsLoading(false);
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const text = input.trim();
    if (!text || isLoading || conversation.isCrisis || conversation.isClosed) return;
    await submitUserTurn({ text });
  }

  async function handleChoiceSelect(choice: ResponseChoice) {
    if (isLoading || conversation.isCrisis || conversation.isClosed) return;

    const userMessage: ChatMessage = {
      id: createId('choice'),
      role: 'user',
      content: choiceDisplayText(choice),
      selectedChoice: choice,
    };

    if (choice.requires_api_after_choice || !choice.client_followup) {
      await submitUserTurn({
        text: choiceApiText(choice),
        displayContent: choiceDisplayText(choice),
        selectedChoice: choice,
      });
      return;
    }

    const localFollowup: ChatMessage = {
      id: createId('local-followup'),
      role: 'assistant',
      content: `你选择了「${choice.label}」。\n\n${choice.client_followup}`,
      responseType: 'normal',
      phase: 'clarification',
      mapping: `你选择了「${choice.label}」，也就是：${choice.description}`,
      question: choice.client_followup,
      responseMode: 'free_text',
      choices: [],
      allowFreeText: true,
      isLocalOnly: true,
    };

    setConversation((current) => ({
      ...current,
      messages: [...current.messages, userMessage, localFollowup],
      turnCount: current.turnCount + 1,
      shouldSummarize: current.canSummarize && current.turnCount + 1 >= SUGGEST_SUMMARY_TURNS,
    }));
    setInput('');
    setApiError(null);
    window.setTimeout(() => inputRef.current?.focus(), 80);
  }

  async function handleSummary() {
    if (isLoading || conversation.isCrisis || !conversation.canSummarize) return;
    setApiError(null);
    setIsLoading(true);
    try {
      const response = await requestSummary({
        history: conversation.messages,
        detectedBeliefs: conversation.detectedBeliefs,
        detectedTensions: conversation.detectedTensions,
      });
      const assistantMessage = createAssistantMessage(response);
      setConversation((current) => ({
        ...current,
        messages: [...current.messages, assistantMessage],
        canSummarize: true,
        shouldSummarize: false,
        isClosed: current.turnCount >= MAX_TURNS,
      }));
    } catch (error) {
      setApiError(error instanceof Error ? error.message : '连接 API 时出现问题。');
    } finally {
      setIsLoading(false);
    }
  }

  function handleSaveCurrentSummary() {
    if (!latestSummary || latestSummarySaved) return;

    const record: SavedThoughtRecord = {
      id: createId('record'),
      title: createRecordTitle(conversation.messages),
      createdAt: new Date().toISOString(),
      content: latestSummary.content,
      beliefs: conversation.detectedBeliefs,
      tensions: conversation.detectedTensions,
    };
    const nextRecords = [record, ...savedRecords].slice(0, MAX_SAVED_RECORDS);
    setSavedRecords(nextRecords);
    writeSavedRecords(nextRecords);
  }

  function handleDeleteSavedRecord(recordId: string) {
    const nextRecords = savedRecords.filter((record) => record.id !== recordId);
    setSavedRecords(nextRecords);
    writeSavedRecords(nextRecords);
  }

  function handleOpenSavedRecord(record: SavedThoughtRecord) {
    const restoredMessage: ChatMessage = {
      id: createId('saved-summary'),
      role: 'assistant',
      content: record.content,
      responseType: 'summary',
      isSavedRecord: true,
    };

    setConversation((current) => ({
      ...current,
      messages: [...current.messages, restoredMessage],
      detectedBeliefs: record.beliefs,
      detectedTensions: record.tensions,
      canSummarize: true,
      shouldSummarize: false,
      isClosed: false,
    }));
    setApiError(null);
    setView('chat');
    window.setTimeout(() => inputRef.current?.focus(), 80);
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <button className="brand" type="button" onClick={() => setView('home')}>
          镜观
        </button>
        <nav aria-label="主导航">
          <button type="button" className="nav-link" onClick={() => setView('home')}>
            关于
          </button>
          <button type="button" className="nav-link" onClick={view === 'chat' ? requestNewConversation : beginChat}>
            新对话
          </button>
        </nav>
      </header>

      {view === 'home' ? (
        <HomeScreen onStart={beginChat} />
      ) : (
        <ChatScreen
          conversation={conversation}
          input={input}
          inputRef={inputRef}
          isLoading={isLoading}
          onInputChange={setInput}
          onSubmit={handleSubmit}
          onSummary={handleSummary}
          onSaveSummary={handleSaveCurrentSummary}
          latestSummarySaved={latestSummarySaved}
          hasSummary={Boolean(latestSummary)}
          apiError={apiError}
          savedRecords={savedRecords}
          onChoiceSelect={handleChoiceSelect}
          onOpenSavedRecord={handleOpenSavedRecord}
          onDeleteSavedRecord={handleDeleteSavedRecord}
          onReset={requestNewConversation}
        />
      )}

      {showConsent ? <ConsentDialog onAccept={acceptConsent} onClose={() => setShowConsent(false)} /> : null}
    </main>
  );
}

function HomeScreen({ onStart }: { onStart: () => void }) {
  return (
    <section className="home-manuscript">
      <div className="home-copy">
        <p className="eyebrow">思想分析 / 苏格拉底式追问</p>
        <h1>把你的困惑说清楚</h1>
        <p className="lead">
          镜观不提供答案，也不替你做决定。它把一段困惑整理成信念、理由、前提与张力，让思考本身变得可读。
        </p>
        <div className="home-rule" />
        <div className="home-actions">
          <button className="primary-action" type="button" onClick={onStart}>
            开始一次对话
          </button>
          <span className="consent-note">每次对话前确认边界</span>
        </div>
      </div>

      <div className="sample-transcript" aria-label="示例对话">
        <TranscriptPreview
          speaker="来访者"
          text="我父母希望我留在老家工作，但我觉得应该去大城市发展。我知道陪伴家人很重要，但不去追求自己的发展好像会后悔。"
        />
        <TranscriptPreview
          speaker="分析师"
          mapping="你同时持有「陪伴家人是重要的」和「追求个人发展是重要的」两个信念，而它们在这个选择里指向了不同方向。"
          question="当你说「追求发展」，你具体指的是什么，是职业机会，还是另一种生活方式？"
          hasTension
        />
      </div>
    </section>
  );
}

function TranscriptPreview({
  speaker,
  text,
  mapping,
  question,
  hasTension,
}: {
  speaker: string;
  text?: string;
  mapping?: string;
  question?: string;
  hasTension?: boolean;
}) {
  return (
    <article className="transcript-entry preview-entry">
      <span className="message-author">{speaker}</span>
      <div className="message-body">
        {text ? <p className="message-text">{text}</p> : null}
        {mapping ? <p className="analysis-mapping">{mapping}</p> : null}
        {question ? (
          <p className="analysis-question">
            {hasTension ? <span className="tension-pill">张力</span> : null}
            {question}
          </p>
        ) : null}
      </div>
    </article>
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
  onSaveSummary,
  latestSummarySaved,
  hasSummary,
  apiError,
  savedRecords,
  onChoiceSelect,
  onOpenSavedRecord,
  onDeleteSavedRecord,
  onReset,
}: {
  conversation: ConversationState;
  input: string;
  inputRef: MutableRefObject<HTMLTextAreaElement | null>;
  isLoading: boolean;
  onInputChange: (value: string) => void;
  onSubmit: (event: FormEvent) => void;
  onSummary: () => void;
  onSaveSummary: () => void;
  latestSummarySaved: boolean;
  hasSummary: boolean;
  apiError: string | null;
  savedRecords: SavedThoughtRecord[];
  onChoiceSelect: (choice: ResponseChoice) => void;
  onOpenSavedRecord: (record: SavedThoughtRecord) => void;
  onDeleteSavedRecord: (recordId: string) => void;
  onReset: () => void;
}) {
  const pageNumber = Math.max(1, Math.min(MAX_TURNS, conversation.turnCount + 1));
  const lastMessage = conversation.messages[conversation.messages.length - 1];
  const activeChoiceMessage =
    !conversation.isClosed &&
    lastMessage?.role === 'assistant' &&
    lastMessage.responseMode === 'choice' &&
    lastMessage.choices?.length
      ? lastMessage
      : undefined;
  const composerPlaceholder = activeChoiceMessage
    ? '也可以不选，直接补充或改写……'
    : conversation.messages.length === 0
      ? '写下一个真实的困惑……'
      : '继续说……';

  return (
    <section className="chat-layout">
      <div className="conversation-area">
        <div className="conversation-header">
          <div>
            <div className="notebook-meta" aria-label="笔记本页眉">
              <span className="notebook-title">镜观</span>
              <span>第 {pageNumber} 页</span>
              <span>{NOTEBOOK_DATE}</span>
            </div>
            <h1>思想分析记录</h1>
          </div>
          <div className="header-actions">
            <button
              className="text-action"
              type="button"
              onClick={onSummary}
              disabled={isLoading || conversation.isCrisis || conversation.isClosed || !conversation.canSummarize}
            >
              生成小结
            </button>
            <button
              className="text-action"
              type="button"
              onClick={onSaveSummary}
              disabled={isLoading || !hasSummary || latestSummarySaved}
            >
              {latestSummarySaved ? '已保存' : '保存记录'}
            </button>
          </div>
        </div>

        {conversation.shouldSummarize && !conversation.isCrisis ? (
          <div className="system-strip">
            对话已到第 {SUGGEST_SUMMARY_TURNS} 轮附近，建议整理阶段性信念结构。
            <button type="button" onClick={onSummary} disabled={isLoading}>
              现在总结
            </button>
          </div>
        ) : null}

        {conversation.isClosed ? (
          <div className="system-strip">
            本次对话已完成阶段性收束。你可以保存记录，或开始新对话。
          </div>
        ) : null}

        {apiError ? (
          <div className="system-strip error" role="alert">
            {apiError}
          </div>
        ) : null}

        {conversation.isCrisis ? (
          <div className="system-strip crisis" role="alert">
            当前不继续思想分析。请优先联系可信任的人、专业机构或当地紧急服务。
          </div>
        ) : null}

        <div className="message-list" aria-live="polite">
          {conversation.messages.length === 0 ? (
            <article className="transcript-entry empty-state">
              <span className="message-author">提示</span>
              <div className="message-body">
                <p className="message-text">写下一个真实的困惑。可以是一件选择、一个矛盾，或一个你说不清理由的信念。</p>
              </div>
            </article>
          ) : (
            conversation.messages.map((message) => (
              <MessageRow
                key={message.id}
                message={message}
                isActiveChoice={message.id === activeChoiceMessage?.id}
                choicesDisabled={isLoading || conversation.isCrisis || conversation.isClosed}
                onChoiceSelect={onChoiceSelect}
              />
            ))
          )}
          {isLoading ? (
            <article className="transcript-entry loading-row">
              <span className="message-author">分析师</span>
              <div className="message-body">
                <p className="analysis-mapping">正在整理你的表述……</p>
              </div>
            </article>
          ) : null}
        </div>

        {conversation.isClosed ? null : (
          <form className="composer transcript-entry" onSubmit={onSubmit}>
            <span className="message-author">来访者</span>
            <div className="composer-body">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(event) => onInputChange(event.target.value)}
                placeholder={composerPlaceholder}
                rows={2}
                disabled={conversation.isCrisis}
              />
              <button className="send-button" type="submit" disabled={!input.trim() || isLoading || conversation.isCrisis}>
                送出
              </button>
            </div>
          </form>
        )}

        <footer className="page-footer">
          <span>第 {pageNumber} 页</span>
          <span>第 {conversation.turnCount || 0} 轮 · 共 {MAX_TURNS} 轮</span>
        </footer>
      </div>

      <BeliefSidebar
        conversation={conversation}
        savedRecords={savedRecords}
        onOpenSavedRecord={onOpenSavedRecord}
        onDeleteSavedRecord={onDeleteSavedRecord}
        onReset={onReset}
      />
    </section>
  );
}

function BeliefSidebar({
  conversation,
  savedRecords,
  onOpenSavedRecord,
  onDeleteSavedRecord,
  onReset,
}: {
  conversation: ConversationState;
  savedRecords: SavedThoughtRecord[];
  onOpenSavedRecord: (record: SavedThoughtRecord) => void;
  onDeleteSavedRecord: (recordId: string) => void;
  onReset: () => void;
}) {
  return (
    <aside className="belief-sidebar" aria-label="已识别信念">
      <div className="sidebar-scroll">
        <section>
          <h2>已识别信念</h2>
          <ul className="note-list">
            {conversation.detectedBeliefs.length > 0 ? (
              conversation.detectedBeliefs.map((belief) => <BeliefNote key={belief}>{belief}</BeliefNote>)
            ) : (
              <BeliefNote placeholder>信念识别中...</BeliefNote>
            )}
            {conversation.detectedTensions.length > 0 ? (
              conversation.detectedTensions.map((tension) => (
                <BeliefNote key={tension} tension>
                  {tension}
                </BeliefNote>
              ))
            ) : (
              <BeliefNote placeholder>张力识别中...</BeliefNote>
            )}
          </ul>
        </section>

        <section className="saved-records">
          <h2>保存记录</h2>
          {savedRecords.length > 0 ? (
            <ul className="saved-record-list">
              {savedRecords.map((record) => (
                <li className="saved-record-item" key={record.id}>
                  <button className="saved-record-open" type="button" onClick={() => onOpenSavedRecord(record)}>
                    <span className="saved-record-title">{record.title}</span>
                    <span className="saved-record-date">{formatRecordDate(record.createdAt)}</span>
                  </button>
                  <button
                    className="saved-record-delete"
                    type="button"
                    onClick={() => onDeleteSavedRecord(record.id)}
                    aria-label={`删除保存记录：${record.title}`}
                  >
                    删除
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="saved-record-empty">生成小结后手动保存。</p>
          )}
        </section>
      </div>
      <div className="sidebar-footer">
        <p>第 {conversation.turnCount || 0} 轮 · 共 {MAX_TURNS} 轮</p>
        <button type="button" onClick={onReset}>
          新对话
        </button>
      </div>
    </aside>
  );
}

function BeliefNote({
  children,
  tension = false,
  placeholder = false,
}: {
  children: string;
  tension?: boolean;
  placeholder?: boolean;
}) {
  return (
    <li className={`belief-note ${tension ? 'tension' : ''} ${placeholder ? 'placeholder' : ''}`}>
      <i className="note-tear" aria-hidden="true" />
      <i className="note-curl" aria-hidden="true" />
      <span>{children}</span>
    </li>
  );
}

function MessageRow({
  message,
  isActiveChoice = false,
  choicesDisabled = false,
  onChoiceSelect,
}: {
  message: ChatMessage;
  isActiveChoice?: boolean;
  choicesDisabled?: boolean;
  onChoiceSelect?: (choice: ResponseChoice) => void;
}) {
  const speaker =
    message.role === 'user'
      ? '来访者'
      : message.isSavedRecord
        ? '保存记录'
        : message.responseType === 'summary'
          ? '小结'
          : '分析师';
  const showChoices =
    message.role === 'assistant' &&
    message.responseType === 'normal' &&
    isActiveChoice &&
    Boolean(message.choices?.length);

  return (
    <article className={`transcript-entry ${message.role} ${message.responseType ?? ''}`}>
      <span className="message-author">{speaker}</span>
      <div className="message-body">
        {message.role === 'user' && message.selectedChoice ? (
          <div className="selected-choice">
            <span>{message.selectedChoice.id}</span>
            <strong>{message.selectedChoice.label}</strong>
            <p>{message.selectedChoice.description}</p>
          </div>
        ) : null}
        {message.role === 'assistant' && message.responseType === 'normal' ? (
          <>
            <p className="analysis-mapping">{message.mapping ?? message.content}</p>
            {message.question ? (
              <p className="analysis-question">
                {message.hasTension ? <span className="tension-pill">张力</span> : null}
                {message.question}
              </p>
            ) : null}
            {showChoices ? (
              <ChoicePanel
                choices={message.choices ?? []}
                allowFreeText={message.allowFreeText ?? true}
                disabled={choicesDisabled}
                onChoiceSelect={onChoiceSelect}
              />
            ) : null}
          </>
        ) : (
          message.selectedChoice ? null : <p className="message-text">{message.content}</p>
        )}
      </div>
    </article>
  );
}

function ChoicePanel({
  choices,
  allowFreeText,
  disabled,
  onChoiceSelect,
}: {
  choices: ResponseChoice[];
  allowFreeText: boolean;
  disabled: boolean;
  onChoiceSelect?: (choice: ResponseChoice) => void;
}) {
  return (
    <div className="choice-panel" aria-label="选择下一步">
      <div className="choice-grid">
        {choices.map((choice) => (
          <button
            className="choice-card"
            type="button"
            key={choice.id}
            disabled={disabled}
            onClick={() => onChoiceSelect?.(choice)}
          >
            <span>{choice.id}</span>
            <strong>{choice.label}</strong>
            <small>{choice.description}</small>
          </button>
        ))}
      </div>
      {allowFreeText ? <p className="choice-free-note">也可以直接在下方补充或改写。</p> : null}
    </div>
  );
}

function ConsentDialog({ onAccept, onClose }: { onAccept: () => void; onClose: () => void }) {
  return (
    <div className="dialog-backdrop" role="presentation">
      <section className="dialog" role="dialog" aria-modal="true" aria-labelledby="consent-title">
        <p className="eyebrow">边界确认</p>
        <h2 id="consent-title">开始前确认</h2>
        <p>
          镜观提供的是思想分析，不是心理咨询或危机干预。它不会替你做决定，也不会提供医疗或心理治疗建议。
        </p>
        <div className="dialog-actions">
          <button className="text-action" type="button" onClick={onClose}>
            返回
          </button>
          <button className="primary-action compact" type="button" onClick={onAccept}>
            我理解，开始对话
          </button>
        </div>
      </section>
    </div>
  );
}

export default App;
