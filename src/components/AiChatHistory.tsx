import { useMemo, useState } from 'react';
import { Popover } from '@base-ui/react';
import { MoreHorizontal, Pencil, Search, SquarePen, Trash2 } from 'lucide-react';
import type { UiChatSession } from '../lib/ai/uiChats';
import { groupUiChats, searchUiChats } from '../lib/ai/uiChats';
import { PopoverContent } from '../ui/overlays';
import { IconButton } from '../ui/primitives';
import { cn } from '../ui/cn';

interface Props {
  sessions: UiChatSession[];
  activeId: string;
  onNewChat: () => void;
  onSelect: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
}

interface RowProps {
  session: UiChatSession;
  active: boolean;
  onSelect: () => void;
  onRename: (title: string) => void;
  onDelete: () => void;
}

function ChatRow({ session, active, onSelect, onRename, onDelete }: RowProps) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(session.title);
  const [menuOpen, setMenuOpen] = useState(false);

  const cancel = () => {
    setValue(session.title);
    setEditing(false);
  };
  const commit = () => {
    const next = value.replace(/\s+/g, ' ').trim();
    if (next && next !== session.title) onRename(next);
    setEditing(false);
  };

  return (
    <li className="group/chat-row relative">
      {editing ? (
        <div className="flex w-full items-center rounded-[10px] bg-secondary px-2.5 py-[7px]">
          <input
            autoFocus
            aria-label="Chat name"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            onBlur={commit}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                commit();
              } else if (event.key === 'Escape') {
                event.preventDefault();
                cancel();
              }
            }}
            className="h-6 w-full rounded-md border border-ring/50 bg-background px-1 text-[13.5px] text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
          />
        </div>
      ) : (
        <button
          type="button"
          onClick={onSelect}
          className={cn(
            'flex w-full min-w-0 flex-col gap-0.5 rounded-[10px] px-2.5 py-[7px] text-start text-[13.5px] leading-5 transition-colors',
            active ? 'bg-secondary' : 'hover:bg-accent/40',
          )}
        >
          <span className="truncate text-foreground">{session.title}</span>
          <span className="truncate text-[11px] text-muted-foreground">{session.context}</span>
        </button>
      )}

      {editing ? null : (
        <div className="absolute end-1.5 top-1/2 flex -translate-y-1/2 items-center gap-px rounded-lg bg-popover p-0.5 opacity-0 shadow-sm ring-1 ring-foreground/10 transition-opacity group-hover/chat-row:opacity-100 group-focus-within/chat-row:opacity-100">
          <IconButton
            label={`Rename ${session.title}`}
            className="size-[26px] rounded-[6px]"
            onClick={() => {
              setValue(session.title);
              setEditing(true);
            }}
          >
            <Pencil className="size-3" />
          </IconButton>
          <Popover.Root open={menuOpen} onOpenChange={setMenuOpen}>
            <Popover.Trigger
              title={`Chat actions for ${session.title}`}
              aria-label={`Chat actions for ${session.title}`}
              className="inline-flex size-[26px] items-center justify-center rounded-[6px] text-muted-foreground outline-none hover:bg-accent hover:text-foreground"
            >
              <MoreHorizontal className="size-3.5" />
            </Popover.Trigger>
            <PopoverContent className="w-48 p-1" align="end">
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  onDelete();
                }}
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[12px] text-negative hover:bg-negative/10"
              >
                <Trash2 className="size-3.5" />
                Delete
              </button>
            </PopoverContent>
          </Popover.Root>
        </div>
      )}
    </li>
  );
}

/** Quant-style history: search, new chat, relative-date groups, inline rename. */
export function AiChatHistory({
  sessions,
  activeId,
  onNewChat,
  onSelect,
  onRename,
  onDelete,
}: Props) {
  const [query, setQuery] = useState('');
  const visible = useMemo(
    () => sessions.filter((session) => session.messages.length > 0),
    [sessions],
  );
  const matches = useMemo(() => searchUiChats(visible, query), [query, visible]);
  const groups = useMemo(() => groupUiChats(matches), [matches]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 p-2 pb-1">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            aria-label="Search chats"
            placeholder="Search chats…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="w-full rounded-[7px] border border-input bg-transparent py-1 pl-8 pr-3 text-[13px] leading-5 text-foreground outline-none placeholder:text-muted-foreground focus-visible:border-ring"
          />
        </div>
      </div>
      <div className="shrink-0 px-1.5 pb-1">
        <button
          type="button"
          onClick={onNewChat}
          className="flex w-full items-center gap-1.5 rounded-lg px-2 py-2 text-[13px] text-foreground/85 hover:bg-accent/50"
        >
          <SquarePen className="size-3.5 text-muted-foreground" />
          New chat
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-1.5">
        {groups.length === 0 ? (
          <div className="flex flex-col items-center gap-1 px-6 py-10 text-center">
            <p className="text-[13px] font-medium text-foreground/85">
              {visible.length === 0 ? 'No chats yet' : 'No chats match'}
            </p>
            <p className="max-w-60 text-[12px] leading-relaxed text-muted-foreground">
              {visible.length === 0
                ? 'Your chats will show up here.'
                : 'Try another search term.'}
            </p>
          </div>
        ) : (
          groups.map((group) => (
            <div key={group.label}>
              <div className="sticky top-0 z-10 bg-card/95 px-2.5 pb-1.5 pt-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/70 backdrop-blur">
                {group.label}
              </div>
              <ul className="flex flex-col gap-0.5">
                {group.sessions.map((session) => (
                  <ChatRow
                    key={session.id}
                    session={session}
                    active={session.id === activeId}
                    onSelect={() => onSelect(session.id)}
                    onRename={(title) => onRename(session.id, title)}
                    onDelete={() => onDelete(session.id)}
                  />
                ))}
              </ul>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
