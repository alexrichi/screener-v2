import { useEffect, useState } from 'react';
import { AlertTriangle, Check, ChevronDown, Loader2 } from 'lucide-react';
import { getToolName, isToolUIPart, type UIMessage } from 'ai';
import { toolView } from '../lib/ai/toolView';
import { cn } from '../ui/cn';

function StatusIcon({ status }: { status: 'running' | 'ok' | 'error' }) {
  if (status === 'running') return <Loader2 className="size-3 shrink-0 animate-spin" />;
  if (status === 'error') return <AlertTriangle className="size-3 shrink-0 text-negative" />;
  return <Check className="size-3 shrink-0 text-muted-foreground" />;
}

/** Human-readable, collapsible tool call. Never dumps raw JSON on the user. */
export function AiToolCard({ part }: { part: UIMessage['parts'][number] }) {
  if (!isToolUIPart(part)) return null;
  const raw = part as unknown as {
    state: string;
    input?: unknown;
    output?: unknown;
    errorText?: string;
  };
  const view = toolView({
    name: getToolName(part),
    state: raw.state,
    input: raw.input,
    output: raw.output,
    errorText: raw.errorText,
  });
  const [open, setOpen] = useState(view.defaultOpen);

  // A call that fails after streaming should reveal its error immediately.
  useEffect(() => {
    if (view.defaultOpen) setOpen(true);
  }, [view.defaultOpen]);

  const expandable = view.sections.length > 0;
  return (
    <div
      className={cn(
        'rounded-md border bg-background/60 text-[11px]',
        view.status === 'error' ? 'border-negative/40' : 'border-border',
      )}
    >
      <button
        type="button"
        onClick={() => expandable && setOpen((value) => !value)}
        aria-expanded={expandable ? open : undefined}
        className={cn(
          'flex w-full items-center gap-1.5 px-2 py-1.5 text-left',
          expandable && 'hover:bg-accent/40',
        )}
      >
        <StatusIcon status={view.status} />
        <span className="shrink-0 font-medium text-foreground/80">{view.title}</span>
        <span className="min-w-0 flex-1 truncate text-muted-foreground">{view.summary}</span>
        {expandable ? (
          <ChevronDown
            className={cn(
              'size-3 shrink-0 text-muted-foreground transition-transform',
              open && 'rotate-180',
            )}
          />
        ) : null}
      </button>
      {open && expandable ? (
        <div className="space-y-2 border-t border-border/70 px-2 py-1.5">
          {view.sections.map((entry) => (
            <div key={entry.label}>
              <div className="mb-0.5 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground/80">
                {entry.label}
              </div>
              <pre
                className={cn(
                  'max-h-60 overflow-auto whitespace-pre-wrap break-words text-[10.5px] leading-relaxed text-foreground/85',
                  entry.mono && 'font-mono',
                )}
              >
                {entry.text}
              </pre>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
