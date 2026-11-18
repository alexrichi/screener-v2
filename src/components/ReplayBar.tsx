import { useEffect, useRef, useState } from 'react';
import type { ReplayState } from '@luxalgo/vela';
import type { VelaWorkspace } from '@luxalgo/vela/workspace';
import { Pause, Play, Rewind, SkipForward, X } from 'lucide-react';
import { Button, IconButton, Input, Select } from '../ui/primitives';

const WEEK = 7 * 24 * 60 * 60 * 1000;
const SPEEDS = [250, 500, 1000, 2000, 5000];

type Mode = 'picking' | 'ready' | 'active';

interface Props {
  open: boolean;
  tabId: string;
  getWorkspace: () => VelaWorkspace | null;
  onClose: () => void;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/** Local `datetime-local` value for an epoch. */
function inputValue(epoch: number): string {
  if (!epoch) return '';
  const date = new Date(epoch);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

function epochFromInput(value: string): number {
  if (!value) return 0;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}

function formatCursor(epoch: number | null): string {
  if (!epoch) return '—';
  return new Date(epoch).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * The bar-replay control bar. Vela owns the replay itself (`workspace.replay`);
 * this only picks a start, drives play/pause/step/stop, and shows the cursor.
 */
export function ReplayBar({ open, tabId, getWorkspace, onClose }: Props) {
  const workspaceRef = useRef<VelaWorkspace | null>(null);
  const closeRef = useRef(onClose);
  const [mode, setMode] = useState<Mode>('picking');
  const [from, setFrom] = useState(0);
  const [bounds, setBounds] = useState<{ first: number; last: number } | null>(null);
  const [status, setStatus] = useState<ReplayState | null>(null);
  const [speed, setSpeed] = useState(1000);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    const workspace = getWorkspace();
    workspaceRef.current = workspace;
    setMode('picking');
    setStatus(workspace?.replay.state ?? null);
    setError(null);
    if (!workspace) {
      setBounds(null);
      return;
    }
    try {
      const next = workspace.replay.bounds;
      setBounds(next);
      if (next) {
        setFrom(clamp(next.last - WEEK, next.first, next.last));
      }
    } catch {
      setBounds(null);
    }
  }, [open, tabId, getWorkspace]);

  useEffect(() => {
    if (!open) return;
    const workspace = workspaceRef.current;
    return () => {
      try {
        workspace?.replay.stop();
      } catch {
        // The workspace may already be destroyed with its tab.
      }
      try {
        workspace?.chart.renderer.set({ crosshairOverride: null, drawingsInteractive: true });
      } catch {
        // No active cell; nothing to restore.
      }
      if (workspaceRef.current === workspace) workspaceRef.current = null;
    };
  }, [open]);

  useEffect(() => {
    if (!open || mode !== 'picking') return;
    const workspace = workspaceRef.current;
    if (!workspace) return;

    let chart;
    try {
      chart = workspace.chart;
    } catch {
      return;
    }

    const offClick = chart.renderer.onClick(({ time }) => {
      if (time == null) return;
      setFrom(time);
      setMode('ready');
      setError(null);
    });

    try {
      chart.renderer.set({
        crosshairOverride: {
          horizontal: false,
          shadeRight: { color: 'rgba(0, 0, 0, 0.35)' },
        },
        drawingsInteractive: false,
      });
    } catch {
      // A renderer without the override still accepts the click.
    }

    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      closeRef.current();
    };
    window.addEventListener('keydown', onKey, true);

    return () => {
      offClick();
      window.removeEventListener('keydown', onKey, true);
      try {
        chart.renderer.set({ crosshairOverride: null, drawingsInteractive: true });
      } catch {
        // The chart was destroyed with its tab.
      }
    };
  }, [open, mode]);

  useEffect(() => {
    if (!open || mode !== 'active') return;
    const workspace = workspaceRef.current;
    if (!workspace) return;

    const update = () => setStatus(workspace.replay.state);
    update();
    const offs = [
      workspace.replay.on('replay:start', update),
      workspace.replay.on('replay:step', update),
      workspace.replay.on('replay:tick', update),
      workspace.replay.on('replay:play', update),
      workspace.replay.on('replay:pause', update),
    ];
    const offEnd = workspace.replay.on('replay:end', () => {
      setStatus(workspace.replay.state);
      setMode('ready');
    });

    return () => {
      for (const off of offs) off();
      offEnd();
    };
  }, [open, mode]);

  if (!open) return null;

  const workspace = workspaceRef.current;
  const active = mode === 'active';

  const start = async () => {
    if (!workspace) {
      setError('The chart is not ready yet.');
      return;
    }
    if (!from) {
      setError('Choose a start time or click a bar.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await workspace.replay.start({ from });
      const next = workspace.replay.state;
      setStatus(next);
      if (!next.active) {
        setError('No bars to replay after that time. Pick an earlier start.');
        return;
      }
      setMode('active');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not start the replay.');
    } finally {
      setBusy(false);
    }
  };

  const togglePlay = () => {
    if (!workspace) return;
    if (status?.playing) workspace.replay.pause();
    else workspace.replay.play(speed);
  };

  const step = () => {
    workspace?.replay.step();
  };

  const stop = () => {
    if (!workspace) return;
    workspace.replay.stop();
    setStatus(workspace.replay.state);
    setMode('ready');
  };

  const changeSpeed = (value: number) => {
    setSpeed(value);
    if (workspace && status?.playing) workspace.replay.play(value);
  };

  return (
    <div
      role="region"
      aria-label="Bar replay"
      className="fixed bottom-24 left-1/2 z-[70] w-[680px] max-w-[calc(100vw-32px)] -translate-x-1/2 rounded-xl border border-border bg-popover/95 shadow-2xl backdrop-blur"
    >
      <div className="flex flex-wrap items-center gap-2 px-3 py-2">
        <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          <Rewind className="size-3.5" />
          Replay
        </span>

        {active ? (
          <>
            <IconButton label={status?.playing ? 'Pause' : 'Play'} onClick={togglePlay}>
              {status?.playing ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
            </IconButton>
            <IconButton label="Step" onClick={step}>
              <SkipForward className="size-3.5" />
            </IconButton>
            <Select
              aria-label="Replay speed"
              value={String(speed)}
              onChange={(event) => changeSpeed(Number(event.target.value))}
              className="h-7 w-[76px] text-[11px]"
            >
              {SPEEDS.map((value) => (
                <option key={value} value={value}>
                  {value < 1000 ? `${value} ms` : `${value / 1000} s`}
                </option>
              ))}
            </Select>
            <Button variant="secondary" size="sm" onClick={stop}>
              Stop
            </Button>
            <span className="text-[11px] text-muted-foreground">
              {status?.cursorTime ? formatCursor(status.cursorTime) : 'Loading bars…'} ·{' '}
              {status?.remaining ?? 0} bars left
            </span>
          </>
        ) : (
          <>
            <Input
              type="datetime-local"
              aria-label="Replay start time"
              value={from ? inputValue(from) : ''}
              min={bounds ? inputValue(bounds.first) : undefined}
              max={bounds ? inputValue(bounds.last) : undefined}
              onChange={(event) => {
                const next = epochFromInput(event.target.value);
                setFrom(next);
                if (next) setMode('ready');
              }}
              className="h-7 w-[190px] text-[11px]"
            />
            <Button
              variant="primary"
              size="sm"
              onClick={() => void start()}
              loading={busy}
              disabled={!workspace || !from}
            >
              {mode === 'ready' ? 'Start replay' : 'Start'}
            </Button>
            <span className="text-[11px] text-muted-foreground">
              {mode === 'ready' ? formatCursor(from) : 'or click a bar on the chart'}
            </span>
          </>
        )}

        <IconButton label="Close replay" onClick={onClose} className="ml-auto">
          <X className="size-3.5" />
        </IconButton>
      </div>

      {!active ? (
        <div className="border-t border-border px-3 py-1.5 text-[10px] text-muted-foreground">
          Click a bar to choose where replay starts; Esc cancels. All charts rewind together.
        </div>
      ) : null}
      {error ? (
        <div className="border-t border-negative/30 px-3 py-1.5 text-[10px] text-negative">
          {error}
        </div>
      ) : null}
    </div>
  );
}
