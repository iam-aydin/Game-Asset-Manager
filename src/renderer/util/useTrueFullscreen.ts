import { useCallback, useEffect, useRef } from 'react';

/**
 * Alt+F: animated app fullscreen + real window fullscreen (like F11).
 * Steps run IN ORDER so they never fight over the window size, and presses
 * during a transition are queued (only the last wanted state is applied).
 * Real fullscreen also ends when the app fullscreen ends (F, button, gesture)
 * and the app fullscreen ends when real fullscreen ends (Esc).
 * Returns a stable toggle function.
 */
export function useTrueFullscreen(
  isFullscreen: boolean | undefined,
  onFullscreen?: () => void
): () => void {
  const isFullscreenRef = useRef(!!isFullscreen);
  isFullscreenRef.current = !!isFullscreen;
  const onFullscreenRef = useRef(onFullscreen);
  onFullscreenRef.current = onFullscreen;

  const trueFsRef = useRef(false);
  const busyRef = useRef(false);
  const pendingRef = useRef<boolean | null>(null);

  const nextFrames = () =>
    new Promise<void>((res) => requestAnimationFrame(() => requestAnimationFrame(() => res())));
  const waitMs = (ms: number) => new Promise<void>((res) => window.setTimeout(res, ms));

  const setTrueFullscreen = useCallback(async (on: boolean): Promise<void> => {
    if (busyRef.current) {
      pendingRef.current = on;
      return;
    }
    if (on === trueFsRef.current) return;
    busyRef.current = true;
    try {
      if (on) {
        trueFsRef.current = true;
        await document.documentElement.requestFullscreen();
        await nextFrames();
        await waitMs(120);
        if (!isFullscreenRef.current) onFullscreenRef.current?.();
      } else {
        if (isFullscreenRef.current) onFullscreenRef.current?.();
        await waitMs(380);
        trueFsRef.current = false;
        if (document.fullscreenElement) await document.exitFullscreen();
      }
    } catch {
      trueFsRef.current = !!document.fullscreenElement;
    } finally {
      busyRef.current = false;
      const queued = pendingRef.current;
      pendingRef.current = null;
      if (queued !== null && queued !== trueFsRef.current) void setTrueFullscreen(queued);
    }
  }, []);

  const toggle = useCallback(() => {
    if (!onFullscreenRef.current) return;
    const cur = pendingRef.current ?? trueFsRef.current;
    void setTrueFullscreen(!cur);
  }, [setTrueFullscreen]);

  // App fullscreen ended by something else (F, button, gesture): leave real fullscreen too.
  useEffect(() => {
    if (!isFullscreen && trueFsRef.current && !busyRef.current) {
      trueFsRef.current = false;
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    }
  }, [isFullscreen]);

  // Real fullscreen ended (Esc): leave app fullscreen too.
  useEffect(() => {
    const onChange = () => {
      if (!document.fullscreenElement && trueFsRef.current && !busyRef.current) {
        trueFsRef.current = false;
        if (isFullscreenRef.current) onFullscreenRef.current?.();
      }
    };
    document.addEventListener('fullscreenchange', onChange);
    return () => {
      document.removeEventListener('fullscreenchange', onChange);
      if (trueFsRef.current && document.fullscreenElement) {
        trueFsRef.current = false;
        void document.exitFullscreen?.().catch(() => undefined);
      }
    };
  }, []);

  return toggle;
}