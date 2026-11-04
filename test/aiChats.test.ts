import { describe, expect, it } from 'vitest';
import type { ThreadMessage, ThreadMessageLike } from '@assistant-ui/react';
import {
  DEFAULT_UI_CHAT_TITLE,
  applyGeneratedTitle,
  createUiChat,
  deleteUiChat,
  emptyUiChat,
  firstAssistantText,
  firstUserText,
  groupUiChats,
  initialUiChats,
  isUiChats,
  migrateLegacyUiChats,
  renameUiChat,
  sanitizeGeneratedTitle,
  saveUiChatMessages,
  storableUiMessages,
} from '../src/lib/ai/uiChats';

const user = (text: string, id = 'u1'): ThreadMessageLike => ({
  id,
  role: 'user',
  content: [{ type: 'text', text }],
});

const assistant = (text: string, id = 'a1'): ThreadMessageLike => ({
  id,
  role: 'assistant',
  content: [{ type: 'text', text }],
});

describe('ui chats', () => {
  it('reads the first user and assistant text from parts', () => {
    expect(firstUserText([assistant('a'), user('  Привет   мир '), user('second')])).toBe(
      'Привет мир',
    );
    expect(firstAssistantText([user('q'), assistant('Ответ')])).toBe('Ответ');
    expect(firstUserText([assistant('a')])).toBe('');
  });

  it('saves messages and uses the first prompt as the fallback title', () => {
    const context = 'BTCUSDT · 1h';
    const state = initialUiChats(context);
    const id = state.activeId;
    const saved = saveUiChatMessages(state, id, [user('Проверь индикатор')], context);
    const session = saved.sessions[0];
    expect(session.messages).toHaveLength(1);
    expect(session.title).toBe('Проверь индикатор');
    expect(session.context).toBe(context);
    expect(session.titleGenerated).toBe(false);

    const done = saveUiChatMessages(saved, id, [user('Проверь индикатор'), assistant('Ок')], context);
    expect(done.sessions[0].messages).toHaveLength(2);
    expect(done.sessions[0].title).toBe('Проверь индикатор');
  });

  it('applies a generated title once and never overwrites a manual rename', () => {
    let state = initialUiChats('BTCUSDT · 1h');
    const id = state.activeId;
    state = saveUiChatMessages(state, id, [user('q'), assistant('a')], state.sessions[0].context);
    state = applyGeneratedTitle(state, id, '«Проверка индикатора».');
    expect(state.sessions[0].title).toBe('Проверка индикатора');
    expect(state.sessions[0].titleGenerated).toBe(true);

    state = renameUiChat(state, id, 'Своё имя');
    state = applyGeneratedTitle(state, id, 'Другое имя');
    expect(state.sessions[0].title).toBe('Своё имя');
    expect(state.sessions[0].titleSource).toBe('user');
  });

  it('does not create a second empty chat', () => {
    const state = initialUiChats('BTCUSDT · 1h');
    expect(createUiChat(state, 'ETHUSDT · 15m')).toBe(state);

    const id = state.activeId;
    const saved = saveUiChatMessages(state, id, [user('q'), assistant('a')], 'BTCUSDT · 1h');
    const next = createUiChat(saved, 'ETHUSDT · 15m');
    expect(next.sessions).toHaveLength(2);
    expect(next.sessions[0].messages).toHaveLength(0);
    expect(next.sessions[0].context).toBe('ETHUSDT · 15m');
  });

  it('selects the newest remaining chat when the active one is deleted', () => {
    let state = initialUiChats('BTCUSDT · 1h');
    const oldId = state.activeId;
    state = saveUiChatMessages(state, oldId, [user('old')], 'BTCUSDT · 1h');
    state = createUiChat(state, 'ETHUSDT · 15m');
    const newId = state.activeId;
    state = saveUiChatMessages(state, newId, [user('new')], 'ETHUSDT · 15m');

    const deleted = deleteUiChat(state, newId, 'ETHUSDT · 15m');
    expect(deleted.sessions).toHaveLength(1);
    expect(deleted.activeId).toBe(oldId);

    const empty = deleteUiChat(deleted, oldId, 'ETHUSDT · 15m');
    expect(empty.sessions).toHaveLength(1);
    expect(empty.activeId).not.toBe(oldId);
    expect(empty.sessions[0].messages).toHaveLength(0);
  });

  it('groups by relative date and skips empty chats', () => {
    const now = new Date(2026, 10, 3, 12, 0, 0).getTime();
    const day = 86_400_000;
    const make = (id: string, updatedAt: number) => ({
      ...emptyUiChat('BTCUSDT · 1h'),
      id,
      updatedAt,
      messages: [user('q', `u-${id}`)],
    });
    const groups = groupUiChats(
      [
        make('today', now),
        make('yesterday', now - day),
        make('week', now - 3 * day),
        make('older', now - 10 * day),
        { ...emptyUiChat('BTCUSDT · 1h'), id: 'empty', updatedAt: now },
      ],
      now,
    );
    expect(groups.map((group) => group.label)).toEqual([
      'Today',
      'Yesterday',
      'Last week',
      'Older',
    ]);
    expect(groups.flatMap((group) => group.sessions.map((s) => s.id))).toEqual([
      'today',
      'yesterday',
      'week',
      'older',
    ]);
  });

  it('migrates the old single transcript', () => {
    const migrated = migrateLegacyUiChats([user('Старый чат'), assistant('Ответ')], 'BTCUSDT · 1h');
    expect(migrated?.version).toBe(2);
    expect(migrated?.sessions).toHaveLength(1);
    expect(migrated?.sessions[0].title).toBe('Старый чат');
    expect(migrated?.sessions[0].context).toBe('BTCUSDT · 1h');
    expect(migrated?.sessions[0].titleGenerated).toBe(true);
    expect(migrated?.activeId).toBe(migrated?.sessions[0].id);
    expect(migrateLegacyUiChats([], 'BTCUSDT · 1h')).toBeNull();
    expect(migrateLegacyUiChats('nope', 'BTCUSDT · 1h')).toBeNull();
  });

  it('strips quotes and a trailing period from a generated title', () => {
    expect(sanitizeGeneratedTitle('«Проверка индикатора».')).toBe('Проверка индикатора');
    expect(sanitizeGeneratedTitle('Title: BTC repaint.')).toBe('BTC repaint');
    expect(sanitizeGeneratedTitle('   ')).toBe('');
  });

  it('drops images and folds text attachments before storage', () => {
    const message = {
      id: 'u1',
      role: 'user',
      content: [
        { type: 'text', text: 'hi' },
        { type: 'image', image: 'data:image/png;base64,xxx' },
      ],
      attachments: [
        {
          content: [
            { type: 'text', text: '--- attached file: notes.pine ---' },
            { type: 'image', image: 'data:image/png;base64,yyy' },
          ],
        },
      ],
    } as unknown as ThreadMessage;
    const stored = storableUiMessages([message]);
    expect(stored).toHaveLength(1);
    const parts = stored[0].content;
    expect(Array.isArray(parts) && parts.every((part) => part.type === 'text')).toBe(true);
    expect(JSON.stringify(stored)).toContain('attached file');
    expect(JSON.stringify(stored)).not.toContain('data:image');
    expect(stored[0].createdAt).toBeUndefined();
  });

  it('validates the store and its active id', () => {
    const state = initialUiChats('BTCUSDT · 1h');
    state.sessions[0].title = DEFAULT_UI_CHAT_TITLE;
    expect(isUiChats(state)).toBe(true);
    expect(isUiChats({ ...state, activeId: 'missing' })).toBe(false);
    expect(isUiChats({ ...state, sessions: [] })).toBe(false);
  });
});
