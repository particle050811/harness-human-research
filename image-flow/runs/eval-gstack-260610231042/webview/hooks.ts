import { useEffect, useRef } from 'react';
export { formatDuration, calcProgress } from '../src/shared';

/** VS Code webview API 包装 */
export interface VSCodeApi {
  postMessage(msg: unknown): void;
  getState<T>(): T | undefined;
  setState<T>(state: T): void;
}

export function useVSCodeApi(): VSCodeApi {
  const ref = useRef<VSCodeApi | null>(null);
  if (!ref.current) {
    const vs = (window as unknown as { acquireVsCodeApi?: () => VSCodeApi }).acquireVsCodeApi?.();
    ref.current = vs ?? {
      postMessage: (msg: unknown) => {
        window.parent.postMessage(msg, '*');
      },
      getState: <T,>() => undefined as T | undefined,
      setState: <T,>(_s: T) => {},
    };
  }
  return ref.current;
}

/** 定时器 hook：interval ms 回调一次 */
export function useInterval(callback: () => void, delay: number | null): void {
  const savedCallback = useRef(callback);
  useEffect(() => {
    savedCallback.current = callback;
  }, [callback]);

  useEffect(() => {
    if (delay === null) return;
    const id = setInterval(() => savedCallback.current(), delay);
    return () => clearInterval(id);
  }, [delay]);
}
