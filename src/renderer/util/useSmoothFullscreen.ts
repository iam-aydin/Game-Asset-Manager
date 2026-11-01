import { useCallback, useEffect, useRef } from 'react';
import { PREVIEW_TRANSITION, pulseResizeBlur } from '@shared/transition';

// How long the frosted glass layer fades in BEFORE the window snaps (it hides the snap).
const FROST_MS = 130;
// Short pause after the window changed size, before the layout animation starts.
const SETTLE_MS = 90;

const wait = (ms: number) => new Promise<void>((res) => window.setTimeout(res, ms));
const nextFrames = () =>
  new Promise<void>((res) => requestAnimationFrame(() => requestAnimationFrame(() => res())));

/**
 * Alt+F: real (F11-style) fullscreen + the preview's animated app fullscreen.
 *   enter: frosted glass fades in -> window goes fullscreen (hidden by the glass)
 *          -> the glass lifts while the preview zooms to fill the window.
 *   leave: the preview shrinks first -> frosted glass fades in -> window leaves fullscreen.
 * The window resize and the layout animation never overlap (resizing during a view
 * transition freezes the page).
 *
 * isFullscreen / onFullscreen are the preview's animated app-fullscreen state and toggle.
 * Returns the toggle to call from the Alt+F key handler.
 */
export function useSmoothFullscreen(
  isFullscreen: boolean | undefined,
  onFullscreen: (() => void) | undefined
): () => void {
  const fsRef = useRef(!!isFullscreen);
  fsRef.current = !!isFullscreen;
  const cbRef = useRef(onFullscreen);
  cbRef.current = onFullscreen;

  const winFsRef = useRef(false); // the window is (or is going) fullscreen via Alt+F
  const busyRef = useRef(false);
  const pendingRef = useRef<boolean | null>(null);

  const run = useCallback(async (on: boolean): Promise<void> => {
    if (busyRef.current) {
      pendingRef.current = on;
      return;
    }
    if (on === winFsRef.current) return;
    busyRef.current = true;
    try {
      if (on) {
        winFsRef.current = true;
        pulseResizeBlur(); // glass fades in
        await wait(FROST_MS);
        await document.documentElement.requestFullscreen(); // the snap, under the glass
        await nextFrames();
        pulseResizeBlur(); // keep the glass up while the layout settles
        await wait(SETTLE_MS);
        if (!fsRef.current) cbRef.current?.(); // preview zooms while the glass lifts
        await wait(PREVIEW_TRANSITION.durationMs + 40);
      } else {
        if (fsRef.current) {
          cbRef.current?.(); // preview shrinks inside the still-fullscreen window
          await wait(PREVIEW_TRANSITION.durationMs + 40);
        }
        pulseResizeBlur();
        await wait(FROST_MS);
        winFsRef.current = false;
        if (document.fullscreenElement) await document.exitFullscreen();
        await nextFrames();
      }
    } catch {
      winFsRef.current = !!document.fullscreenElement;
    } finally {
      busyRef.current = false;
      const queued = pendingRef.current;
      pendingRef.current = null;
      if (queued !== null && queued !== winFsRef.current) {
        void run(queued);
      } else if (winFsRef.current && !fsRef.current && !document.fullscreenElement) {
        winFsRef.current = false;
      }
    }
  }, []);

  // Esc (or anything else) left real fullscreen: close the app fullscreen too.
  useEffect(() => {
    const onChange = () => {
      if (!document.fullscreenElement && winFsRef.current && !busyRef.current) {
        winFsRef.current = false;
        pulseResizeBlur();
        if (fsRef.current) cbRef.current?.();
      }
    };
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  // The layout was closed by another route (F key, the button, I): bring the window back too.
  useEffect(() => {
    if (!isFullscreen && winFsRef.current && !busyRef.current) void run(false);
  }, [isFullscreen, run]);

  // Never leave the window fullscreen if the player goes away.
  useEffect(() => {
    return () => {
      if (winFsRef.current && document.fullscreenElement) {
        winFsRef.current = false;
        void document.exitFullscreen?.().catch(() => undefined);
      }
    };
  }, []);

  return useCallback(() => {
    const cur = pendingRef.current ?? winFsRef.current;
    void run(!cur);
  }, [run]);
}