import { useCallback, useEffect, useReducer, useRef } from 'react';
import {
  EMPTY_ORDER_FLOW_STATE,
  orderFlowReducer,
  type OrderFlowFrame,
  type OrderFlowState,
} from '../lib/orderflow';
import { sidecarBaseUrl } from '../venues/sidecar';

function orderFlowWsUrl(): string {
  const url = new URL(sidecarBaseUrl());
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = '/orderflow';
  url.search = '';
  url.hash = '';
  return url.toString();
}

export interface OrderFlowHandle {
  state: OrderFlowState;
  /** Drop accumulated data for peers the user removed. */
  dropVenues: (peers: string[]) => void;
  /** Restart the DOM's traded-volume window. */
  resetWindow: () => void;
}

/**
 * One live order-flow socket for the active chart symbol. Venue changes reuse
 * the socket; a symbol change reconnects and resets the window. A hidden panel
 * keeps no connection: `active` false closes it and clears the window.
 */
export function useOrderFlow(
  symbol: string,
  venues: string[] | null,
  grouping: number | null,
  active = true,
): OrderFlowHandle {
  const [state, dispatch] = useReducer(orderFlowReducer, EMPTY_ORDER_FLOW_STATE);
  const socketRef = useRef<WebSocket | null>(null);
  const venuesRef = useRef(venues);
  venuesRef.current = venues;
  const groupingRef = useRef(grouping);
  groupingRef.current = grouping;
  const venuesKey = venues === null ? '*' : venues.join(',');

  useEffect(() => {
    if (!symbol || !active) {
      dispatch({ type: 'reset' });
      return;
    }
    let stopped = false;
    let retry: ReturnType<typeof setTimeout> | null = null;
    dispatch({ type: 'reset' });

    const connect = (): void => {
      if (stopped) return;
      dispatch({ type: 'connecting' });
      const socket = new WebSocket(orderFlowWsUrl());
      socketRef.current = socket;
      socket.onopen = () => {
        if (stopped) return;
        dispatch({ type: 'open' });
        socket.send(
          JSON.stringify({
            type: 'subscribe',
            symbol,
            venues: venuesRef.current,
            grouping: groupingRef.current,
          }),
        );
      };
      socket.onmessage = (event) => {
        if (stopped) return;
        try {
          const frame = JSON.parse(String(event.data)) as OrderFlowFrame;
          dispatch({ type: 'frame', frame });
        } catch {
          // Ignore malformed frames; the next book or trade recovers.
        }
      };
      socket.onclose = () => {
        if (stopped) return;
        dispatch({ type: 'connecting' });
        retry = setTimeout(connect, 1_500);
      };
      socket.onerror = () => {
        socket.close();
      };
    };

    connect();
    return () => {
      stopped = true;
      if (retry) clearTimeout(retry);
      const socket = socketRef.current;
      socketRef.current = null;
      socket?.close();
    };
  }, [symbol, active]);

  useEffect(() => {
    const socket = socketRef.current;
    if (socket?.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify({ type: 'venues', venues }));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the key identifies the list
  }, [venuesKey]);

  useEffect(() => {
    const socket = socketRef.current;
    if (socket?.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify({ type: 'grouping', value: grouping }));
  }, [grouping]);

  const dropVenues = useCallback((drop: string[]) => {
    dispatch({ type: 'drop', venues: drop });
  }, []);

  const resetWindow = useCallback(() => {
    dispatch({ type: 'reset-window' });
  }, []);

  return { state, dropVenues, resetWindow };
}
