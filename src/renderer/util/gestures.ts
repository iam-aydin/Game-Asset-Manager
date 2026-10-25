import { useCallback, useEffect, useRef } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';

/**
 * Left mouse button held + dragged up / down on a surface.
 * Reusable for any player (video, audio, ...). The hook only detects the
 * gesture; the caller decides what "up" and "down" do.
 *
 * Behaviour (identical to the one that used to live inside VideoPlayer):
 *  - the action fires on RELEASE, never while the button is still down
 *  - the drag must be far enough AND clearly vertical (wobbly clicks do nothing)
 *  - the click that follows the release is suppressed (see shouldSuppressClick)
 *  - the second press of a double-click is never a gesture
 *  - presses on controls / menus / modals are ignored
 *  - listeners and timers are always cleaned up (blur, unmount, new gesture)
 */

export type VerticalGesture = 'up' | 'down';

/** Presses starting inside these never begin a gesture. Mantine portals render
 *  outside the controls but React events still bubble through them, so they are
 *  listed explicitly. */
export const DEFAULT_GESTURE_IGNORE =
  '[data-vp-controls], .mantine-Popover-dropdown, .mantine-Menu-dropdown, .mantine-Modal-root';

export interface VerticalDragGestureOptions {
  /** Called once on release with the direction of the drag. */
  onGesture: (direction: VerticalGesture) => void;
  /** Minimum vertical distance in px. Default 70. */
  minDistance?: number;
  /** |dy| must be at least this many times |dx|. Default 1.5. */
  verticalBias?: number;
  /** CSS selector of elements that must not start a gesture. */
  ignoreSelector?: string;
  /** Turn the gesture off without unmounting. Default true. */
  enabled?: boolean;
}

export function useVerticalDragGesture(options: VerticalDragGestureOptions) {
  // Always read the latest options without re-creating the handler.
  const optsRef = useRef(options);
  optsRef.current = options;

  const suppressClickRef = useRef(false);
  const cleanupRef = useRef<(() => void) | null>(null);
  const timersRef = useRef<number[]>([]);

  const onMouseDown = useCallback((e: ReactMouseEvent) => {
    const o = optsRef.current;
    if (o.enabled === false) return;
    if (e.button !== 0) return;
    if (e.detail > 1) return;
    const target = e.target as HTMLElement | null;
    if (target?.closest(o.ignoreSelector ?? DEFAULT_GESTURE_IGNORE)) return;

    // Only one gesture is ever listening.
    cleanupRef.current?.();

    const startX = e.clientX;
    const startY = e.clientY;
    let lastX = startX;
    let lastY = startY;

    const onMove = (ev: MouseEvent) => {
      lastX = ev.clientX;
      lastY = ev.clientY;
    };
    const cleanup = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('blur', cleanup);
      if (cleanupRef.current === cleanup) cleanupRef.current = null;
    };
    const onUp = (ev: MouseEvent) => {
      cleanup();
      if (ev.button !== 0) return;
      const { minDistance = 70, verticalBias = 1.5 } = optsRef.current;
      const dx = lastX - startX;
      const dy = lastY - startY;
      if (Math.abs(dy) < minDistance || Math.abs(dy) < Math.abs(dx) * verticalBias) return;

      // The click that follows this release must not trigger the surface's click action.
      suppressClickRef.current = true;
      // Run the action after that click event has passed, then lift the guard.
      const t1 = window.setTimeout(() => optsRef.current.onGesture(dy < 0 ? 'up' : 'down'), 0);
      const t2 = window.setTimeout(() => {
        suppressClickRef.current = false;
      }, 150);
      timersRef.current.push(t1, t2);
    };

    cleanupRef.current = cleanup;
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('blur', cleanup);
  }, []);

  /** Call at the top of an onClick: if true, ignore that click. */
  const shouldSuppressClick = useCallback(() => suppressClickRef.current, []);

  useEffect(() => {
    return () => {
      cleanupRef.current?.();
      cleanupRef.current = null;
      timersRef.current.forEach((t) => window.clearTimeout(t));
      timersRef.current = [];
    };
  }, []);

  return { onMouseDown, shouldSuppressClick };
}
