import type {
  AlertPriceCondition,
  PriceAlertFrequency,
  VenueId,
} from '../types';

/** Everything the context menu hands the price-alert dialog. */
export interface PriceAlertSeed {
  price: number;
  /** Display price (`61 733.2`), already rounded to the chart's tick. */
  priceText: string;
  /** Decimal places used by the target's tick. */
  decimals: number;
  venue: VenueId;
  velaSymbol: string;
  symbol: string;
  timeframe: string;
}

export const PRICE_ALERT_CONDITIONS: ReadonlyArray<{
  value: AlertPriceCondition;
  label: string;
}> = [
  { value: 'crossing', label: 'Crossing' },
  { value: 'crossing-up', label: 'Crossing Up' },
  { value: 'crossing-down', label: 'Crossing Down' },
];

export const PRICE_ALERT_FREQUENCIES: ReadonlyArray<{
  value: PriceAlertFrequency;
  label: string;
}> = [
  { value: 'once', label: 'Only once' },
  { value: 'every-time', label: 'Every time' },
];

export function priceConditionLabel(condition: AlertPriceCondition): string {
  return (
    PRICE_ALERT_CONDITIONS.find((entry) => entry.value === condition)?.label ?? 'Crossing'
  );
}

export function priceFrequencyLabel(frequency: PriceAlertFrequency): string {
  return (
    PRICE_ALERT_FREQUENCIES.find((entry) => entry.value === frequency)?.label ?? 'Only once'
  );
}

export function defaultPriceAlertName(
  symbol: string,
  condition: AlertPriceCondition,
  priceText: string,
): string {
  return `${symbol} ${priceConditionLabel(condition)} ${priceText}`;
}
