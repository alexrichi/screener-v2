import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import type { ReplayState } from '@luxalgo/vela';
import type { VelaWorkspace } from '@luxalgo/vela/workspace';
import { createDatePicker, isoDate } from '@luxalgo/vela-ui/date-picker';
import { Calendar, GripVertical, Pause, Play, Rewind, SkipForward, X } from 'lucide-react';
import { timeframeMs } from '../lib/timeframe';
import { Button, IconButton, Input, Select } from '../ui/primitives';

const HISTORY_MAX = 100_000;
const SPEEDS = [0.1, 0.25, 0.5, 1, 2, 3, 5, 10] as const;

type Mode = 'picking' | 'ready' | 'active';

interface Props {
  open: boolean;
  tabId: string;
  getWorkspace: () => VelaWorkspace | null;
  onClose: () => void;
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

/** Vela's replay timer takes milliseconds per bar; the UI shows a speed multiplier. */
function intervalFor(speed: number): number {
  return Math.max(16, Math.round(1000 / speed));
}

/**
 * Replay only walks loaded history. When the picked date is older than a cell's
 * loaded bars, deepen every cell that shares the reference cell's symbol, before
 * the workspace replay starts. Vela's own depth extension is off during replay.
 */
async function ensureReplayHistory(
  workspace: VelaWorkspace,
  from: number,
  cellId: string | null,
): Promise<void> {
  let reference;
  try {
    reference = cellId
      ? (workspace.cells().find((cell) => cell.id === cellId) ?? workspace.active)
      : workspace.active;
  } catch {
    return;
  }
  if (!reference) return;
  const symbol = reference.symbol;
  const targets = workspace.cells().filter((cell) => cell.symbol === symbol);

  await Promise.all(
    targets.map(async (cell) => {
      try {
        const barMs = timeframeMs(cell.chart.market.timeframe ?? '15');
        if (!(barMs > 0)) return;
        const current = cell.chart.market.bars ?? 0;
        const first = cell.chart.replay.bounds?.first ?? null;
        const anchor = first ?? Date.now();
        if (first != null && from >= first - barMs * 8) return;
        const missing = anchor - from;
        if (!(missing > 0)) return;
        const needed = current + Math.ceil(missing / barMs) + 50;
        const target = Math.min(Math.max(current + 500, needed), HISTORY_MAX);
        if (target <= current) return;
        await cell.chart.setMarket({ bars: target });
        await cell.chart.historyComplete();
      } catch {
        // A cell that cannot deepen still lets the replay start with what it has.
      }
    }),
  );
}

/**
 * The bar-replay control bar. Vela owns the replay itself (`workspace.replay`);
 * this only picks a start, drives play/pause/step, and shows the cursor.
 */
export function ReplayBar({ open, tabId, getWorkspace, onClose }: Props) {
  const workspaceRef = useRef<VelaWorkspace | null>(null);
  const closeRef = useRef(onClose);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const calendarRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ dx: number; dy: number } | null>(null);
  const [mode, setMode] = useState<Mode>('picking');
  const [from, setFrom] = useState(0);
  const [pickCellId, setPickCellId] = useState<string | null>(null);
  const [status, setStatus] = useState<ReplayState | null>(null);
  const [speed, setSpeed] = useState(5);
  const [time, setTime] = useState('00:00');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dateOpen, setDateOpen] = useState(false);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const timeRef = useRef(time);
  timeRef.current = time;

  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const onMove = (event: MouseEvent) => {
      const drag = dragRef.current;
      const panel = panelRef.current;
      if (!drag || !panel) return;
      const rect = panel.getBoundingClientRect();
      const maxX = Math.max(8, window.innerWidth - rect.width - 8);
      const maxY = Math.max(8, window.innerHeight - rect.height - 8);
      setPos({
        x: Math.min(Math.max(8, event.clientX - drag.dx), maxX),
        y: Math.min(Math.max(8, event.clientY - drag.dy), maxY),
      });
    };
    const onUp = () => {
      dragRef.current = null;
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const workspace = getWorkspace();
    workspaceRef.current = workspace;
    setMode('picking');
    setStatus(workspace?.replay.state ?? null);
    setError(null);
    setDateOpen(false);
    setFrom(0);
    setPickCellId(null);
  }, [open, tabId, getWorkspace]);

  useEffect(() => {
    if (!dateOpen || mode === 'active') return;
    const host = calendarRef.current;
    if (!host) return;
    const selected = from ? new Date(from) : new Date();
    const picker = createDatePicker({
      value: isoDate(selected),
      onPick: (value) => {
        const [y, m, d] = value.split('-').map(Number);
        const [h, min] = (timeRef.current || '00:00').split(':').map(Number);
        const next = new Date(y!, m! - 1, d!, h ?? 0, min ?? 0).getTime();
        setFrom(next);
        setPickCellId(null);
        setMode('ready');
        setDateOpen(false);
      },
    });
    host.replaceChildren(picker.el);
    return () => {
      picker.destroy();
      host.replaceChildren();
    };
  }, [dateOpen, from, mode]);

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

    const entries = workspace.cells().map((cell) => ({ cell, chart: cell.chart }));
    const offs = entries.map(({ cell, chart }) =>
      chart.renderer.onClick(({ time }) => {
        if (time == null) return;
        setFrom(time);
        setPickCellId(cell.id);
        setMode('ready');
        setDateOpen(false);
        setError(null);
      }),
    );

    for (const { chart } of entries) {
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
    }

    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      closeRef.current();
    };
    window.addEventListener('keydown', onKey, true);

    return () => {
      for (const off of offs) off();
      window.removeEventListener('keydown', onKey, true);
      for (const { chart } of entries) {
        try {
          chart.renderer.set({ crosshairOverride: null, drawingsInteractive: true });
        } catch {
          // The chart was destroyed with its tab.
        }
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

  useEffect(() => {
    if (!open || mode !== 'active') return;
    document.body.dataset.screenerReplay = '1';
    return () => {
      delete document.body.dataset.screenerReplay;
    };
  }, [open, mode]);

  if (!open) return null;

  const workspace = workspaceRef.current;
  const active = mode === 'active';
  const picking = mode === 'picking';

  const pickBar = () => {
    if (!workspace) return;
    if (workspace.replay.state.active) workspace.replay.stop();
    setMode('picking');
    setDateOpen(false);
    setError(null);
    setPickCellId(null);
  };

  const start = async () => {
    if (!workspace) {
      setError('The chart is not ready yet.');
      return;
    }
    if (!from) {
      setError('Pick a bar or select a date first.');
      return;
    }
    setBusy(true);
    setError(null);
    setDateOpen(false);
    try {
      await ensureReplayHistory(workspace, from, pickCellId);
      await workspace.replay.start({
        from,
        ...(pickCellId ? { cell: pickCellId } : {}),
      });
      const next = workspace.replay.state;
      setStatus(next);
      if (!next.active) {
        setError('No bars to replay after that time. Pick an earlier start.');
        return;
      }
      setMode('active');
      workspace.replay.play(intervalFor(speed));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not start the replay.');
    } finally {
      setBusy(false);
    }
  };

  const togglePlay = () => {
    if (!workspace) return;
    if (status?.playing) workspace.replay.pause();
    else workspace.replay.play(intervalFor(speed));
  };

  const step = () => {
    workspace?.replay.step();
  };

  const changeSpeed = (value: number) => {
    setSpeed(value);
    if (workspace && status?.playing) workspace.replay.play(intervalFor(value));
  };

  const openDate = () => {
    setPickCellId(null);
    setDateOpen(true);
  };

  const startDrag = (event: ReactMouseEvent<HTMLSpanElement>) => {
    const panel = panelRef.current;
    if (!panel) return;
    const rect = panel.getBoundingClientRect();
    dragRef.current = { dx: event.clientX - rect.left, dy: event.clientY - rect.top };
    setPos({ x: rect.left, y: rect.top });
    event.preventDefault();
  };

  return (
    <div
      ref={panelRef}
      role="region"
      aria-label="Bar replay"
      style={pos ? { left: pos.x, top: pos.y, bottom: 'auto', transform: 'none' } : undefined}
      className={`fixed z-[70] w-[680px] max-w-[calc(100vw-32px)] rounded-xl border border-border bg-popover/95 shadow-2xl backdrop-blur ${
        pos ? '' : 'bottom-24 left-1/2 -translate-x-1/2'
      }`}
    >
      <div className="flex flex-wrap items-center gap-2 px-2 py-2">
        <span
          role="button"
          tabIndex={-1}
          aria-label="Drag replay panel"
          title="Drag"
          onMouseDown={startDrag}
          className="inline-flex h-7 w-5 shrink-0 cursor-grab items-center justify-center rounded text-muted-foreground/60 hover:text-foreground active:cursor-grabbing"
        >
          <GripVertical className="size-3.5" />
        </span>

        <Button
          variant="secondary"
          size="sm"
          onClick={pickBar}
          disabled={!workspace}
          title="Pick the replay start on the chart"
          className={
            picking
              ? 'border-transparent bg-foreground text-background hover:bg-foreground/90'
              : undefined
          }
        >
          <Rewind className="size-3.5" />
          Start bar
        </Button>

        {active ? (
          <>
            <IconButton label={status?.playing ? 'Pause' : 'Play'} onClick={togglePlay}>
              {status?.playing ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
            </IconButton>
            <IconButton label="Step" onClick={step}>
              <SkipForward className="size-3.5" />
            </IconButton>
          </>
        ) : (
          <>
            <IconButton
              label="Play"
              onClick={() => void start()}
              disabled={!workspace || !from || busy}
            >
              <Play className="size-3.5" />
            </IconButton>
            <IconButton label="Step" disabled>
              <SkipForward className="size-3.5" />
            </IconButton>
          </>
        )}

        <Select
          aria-label="Replay speed"
          value={String(speed)}
          onChange={(event) => changeSpeed(Number(event.target.value))}
          className="h-7 w-[76px] text-[11px]"
        >
          {SPEEDS.map((value) => (
            <option key={value} value={value}>
              {value}x
            </option>
          ))}
        </Select>

        {active ? (
          <span className="text-[11px] text-muted-foreground">
            {status?.cursorTime ? formatCursor(status.cursorTime) : 'Loading bars…'} ·{' '}
            {status?.remaining ?? 0} bars left
          </span>
        ) : (
          <>
            <Button
              variant="secondary"
              size="sm"
              onClick={openDate}
              disabled={!workspace}
              title="Select date"
            >
              <Calendar className="size-3.5" />
              Select date
            </Button>
            {from ? (
              <span className="text-[11px] text-muted-foreground">{formatCursor(from)}</span>
            ) : null}
          </>
        )}

        <IconButton label="Close replay" onClick={onClose} className="ml-auto">
          <X className="size-3.5" />
        </IconButton>
      </div>

      {dateOpen && !active ? (
        <div className="vela-ui absolute bottom-full left-2 z-10 mb-2 w-[228px] rounded-lg border border-border bg-popover p-2 shadow-2xl">
          <div ref={calendarRef} />
          <div className="mt-2 flex items-center justify-between gap-2 border-t border-border pt-2">
            <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              Time
            </span>
            <Input
              type="time"
              aria-label="Replay start time"
              value={time}
              onChange={(event) => setTime(event.target.value || '00:00')}
              className="h-7 w-24 text-[11px]"
            />
          </div>
        </div>
      ) : null}

      {picking ? (
        <div className="absolute bottom-0 left-full ml-3 whitespace-nowrap rounded-md border border-border bg-popover px-2 py-1 text-[10px] text-muted-foreground shadow-lg">
          Bar replay: click the bar to start from (Esc cancels)
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
