import { useState } from 'react';
import { Bell } from 'lucide-react';
import type {
  AlertFrequency,
  AlertInputValues,
  AlertNotificationPrefs,
  VenueId,
} from '../types';
import { addAlertRule } from '../lib/alerts';
import { spotSymbol } from '../lib/binance';
import { timeframeLabel } from '../lib/timeframe';
import { Modal } from '../ui/overlays';
import { Button, Segmented, Select } from '../ui/primitives';

export interface AlertDraft {
  source: string;
  indicatorTitle: string;
  symbol: string;
  timeframe: string;
  venue: VenueId;
  velaSymbol: string;
  sites: string[];
  hasAlert: boolean;
  untitled: number;
  inputs: AlertInputValues;
}

const CONDITION_PREFIX = 'condition:';
const ANY_ALERT = 'alert';

function choiceValue(site: string): string {
  return `${CONDITION_PREFIX}${site}`;
}

function choiceLabel(choice: string): string {
  return choice === ANY_ALERT ? 'Any alert' : choice.slice(CONDITION_PREFIX.length);
}

function defaultName(symbol: string, choice: string): string {
  return `${spotSymbol(symbol)} ${choiceLabel(choice)}`;
}

function newId(): string {
  return `alert-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

const checkboxClass = 'size-3.5 shrink-0 accent-primary';

export function CreateAlertDialog({
  draft,
  onClose,
}: {
  draft: AlertDraft | null;
  onClose: () => void;
}) {
  const [name, setName] = useState('');
  const [nameTouched, setNameTouched] = useState(false);
  const [choice, setChoice] = useState('');
  const [frequency, setFrequency] = useState<AlertFrequency>('once-per-bar-close');
  const [notify, setNotify] = useState<AlertNotificationPrefs>({
    toast: true,
    sound: true,
    system: true,
  });
  const [error, setError] = useState<string | null>(null);
  const [lastDraft, setLastDraft] = useState<AlertDraft | null>(null);

  // The dialog is remounted by key when a new draft arrives; seed once.
  if (draft !== lastDraft) {
    setLastDraft(draft);
    const initial = draft
      ? draft.sites.length > 0
        ? choiceValue(draft.sites[0]!)
        : draft.hasAlert
          ? ANY_ALERT
          : ''
      : '';
    setName(draft && initial ? defaultName(draft.symbol, initial) : '');
    setNameTouched(false);
    setChoice(initial);
    setFrequency('once-per-bar-close');
    setNotify({ toast: true, sound: true, system: true });
    setError(null);
  }

  const pick = (value: string) => {
    setChoice(value);
    if (!nameTouched && draft) setName(defaultName(draft.symbol, value));
  };

  const create = () => {
    if (!draft) return;
    if (!choice) {
      setError('This script has no selectable alert condition.');
      return;
    }
    const includeAlert = choice === ANY_ALERT;
    const rule = addAlertRule({
      version: 1,
      id: newId(),
      kind: 'chart',
      name: name.trim() || defaultName(draft.symbol, choice),
      target: {
        kind: 'instrument',
        venue: draft.venue,
        velaSymbol: draft.velaSymbol,
        symbol: draft.symbol,
      },
      timeframe: draft.timeframe,
      script: draft.source,
      inputs: draft.inputs,
      sites: includeAlert ? [] : [choice.slice(CONDITION_PREFIX.length)],
      includeAlert,
      frequency,
      notify,
      indicatorTitle: draft.indicatorTitle,
      enabled: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      lastFiredAt: null,
      fireCount: 0,
    });
    if (!rule) {
      setError('The alert could not be saved. Remove an old alert and try again.');
      return;
    }
    onClose();
  };

  return (
    <Modal
      open={draft !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={draft ? `Alert on ${draft.indicatorTitle}` : 'Create alert'}
      description={
        draft
          ? `${draft.velaSymbol} · ${timeframeLabel(draft.timeframe)} · runs without the chart`
          : undefined
      }
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={create}>
            <Bell className="size-3.5" />
            Create alert
          </Button>
        </>
      }
    >
      {draft ? (
        <div className="flex flex-col gap-4 text-[12px]">
          <p className="text-[11px] text-muted-foreground">
            On <span className="font-mono text-foreground">{draft.velaSymbol}</span> ·{' '}
            {timeframeLabel(draft.timeframe)}
          </p>

          <div className="flex flex-col gap-1">
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-muted-foreground">Watch</span>
              {draft.sites.length > 0 || draft.hasAlert ? (
                <Select value={choice} onChange={(event) => pick(event.target.value)}>
                  {draft.sites.map((site) => (
                    <option key={site} value={choiceValue(site)}>
                      {site}
                    </option>
                  ))}
                  {draft.hasAlert ? <option value={ANY_ALERT}>Any alert() call</option> : null}
                </Select>
              ) : (
                <p className="text-[11px] text-negative">
                  This script has no alertcondition or alert() calls.
                </p>
              )}
            </label>
            <p className="text-[11px] text-muted-foreground">
              Fires whenever the script&apos;s own condition is met, as its author wrote it.
            </p>
            {draft.untitled > 0 ? (
              <p className="text-[11px] text-muted-foreground">
                {draft.untitled} alertcondition call
                {draft.untitled === 1 ? '' : 's'} without a static title cannot be selected.
              </p>
            ) : null}
          </div>

          <div className="flex flex-col gap-1">
            <span className="text-[11px] text-muted-foreground">When</span>
            <Segmented
              value={frequency}
              onChange={setFrequency}
              options={[
                { value: 'once', label: 'Only once' },
                { value: 'once-per-bar-close', label: 'Once per bar close' },
              ]}
            />
            <p className="text-[11px] text-muted-foreground">
              Fires when a bar closes with the condition met.
            </p>
          </div>

          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-muted-foreground">Name</span>
            <input
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                setNameTouched(true);
              }}
              placeholder={choice ? defaultName(draft.symbol, choice) : ''}
              className="h-8 rounded-md border border-border bg-background px-2 text-[12px] text-foreground outline-none focus:border-primary"
            />
          </label>

          <div className="flex flex-col gap-1.5">
            <span className="text-[11px] text-muted-foreground">Notify</span>
            {(
              [
                ['toast', 'In-app toast'],
                ['sound', 'Sound'],
                ['system', 'System notification'],
              ] as const
            ).map(([key, label]) => (
              <label key={key} className="flex items-center gap-2 text-foreground">
                <input
                  type="checkbox"
                  checked={notify[key]}
                  onChange={(event) =>
                    setNotify((current) => ({ ...current, [key]: event.target.checked }))
                  }
                  className={checkboxClass}
                />
                <span>{label}</span>
              </label>
            ))}
          </div>

          {error ? <p className="text-[11px] text-negative">{error}</p> : null}
        </div>
      ) : null}
    </Modal>
  );
}
