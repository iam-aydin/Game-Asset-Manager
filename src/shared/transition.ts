/**
 * transition.ts: every animation in the app lives in this one file.
 *
 * Put it at src/shared/transition.ts. It is imported from BOTH sides:
 *   main process : import { animateBounds, MINI_WINDOW } from '@shared/transition';
 *   renderer     : import { runPreviewTransition, previewTransitionCss } from '@shared/transition';
 *
 * It has no React, no Electron and no DOM imports, so either side can load it.
 * To restyle an animation, edit the section for it below. Nothing else needs
 * to change (and you never have to send me a player file just for this).
 */

/// <reference lib="dom" />

// ─── Easing curves ──────────────────────────────────────────────────────────
// Each takes progress t (0 → 1) and returns eased progress (0 → 1).

export type Easing = (t: number) => number;

export const easeInOutCubic: Easing = (t) =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

export const easeOutCubic: Easing = (t) => 1 - Math.pow(1 - t, 3);

// ─── 1. Mini player: the OS window shrinks / grows (main process) ───────────

/** Size and screen-corner margin of the mini player window. */
export const MINI_WINDOW = { width: 640, height: 400, margin: 24 } as const;

export const WINDOW_TRANSITION = {
  durationMs: 240,
  easing: easeInOutCubic
} as const;

export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The few BrowserWindow methods the animation needs (keeps this file free of
 *  any electron import). */
interface BoundsWindow {
  getBounds(): Bounds;
  setBounds(bounds: Bounds): void;
  isDestroyed(): boolean;
}

/** Smoothly moves/resizes a window to `to`. Resolves when it has landed. */
export function animateBounds(
  win: BoundsWindow,
  to: Bounds,
  ms: number = WINDOW_TRANSITION.durationMs,
  easing: Easing = WINDOW_TRANSITION.easing
): Promise<void> {
  return new Promise((resolve) => {
    const from = win.getBounds();
    const start = Date.now();
    const tick = () => {
      if (win.isDestroyed()) return resolve();
      const t = Math.min(1, (Date.now() - start) / ms);
      const k = easing(t);
      win.setBounds({
        x: Math.round(from.x + (to.x - from.x) * k),
        y: Math.round(from.y + (to.y - from.y) * k),
        width: Math.round(from.width + (to.width - from.width) * k),
        height: Math.round(from.height + (to.height - from.height) * k)
      });
      if (t < 1) setTimeout(tick, 8);
      else resolve();
    };
    tick();
  });
}

// ─── 2. Preview expand / shrink inside the app window (renderer) ────────────
// Uses the browser's View Transitions API: the preview container is
// snapshotted before and after the layout change and the browser morphs
// between the two. PreviewPane puts `view-transition-name` on its container.
// The rest of the UI (the "root" snapshot) blurs while the preview moves, so
// the preview feels like it is lifting on top of the app.

export const PREVIEW_TRANSITION = {
  /** Must match the `viewTransitionName` PreviewPane sets on its container. */
  name: 'gam-preview',
  durationMs: 320,
  /** CSS easing (fast start, soft landing). */
  cssEasing: 'cubic-bezier(0.22, 1, 0.36, 1)',
  radiusPx: 8,
  /** Blur applied to the rest of the UI mid-transition. 0 = no blur. */
  bgBlurPx: 12
} as const;

type ViewTransitionDoc = {
  startViewTransition?: (update: () => void) => unknown;
};
type BrowserGlobals = {
  document?: ViewTransitionDoc;
  matchMedia?: (query: string) => { matches: boolean };
};

/**
 * Runs `update` inside an animated transition. `update` must apply its React
 * state change synchronously (wrap it in flushSync, as PreviewPane does) so
 * the browser takes its "after" snapshot of the new layout.
 * Falls back to a plain instant update if the API is missing or the OS asks
 * for reduced motion.
 */
export function runPreviewTransition(update: () => void): void {
  const g = globalThis as unknown as BrowserGlobals;
  const reduceMotion = g.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const start = g.document?.startViewTransition;
  if (typeof start !== 'function' || reduceMotion) {
    update();
    return;
  }
  start.call(g.document, update);
}

/** The CSS that styles the preview transition. Render once, e.g.
 *  <style>{previewTransitionCss()}</style> */
export function previewTransitionCss(): string {
  const { name, durationMs, cssEasing, radiusPx, bgBlurPx } = PREVIEW_TRANSITION;
  return `
    /* The rest of the page: old UI blurs out while the new UI blurs in, so
       the whole app looks frosted while the preview moves on top of it. */
    @keyframes gam-bg-out {
      from { filter: blur(0px); opacity: 1; }
      to   { filter: blur(${bgBlurPx}px); opacity: 0; }
    }
    @keyframes gam-bg-in {
      from { filter: blur(${bgBlurPx}px); opacity: 0; }
      to   { filter: blur(0px); opacity: 1; }
    }

    ::view-transition-old(root),
    ::view-transition-new(root) {
      mix-blend-mode: normal;
      animation-duration: ${durationMs}ms;
      animation-timing-function: ${cssEasing};
      animation-fill-mode: both;
    }
    ::view-transition-old(root) {
      animation-name: gam-bg-out;
    }
    ::view-transition-new(root) {
      animation-name: gam-bg-in;
    }

    /* The moving / resizing box. */
    ::view-transition-group(${name}) {
      animation-duration: ${durationMs}ms;
      animation-timing-function: ${cssEasing};
      overflow: clip;
      border-radius: ${radiusPx}px;
      z-index: 1;
    }

    /* The before / after pictures inside it (they cross-fade while it moves). */
    ::view-transition-old(${name}),
    ::view-transition-new(${name}) {
      animation-duration: ${durationMs}ms;
      animation-timing-function: ${cssEasing};
      width: 100%;
      height: 100%;
      object-fit: fill;
    }
  `;
}

// ─── 2b. Mini player: hide / show the interface (renderer) ──────────────────
// The eye button in the mini player header collapses everything except the
// header buttons: the filename and header background slide out to the window
// edge, the control strip (View / Environment / Grid) slides down and
// disappears, and the viewport label (Grid: 1 cell = 1 units) shrinks.
// PreviewPane drives these with plain CSS transitions using the values below.

export const MINI_CHROME_TRANSITION = {
  durationMs: 280,
  /** CSS easing (same feel as the expand animation). */
  cssEasing: 'cubic-bezier(0.22, 1, 0.36, 1)',
  /** How far the filename slides toward the left edge while fading, in px. */
  titleSlidePx: 24,
  /** How far the control strip slides down while it collapses, as a % of its height. */
  stripSlidePercent: 100,
  /** Scale the viewport label ends at when the interface is hidden (1 = no shrink). */
  labelScale: 0.7
} as const;

/** Builds a CSS `transition` value for the given properties, e.g.
 *  miniChromeTransition('opacity', 'transform'). */
export function miniChromeTransition(...props: string[]): string {
  const { durationMs, cssEasing } = MINI_CHROME_TRANSITION;
  return props.map((p) => `${p} ${durationMs}ms ${cssEasing}`).join(', ');
}

/** CSS for the viewport label. Give the label element the class
 *  `gam-viewport-label`; PreviewPane sets data-mini-chrome="hidden" | "shown"
 *  on its container. Render once: <style>{miniChromeCss()}</style> */
export function miniChromeCss(): string {
  const { labelScale } = MINI_CHROME_TRANSITION;
  return `
    [data-mini-chrome] .gam-viewport-label {
      transform-origin: left bottom;
      transition: ${miniChromeTransition('transform', 'opacity')};
    }
    [data-mini-chrome="hidden"] .gam-viewport-label {
      transform: scale(${labelScale});
      opacity: 0.75;
    }
    @media (prefers-reduced-motion: reduce) {
      [data-mini-chrome] .gam-viewport-label { transition: none; }
    }
  `;
}

// ─── 3. Resize blur (renderer) ──────────────────────────────────────────────
// A full-window frosted layer that hides layout glitches while the window
// changes size. It appears the moment the window starts resizing (dragging an
// edge, or the I-key mini player animation), stays while it keeps resizing,
// and fades out `holdMs` after the last resize.
// Call installResizeBlur() once at app start (App.tsx), and
// pulseResizeBlur() right before a layout swap you want covered.

export const RESIZE_BLUR = {
  /** Blur strength. 0 = no blur, just the tint. */
  blurPx: 14,
  /** How much of the theme background colour tints the layer (0 to 1). */
  tint: 0.55,
  /** Blur stays this long after the LAST resize event, then fades. */
  holdMs: 200,
  fadeInMs: 90,
  fadeOutMs: 280,
  easing: 'cubic-bezier(0.22, 1, 0.36, 1)'
} as const;

let blurBump: (() => void) | null = null;

/** Shows the blur now and (re)starts the hold timer. No-op until installed. */
export function pulseResizeBlur(): void {
  blurBump?.();
}

/** Creates the blur layer and listens for window resizes.
 *  Returns a cleanup function (use it as a useEffect return value). */
export function installResizeBlur(): () => void {
  if (typeof document === 'undefined') return () => undefined;
  const { blurPx, tint, holdMs, fadeInMs, fadeOutMs, easing } = RESIZE_BLUR;

  const el = document.createElement('div');
  el.setAttribute('aria-hidden', 'true');
  const s = el.style;
  s.position = 'fixed';
  s.inset = '0';
  s.zIndex = '100000'; // above modals, popovers and the mini player
  s.pointerEvents = 'none';
  s.opacity = '0';
  s.visibility = 'hidden';
  s.willChange = 'opacity';
  s.background = `color-mix(in srgb, var(--wh3d-viewport-bg, #101113) ${Math.round(tint * 100)}%, transparent)`;
  if (blurPx > 0) {
    s.setProperty('backdrop-filter', `blur(${blurPx}px)`);
    s.setProperty('-webkit-backdrop-filter', `blur(${blurPx}px)`);
  }
  document.body.appendChild(el);

  let visible = false;
  let holdTimer: ReturnType<typeof setTimeout> | undefined;
  let hideTimer: ReturnType<typeof setTimeout> | undefined;

  const show = () => {
    if (hideTimer) {
      clearTimeout(hideTimer);
      hideTimer = undefined;
    }
    if (visible) return;
    visible = true;
    s.visibility = 'visible';
    s.transition = `opacity ${fadeInMs}ms ease-out`;
    s.opacity = '1';
  };

  const hide = () => {
    visible = false;
    s.transition = `opacity ${fadeOutMs}ms ${easing}`;
    s.opacity = '0';
    hideTimer = setTimeout(() => {
      s.visibility = 'hidden'; // stop compositing the blur once it is invisible
    }, fadeOutMs);
  };

  const bump = () => {
    show();
    if (holdTimer) clearTimeout(holdTimer);
    holdTimer = setTimeout(hide, holdMs);
  };

  blurBump = bump;
  window.addEventListener('resize', bump);

  return () => {
    window.removeEventListener('resize', bump);
    if (holdTimer) clearTimeout(holdTimer);
    if (hideTimer) clearTimeout(hideTimer);
    if (blurBump === bump) blurBump = null;
    el.remove();
  };
}