import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  ScanProgress,
  ScanResult,
  ScanWorkerIn,
  ScanWorkerOut,
} from '../types';

interface ScanCallbacks {
  onProgress?: (progress: ScanProgress) => void;
  onResult?: (result: ScanResult) => void;
  onDone?: () => void;
  onFatal?: (error: string) => void;
}

export interface ScanParams {
  script: string;
  timeframe: string;
  symbols: string[];
  bars: number;
  concurrency?: number;
}

export function useScanner() {
  const workerRef = useRef<Worker | null>(null);
  const idRef = useRef(0);
  const callbacksRef = useRef<ScanCallbacks>({});
  const [running, setRunning] = useState(false);

  const stop = useCallback(() => {
    const worker = workerRef.current;
    if (worker) {
      worker.terminate();
      workerRef.current = null;
    }
    setRunning(false);
  }, []);

  const scan = useCallback((params: ScanParams, callbacks: ScanCallbacks) => {
    stop();
    const id = ++idRef.current;
    callbacksRef.current = callbacks;
    const worker = new Worker(new URL('./scan.worker.ts', import.meta.url), {
      type: 'module',
      name: 'pine-scan',
    });
    workerRef.current = worker;
    setRunning(true);

    worker.onmessage = (event: MessageEvent<ScanWorkerOut>) => {
      const message = event.data;
      if (message.id !== idRef.current) return;
      if (message.type === 'progress') {
        callbacksRef.current.onProgress?.({
          done: message.done,
          total: message.total,
          symbol: message.symbol,
        });
      } else if (message.type === 'result') {
        callbacksRef.current.onResult?.(message.result);
      } else if (message.type === 'done') {
        callbacksRef.current.onDone?.();
        setRunning(false);
        worker.terminate();
        if (workerRef.current === worker) workerRef.current = null;
      } else if (message.type === 'fatal') {
        callbacksRef.current.onFatal?.(message.error);
        setRunning(false);
        worker.terminate();
        if (workerRef.current === worker) workerRef.current = null;
      }
    };

    worker.onerror = (event) => {
      if (id !== idRef.current) return;
      callbacksRef.current.onFatal?.(event.message || 'Scanner worker failed');
      setRunning(false);
      worker.terminate();
      if (workerRef.current === worker) workerRef.current = null;
    };

    const request: ScanWorkerIn = {
      type: 'scan',
      id,
      script: params.script,
      timeframe: params.timeframe,
      symbols: params.symbols,
      bars: params.bars,
      concurrency: params.concurrency ?? 6,
    };
    worker.postMessage(request);
  }, [stop]);

  useEffect(() => stop, [stop]);

  return { scan, stop, running };
}
