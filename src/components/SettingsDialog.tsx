import { useEffect, useState } from 'react';
import type { Settings, VenueId } from '../types';
import { clearAiConfig, saveAiConfig, type AiStatus } from '../lib/ai/model';
import { AI_PROVIDERS, presetById, providerIdFor } from '../lib/ai/providers';
import { VENUE_CATALOG } from '../venues/catalog';
import { VenueIcon } from '../venues/venueIcons';
import { Badge, Button, Input, Segmented, Select } from '../ui/primitives';
import { Modal } from '../ui/overlays';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  settings: Settings;
  onSave: (settings: Settings) => void;
  aiStatus: AiStatus | null;
  onAiChange: (status: AiStatus) => void;
  /** Which tab opens; the AI sidebar jumps straight to the creds. */
  initialTab?: 'screener' | 'ai';
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

export function SettingsDialog({
  open,
  onOpenChange,
  settings,
  onSave,
  aiStatus,
  onAiChange,
  initialTab = 'screener',
}: Props) {
  const [tab, setTab] = useState<'screener' | 'ai'>('screener');
  const [draft, setDraft] = useState<Settings>(settings);
  const [aiBase, setAiBase] = useState('');
  const [aiModel, setAiModel] = useState('');
  const [aiTranscribe, setAiTranscribe] = useState('');
  const [aiKey, setAiKey] = useState('');
  const [aiProvider, setAiProvider] = useState('custom');
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiNote, setAiNote] = useState<string | null>(null);

  useEffect(() => {
    if (open) setDraft(settings);
  }, [open, settings]);

  useEffect(() => {
    if (!open) return;
    setTab(initialTab);
  }, [open, initialTab]);

  useEffect(() => {
    if (!open) return;
    setAiKey('');
    setAiError(null);
    setAiNote(null);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setAiBase(aiStatus?.baseUrl ?? '');
    setAiModel(aiStatus?.model ?? '');
    setAiTranscribe(aiStatus?.transcriptionModel ?? '');
    setAiProvider(providerIdFor(aiStatus?.baseUrl));
  }, [
    open,
    aiStatus?.baseUrl,
    aiStatus?.model,
    aiStatus?.transcriptionModel,
    aiStatus?.source,
  ]);

  const patch = (patch: Partial<Settings>) => setDraft((prev) => ({ ...prev, ...patch }));

  /** An empty field removes the venue override and falls back to the default. */
  const setVenueVolume = (venue: VenueId, raw: string) => {
    const next = { ...(draft.minVolumeByVenue ?? {}) };
    if (raw.trim() === '') delete next[venue];
    else next[venue] = Math.max(0, Number(raw) || 0);
    patch({ minVolumeByVenue: next });
  };

  const aiFromEnv = aiStatus?.source === 'env';
  const aiDirty =
    aiBase.trim() !== (aiStatus?.baseUrl ?? '') ||
    aiModel.trim() !== (aiStatus?.model ?? '') ||
    aiTranscribe.trim() !== (aiStatus?.transcriptionModel ?? '') ||
    aiKey.trim().length > 0;

  const saveAi = async (): Promise<boolean> => {
    setAiBusy(true);
    setAiError(null);
    setAiNote(null);
    try {
      const status = await saveAiConfig({
        baseUrl: aiBase,
        model: aiModel,
        transcriptionModel: aiTranscribe,
        apiKey: aiKey.trim() ? aiKey.trim() : undefined,
        replaceKey: aiKey.trim() ? true : undefined,
      });
      onAiChange(status);
      setAiKey('');
      setAiNote(
        status.keySet
          ? 'Saved. The key stays in the sidecar, outside the app bundle.'
          : 'Saved without a key. Local servers usually do not need one.',
      );
      return true;
    } catch (cause) {
      setAiError(cause instanceof Error ? cause.message : String(cause));
      return false;
    } finally {
      setAiBusy(false);
    }
  };

  /** The footer saves everything: app settings plus a dirty AI form. */
  const commit = async () => {
    if (aiDirty && !aiFromEnv) {
      const ok = await saveAi();
      if (!ok) return;
    }
    onSave(draft);
    onOpenChange(false);
  };

  const clearAi = async () => {
    setAiBusy(true);
    setAiError(null);
    setAiNote(null);
    try {
      const status = await clearAiConfig();
      onAiChange(status);
      setAiBase('');
      setAiModel('');
      setAiTranscribe('');
      setAiKey('');
      setAiNote('Cleared.');
    } catch (cause) {
      setAiError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setAiBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Settings"
      description="Screener universe, scan defaults and AI"
      footer={
        <>
          {aiError ? (
            <span className="mr-auto max-w-[60%] text-[11px] leading-tight text-negative">
              {aiError}
            </span>
          ) : null}
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={aiBusy}>
            Cancel
          </Button>
          <Button variant="primary" loading={aiBusy} onClick={() => void commit()}>
            Save
          </Button>
        </>
      }
    >
      <div className="mb-4">
        <Segmented
          value={tab}
          options={[
            { value: 'screener', label: 'Screener' },
            { value: 'ai', label: 'AI' },
          ]}
          onChange={setTab}
        />
      </div>

      {tab === 'screener' ? (
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Watch threshold" hint="Min 24h quote volume; venues below can override it">
          <Input
            type="number"
            min={0}
            step={100_000}
            value={draft.minVolume}
            onChange={(event) => patch({ minVolume: Math.max(0, Number(event.target.value) || 0) })}
          />
        </Field>
        <Field label="Metrics timeframe" hint="Technical TF for RSI, VWAP, Range and RVOL">
          <Select
            value={draft.metricsTimeframe ?? '15'}
            onChange={(event) => patch({ metricsTimeframe: event.target.value })}
          >
            <option value="15">15m</option>
            <option value="30">30m</option>
            <option value="60">1h</option>
          </Select>
        </Field>
        <Field label="RVOL days" hint="Previous 24h windows in the average">
          <Input
            type="number"
            min={1}
            max={30}
            step={1}
            value={draft.rvolDays ?? 7}
            onChange={(event) =>
              patch({ rvolDays: Math.max(1, Math.min(30, Number(event.target.value) || 7)) })
            }
          />
        </Field>
        <Field label="RSI period" hint="Wilder RSI period">
          <Input
            type="number"
            min={2}
            max={50}
            step={1}
            value={draft.rsiPeriod ?? 14}
            onChange={(event) =>
              patch({ rsiPeriod: Math.max(2, Math.min(50, Number(event.target.value) || 14)) })
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
        <div className="sm:col-span-2">
          <div className="text-[11px] font-medium text-foreground">Per-venue watch threshold</div>
          <p className="mt-0.5 text-[10px] leading-4 text-muted-foreground">
            Empty uses the default above. A venue's number replaces it for that venue only.
          </p>
          <div className="mt-2 grid gap-1">
            {VENUE_CATALOG.map((venue) => (
              <label key={venue.id} className="flex items-center gap-2">
                <VenueIcon venue={venue.id} size={14} />
                <span className="min-w-0 flex-1 truncate text-[12px] text-foreground">
                  {venue.label}
                </span>
                <Input
                  type="number"
                  min={0}
                  step={100_000}
                  placeholder={String(draft.minVolume)}
                  value={draft.minVolumeByVenue?.[venue.id] ?? ''}
                  onChange={(event) => setVenueVolume(venue.id, event.target.value)}
                  className="h-6 w-32 text-right font-mono tabular-nums"
                />
              </label>
            ))}
          </div>
        </div>
      </div>
      ) : (
      <div>
        <div className="mb-3 flex items-center gap-2">
          <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            AI assistant
          </span>
          {aiStatus?.configured ? (
            <Badge tone="positive">configured</Badge>
          ) : (
            <Badge tone="neutral">off</Badge>
          )}
          {aiStatus?.keySet ? (
            <Badge tone="primary">key saved</Badge>
          ) : aiStatus ? (
            <Badge tone="neutral">no key</Badge>
          ) : null}
          {aiFromEnv ? <Badge tone="neutral">env</Badge> : null}
        </div>
        {aiStatus?.configFile ? (
          <p className="mb-3 break-all text-[10px] leading-4 text-muted-foreground">
            Settings file: {aiStatus.configFile}
          </p>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Field
              label="Provider"
              hint="Any OpenAI-compatible endpoint. Anthropic needs native support, so it is not listed."
            >
              <Select
                value={aiProvider}
                onChange={(event) => {
                  const id = event.target.value;
                  setAiProvider(id);
                  const preset = presetById(id);
                  if (preset) setAiBase(preset.baseUrl);
                }}
                disabled={aiFromEnv}
              >
                {AI_PROVIDERS.map((provider) => (
                  <option key={provider.id} value={provider.id}>
                    {provider.label}
                  </option>
                ))}
                <option value="custom">Custom endpoint…</option>
              </Select>
            </Field>
          </div>
          <div className="sm:col-span-2">
            <Field
              label="Base URL"
              hint="Usually ends in /v1; local servers need no key"
            >
              <Input
                value={aiBase}
                onChange={(event) => {
                  setAiBase(event.target.value);
                  setAiProvider(providerIdFor(event.target.value));
                }}
                placeholder="https://api.openai.com/v1"
                spellCheck={false}
                disabled={aiFromEnv}
              />
            </Field>
          </div>
          <Field label="Model" hint="Must support tool calling; vision is optional">
            <Input
              value={aiModel}
              onChange={(event) => setAiModel(event.target.value)}
              placeholder="google/gemini-2.5-flash"
              spellCheck={false}
              disabled={aiFromEnv}
            />
          </Field>
          <Field
            label="API key"
            hint={
              aiStatus?.keySet
                ? 'A key is saved; leave this blank to keep it'
                : 'Optional for local servers'
            }
          >
            <div className="flex items-center gap-2">
              <Input
                className="min-w-0 flex-1"
                type="password"
                value={aiKey}
                onChange={(event) => setAiKey(event.target.value)}
                placeholder={aiStatus?.keySet ? '••••••••' : 'sk-…'}
                autoComplete="off"
                disabled={aiFromEnv}
              />
              {aiStatus ? (
                aiStatus.keySet ? (
                  <Badge tone="primary">saved</Badge>
                ) : (
                  <Badge tone="neutral">not set</Badge>
                )
              ) : null}
            </div>
          </Field>
          <div className="sm:col-span-2">
            <Field
              label="Transcription model"
              hint="Whisper-compatible model on the same base URL; blank hides the mic"
            >
              <Input
                value={aiTranscribe}
                onChange={(event) => setAiTranscribe(event.target.value)}
                placeholder="whisper-1"
                spellCheck={false}
                disabled={aiFromEnv}
              />
            </Field>
          </div>
        </div>

        <p className="mt-2 text-[10px] text-muted-foreground/70">
          The sidecar stores these in your user profile, outside the app bundle, and never
          sends the key back to the window.{' '}
          {aiFromEnv
            ? 'AI_BASE_URL is set in the environment and overrides these fields.'
            : 'Saving applies immediately, no restart.'}
        </p>

        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Button
            variant="ghost"
            onClick={() => void clearAi()}
            disabled={aiBusy || aiFromEnv || !aiStatus?.configured}
          >
            Clear
          </Button>
          {aiNote ? <span className="text-[11px] text-positive">{aiNote}</span> : null}
          {aiError ? <span className="text-[11px] text-negative">{aiError}</span> : null}
        </div>
      </div>
      )}
    </Modal>
  );
}
