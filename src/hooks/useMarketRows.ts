import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MarketRow, VenueId } from '../types';
import { venueLabel } from '../venues/catalog';
import { fetchMarketRows } from '../lib/marketData';

export function useMarketRows(refreshSeconds: number, venues: VenueId[]) {
  const [rows, setRows] = useState<MarketRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [venueErrors, setVenueErrors] = useState<Record<string, string>>({});
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const inFlight = useRef<AbortController | null>(null);
  const venueKey = venues.join(',');

  const refresh = useCallback(async () => {
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;
    const activeVenues = venueKey ? venueKey.split(',') : [];

    if (activeVenues.length === 0) {
      setRows([]);
      setVenueErrors({});
      setUpdatedAt(Date.now());
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const next = await fetchMarketRows(activeVenues, controller.signal);
      if (controller.signal.aborted) return;
      setRows(next.rows);
      setVenueErrors(next.errors);
      setUpdatedAt(Date.now());
    } catch (cause) {
      if (controller.signal.aborted) return;
      const message = cause instanceof Error ? cause.message : String(cause);
      setVenueErrors(
        Object.fromEntries(activeVenues.map((venue) => [venue, message])),
      );
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [venueKey]);

  useEffect(() => {
    void refresh();
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh();
    }, Math.max(3, refreshSeconds) * 1000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
      inFlight.current?.abort();
    };
  }, [refresh, refreshSeconds]);

  const error = useMemo(() => {
    const entries = Object.entries(venueErrors);
    if (entries.length === 0) return null;
    return entries
      .map(([venue, message]) => `${venueLabel(venue)}: ${message}`)
      .join(' · ');
  }, [venueErrors]);

  return { rows, loading, error, venueErrors, updatedAt, refresh };
}
