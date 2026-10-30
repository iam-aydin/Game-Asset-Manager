import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Smooth, gentle zoom shared by ImagePreview and IconPreview.
 *
 *  - One mouse-wheel notch is about 5%. Touchpads send many small deltas, so
 *    they zoom proportionally less per event.
 *  - The view glides to the target (exponential smoothing, anchored on the
 *    pointer), instead of jumping on every wheel event.
 *  - Fast scrolling keeps stacking onto the same target, so it still feels
 *    responsive.
 */

export interface View {
  zoom: number; // 1 = fit
  x: number; // pan, px
  y: number;
}

export const VIEW_ZOOM_MIN = 0.1;
export const VIEW_ZOOM_MAX = 40;
/** Multiplier for the + / - buttons (10% per click). */
export const VIEW_ZOOM_STEP = 1.1;

/** Per wheel event: ln(1.05) / 100. A standard notch (100) = 5%. */
const WHEEL_SENSITIVITY = 0.00049;
const WHEEL_MAX_DELTA = 100;
/** Higher = the glide catches up faster. */
const SMOOTH_RATE = 11;

export const clampViewZoom = (z: number): number =>
  Math.min(VIEW_ZOOM_MAX, Math.max(VIEW_ZOOM_MIN, z));

/** Zoom factor for one wheel event (> 1 when scrolling up). */
export function wheelZoomFactor(e: { deltaY: number; deltaMode: number }): number {
  let dy = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY;
  dy = Math.max(-WHEEL_MAX_DELTA, Math.min(WHEEL_MAX_DELTA, dy));
  return Math.exp(-dy * WHEEL_SENSITIVITY);
}

interface Target {
  zoom: number;
  /** Keep this point (relative to the viewport centre) fixed while zooming. */
  anchor: { x: number; y: number } | null;
  /** Also glide the pan to this position (reset / actual size). */
  pan: { x: number; y: number } | null;
}

const prefersReducedMotion = (): boolean =>
  typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export function useSmoothView(initial: View = { zoom: 1, x: 0, y: 0 }) {
  const [view, setViewState] = useState<View>(initial);
  const viewRef = useRef<View>(view);
  const targetRef = useRef<Target | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastRef = useRef(0);

  const commit = useCallback((v: View) => {
    viewRef.current = v;
    setViewState(v);
  }, []);

  const stop = useCallback(() => {
    targetRef.current = null;
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  const frame = useCallback(
    (now: number) => {
      rafRef.current = null;
      const t = targetRef.current;
      if (!t) return;
      const dt = Math.min(0.05, Math.max(0.001, (now - lastRef.current) / 1000));
      lastRef.current = now;
      const k = 1 - Math.exp(-dt * SMOOTH_RATE);
      const v = viewRef.current;

      const zoomDone = Math.abs(Math.log(t.zoom / v.zoom)) < 0.002;
      const zoom = zoomDone ? t.zoom : v.zoom * Math.pow(t.zoom / v.zoom, k);
      let x = v.x;
      let y = v.y;
      let panDone = true;
      if (t.pan) {
        x += (t.pan.x - x) * k;
        y += (t.pan.y - y) * k;
        panDone = Math.hypot(t.pan.x - x, t.pan.y - y) < 0.5;
        if (panDone) {
          x = t.pan.x;
          y = t.pan.y;
        }
      } else if (t.anchor) {
        const r = zoom / v.zoom;
        x = t.anchor.x - (t.anchor.x - v.x) * r;
        y = t.anchor.y - (t.anchor.y - v.y) * r;
      }
      commit({ zoom, x, y });

      if (zoomDone && panDone) {
        targetRef.current = null;
        return;
      }
      rafRef.current = requestAnimationFrame(frame);
    },
    [commit]
  );

  const start = useCallback(() => {
    if (rafRef.current === null) {
      lastRef.current = performance.now();
      rafRef.current = requestAnimationFrame(frame);
    }
  }, [frame]);

  /** Multiply the zoom by `factor`, keeping the point (cx, cy) under the pointer. */
  const zoomBy = useCallback(
    (factor: number, cx = 0, cy = 0) => {
      const cur = viewRef.current;
      const t = targetRef.current;
      const base = t && !t.pan ? t.zoom : cur.zoom;
      const zoom = clampViewZoom(base * factor);
      if (prefersReducedMotion()) {
        stop();
        const r = zoom / cur.zoom;
        commit({ zoom, x: cx - (cx - cur.x) * r, y: cy - (cy - cur.y) * r });
        return;
      }
      targetRef.current = { zoom, anchor: { x: cx, y: cy }, pan: null };
      start();
    },
    [commit, start, stop]
  );

  /** Glide to an exact view (reset to fit, actual size). */
  const animateTo = useCallback(
    (v: View) => {
      if (prefersReducedMotion()) {
        stop();
        commit(v);
        return;
      }
      targetRef.current = { zoom: clampViewZoom(v.zoom), anchor: null, pan: { x: v.x, y: v.y } };
      start();
    },
    [commit, start, stop]
  );

  const reset = useCallback(() => animateTo({ zoom: 1, x: 0, y: 0 }), [animateTo]);

  /** Direct change (dragging the picture). Cancels any glide in progress. */
  const setView = useCallback(
    (next: View | ((v: View) => View)) => {
      stop();
      commit(typeof next === 'function' ? next(viewRef.current) : next);
    },
    [commit, stop]
  );

  useEffect(() => stop, [stop]);

  return { view, setView, zoomBy, animateTo, reset };
}
