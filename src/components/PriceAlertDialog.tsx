import { useState } from 'react';
import { Bell } from 'lucide-react';
import type {
  AlertNotificationPrefs,
  AlertPriceCondition,
  PriceAlertFrequency,
} from '../types';
import { addAlertRule } from '../lib/alerts';
import { formatPrice } from '../lib/format';
import {
  defaultPriceAlertName,
  PRICE_ALERT_CONDITIONS,
  PRICE_ALERT_FREQUENCIES,
  type PriceAlertSeed,
} from '../lib/priceAlert';
import { Modal } from '../ui/overlays';
import { Button, Segmented, Select } from '../ui/primitives';

const checkboxClass = 'size-3.5 shrink-0 accent-primary';

function newId(): string {
  return `alert-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function PriceAlertDialog({
  seed,
  onClose,
}: {
  seed: PriceAlertSeed | null;
  onClose: () => void;
}) {
  const [lastSeed, setLastSeed] = useState<PriceAlertSeed | null>(null);
  const [condition, setCondition] = useState<AlertPriceCondition>('crossing');
  const [price, setPrice] = useState('');
  const [name, setName] = useState('');
  const [nameTouched, setNameTouched] = useState(false);
  const [frequency, setFrequency] = useState<PriceAlertFrequency>('once');
  const [message, setMessage] = useState('');
  const [notify, setNotify] = useState<AlertNotificationPrefs>({
    toast: true,
    sound: true,
    system: true,
  });
  const [error, setError] = useState<string | null>(null);

  // The dialog is remounted by key when a new seed arrives; seed once.
  if (seed !== lastSeed) {
    setLastSeed(seed);
    setCondition('crossing');
    setPrice(seed ? seed.price.toFixed(seed.decimals) : '');
    setName(seed ? defaultPriceAlertName(seed.symbol, 'crossing', seed.priceText) : '');
    setNameTouched(false);
    setFrequency('once');
    setMessage('');
    setNotify({ toast: true, sound: true, system: true });
    setError(null);
  }

  const displayPrice = (value: number): string =>
    seed ? formatPrice(value, seed.decimals) : String(value);

  const pickCondition = (next: AlertPriceCondition) => {
    setCondition(next);
    const value = Number(price);
    if (!nameTouched && seed) {
      setName(defaultPriceAlertName(seed.symbol, next, Number.isFinite(value) ? displayPrice(value) : seed.priceText));
    }
  };

  const create = () => {
    if (!seed) return;
    const value = Number(price);
    if (!Number.isFinite(value) || value <= 0) {
      setError('Enter a positive price.');
      return;
    }
    const priceText = displayPrice(value);
    const rule = addAlertRule({
      version: 1,
      id: newId(),
      kind: 'price',
      name: name.trim() || defaultPriceAlertName(seed.symbol, condition, priceText),
      target: {
        kind: 'instrument',
        venue: seed.venue,
        velaSymbol: seed.velaSymbol,
        symbol: seed.symbol,
      },
      timeframe: seed.timeframe,
      price: value,
      priceText,
      condition,
      frequency,
      ...(message.trim() ? { message: message.trim() } : {}),
      notify,
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
      open={seed !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title="New price alert"
      description={
        seed
          ? `${seed.velaSymbol} · checks the live 1m price`
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
      {seed ? (
        <div className="flex flex-col gap-4 text-[12px]">
          <div className="flex gap-3">
            <label className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="text-[11px] text-muted-foreground">Condition</span>
              <Select
                value={condition}
                onChange={(event) => pickCondition(event.target.value as AlertPriceCondition)}
              >
                {PRICE_ALERT_CONDITIONS.map((entry) => (
                  <option key={entry.value} value={entry.value}>
                    {entry.label}
                  </option>
                ))}
              </Select>
            </label>
            <label className="flex w-32 flex-col gap-1">
              <span className="text-[11px] text-muted-foreground">Price</span>
              <input
                value={price}
                inputMode="decimal"
                onChange={(event) => {
                  setPrice(event.target.value);
                  const value = Number(event.target.value);
                  if (!nameTouched) {
                    setName(
                      defaultPriceAlertName(
                        seed.symbol,
                        condition,
                        Number.isFinite(value) ? displayPrice(value) : seed.priceText,
                      ),
                    );
                  }
                }}
                className="h-8 rounded-md border border-border bg-background px-2 font-mono text-[12px] tabular-nums text-foreground outline-none focus:border-primary"
              />
            </label>
          </div>

          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-muted-foreground">Name</span>
            <input
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                setNameTouched(true);
              }}
              className="h-8 rounded-md border border-border bg-background px-2 text-[12px] text-foreground outline-none focus:border-primary"
            />
          </label>

          <div className="flex flex-col gap-1">
            <span className="text-[11px] text-muted-foreground">Frequency</span>
            <Segmented
              value={frequency}
              onChange={(next: PriceAlertFrequency) => setFrequency(next)}
              options={PRICE_ALERT_FREQUENCIES.map((entry) => ({
                value: entry.value,
                label: entry.label,
              }))}
            />
            <p className="text-[11px] text-muted-foreground">
              Only once fires on the first crossing, then pauses. Every time re-arms after the
              price returns to the other side.
            </p>
          </div>

          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-muted-foreground">Message (optional)</span>
            <input
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              placeholder={`${seed.symbol} crossed ${seed.priceText}`}
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
