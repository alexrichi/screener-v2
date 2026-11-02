import { useMemo } from 'react';
import {
  FilePlus2,
  Layers,
  Play,
  Save,
  ScanSearch,
  Square,
  Upload,
} from 'lucide-react';
import type { PlotColumn, ScanProgress } from '../types';
import type { SavedIndicator } from '../lib/indicatorLibrary';
import { PRESETS } from '../scripts/presets';
import { Button, ProgressBar, Select } from '../ui/primitives';
import { PineEditor } from './PineEditor';

const TIMEFRAMES = [
  { value: '5', label: '5m' },
  { value: '15', label: '15m' },
  { value: '60', label: '1h' },
  { value: '240', label: '4h' },
  { value: 'D', label: '1D' },
];

interface Props {
  script: string;
  onScriptChange: (script: string) => void;
  savedItems: SavedIndicator[];
  currentSavedId: string | null;
  dirty: boolean;
  onSelectSaved: (id: string) => void;
  onUsePreset: (source: string) => void;
  onSave: () => void;
  onNew: () => void;
  scanTimeframe: string;
  onScanTimeframeChange: (timeframe: string) => void;
  scanBars: number;
  onScanBarsChange: (bars: number) => void;
  onApply: (script: string, allCells: boolean) => void;
  onScan: () => void;
  onCancel: () => void;
  scanning: boolean;
  progress: ScanProgress | null;
  error: string | null;
  resultCount: number;
  plotColumns: PlotColumn[];
  lastScanMs: number | null;
}

export function PinePanel({
  script,
  onScriptChange,
  savedItems,
  currentSavedId,
  dirty,
  onSelectSaved,
  onUsePreset,
  onSave,
  onNew,
  scanTimeframe,
  onScanTimeframeChange,
  scanBars,
  onScanBarsChange,
  onApply,
  onScan,
  onCancel,
  scanning,
  progress,
  error,
  resultCount,
  plotColumns,
  lastScanMs,
}: Props) {
  const savedName = useMemo(
    () => savedItems.find((item) => item.id === currentSavedId)?.name ?? null,
    [currentSavedId, savedItems],
  );
  const presetId = useMemo(
    () => PRESETS.find((preset) => preset.source === script)?.id ?? '',
    [script],
  );
  const selectValue = dirty
    ? 'draft'
    : currentSavedId
      ? `saved:${currentSavedId}`
      : presetId
        ? `preset:${presetId}`
        : 'draft';
  const percent = progress && progress.total > 0 ? (progress.done / progress.total) * 100 : 0;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-1.5 border-b border-border px-2 py-2">
        {dirty ? (
          <span
            title="Unsaved changes"
            className="size-1.5 shrink-0 rounded-full bg-amber-400"
          />
        ) : null}
        <Select
          value={selectValue}
          onChange={(event) => {
            const value = event.target.value;
            if (value.startsWith('saved:')) onSelectSaved(value.slice(6));
            else if (value.startsWith('preset:')) {
              const preset = PRESETS.find((item) => item.id === value.slice(7));
              if (preset) onUsePreset(preset.source);
            }
          }}
          className="min-w-0 flex-1 text-[11px]"
          title={savedName ?? 'Script'}
        >
          <option value="draft">Draft{savedName ? ` · ${savedName}` : ''}</option>
          {savedItems.length > 0 ? (
            <optgroup label="Saved">
              {savedItems.map((item) => (
                <option key={item.id} value={`saved:${item.id}`}>
                  {item.name}
                </option>
              ))}
            </optgroup>
          ) : null}
          <optgroup label="Templates">
            {PRESETS.map((preset) => (
              <option key={preset.id} value={`preset:${preset.id}`}>
                {preset.name}
              </option>
            ))}
          </optgroup>
        </Select>
        <button
          type="button"
          title="Save indicator"
          aria-label="Save indicator"
          onClick={onSave}
          disabled={!script.trim()}
          className="inline-flex size-7 shrink-0 items-center justify-center rounded-md border border-border text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40"
        >
          <Save className="size-3.5" />
        </button>
        <button
          type="button"
          title="New indicator"
          aria-label="New indicator"
          onClick={onNew}
          className="inline-flex size-7 shrink-0 items-center justify-center rounded-md border border-border text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <FilePlus2 className="size-3.5" />
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-2 p-2">
        <PineEditor
          value={script}
          onChange={onScriptChange}
          onSave={onSave}
          onRun={onScan}
          className="min-h-48 flex-1"
          placeholder={'//@version=6\nindicator("My script")\nplot(close)'}
        />

        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Scan
          </span>
          <Select
            value={scanTimeframe}
            onChange={(event) => onScanTimeframeChange(event.target.value)}
            className="w-16"
            title="Scan timeframe"
          >
            {TIMEFRAMES.map((timeframe) => (
              <option key={timeframe.value} value={timeframe.value}>
                {timeframe.label}
              </option>
            ))}
          </Select>
          <input
            type="number"
            min={60}
            max={1500}
            step={50}
            value={scanBars}
            onChange={(event) => {
              const next = Number(event.target.value);
              if (Number.isFinite(next)) onScanBarsChange(Math.max(60, Math.min(1500, next)));
            }}
            title="Closed bars per symbol"
            className="h-7 w-16 rounded-md border border-border bg-muted/50 px-2 font-mono text-[11px] text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
          />
          <span className="text-[10px] text-muted-foreground">bars</span>
          <div className="ml-auto flex items-center gap-1.5">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => onApply(script, false)}
              disabled={!script.trim()}
              title="Apply to the active chart"
            >
              <Upload className="size-3" />
              Apply
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => onApply(script, true)}
              disabled={!script.trim()}
              title="Apply to every chart in this workspace"
            >
              <Layers className="size-3" />
              All
            </Button>
            {scanning ? (
              <Button size="sm" variant="secondary" onClick={onCancel}>
                <Square className="size-3" />
                Stop
              </Button>
            ) : (
              <Button
                size="sm"
                variant="primary"
                onClick={onScan}
                disabled={!script.trim()}
              >
                <Play className="size-3" />
                Scan
              </Button>
            )}
          </div>
        </div>

        {scanning ? (
          <div className="rounded-md border border-border bg-muted/30 p-2">
            <div className="mb-1.5 flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <ScanSearch className="size-3 text-primary" />
                {progress?.symbol ? `Scanning ${progress.symbol}` : 'Preparing scan…'}
              </span>
              <span className="font-mono tabular-nums">
                {progress ? `${progress.done}/${progress.total}` : '—'}
              </span>
            </div>
            <ProgressBar value={percent} />
          </div>
        ) : null}

        {error ? (
          <div className="max-h-28 overflow-y-auto rounded-md border border-negative/30 bg-negative/10 p-2 font-mono text-[10px] leading-4 text-negative">
            {error}
          </div>
        ) : null}

        {!scanning && !error && resultCount > 0 ? (
          <div className="flex items-center justify-between rounded-md border border-border bg-muted/20 px-2 py-1.5 text-[10px] text-muted-foreground">
            <span>
              <span className="font-semibold text-foreground">{resultCount}</span> symbols scanned
            </span>
            {lastScanMs !== null ? (
              <span className="font-mono tabular-nums">{lastScanMs} ms</span>
            ) : null}
          </div>
        ) : null}

        {plotColumns.length > 0 ? (
          <div className="flex flex-wrap items-center gap-1">
            <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              Columns
            </span>
            {plotColumns.slice(0, 12).map((column) => (
              <span
                key={column.key}
                title={column.title}
                className="max-w-36 truncate rounded border border-primary/25 bg-primary-soft px-1.5 py-0.5 text-[10px] text-foreground/80"
              >
                {column.title}
              </span>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
