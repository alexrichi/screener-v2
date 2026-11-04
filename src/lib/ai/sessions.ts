import type { UIMessage } from 'ai';

export const AI_SESSIONS_KEY = 'screener.ai.sessions.v1';
export const MAX_SESSIONS = 30;
export const MAX_MESSAGES = 200;
const DEFAULT_TITLE = 'New chat';

export interface AiSession {
  id: string;
  /** Auto-titled from the first user message until the user renames it. */
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: UIMessage[];
}

export interface AiSessions {
  version: 1;
  sessions: AiSession[];
  activeId: string;
}

function isMessage(value: unknown): boolean {
  const message = value as { id?: unknown; role?: unknown; parts?: unknown };
  return (
    typeof message?.id === 'string' &&
    (message.role === 'user' || message.role === 'assistant') &&
    Array.isArray(message.parts) &&
    message.parts.every(
      (part) =>
        typeof part === 'object' && part !== null && typeof (part as { type?: unknown }).type === 'string',
    )
  );
}

function isSession(value: unknown): value is AiSession {
  const session = value as Partial<AiSession>;
  return (
    typeof session?.id === 'string' &&
    typeof session.title === 'string' &&
    typeof session.createdAt === 'number' &&
    typeof session.updatedAt === 'number' &&
    Array.isArray(session.messages) &&
    session.messages.every(isMessage)
  );
}

export function isAiSessions(value: unknown): value is AiSessions {
  const state = value as Partial<AiSessions>;
  return (
    state?.version === 1 &&
    typeof state.activeId === 'string' &&
    Array.isArray(state.sessions) &&
    state.sessions.every(isSession)
  );
}

export function emptySession(): AiSession {
  const now = Date.now();
  return { id: crypto.randomUUID(), title: DEFAULT_TITLE, createdAt: now, updatedAt: now, messages: [] };
}

export function initialAiSessions(): AiSessions {
  const session = emptySession();
  return { version: 1, sessions: [session], activeId: session.id };
}

/** Images would blow the localStorage quota and are per-turn context anyway. */
export function stripFiles(messages: UIMessage[]): UIMessage[] {
  return messages.map((message) => ({
    ...message,
    parts: message.parts.filter((part) => part.type !== 'file'),
  }));
}

export function sessionTitle(messages: UIMessage[]): string {
  for (const message of messages) {
    if (message.role !== 'user') continue;
    const text = message.parts.find((part) => part.type === 'text');
    const cleaned = text && text.type === 'text' ? text.text.replace(/\s+/g, ' ').trim() : '';
    if (cleaned) return cleaned.slice(0, 48);
  }
  return DEFAULT_TITLE;
}

export function createSession(state: AiSessions): AiSessions {
  const session = emptySession();
  return {
    version: 1,
    sessions: [session, ...state.sessions].slice(0, MAX_SESSIONS),
    activeId: session.id,
  };
}

export function selectSession(state: AiSessions, id: string): AiSessions {
  if (!state.sessions.some((session) => session.id === id)) return state;
  return { ...state, activeId: id };
}

export function deleteSession(state: AiSessions, id: string): AiSessions {
  const sessions = state.sessions.filter((session) => session.id !== id);
  if (sessions.length === 0) return createSession({ ...state, sessions: [] });
  const activeId = state.activeId === id ? sessions[0].id : state.activeId;
  return { ...state, sessions, activeId };
}

export function renameSession(state: AiSessions, id: string, title: string): AiSessions {
  const trimmed = title.trim().slice(0, 80);
  if (!trimmed) return state;
  return {
    ...state,
    sessions: state.sessions.map((session) =>
      session.id === id ? { ...session, title: trimmed, updatedAt: Date.now() } : session,
    ),
  };
}

/** Save a finished turn; the title follows the first user message. */
export function saveMessages(
  state: AiSessions,
  id: string,
  messages: UIMessage[],
): AiSessions {
  const clean = stripFiles(messages).slice(-MAX_MESSAGES);
  const now = Date.now();
  return {
    ...state,
    sessions: state.sessions.map((session) =>
      session.id === id
        ? {
            ...session,
            messages: clean,
            title: session.title === DEFAULT_TITLE ? sessionTitle(clean) : session.title,
            updatedAt: now,
          }
        : session,
    ),
  };
}
