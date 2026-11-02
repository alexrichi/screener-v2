import { useEffect, useState } from 'react';
import type { Settings } from '../types';
import { Button, Input, Select } from '../ui/primitives';
import { Modal } from '../ui/overlays';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  settings: Settings;
  onSave: (settings: Settings) => void;
}

const LAYOUTS = [
  { value: '1', label: '1 chart' },
  { value: '2h', label: '2 charts · side by side' },
  { value: '2v', label: '2 charts · stacked' },
  { value: '4', label: '4 charts · 2×2' },
  { value: '8', label: '8 charts · 4×2' },
];

const SCAN_TIMEFRAMES = [
  { value: '5', label: '5m' },
  { value: '15', label: '15m' },
  { value: '60', label: '1h' },
  { value: '240', label: '4h' },
  { value: 'D', label: '1D' },
];

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="grid gap-1">
      <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      {children}
      {hint ? <span className="text-[10px] text-muted-foreground/70">{hint}</span> : null}
    </label>
  );
}

export function SettingsDialog({ open, onOpenChange, settings, onSave }: Props) {
  const [draft, setDraft] = useState<Settings>(settings);

  useEffect(() => {
    if (open) setDraft(settings);
  }, [open, settings]);

  const patch = (patch: Partial<Settings>) => setDraft((prev) => ({ ...prev, ...patch }));

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Settings"
      description="Screener universe and scan defaults"
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              onSave(draft);
              onOpenChange(false);
            }}
          >
            Save
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Min 24h volume" hint="Per venue, in quote currency">
          <Input
            type="number"
            min={0}
            step={100_000}
            value={draft.minVolume}
            onChange={(event) => patch({ minVolume: Math.max(0, Number(event.target.value) || 0) })}
          />
        </Field>
        <Field label="Top symbols" hint="Per venue, after the volume filter">
          <Input
            type="number"
            min={1}
            max={500}
            step={10}
            value={draft.topN}
            onChange={(event) =>
              patch({ topN: Math.max(1, Math.min(500, Number(event.target.value) || 1)) })
            }
          />
        </Field>
        <Field label="Default layout" hint="New workspaces start here">
          <Select
            value={draft.defaultLayout}
            onChange={(event) => patch({ defaultLayout: event.target.value })}
          >
            {LAYOUTS.map((layout) => (
              <option key={layout.value} value={layout.value}>
                {layout.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Refresh interval" hint="Binance tickers">
          <Select
            value={String(draft.refreshSeconds)}
            onChange={(event) => patch({ refreshSeconds: Number(event.target.value) })}
          >
            <option value="5">5 seconds</option>
            <option value="10">10 seconds</option>
            <option value="30">30 seconds</option>
          </Select>
        </Field>
        <Field label="Scan timeframe" hint="Used by the Pine scanner">
          <Select
            value={draft.scanTimeframe}
            onChange={(event) => patch({ scanTimeframe: event.target.value })}
          >
            {SCAN_TIMEFRAMES.map((timeframe) => (
              <option key={timeframe.value} value={timeframe.value}>
                {timeframe.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Scan bars" hint="Closed candles per symbol">
          <Input
            type="number"
            min={60}
            max={1500}
            step={50}
            value={draft.scanBars}
            onChange={(event) =>
              patch({
                scanBars: Math.max(60, Math.min(1500, Number(event.target.value) || 500)),
              })
            }
          />
        </Field>
      </div>
    </Modal>
  );
}
