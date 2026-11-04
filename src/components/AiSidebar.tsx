import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import type { ToolSet } from 'ai';
import { Image as ImageIcon, Mic } from 'lucide-react';
import { useAui, type ThreadMessage } from '@assistant-ui/react';
import { AiAgentPicker } from './AiAgentPicker';
import { AiChatHistory } from './AiChatHistory';
import { AiChatTabs } from './AiChatTabs';
import { AiModelPicker, AiReasoningPicker } from './AiModelPicker';
import { AssistantUiThread } from './AssistantUiThread';
import { ChainOfThoughtGroup } from './ChainOfThoughtGroup';
import { ToolActivityGroup } from './ToolActivityGroup';
import type { ThreadComponents } from './assistant-ui/elements/thread.aui';
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
import { useDictation } from '../hooks/useDictation';
import type { AiAgent, AiAgentId } from '../lib/ai/agents';
import { isAiReasoning, type AiReasoning } from '../lib/ai/model';
import { isString, usePersistedState } from '../lib/usePersistedState';
import { IconButton, Spinner } from '../ui/primitives';
import { cn } from '../ui/cn';

const MIN_WIDTH = 320;
const MAX_WIDTH = 720;

interface Props {
  width: number;
  tools: ToolSet;
  system: () => string;
  agents: AiAgent[];
  agent: AiAgent;
  onAgentChange: (id: AiAgentId) => void;
  /** Null until the sidecar answers; false keeps the settings hint reachable. */
  configured: boolean | null;
  model: string | null;
  /** Whisper-compatible model; the mic is hidden when null. */
  transcriptionModel: string | null;
  contextLabel: string;
  /** PNG data URL of the active chart, or null when it cannot be exported. */
  screenshot: () => string | null;
  onOpenSettings: () => void;
  onWidthChange: (width: number) => void;
  onClose: () => void;
}

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

export function AiSidebar({
  width,
  tools,
  system,
  agents,
  agent,
  onAgentChange,
  configured,
  model,
  transcriptionModel,
  contextLabel,
  screenshot,
  onOpenSettings,
  onWidthChange,
  onClose,
}: Props) {
  const [withChart, setWithChart] = useState(true);
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

  return (
    <aside
      className="relative flex h-full shrink-0 flex-col border-r border-border bg-card"
      style={{ width }}
      aria-label="AI"
    >
      <AiChatTabs
        title={activeUiChat.title}
        view={view}
        onShowChat={() => setView('chat')}
        onShowHistory={() => setView('history')}
        onNewChat={newUiChat}
        onOpenSettings={onOpenSettings}
        onClose={onClose}
      />

      <div className={cn('flex min-h-0 flex-1 flex-col', view !== 'chat' && 'hidden')}>
        {configured === false ? (
          <div className="shrink-0 border-b border-border px-3 py-2 text-[11px] leading-4 text-muted-foreground">
            AI is not configured. Add a base URL and model in{' '}
            <button
              type="button"
              onClick={onOpenSettings}
              className="underline underline-offset-2 hover:text-foreground"
            >
              AI settings
            </button>
            .
          </div>
        ) : null}
        <div className="min-h-0 flex-1 overflow-hidden">
          <AiComposerContext.Provider value={composerValue}>
            <AssistantUiThread
              key={activeUiChat.id}
              tools={tools}
              system={system}
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

      <div
        role="separator"
        aria-orientation="vertical"
        onPointerDown={startResize}
        className="absolute inset-y-0 -right-1 z-10 w-2 cursor-col-resize hover:bg-primary/20"
      />
    </aside>
  );
}
