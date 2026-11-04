import { useState } from 'react';
import { Popover } from '@base-ui/react';
import {
  MessagesSquare,
  MoreVertical,
  Plus,
  Settings,
  Sparkles,
  X,
} from 'lucide-react';
import { PopoverContent } from '../ui/overlays';
import { IconButton } from '../ui/primitives';
import { cn } from '../ui/cn';

interface Props {
  title: string;
  view: 'chat' | 'history';
  onShowChat: () => void;
  onShowHistory: () => void;
  onNewChat: () => void;
  onOpenSettings: () => void;
  onClose: () => void;
}

const tabClass = (active: boolean) =>
  cn(
    'flex h-7 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-md px-2 text-[13px] transition-colors',
    active
      ? 'bg-accent text-foreground'
      : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
  );

/** The Quant-style strip: the current chat and the history list. */
export function AiChatTabs({
  title,
  view,
  onShowChat,
  onShowHistory,
  onNewChat,
  onOpenSettings,
  onClose,
}: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const run = (action: () => void) => {
    setMenuOpen(false);
    action();
  };
  return (
    <header className="flex h-9 shrink-0 items-center gap-0.5 border-b border-border px-2">
      <div role="tablist" className="flex min-w-0 flex-1 items-center gap-0.5">
        <button
          type="button"
          role="tab"
          aria-selected={view === 'chat'}
          onClick={onShowChat}
          className={tabClass(view === 'chat')}
        >
          <Sparkles className="size-3.5 shrink-0" />
          <span className="truncate">{title || 'Chat'}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={view === 'history'}
          onClick={onShowHistory}
          className={tabClass(view === 'history')}
        >
          <MessagesSquare className="size-3.5 shrink-0" />
          <span className="truncate">All chats</span>
        </button>
      </div>
      <Popover.Root open={menuOpen} onOpenChange={setMenuOpen}>
        <Popover.Trigger
          title="Chat options"
          aria-label="Chat options"
          className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <MoreVertical className="size-3.5" />
        </Popover.Trigger>
        <PopoverContent className="w-48 p-1" align="end">
          <button
            type="button"
            onClick={() => run(onNewChat)}
            className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[12px] text-foreground/85 hover:bg-accent/60"
          >
            <Plus className="size-3.5 text-muted-foreground" />
            New chat
          </button>
          <button
            type="button"
            onClick={() => run(onOpenSettings)}
            className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[12px] text-foreground/85 hover:bg-accent/60"
          >
            <Settings className="size-3.5 text-muted-foreground" />
            AI settings
          </button>
        </PopoverContent>
      </Popover.Root>
      <IconButton label="Close AI" onClick={onClose}>
        <X className="size-3.5" />
      </IconButton>
    </header>
  );
}
