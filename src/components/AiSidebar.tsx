import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { Popover } from '@base-ui/react';
import {
  ArrowUp,
  Columns2,
  FileText,
  History,
  Image as ImageIcon,
  Mic,
  Paperclip,
  Plus,
  Sparkles,
  Square,
  Trash2,
  X,
} from 'lucide-react';
import { getToolName, isToolUIPart, type ToolSet, type UIMessage } from 'ai';
import { useAui, type ThreadMessage } from '@assistant-ui/react';
import { toast } from 'sonner';
import { AiAgentPicker } from './AiAgentPicker';
import { AiChatHistory } from './AiChatHistory';
import { AiChatTabs } from './AiChatTabs';
import { AiModelPicker, AiReasoningPicker } from './AiModelPicker';
import { AiToolCard } from './AiToolCard';
import { AssistantUiThread } from './AssistantUiThread';
import { ChainOfThoughtGroup } from './ChainOfThoughtGroup';
import { ToolActivityGroup } from './ToolActivityGroup';
import type { ThreadComponents } from './assistant-ui/elements/thread.aui';
import { TOOL_LABELS } from '../lib/ai/toolView';
import { generateChatTitle } from '../lib/ai/title';
import {
  UI_CHATS_KEY,
  UI_CHATS_LEGACY_KEY,
  applyGeneratedTitle,
  createUiChat,
  deleteUiChat,
  hasAssistantMessage,
  hasUserMessage,
  isUiChats,
  loadInitialUiChats,
  markTitleAttempted,
  renameUiChat,
  saveUiChatMessages,
  selectUiChat,
  storableUiMessages,
  type UiChats,
} from '../lib/ai/uiChats';
import type { AiChat } from '../hooks/useAiChat';
import { useDictation } from '../hooks/useDictation';
import {
  MAX_ATTACHMENTS,
  mediaTypeOf,
  readAttachment,
  type PendingAttachment,
} from '../lib/ai/attachments';
import type { AiSession } from '../lib/ai/sessions';
import type { AiAgent, AiAgentId } from '../lib/ai/agents';
import { isAiReasoning, type AiReasoning } from '../lib/ai/model';
import { isString, usePersistedState } from '../lib/usePersistedState';
import { Button, IconButton, Spinner } from '../ui/primitives';
import { PopoverContent } from '../ui/overlays';
import { cn } from '../ui/cn';

const MIN_WIDTH = 320;
const MAX_WIDTH = 720;
const ACCEPT =
  'image/*,.pine,.txt,.md,.json,.csv,.log,.ts,.tsx,.js,.jsx,.yaml,.yml,.toml,.ini';

interface Props {
  width: number;
  chat: AiChat;
  sessions: AiSession[];
  activeSessionId: string;
  agents: AiAgent[];
  agent: AiAgent;
  onAgentChange: (id: AiAgentId) => void;
  /** Null until the sidecar answers; false shows the configuration hint. */
  configured: boolean | null;
  model: string | null;
  /** Whisper-compatible model; the mic is hidden when null. */
  transcriptionModel: string | null;
  contextLabel: string;
  /** PNG data URL of the active chart, or null when it cannot be exported. */
  screenshot: () => string | null;
  onNewChat: () => void;
  onSelectSession: (id: string) => void;
  onDeleteSession: (id: string) => void;
  onOpenSettings: () => void;
  onWidthChange: (width: number) => void;
  onClose: () => void;
  /** Same model and tools, rendered by assistant-ui for comparison. */
  compareTools: ToolSet;
  compareSystem: () => string;
}

const SUGGESTIONS = [
  'Explain what this script does, step by step.',
  'Add a 200 EMA trend filter and keep the rest unchanged.',
  'Run the script and explain any warnings.',
];

interface AiComposerValue {
  agent: AiAgent;
  agents: AiAgent[];
  onAgentChange: (id: AiAgentId) => void;
  selectedModel: string | null;
  configuredModel: string | null;
  reasoning: AiReasoning;
  onModelChange: (model: string | null) => void;
  onReasoningChange: (reasoning: AiReasoning) => void;
  withChart: boolean;
  onToggleChart: () => void;
  transcriptionModel: string | null;
}

const AiComposerContext = createContext<AiComposerValue | null>(null);

function useAiComposer(): AiComposerValue {
  const value = useContext(AiComposerContext);
  if (!value) throw new Error('AI composer controls need their context');
  return value;
}

/**
 * Stable component types: a changing `components` object makes assistant-ui
 * remount the composer and closes an open model/reasoning popover.
 */
function ComposerModelControls() {
  const {
    selectedModel,
    configuredModel,
    reasoning,
    onModelChange,
    onReasoningChange,
    withChart,
    onToggleChart,
    transcriptionModel,
  } = useAiComposer();
  const aui = useAui();
  const dictation = useDictation((text) => {
    const current = aui.composer.getState().text;
    aui.composer.setText(current ? `${current} ${text}` : text, { origin: 'user' });
  });
  return (
    <div className="flex min-w-0 items-center gap-1">
      {transcriptionModel ? (
        <IconButton
          label={dictation.recording ? 'Stop dictation' : 'Dictate a prompt'}
          onClick={() => (dictation.recording ? dictation.stop() : dictation.start())}
          disabled={dictation.transcribing}
          className={cn(dictation.recording && 'bg-negative/10 text-negative')}
        >
          {dictation.transcribing ? (
            <Spinner className="size-3.5" />
          ) : (
            <Mic className="size-3.5" />
          )}
        </IconButton>
      ) : null}
      <button
        type="button"
        aria-pressed={withChart}
        title="Attach the active chart to every message"
        onClick={onToggleChart}
        className={cn(
          'inline-flex shrink-0 items-center gap-1 rounded border px-1.5 py-0.5 text-[10px]',
          withChart
            ? 'border-primary/40 bg-primary-soft text-primary'
            : 'border-border text-muted-foreground',
        )}
      >
        <ImageIcon className="size-3" />
        Chart
      </button>
      <AiModelPicker
        model={selectedModel}
        defaultModel={configuredModel}
        onModelChange={onModelChange}
      />
      <AiReasoningPicker reasoning={reasoning} onReasoningChange={onReasoningChange} />
    </div>
  );
}

function ComposerModeControl() {
  const { agent, agents, onAgentChange, configuredModel } = useAiComposer();
  return (
    <AiAgentPicker
      agent={agent}
      agents={agents}
      onAgentChange={onAgentChange}
      model={configuredModel}
      compact
    />
  );
}

const COMPOSER_COMPONENTS: ThreadComponents = {
  ComposerExtra: ComposerModelControls,
  ComposerFooter: ComposerModeControl,
  ToolGroup: ToolActivityGroup,
  ChainOfThought: ChainOfThoughtGroup,
};

function relativeTime(at: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - at) / 1000));
  if (seconds < 60) return 'now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

function Message({ message }: { message: UIMessage }) {
  const mine = message.role === 'user';
  const streaming = message.parts.some(
    (part) =>
      isToolUIPart(part) &&
      part.state !== 'output-available' &&
      part.state !== 'output-error',
  );
  return (
    <div className={cn('flex flex-col gap-1.5', mine ? 'items-end' : 'items-stretch')}>
      {message.parts.map((part, index) =>
        part.type === 'text' ? (
          <div
            key={index}
            className={cn(
              'max-w-full whitespace-pre-wrap break-words rounded-lg px-2.5 py-2 text-[12px] leading-relaxed',
              mine
                ? 'bg-primary-soft text-foreground'
                : 'bg-transparent px-0 py-0 text-foreground/90',
            )}
          >
            {part.text}
          </div>
        ) : isToolUIPart(part) ? (
          <AiToolCard key={index} part={part} />
        ) : part.type === 'file' ? (
          <div
            key={index}
            className="inline-flex items-center gap-1 self-end rounded-md border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground"
          >
            <ImageIcon className="size-3" />
            {part.filename ?? 'Attachment'}
          </div>
        ) : null,
      )}
      {streaming ? <Spinner className="size-3 text-muted-foreground" /> : null}
    </div>
  );
}

export function AiSidebar({
  width,
  chat,
  sessions,
  activeSessionId,
  agents,
  agent,
  onAgentChange,
  configured,
  model,
  transcriptionModel,
  contextLabel,
  screenshot,
  onNewChat,
  onSelectSession,
  onDeleteSession,
  onOpenSettings,
  onWidthChange,
  onClose,
  compareTools,
  compareSystem,
}: Props) {
  const [draft, setDraft] = useState('');
  const [withChart, setWithChart] = useState(true);
  const [pending, setPending] = useState<PendingAttachment[]>([]);
  const dictation = useDictation((text) =>
    setDraft((prev) => (prev ? `${prev} ${text}` : text)),
  );
  const [historyOpen, setHistoryOpen] = useState(false);
  // Temporary: assistant-ui is the visible chat until we decide between the two.
  const [compare, setCompare] = useState(true);
  const [view, setView] = useState<'chat' | 'history'>('chat');
  const initialUiChatsState = useMemo(() => loadInitialUiChats(contextLabel), []);
  const [uiChats, setUiChats] = usePersistedState<UiChats>(
    UI_CHATS_KEY,
    initialUiChatsState,
    isUiChats,
  );
  const [aiModelChoice, setAiModelChoice] = usePersistedState<string>(
    'screener.ai.model',
    '',
    isString,
  );
  const [aiReasoning, setAiReasoning] = usePersistedState<AiReasoning>(
    'screener.ai.reasoning',
    'auto',
    isAiReasoning,
  );
  const titlePendingRef = useRef(new Set<string>());
  const activeUiChat =
    uiChats.sessions.find((session) => session.id === uiChats.activeId) ?? uiChats.sessions[0];
  const listRef = useRef<HTMLDivElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const busy = chat.status === 'streaming';
  const disabled = configured === false;
  const lastMessage = chat.messages[chat.messages.length - 1];
  const runningPart =
    lastMessage?.role === 'assistant'
      ? lastMessage.parts.find(
          (part) =>
            isToolUIPart(part) &&
            (part.state === 'input-streaming' || part.state === 'input-available'),
        )
      : undefined;
  const hasReplyText =
    lastMessage?.parts.some((part) => part.type === 'text' && part.text.trim().length > 0) ?? false;
  const busyLabel = runningPart
    ? `Running ${TOOL_LABELS[getToolName(runningPart)] ?? 'tool'}…`
    : hasReplyText
      ? 'Writing…'
      : 'Thinking…';
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!busy) {
      setStartedAt(null);
      return;
    }
    setStartedAt(Date.now());
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [busy]);
  const elapsed = busy && startedAt ? Math.max(0, Math.round((now - startedAt) / 1000)) : 0;
  const statusText = busy ? busyLabel : chat.stopped ? 'Stopped' : 'Ready';

  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [chat.messages]);

  useEffect(() => {
    if (!historyOpen) return;
    setHistoryOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSessionId]);

  // The legacy key was folded into v2 by loadInitialUiChats; drop the old copy.
  useEffect(() => {
    try {
      localStorage.removeItem(UI_CHATS_LEGACY_KEY);
    } catch {
      /* storage can be unavailable */
    }
  }, []);

  // One cheap title call per chat, once there is an assistant reply to summarize.
  useEffect(() => {
    if (configured !== true) return;
    for (const session of uiChats.sessions) {
      if (session.titleSource !== 'auto' || session.titleGenerated) continue;
      if (!hasUserMessage(session.messages) || !hasAssistantMessage(session.messages)) continue;
      if (titlePendingRef.current.has(session.id)) continue;
      titlePendingRef.current.add(session.id);
      void generateChatTitle(session.messages, session.context, aiModelChoice || null)
        .then((title) => {
          setUiChats((state) =>
            title
              ? applyGeneratedTitle(state, session.id, title)
              : markTitleAttempted(state, session.id),
          );
        })
        .finally(() => {
          titlePendingRef.current.delete(session.id);
        });
    }
  }, [aiModelChoice, configured, setUiChats, uiChats.sessions]);

  const saveUiMessages = useCallback(
    (messages: readonly ThreadMessage[]) => {
      setUiChats((state) =>
        saveUiChatMessages(state, activeUiChat.id, storableUiMessages(messages), contextLabel),
      );
    },
    [activeUiChat.id, contextLabel, setUiChats],
  );

  const newUiChat = () => {
    setUiChats((state) => createUiChat(state, contextLabel));
    setView('chat');
  };
  const openUiChat = (id: string) => {
    setUiChats((state) => selectUiChat(state, id));
    setView('chat');
  };
  const removeUiChat = (id: string) => {
    setUiChats((state) => deleteUiChat(state, id, contextLabel));
  };
  const renameUiChatById = (id: string, title: string) => {
    setUiChats((state) => renameUiChat(state, id, title));
  };

  const onModelChange = useCallback(
    (next: string | null) => setAiModelChoice(next ?? ''),
    [setAiModelChoice],
  );
  const composerValue = useMemo<AiComposerValue>(
    () => ({
      agent,
      agents,
      onAgentChange,
      selectedModel: aiModelChoice || null,
      configuredModel: model,
      reasoning: aiReasoning,
      onModelChange,
      onReasoningChange: setAiReasoning,
      withChart,
      onToggleChart: () => setWithChart((value) => !value),
      transcriptionModel,
    }),
    [
      agent,
      agents,
      aiModelChoice,
      aiReasoning,
      model,
      onAgentChange,
      onModelChange,
      setAiReasoning,
      withChart,
      transcriptionModel,
    ],
  );

  const addFiles = async (files: File[]) => {
    if (files.length === 0) return;
    const room = MAX_ATTACHMENTS - pending.length;
    if (room <= 0) {
      toast.error(`Up to ${MAX_ATTACHMENTS} attachments per message`);
      return;
    }
    const accepted: PendingAttachment[] = [];
    for (const file of files.slice(0, room)) {
      try {
        accepted.push(await readAttachment(file));
      } catch (cause) {
        toast.error(cause instanceof Error ? cause.message : String(cause));
      }
    }
    if (accepted.length > 0) setPending((prev) => [...prev, ...accepted]);
  };

  const submit = (text = draft) => {
    if (busy || disabled) return;
    const images = pending
      .filter((item) => item.kind === 'image')
      .map((item) => ({ url: item.data, mediaType: mediaTypeOf(item.data), name: item.name }));
    const chart = withChart ? screenshot() : null;
    if (chart) images.unshift({ url: chart, mediaType: 'image/png', name: 'chart.png' });
    const files = pending
      .filter((item) => item.kind === 'text')
      .map((item) => ({ name: item.name, text: item.data }));
    if (!text.trim() && images.length === 0 && files.length === 0) return;
    chat.send(text.trim() || 'Review the attached files.', { images, files });
    setDraft('');
    setPending([]);
  };

  const startResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const handle = event.currentTarget;
    try {
      handle.setPointerCapture(event.pointerId);
    } catch {
      /* synthetic or already-released pointer */
    }
    const startX = event.clientX;
    const startWidth = width;
    const move = (moveEvent: PointerEvent) => {
      const next = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startWidth + moveEvent.clientX - startX));
      onWidthChange(next);
    };
    const stop = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', stop);
      handle.removeEventListener('pointercancel', stop);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', stop);
    handle.addEventListener('pointercancel', stop);
  };

  const onDrop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    void addFiles(Array.from(event.dataTransfer.files));
  };

  return (
    <aside
      className="relative flex h-full shrink-0 flex-col border-r border-border bg-card"
      style={{ width }}
      aria-label="AI"
      onDragOver={(event) => event.preventDefault()}
      onDrop={onDrop}
    >
      {compare ? (
        <AiChatTabs
          title={activeUiChat.title}
          view={view}
          onShowChat={() => setView('chat')}
          onShowHistory={() => setView('history')}
          onNewChat={newUiChat}
          onShowAppChat={() => setCompare(false)}
          onOpenSettings={onOpenSettings}
          onClose={onClose}
        />
      ) : (
        <header className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
          <Sparkles className="size-3.5 text-primary" />
          <span className="text-[12px] font-medium">AI</span>
          <AiAgentPicker agent={agent} agents={agents} onAgentChange={onAgentChange} model={model} />
          <div className="ml-auto flex items-center gap-1">
            <Popover.Root open={historyOpen} onOpenChange={setHistoryOpen}>
              <Popover.Trigger
                title="Chat history"
                aria-label="Chat history"
                className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <History className="size-3.5" />
              </Popover.Trigger>
              <PopoverContent className="w-72 p-1" align="end">
                <div className="flex items-center justify-between px-2 py-1">
                  <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    Chats
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setHistoryOpen(false);
                      onNewChat();
                    }}
                    className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-foreground/80 hover:bg-accent"
                  >
                    <Plus className="size-3" />
                    New
                  </button>
                </div>
                <div className="max-h-80 overflow-y-auto">
                  {sessions.map((session) => (
                    <div
                      key={session.id}
                      className={cn(
                        'group flex items-center gap-1 rounded px-1.5 py-1',
                        session.id === activeSessionId ? 'bg-primary-soft' : 'hover:bg-accent/60',
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => {
                          setHistoryOpen(false);
                          onSelectSession(session.id);
                        }}
                        className="min-w-0 flex-1 text-left"
                      >
                        <div className="truncate text-[11px] text-foreground/90">{session.title}</div>
                        <div className="text-[10px] text-muted-foreground">
                          {relativeTime(session.updatedAt)} · {session.messages.length} msg
                        </div>
                      </button>
                      <IconButton
                        label={`Delete ${session.title}`}
                        onClick={() => onDeleteSession(session.id)}
                        className="opacity-0 group-hover:opacity-100"
                      >
                        <Trash2 className="size-3" />
                      </IconButton>
                    </div>
                  ))}
                </div>
              </PopoverContent>
            </Popover.Root>
            <IconButton label="Show assistant-ui" onClick={() => setCompare(true)}>
              <Columns2 className="size-3.5" />
            </IconButton>
            <IconButton label="New chat" onClick={onNewChat}>
              <Plus className="size-3.5" />
            </IconButton>
            <IconButton label="Close AI" onClick={onClose}>
              <X className="size-3.5" />
            </IconButton>
          </div>
        </header>
      )}

      {compare ? (
        <>
          <div className={cn('flex min-h-0 flex-1 flex-col', view !== 'chat' && 'hidden')}>
            <div className="min-h-0 flex-1 overflow-hidden">
              <AiComposerContext.Provider value={composerValue}>
                <AssistantUiThread
                  key={activeUiChat.id}
                  tools={compareTools}
                  system={compareSystem}
                  sessionId={activeUiChat.id}
                  initialMessages={activeUiChat.messages}
                  onSave={saveUiMessages}
                  components={COMPOSER_COMPONENTS}
                  model={aiModelChoice || null}
                  reasoning={aiReasoning}
                  withChart={withChart}
                  screenshot={screenshot}
                />
              </AiComposerContext.Provider>
            </div>
            <p className="shrink-0 px-4 pb-2 text-center text-[10px] leading-4 text-muted-foreground">
              AI can make mistakes. Check important results.
            </p>
          </div>
          <div className={cn('flex min-h-0 flex-1 flex-col', view !== 'history' && 'hidden')}>
            <AiChatHistory
              sessions={uiChats.sessions}
              activeId={activeUiChat.id}
              onNewChat={newUiChat}
              onSelect={openUiChat}
              onRename={renameUiChatById}
              onDelete={removeUiChat}
            />
          </div>
        </>
      ) : (
        <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
      <div ref={listRef} className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-3 py-3">
        {chat.messages.length === 0 ? (
          <div className="flex flex-col gap-3 text-[12px] text-muted-foreground">
            <p>
              Ask about the open script or the active chart. Attach screenshots or files, or
              dictate a prompt. The assistant can read and edit the script, run a debug pass, and
              look at the chart image.
            </p>
            <p className="text-[11px] text-muted-foreground/70">{contextLabel}</p>
            <div className="flex flex-col items-start gap-1.5">
              {SUGGESTIONS.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  disabled={disabled}
                  onClick={() => submit(suggestion)}
                  className="rounded-md border border-border px-2 py-1 text-left text-[11px] text-foreground/80 hover:bg-accent disabled:opacity-40"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        ) : (
          chat.messages.map((message) => <Message key={message.id} message={message} />)
        )}
        {chat.error ? (
          <div className="rounded-md border border-negative/40 bg-negative/10 px-2 py-1.5 text-[11px] text-negative">
            {chat.error}
          </div>
        ) : null}
        {disabled ? (
          <div className="rounded-md border border-border bg-background/60 px-2 py-2 text-[11px] text-muted-foreground">
            <p>
              AI is not configured. Add a base URL and model in Settings; the key stays in the
              sidecar.
            </p>
            <button
              type="button"
              onClick={onOpenSettings}
              className="mt-1.5 rounded-md border border-border px-2 py-1 text-[11px] text-foreground/80 hover:bg-accent"
            >
              Open settings
            </button>
          </div>
        ) : null}
      </div>

      <form
        className="shrink-0 border-t border-border p-2"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        {pending.length > 0 ? (
          <div className="mb-1.5 flex flex-wrap gap-1">
            {pending.map((item) => (
              <div
                key={item.id}
                className="flex max-w-full items-center gap-1 rounded border border-border bg-background px-1 py-0.5 text-[10px] text-foreground/80"
              >
                {item.kind === 'image' ? (
                  <img src={item.data} alt="" className="size-5 rounded object-cover" />
                ) : (
                  <FileText className="size-3 text-muted-foreground" />
                )}
                <span className="max-w-28 truncate">{item.name}</span>
                <button
                  type="button"
                  aria-label={`Remove ${item.name}`}
                  onClick={() => setPending((prev) => prev.filter((entry) => entry.id !== item.id))}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <X className="size-3" />
                </button>
              </div>
            ))}
          </div>
        ) : null}
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              submit();
            }
          }}
          onPaste={(event) => {
            const files = Array.from(event.clipboardData.files);
            if (files.length > 0) {
              event.preventDefault();
              void addFiles(files);
            }
          }}
          rows={3}
          disabled={disabled}
          placeholder={disabled ? 'Configure a model to start' : 'Ask about the script or chart…'}
          className="w-full resize-none rounded-md border border-border bg-background px-2 py-1.5 text-[12px] outline-none placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
        />
        <input
          ref={fileRef}
          type="file"
          multiple
          accept={ACCEPT}
          className="hidden"
          onChange={(event) => {
            void addFiles(Array.from(event.target.files ?? []));
            event.target.value = '';
          }}
        />
        <div className="mt-1.5 flex items-center gap-1">
          <IconButton
            label="Attach images or files"
            onClick={() => fileRef.current?.click()}
            disabled={disabled}
          >
            <Paperclip className="size-3.5" />
          </IconButton>
          {transcriptionModel ? (
            <IconButton
              label={dictation.recording ? 'Stop dictation' : 'Dictate a prompt'}
              onClick={() => (dictation.recording ? dictation.stop() : dictation.start())}
              disabled={disabled || dictation.transcribing}
              className={cn(dictation.recording && 'bg-negative/10 text-negative')}
            >
              {dictation.transcribing ? (
                <Spinner className="size-3.5" />
              ) : (
                <Mic className="size-3.5" />
              )}
            </IconButton>
          ) : null}
          <button
            type="button"
            aria-pressed={withChart}
            title="Attach the active chart to every message"
            onClick={() => setWithChart((value) => !value)}
            className={cn(
              'inline-flex shrink-0 items-center gap-1 rounded border px-1.5 py-0.5 text-[10px]',
              withChart
                ? 'border-primary/40 bg-primary-soft text-primary'
                : 'border-border text-muted-foreground',
            )}
          >
            <ImageIcon className="size-3" />
            Chart
          </button>
          <span className="truncate text-[10px] text-muted-foreground">{contextLabel}</span>
          <div className="ml-auto flex items-center gap-1.5">
            {busy ? (
              <Button size="sm" variant="ghost" onClick={chat.stop} type="button">
                <Square className="size-3" />
                Stop
              </Button>
            ) : null}
            <Button
              size="sm"
              variant="primary"
              type="submit"
              disabled={busy || disabled || (!draft.trim() && pending.length === 0)}
            >
              <ArrowUp className="size-3" />
              Send
            </Button>
          </div>
        </div>
      </form>
        </div>
        </div>
      )}

      <div
        role="separator"
        aria-orientation="vertical"
        onPointerDown={startResize}
        className="absolute inset-y-0 -right-1 z-10 w-2 cursor-col-resize hover:bg-primary/20"
      />
    </aside>
  );
}
