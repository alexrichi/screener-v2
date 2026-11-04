import { useSyncExternalStore } from 'react';
import { Bell, Trash2 } from 'lucide-react';
import {
  alertsFor,
  clearAlerts,
  subscribeAlerts,
  type ChartAlert,
} from '../lib/alerts';

interface Props {
  /** Workspace tab whose alerts the panel shows. */
  tabId: string;
}

const TF_LABEL: Record<string, string> = {
  '1': '1m',
  '3': '3m',
  '5': '5m',
  '15': '15m',
  '30': '30m',
  '60': '1h',
  '120': '2h',
  '180': '3h',
  '240': '4h',
  '360': '6h',
  '480': '8h',
  '720': '12h',
  D: '1D',
  W: '1W',
  M: '1M',
};

function timeLabel(ms: number): string {
  return new Date(ms).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function AlertRow({ alert }: { alert: ChartAlert }) {
  return (
    <li className="px-2 py-2">
      <div className="flex items-center gap-1.5 text-[11px]">
        <span className="font-mono font-semibold text-foreground">{alert.symbol}</span>
        <span className="rounded border border-border px-1 text-[9px] text-muted-foreground">
          {TF_LABEL[alert.timeframe] ?? alert.timeframe}
        </span>
        {alert.title ? (
          <span className="min-w-0 truncate text-foreground">{alert.title}</span>
        ) : null}
      </div>
      <p className="mt-1 whitespace-pre-wrap break-words text-[11px] text-foreground/90">
        {alert.message}
      </p>
      <div className="mt-1 flex items-center gap-1.5 text-[10px] text-muted-foreground">
        <span className="font-mono">{timeLabel(alert.time)}</span>
        {alert.indicator ? (
          <>
            <span>·</span>
            <span className="min-w-0 truncate">via {alert.indicator}</span>
          </>
        ) : null}
      </div>
    </li>
  );
}

/** The app's alerts surface: what Vela's topbar bell collects, per workspace tab. */
export function AlertsPanel({ tabId }: Props) {
  const alerts = useSyncExternalStore(
    subscribeAlerts,
    () => alertsFor(tabId),
    () => alertsFor(tabId),
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      {alerts.length > 0 ? (
        <div className="flex shrink-0 items-center justify-between border-b border-border px-2 py-1.5">
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
            {alerts.length} alert{alerts.length === 1 ? '' : 's'}
          </span>
          <button
            type="button"
            title="Clear alerts"
            aria-label="Clear alerts"
            onClick={() => clearAlerts(tabId)}
            className="inline-flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <Trash2 className="size-3.5" />
          </button>
        </div>
      ) : null}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {alerts.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center text-muted-foreground">
            <Bell className="size-6 opacity-40" />
            <p className="text-[12px]">No alerts yet. Scripts raise them with alert().</p>
          </div>
        ) : (
          <ul className="divide-y divide-border/60">
            {alerts.map((alert) => (
              <AlertRow key={`${alert.cellId}:${alert.id}:${alert.time}`} alert={alert} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
