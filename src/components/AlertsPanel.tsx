import { useState, useSyncExternalStore } from 'react';
import { Bell, BellOff, Trash2 } from 'lucide-react';
import {
  alertEvents,
  alertRules,
  alertUnreadCount,
  alertsVersion,
  clearAlertLog,
  markAlertsRead,
  removeAlertRule,
  setAlertRuleEnabled,
  subscribeAlerts,
} from '../lib/alerts';
import type { AlertEvent } from '../types';
import { timeframeLabel } from '../lib/timeframe';

function timeLabel(ms: number): string {
  return new Date(ms).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function AlertRow({ alert }: { alert: AlertEvent }) {
  return (
    <li className="px-2 py-2">
      <div className="flex items-center gap-1.5 text-[11px]">
        <span className="font-mono font-semibold text-foreground">{alert.symbol}</span>
        {alert.timeframe ? (
          <span className="rounded border border-border px-1 text-[9px] text-muted-foreground">
            {timeframeLabel(alert.timeframe)}
          </span>
        ) : null}
        <span className="min-w-0 flex-1 truncate text-foreground">{alert.source}</span>
        {alert.kind === 'rule' ? (
          <span className="rounded bg-primary/15 px-1 text-[9px] text-primary">armed</span>
        ) : null}
      </div>
      <p className="mt-1 whitespace-pre-wrap break-words text-[11px] text-foreground/90">
        {alert.message}
      </p>
      <div className="mt-1 flex items-center gap-1.5 text-[10px] text-muted-foreground">
        <span className="font-mono">{timeLabel(alert.receivedAt)}</span>
        {alert.price !== undefined ? (
          <>
            <span>·</span>
            <span className="font-mono">{alert.price}</span>
          </>
        ) : null}
      </div>
    </li>
  );
}

/** The app's global alert history and the chart alerts armed to run without a chart. */
export function AlertsPanel() {
  useSyncExternalStore(subscribeAlerts, alertsVersion, alertsVersion);
  const rules = alertRules();
  const events = alertEvents();
  const unread = alertUnreadCount();
  const [view, setView] = useState<'rules' | 'history'>('rules');

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-1 border-b border-border px-1.5 py-1.5">
        {(
          [
            ['rules', `Armed${rules.length > 0 ? ` ${rules.length}` : ''}`],
            ['history', `History${events.length > 0 ? ` ${events.length}` : ''}`],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => {
              setView(id);
              if (id === 'history') markAlertsRead();
            }}
            className={`rounded px-2 py-1 text-[11px] ${
              view === id
                ? 'bg-accent text-foreground'
                : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'
            }`}
          >
            {label}
            {id === 'history' && unread > 0 ? (
              <span className="ml-1 rounded-full bg-primary px-1 text-[9px] text-primary-foreground">
                {unread}
              </span>
            ) : null}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-0.5">
          {view === 'history' && events.length > 0 ? (
            <button
              type="button"
              title="Mark all read"
              aria-label="Mark all read"
              onClick={() => markAlertsRead()}
              className="inline-flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <Bell className="size-3.5" />
            </button>
          ) : null}
          {view === 'history' && events.length > 0 ? (
            <button
              type="button"
              title="Clear alert history"
              aria-label="Clear alert history"
              onClick={() => clearAlertLog()}
              className="inline-flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <Trash2 className="size-3.5" />
            </button>
          ) : null}
        </div>
      </div>

      {view === 'rules' ? (
        <div className="min-h-0 flex-1 overflow-y-auto">
          {rules.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center text-muted-foreground">
              <BellOff className="size-6 opacity-40" />
              <p className="text-[12px]">
                No armed alerts. Open a Pine indicator's bell in the chart legend to create one.
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-border/60">
              {rules.map((rule) => (
                <li key={rule.id} className="px-2 py-2">
                  <div className="flex items-center gap-1.5 text-[11px]">
                    <input
                      type="checkbox"
                      checked={rule.enabled}
                      onChange={(event) => setAlertRuleEnabled(rule.id, event.target.checked)}
                      title={rule.enabled ? 'Pause alert' : 'Resume alert'}
                      className="size-3.5 shrink-0 accent-primary"
                    />
                    <span className="min-w-0 flex-1 truncate font-medium text-foreground">
                      {rule.name}
                    </span>
                    <button
                      type="button"
                      title="Delete alert"
                      aria-label="Delete alert"
                      onClick={() => removeAlertRule(rule.id)}
                      className="inline-flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
                    >
                      <Trash2 className="size-3" />
                    </button>
                  </div>
                  <div className="mt-1 flex items-center gap-1.5 text-[10px] text-muted-foreground">
                    <span className="font-mono text-foreground/80">{rule.target.symbol}</span>
                    <span>·</span>
                    <span>{timeframeLabel(rule.timeframe)}</span>
                    <span>·</span>
                    <span className="min-w-0 truncate">{rule.indicatorTitle}</span>
                  </div>
                  <div className="mt-0.5 text-[10px] text-muted-foreground">
                    {[
                      ...rule.sites,
                      ...(rule.includeAlert ? ['alert()'] : []),
                    ].join(', ')}
                    {rule.fireCount > 0 ? ` · fired ${rule.fireCount}` : ''}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          {events.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center text-muted-foreground">
              <Bell className="size-6 opacity-40" />
              <p className="text-[12px]">
                No alerts yet. Armed alerts run on closed bars without their chart.
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-border/60">
              {events.map((alert) => (
                <AlertRow key={alert.id} alert={alert} />
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
