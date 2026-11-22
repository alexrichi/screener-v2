import { ArrowDown, ArrowUp, Minus, Plus } from 'lucide-react';
import type { Dispatch, ReactNode, SetStateAction } from 'react';
import {
  DEFAULT_DOM_COLUMNS,
  type DomColumnId,
  type OrderFlowSettings,
  type OrderFlowState,
  type OrderFlowTab,
} from '../lib/orderflow';
import { IconButton, Segmented } from '../ui/primitives';

interface Props {
  tab: OrderFlowTab;
  settings: OrderFlowSettings;
  state: OrderFlowState;
  onChange: Dispatch<SetStateAction<OrderFlowSettings>>;
}

const COLUMN_LABELS: Record<DomColumnId, string> = {
  sold: 'Sold into the bid',
  bid: 'Bid',
  price: 'Price',
  ask: 'Ask',
  bought: 'Bought from the ask',
  delta: 'Delta (bought minus sold)',
  volume: 'Volume traded',
  last: 'Last size (5s)',
};

const FIXED_COLUMNS = new Set<DomColumnId>(['bid', 'price', 'ask']);
const TRADE_FILTERS: Array<[string, number | null]> = [
  ['All', null],
  ['1K', 1_000],
  ['10K', 10_000],
  ['50K', 50_000],
  ['100K', 100_000],
  ['1M', 1_000_000],
];
const MULTIPLIERS = [2, 3, 5, 10, 20];

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/80">
        {label}
      </div>
      {children}
      {hint ? <div className="text-[10px] leading-snug text-muted-foreground">{hint}</div> : null}
    </div>
  );
}

function Choices<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          className={
            option.value === value
              ? 'h-6 rounded border border-primary/40 bg-primary-soft px-2 text-[10.5px] font-medium text-primary'
              : 'h-6 rounded border border-border bg-muted/20 px-2 text-[10.5px] text-muted-foreground hover:bg-accent hover:text-foreground'
          }
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function ZoomRow({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  return (
    <div className="flex items-center gap-2">
      <IconButton
        label="Zoom out"
        onClick={() => onChange(Math.max(70, value - 10))}
        className="size-6"
      >
        <Minus className="size-3" />
      </IconButton>
      <span className="w-12 text-center font-mono text-[11px] tabular-nums">{value}%</span>
      <IconButton
        label="Zoom in"
        onClick={() => onChange(Math.min(160, value + 10))}
        className="size-6"
      >
        <Plus className="size-3" />
      </IconButton>
    </div>
  );
}

function ColorRow({
  bid,
  ask,
  onChange,
}: {
  bid: string;
  ask: string;
  onChange: (key: 'bidColor' | 'askColor', value: string) => void;
}) {
  return (
    <div className="flex items-center gap-4">
      <label className="flex items-center gap-1.5 text-[10.5px] text-muted-foreground">
        <input
          type="color"
          value={bid}
          onChange={(event) => onChange('bidColor', event.currentTarget.value)}
          className="size-6 cursor-pointer rounded border border-border bg-transparent p-0"
        />
        Bids and buys
      </label>
      <label className="flex items-center gap-1.5 text-[10.5px] text-muted-foreground">
        <input
          type="color"
          value={ask}
          onChange={(event) => onChange('askColor', event.currentTarget.value)}
          className="size-6 cursor-pointer rounded border border-border bg-transparent p-0"
        />
        Asks and sells
      </label>
    </div>
  );
}

function StyleFields({
  unit,
  zoom,
  bidColor,
  askColor,
  base,
  quote,
  onUnit,
  onZoom,
  onColor,
}: {
  unit: 'base' | 'quote';
  zoom: number;
  bidColor: string;
  askColor: string;
  base: string;
  quote: string;
  onUnit: (unit: 'base' | 'quote') => void;
  onZoom: (zoom: number) => void;
  onColor: (key: 'bidColor' | 'askColor', value: string) => void;
}) {
  return (
    <>
      <Row label="Show sizes in">
        <Segmented
          value={unit}
          onChange={onUnit}
          options={[
            { value: 'base', label: base || 'Base' },
            { value: 'quote', label: quote || 'Quote' },
          ]}
        />
      </Row>
      <Row label="Style">
        <div className="flex items-center justify-between gap-2">
          <ZoomRow value={zoom} onChange={onZoom} />
          <ColorRow bid={bidColor} ask={askColor} onChange={onColor} />
        </div>
      </Row>
    </>
  );
}

export function OrderFlowSettings({ tab, settings, state, onChange }: Props) {
  const patch = (next: Partial<OrderFlowSettings>) => onChange((prev) => ({ ...prev, ...next }));
  const patchBook = (next: Partial<OrderFlowSettings['book']>) =>
    onChange((prev) => ({ ...prev, book: { ...prev.book, ...next } }));
  const patchDom = (next: Partial<OrderFlowSettings['dom']>) =>
    onChange((prev) => ({ ...prev, dom: { ...prev.dom, ...next } }));
  const patchTrades = (next: Partial<OrderFlowSettings['trades']>) =>
    onChange((prev) => ({ ...prev, trades: { ...prev.trades, ...next } }));

  return (
    <div className="space-y-4">
      <div className="text-[12px] font-semibold text-foreground">
        {tab === 'book' ? 'Book settings' : tab === 'dom' ? 'DOM settings' : 'Trades settings'}
      </div>

      {tab === 'book' ? (
        <>
          <StyleFields
            unit={settings.book.unit}
            zoom={settings.book.zoom}
            bidColor={settings.book.bidColor}
            askColor={settings.book.askColor}
            base={state.base}
            quote={state.quote}
            onUnit={(unit) => patchBook({ unit })}
            onZoom={(zoom) => patchBook({ zoom })}
            onColor={(key, value) => patchBook({ [key]: value })}
          />
          <Row label="Depth style">
            <Choices
              value={settings.book.style}
              options={[
                { value: 'bars', label: 'Bars' },
                { value: 'area', label: 'Area' },
                { value: 'area-line', label: 'Area + line' },
                { value: 'line', label: 'Line' },
              ]}
              onChange={(style) => patchBook({ style })}
            />
          </Row>
          <Row label="Depth shows">
            <Segmented
              value={settings.book.total}
              onChange={(total) => patchBook({ total })}
              options={[
                { value: 'running', label: 'Running total' },
                { value: 'level', label: 'Each level' },
              ]}
            />
          </Row>
        </>
      ) : null}

      {tab === 'dom' ? (
        <>
          <StyleFields
            unit={settings.dom.unit}
            zoom={settings.dom.zoom}
            bidColor={settings.dom.bidColor}
            askColor={settings.dom.askColor}
            base={state.base}
            quote={state.quote}
            onUnit={(unit) => patchDom({ unit })}
            onZoom={(zoom) => patchDom({ zoom })}
            onColor={(key, value) => patchDom({ [key]: value })}
          />
          <Row
            label="Follow the market"
            hint={
              settings.dom.follow === 'fixed'
                ? 'The ladder stays still. Press Center to bring the market back.'
                : settings.dom.follow === 'timed'
                  ? `The ladder holds still while your pointer is on it, and recenters ${settings.dom.timedSec} seconds after the pointer leaves.`
                  : 'The ladder follows the market, and holds still while your pointer is on it unless the price would leave the screen.'
            }
          >
            <Choices
              value={settings.dom.follow}
              options={[
                { value: 'fixed', label: 'Fixed' },
                { value: 'auto', label: 'Auto' },
                { value: 'timed', label: 'Timed' },
              ]}
              onChange={(follow) => patchDom({ follow })}
            />
            {settings.dom.follow === 'timed' ? (
              <Choices
                value={String(settings.dom.timedSec) as '5' | '10' | '30' | '60'}
                options={(['5', '10', '30', '60'] as const).map((value) => ({
                  value,
                  label: `${value}s`,
                }))}
                onChange={(value) => patchDom({ timedSec: Number(value) as 5 | 10 | 30 | 60 })}
              />
            ) : null}
          </Row>
          <Row label="Columns">
            <div className="space-y-1">
              {settings.dom.columns.map((column, index) => {
                const fixed = FIXED_COLUMNS.has(column.id);
                return (
                  <div
                    key={column.id}
                    className="flex items-center gap-1.5 rounded border border-border/60 bg-muted/10 px-1.5 py-1"
                  >
                    <button
                      type="button"
                      aria-label={`Hide ${COLUMN_LABELS[column.id]}`}
                      disabled={fixed}
                      onClick={() =>
                        patchDom({
                          columns: settings.dom.columns.map((item) =>
                            item.id === column.id ? { ...item, visible: !item.visible } : item,
                          ),
                        })
                      }
                      className={
                        column.visible
                          ? 'size-3 rounded border border-primary bg-primary'
                          : 'size-3 rounded border border-border bg-transparent'
                      }
                    />
                    <span className="min-w-0 flex-1 truncate text-[10.5px] text-foreground">
                      {COLUMN_LABELS[column.id]}
                    </span>
                    <div className="flex gap-0.5">
                      <button
                        type="button"
                        aria-label={`Move ${COLUMN_LABELS[column.id]} up`}
                        disabled={index === 0}
                        onClick={() => {
                          if (index === 0) return;
                          const columns = [...settings.dom.columns];
                          [columns[index - 1], columns[index]] = [columns[index]!, columns[index - 1]!];
                          patchDom({ columns });
                        }}
                        className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-30"
                      >
                        <ArrowUp className="size-3" />
                      </button>
                      <button
                        type="button"
                        aria-label={`Move ${COLUMN_LABELS[column.id]} down`}
                        disabled={index === settings.dom.columns.length - 1}
                        onClick={() => {
                          if (index === settings.dom.columns.length - 1) return;
                          const columns = [...settings.dom.columns];
                          [columns[index], columns[index + 1]] = [columns[index + 1]!, columns[index]!];
                          patchDom({ columns });
                        }}
                        className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-30"
                      >
                        <ArrowDown className="size-3" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
            <button
              type="button"
              onClick={() => patchDom({ columns: DEFAULT_DOM_COLUMNS.map((column) => ({ ...column })) })}
              className="text-[10.5px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
            >
              Reset columns
            </button>
            <div className="text-[10px] leading-snug text-muted-foreground">
              Bid, price and ask always show.
            </div>
          </Row>
          <Row
            label="Highlight large orders"
            hint={
              settings.dom.highlight === 'relative'
                ? 'Times the typical order resting near the price.'
                : 'Resting size at or above this amount is highlighted.'
            }
          >
            <Choices
              value={settings.dom.highlight}
              options={[
                { value: 'relative', label: 'Relative' },
                { value: 'amount', label: 'Set amount' },
              ]}
              onChange={(highlight) => patchDom({ highlight })}
            />
            {settings.dom.highlight === 'relative' ? (
              <Choices
                value={String(settings.dom.multiplier)}
                options={MULTIPLIERS.map((value) => ({
                  value: String(value),
                  label: `${value}×`,
                }))}
                onChange={(value) => patchDom({ multiplier: Number(value) })}
              />
            ) : (
              <input
                type="number"
                min={0}
                value={settings.dom.amount}
                onChange={(event) => patchDom({ amount: Math.max(0, Number(event.currentTarget.value) || 0) })}
                className="h-7 w-full rounded border border-border bg-background px-2 font-mono text-[11px] text-foreground outline-none focus:border-primary"
              />
            )}
          </Row>
        </>
      ) : null}

      {tab === 'trades' ? (
        <>
          <StyleFields
            unit={settings.trades.unit}
            zoom={settings.trades.zoom}
            bidColor={settings.trades.bidColor}
            askColor={settings.trades.askColor}
            base={state.base}
            quote={state.quote}
            onUnit={(unit) => patchTrades({ unit })}
            onZoom={(zoom) => patchTrades({ zoom })}
            onColor={(key, value) => patchTrades({ [key]: value })}
          />
          <Row label="Trades shown" hint="Notional size in the quote currency.">
            <Choices
              value={String(settings.trades.min ?? 'all')}
              options={TRADE_FILTERS.map(([label, value]) => ({
                value: value === null ? 'all' : String(value),
                label,
              }))}
              onChange={(value) => patchTrades({ min: value === 'all' ? null : Number(value) })}
            />
            <div className="grid grid-cols-2 gap-2">
              <label className="flex items-center gap-1 text-[10px] text-muted-foreground">
                Smallest
                <input
                  type="number"
                  min={0}
                  value={settings.trades.min ?? ''}
                  placeholder={`0 ${state.quote}`}
                  onChange={(event) =>
                    patchTrades({
                      min: event.currentTarget.value === '' ? null : Number(event.currentTarget.value),
                    })
                  }
                  className="h-6 min-w-0 flex-1 rounded border border-border bg-background px-1.5 font-mono text-[10.5px] text-foreground outline-none focus:border-primary"
                />
              </label>
              <label className="flex items-center gap-1 text-[10px] text-muted-foreground">
                Largest
                <input
                  type="number"
                  min={0}
                  value={settings.trades.max ?? ''}
                  placeholder="No limit"
                  onChange={(event) =>
                    patchTrades({
                      max: event.currentTarget.value === '' ? null : Number(event.currentTarget.value),
                    })
                  }
                  className="h-6 min-w-0 flex-1 rounded border border-border bg-background px-1.5 font-mono text-[10.5px] text-foreground outline-none focus:border-primary"
                />
              </label>
            </div>
          </Row>
          <Row
            label="Highlight large trades"
            hint={
              settings.trades.highlight === 'relative'
                ? 'Times the average trade on this market.'
                : 'Notional at or above this amount is highlighted.'
            }
          >
            <Choices
              value={settings.trades.highlight}
              options={[
                { value: 'relative', label: 'Relative' },
                { value: 'amount', label: 'Set amount' },
              ]}
              onChange={(highlight) => patchTrades({ highlight })}
            />
            {settings.trades.highlight === 'relative' ? (
              <Choices
                value={String(settings.trades.multiplier)}
                options={MULTIPLIERS.map((value) => ({
                  value: String(value),
                  label: `${value}×`,
                }))}
                onChange={(value) => patchTrades({ multiplier: Number(value) })}
              />
            ) : (
              <input
                type="number"
                min={0}
                value={settings.trades.amount}
                onChange={(event) =>
                  patchTrades({ amount: Math.max(0, Number(event.currentTarget.value) || 0) })
                }
                className="h-7 w-full rounded border border-border bg-background px-2 font-mono text-[11px] text-foreground outline-none focus:border-primary"
              />
            )}
          </Row>
          <div className="space-y-1.5">
            {[
              ['combine', 'Combine fills of one order'],
              ['freeze', 'Freeze on hover'],
              ['ms', 'Show milliseconds'],
            ].map(([key, label]) => (
              <label
                key={key}
                className="flex cursor-pointer items-center justify-between gap-2 rounded px-1 py-1 text-[11px] text-foreground hover:bg-accent"
              >
                {label}
                <input
                  type="checkbox"
                  checked={settings.trades[key as 'combine' | 'freeze' | 'ms']}
                  onChange={(event) =>
                    patchTrades({ [key as 'combine' | 'freeze' | 'ms']: event.currentTarget.checked })
                  }
                  className="size-3 accent-primary"
                />
              </label>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}
