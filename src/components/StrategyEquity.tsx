import { useMemo } from 'react';
import { formatPrice } from '../lib/format';
import { cn } from '../lib/utils';
import type { StrategyEquityPoint } from '../lib/pineVela/strategy';

interface Props {
  points: readonly StrategyEquityPoint[];
  initialCapital: number;
  className?: string;
  /** Tailwind height class; the width always fills the parent. */
  heightClass?: string;
}

const VIEW_WIDTH = 1000;
/** Enough detail for a 340px rail and a wide viewer without 100k SVG points. */
const MAX_POINTS = 600;

function signed(value: number): string {
  if (!Number.isFinite(value)) return '—';
  return `${value > 0 ? '+' : ''}${formatPrice(value, 2)}`;
}

function day(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: '2-digit' });
}

/** The strategy's net P&L curve with a zero line, for the rail and the viewer. */
export function StrategyEquity({ points, initialCapital, className, heightClass = 'h-20' }: Props) {
  const chart = useMemo(() => {
    const usable = points.filter((point) => Number.isFinite(point.equity));
    if (usable.length < 2) return null;
    const values = usable.map((point) => point.equity - initialCapital);
    const rawMin = Math.min(0, ...values);
    const rawMax = Math.max(0, ...values);
    const span = rawMax - rawMin || 1;
    const min = rawMin - span * 0.08;
    const max = rawMax + span * 0.08;
    const step = Math.max(1, Math.ceil(usable.length / MAX_POINTS));
    const sampled = usable.filter((_, index) => index % step === 0);
    if (sampled[sampled.length - 1] !== usable[usable.length - 1]) {
      sampled.push(usable[usable.length - 1]!);
    }
    const path = sampled
      .map((point, index) => {
        const x = (index / (sampled.length - 1)) * VIEW_WIDTH;
        const y = ((max - (point.equity - initialCapital)) / (max - min)) * 100;
        return `${index === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`;
      })
      .join(' ');
    return {
      path,
      zeroY: ((max - 0) / (max - min)) * 100,
      min: rawMin,
      max: rawMax,
      start: usable[0]!.time,
      end: usable[usable.length - 1]!.time,
    };
  }, [initialCapital, points]);

  if (!chart) return null;

  return (
    <div className={cn('select-none', className)}>
      <svg
        data-equity
        viewBox={`0 0 ${VIEW_WIDTH} 100`}
        preserveAspectRatio="none"
        role="img"
        aria-label="Strategy equity curve"
        className={cn('w-full text-emerald-500', heightClass)}
      >
        <line
          x1="0"
          x2={VIEW_WIDTH}
          y1={chart.zeroY}
          y2={chart.zeroY}
          className="stroke-border"
          strokeDasharray="3 3"
          vectorEffect="non-scaling-stroke"
        />
        <path
          d={chart.path}
          fill="none"
          className="stroke-current"
          strokeWidth="1.5"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <div className="mt-0.5 flex items-center justify-between text-[9px] text-muted-foreground">
        <span>{day(chart.start)}</span>
        <span className="font-mono tabular-nums">
          {signed(chart.min)} … {signed(chart.max)}
        </span>
        <span>{day(chart.end)}</span>
      </div>
    </div>
  );
}
