import type { ThreadMessage, ThreadMessageLike } from '@assistant-ui/react';

export const UI_CHATS_KEY = 'screener.ai.aui.v2';
export const UI_CHATS_LEGACY_KEY = 'screener.ai.aui.v1';
export const MAX_UI_CHATS = 50;
export const MAX_UI_MESSAGES = 200;
export const DEFAULT_UI_CHAT_TITLE = 'Chat';

export interface UiChatSession {
  id: string;
  title: string;
  /** `user` freezes a manual rename; `auto` lets the title generator run once. */
  titleSource: 'auto' | 'user';
  /** Set once a generated title was applied or the generation attempt failed. */
  titleGenerated: boolean;
  /** Chart context captured when the first message is saved. */
  context: string;
  createdAt: number;
  updatedAt: number;
  messages: ThreadMessageLike[];
}

export interface UiChats {
  version: 2;
  sessions: UiChatSession[];
  activeId: string;
}

export type ChatGroupLabel = 'Today' | 'Yesterday' | 'Last week' | 'Older';

export interface ChatGroup {
  label: ChatGroupLabel;
  sessions: UiChatSession[];
}

function messageText(message: ThreadMessageLike): string {
  if (typeof message.content === 'string') return message.content;
  // The first text part is the typed prompt; later parts are folded attachments.
  const text = message.content.find((part) => part.type === 'text');
  return text?.type === 'text' ? text.text : '';
}

/** The first user prompt, collapsed to one line; the fallback chat title. */
export function firstUserText(messages: readonly ThreadMessageLike[]): string {
  for (const message of messages) {
    if (message.role !== 'user') continue;
    const text = messageText(message).replace(/\s+/g, ' ').trim();
    if (text) return text;
  }
  return '';
}

export function firstAssistantText(messages: readonly ThreadMessageLike[]): string {
  for (const message of messages) {
    if (message.role !== 'assistant') continue;
    const text = messageText(message).replace(/\s+/g, ' ').trim();
    if (text) return text;
  }
  return '';
}

export function hasUserMessage(messages: readonly ThreadMessageLike[]): boolean {
  return messages.some((message) => message.role === 'user');
}

export function hasAssistantMessage(messages: readonly ThreadMessageLike[]): boolean {
  return messages.some((message) => message.role === 'assistant');
}

export function sanitizeGeneratedTitle(value: string): string {
  return value
    .replace(/^title\s*[:—-]\s*/i, '')
    .replace(/^[\s"'«»]+|[\s"'«».]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}

export function emptyUiChat(context: string): UiChatSession {
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    title: DEFAULT_UI_CHAT_TITLE,
    titleSource: 'auto',
    titleGenerated: false,
    context,
    createdAt: now,
    updatedAt: now,
    messages: [],
  };
}

export function initialUiChats(context: string): UiChats {
  const session = emptyUiChat(context);
  return { version: 2, sessions: [session], activeId: session.id };
}

function isMessage(value: unknown): value is ThreadMessageLike {
  const message = value as { role?: unknown; content?: unknown };
  if (message?.role !== 'user' && message?.role !== 'assistant' && message?.role !== 'system') {
    return false;
  }
  if (typeof message.content === 'string') return true;
  if (!Array.isArray(message.content)) return false;
  return message.content.every(
    (part) =>
      typeof part === 'object' &&
      part !== null &&
      typeof (part as { type?: unknown }).type === 'string',
  );
}

function isSession(value: unknown): value is UiChatSession {
  const session = value as Partial<UiChatSession>;
  return (
    typeof session?.id === 'string' &&
    typeof session.title === 'string' &&
    (session.titleSource === 'auto' || session.titleSource === 'user') &&
    typeof session.titleGenerated === 'boolean' &&
    typeof session.context === 'string' &&
    typeof session.createdAt === 'number' &&
    typeof session.updatedAt === 'number' &&
    Array.isArray(session.messages) &&
    session.messages.every(isMessage)
  );
}

export function isUiChats(value: unknown): value is UiChats {
  const state = value as Partial<UiChats>;
  return (
    state?.version === 2 &&
    typeof state.activeId === 'string' &&
    Array.isArray(state.sessions) &&
    state.sessions.length > 0 &&
    state.sessions.every(isSession) &&
    state.sessions.some((session) => session.id === state.activeId)
  );
}

/** Fold text attachments into content and drop images, which localStorage cannot hold. */
export function storableUiMessages(messages: readonly ThreadMessage[]): ThreadMessageLike[] {
  return messages.slice(-MAX_UI_MESSAGES).flatMap((message) => {
    if (message.role !== 'user' && message.role !== 'assistant') return [];
    const content = [
      ...message.content.filter((part) => part.type !== 'image'),
      ...(message.attachments ?? []).flatMap((attachment) =>
        attachment.content.filter((part) => part.type === 'text'),
      ),
    ];
    return [
      {
        role: message.role,
        id: message.id,
        status: message.status,
        content,
      } as ThreadMessageLike,
    ];
  });
}

function sameMessages(a: readonly ThreadMessageLike[], b: readonly ThreadMessageLike[]): boolean {
  return a.length === b.length && JSON.stringify(a) === JSON.stringify(b);
}

export function createUiChat(state: UiChats, context: string): UiChats {
  const active = state.sessions.find((session) => session.id === state.activeId);
  if (active && active.messages.length === 0) return state;
  const session = emptyUiChat(context);
  return {
    version: 2,
    sessions: [session, ...state.sessions].slice(0, MAX_UI_CHATS),
    activeId: session.id,
  };
}

export function selectUiChat(state: UiChats, id: string): UiChats {
  if (!state.sessions.some((session) => session.id === id)) return state;
  return { ...state, activeId: id };
}

export function deleteUiChat(state: UiChats, id: string, context: string): UiChats {
  const sessions = state.sessions.filter((session) => session.id !== id);
  if (sessions.length === 0) return initialUiChats(context);
  if (state.activeId !== id) return { ...state, sessions };
  const next = [...sessions].sort((a, b) => b.updatedAt - a.updatedAt)[0];
  return { ...state, sessions, activeId: next.id };
}

export function renameUiChat(state: UiChats, id: string, title: string): UiChats {
  const trimmed = title.replace(/\s+/g, ' ').trim().slice(0, 80);
  if (!trimmed) return state;
  return {
    ...state,
    sessions: state.sessions.map((session) =>
      session.id === id
        ? { ...session, title: trimmed, titleSource: 'user', titleGenerated: true }
        : session,
    ),
  };
}

/** Save a finished run; the first prompt supplies the fallback title and context. */
export function saveUiChatMessages(
  state: UiChats,
  id: string,
  messages: ThreadMessageLike[],
  context: string,
): UiChats {
  const session = state.sessions.find((entry) => entry.id === id);
  if (!session) return state;
  const clean = messages.slice(-MAX_UI_MESSAGES);
  if (sameMessages(session.messages, clean)) return state;
  const firstUser = clean.find((message) => message.role === 'user');
  const hadUser = hasUserMessage(session.messages);
  const title =
    session.titleSource === 'auto' &&
    session.title === DEFAULT_UI_CHAT_TITLE &&
    firstUser
      ? firstUserText(clean).slice(0, 48) || DEFAULT_UI_CHAT_TITLE
      : session.title;
  const nextContext = !hadUser && firstUser ? context : session.context;
  return {
    ...state,
    sessions: state.sessions.map((entry) =>
      entry.id === id
        ? {
            ...entry,
            messages: clean,
            title,
            context: nextContext,
            updatedAt: Date.now(),
          }
        : entry,
    ),
  };
}

export function applyGeneratedTitle(state: UiChats, id: string, title: string): UiChats {
  const clean = sanitizeGeneratedTitle(title);
  if (!clean) return state;
  return {
    ...state,
    sessions: state.sessions.map((session) =>
      session.id === id && session.titleSource === 'auto'
        ? { ...session, title: clean, titleGenerated: true }
        : session,
    ),
  };
}

export function markTitleAttempted(state: UiChats, id: string): UiChats {
  return {
    ...state,
    sessions: state.sessions.map((session) =>
      session.id === id && session.titleSource === 'auto' && !session.titleGenerated
        ? { ...session, titleGenerated: true }
        : session,
    ),
  };
}

function startOfDay(at: number): number {
  const date = new Date(at);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

export function groupUiChats(sessions: readonly UiChatSession[], now = Date.now()): ChatGroup[] {
  const today = startOfDay(now);
  const yesterday = startOfDay(today - 86_400_000);
  const week = startOfDay(today - 7 * 86_400_000);
  const groups: ChatGroup[] = [
    { label: 'Today', sessions: [] },
    { label: 'Yesterday', sessions: [] },
    { label: 'Last week', sessions: [] },
    { label: 'Older', sessions: [] },
  ];
  for (const session of [...sessions].sort((a, b) => b.updatedAt - a.updatedAt)) {
    if (session.messages.length === 0) continue;
    if (session.updatedAt >= today) groups[0].sessions.push(session);
    else if (session.updatedAt >= yesterday) groups[1].sessions.push(session);
    else if (session.updatedAt >= week) groups[2].sessions.push(session);
    else groups[3].sessions.push(session);
  }
  return groups.filter((group) => group.sessions.length > 0);
}

export function searchUiChats(
  sessions: readonly UiChatSession[],
  query: string,
): UiChatSession[] {
  const needle = query.replace(/\s+/g, ' ').trim().toLowerCase();
  if (!needle) return [...sessions];
  return sessions.filter(
    (session) =>
      session.title.toLowerCase().includes(needle) ||
      session.context.toLowerCase().includes(needle),
  );
}

/** Fold the old single-transcript key into one chat when v2 does not exist yet. */
export function migrateLegacyUiChats(raw: unknown, context: string): UiChats | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const messages = raw.filter(isMessage).slice(-MAX_UI_MESSAGES);
  if (messages.length === 0) return null;
  const now = Date.now();
  const session: UiChatSession = {
    id: crypto.randomUUID(),
    title: firstUserText(messages).slice(0, 48) || DEFAULT_UI_CHAT_TITLE,
    titleSource: 'auto',
    titleGenerated: true,
    context,
    createdAt: now,
    updatedAt: now,
    messages,
  };
  return { version: 2, sessions: [session], activeId: session.id };
}

export function loadInitialUiChats(context: string): UiChats {
  try {
    const raw = localStorage.getItem(UI_CHATS_LEGACY_KEY);
    if (raw) {
      const migrated = migrateLegacyUiChats(JSON.parse(raw), context);
      if (migrated) return migrated;
    }
  } catch {
    /* invalid legacy payload: start a fresh chat */
  }
  return initialUiChats(context);
}
