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

// ─── 4. Text preview right-click menu (renderer) ────────────────────────────
// The menu pops in (fades, grows from the corner nearest the cursor, slides a
// few px) and plays the same animation backwards when it closes.
// TextContextMenu renders <style>{contextMenuCss()}</style> itself.

export const CONTEXT_MENU_TRANSITION = {
  durationMs: 140,
  /** CSS easing (fast start, soft landing). */
  cssEasing: 'cubic-bezier(0.22, 1, 0.36, 1)',
  /** Menu starts at this scale and grows to 1. */
  enterScale: 0.94,
  /** Menu starts this many px higher and slides down. */
  enterOffsetPx: -4,
  /** Size of the small "Ctrl + C" line relative to the label (1 = same size). */
  hintScale: 0.78
} as const;

export function contextMenuCss(): string {
  const { durationMs, cssEasing, enterScale, enterOffsetPx, hintScale } = CONTEXT_MENU_TRANSITION;
  return `
    @keyframes gam-ctx-in {
      from { opacity: 0; transform: translateY(${enterOffsetPx}px) scale(${enterScale}); }
      to   { opacity: 1; transform: none; }
    }
    @keyframes gam-ctx-out {
      from { opacity: 1; transform: none; }
      to   { opacity: 0; transform: translateY(${enterOffsetPx}px) scale(${enterScale}); }
    }
    .gam-ctx-menu {
      min-width: 160px;
      padding: 6px;
      font-size: 13px;
      animation: gam-ctx-in ${durationMs}ms ${cssEasing} both;
    }
    .gam-ctx-menu[data-state='closing'] {
      animation: gam-ctx-out ${durationMs}ms ${cssEasing} both;
      pointer-events: none;
    }
    .gam-ctx-item {
      display: flex;
      flex-direction: column;
      gap: 1px;
      padding: 6px 10px;
      border-radius: 10px;
      cursor: pointer;
      outline: none;
      transition: background 120ms ease;
    }
    .gam-ctx-item:hover,
    .gam-ctx-item:focus-visible {
      background: color-mix(in srgb, currentColor 12%, transparent);
    }
    .gam-ctx-hint {
      font-size: calc(1em * ${hintScale});
      opacity: 0.6;
      letter-spacing: 0.02em;
    }
    @media (prefers-reduced-motion: reduce) {
      .gam-ctx-menu, .gam-ctx-menu[data-state='closing'] { animation-duration: 1ms; }
    }
  `;
}

// ─── 5. Video player: play/pause indicator + status pill (renderer) ─────────
// Click the video and a glass circle pops in, holds, then shrinks away.
// A small glass pill at the top of the video shows the result of other
// actions (volume, speed, loop, seek, mute, reset) and fades after a moment.
// Pushing a limit again and again (volume past 200% / below 0%, speed past
// 4x / below 0.25x) makes the pill react: it grows and shakes at the top
// limit, and shrinks at the bottom limit. It gets stronger the longer the
// user keeps pushing.

export const PLAYBACK_INDICATOR = {
  className: 'gam-play-indicator',
  hudClassName: 'gam-vol-hud',
  sizePx: 76,
  iconPx: 34,
  /** Circle timeline: pops in, stays fully visible, then shrinks away. */
  popMs: 146,
  holdMs: 300,
  fadeMs: 414,
  cssEasing: 'cubic-bezier(0.22, 1, 0.36, 1)',
  /** Starts at this scale and grows to 1 (pinch out). */
  enterScale: 0.7,
  /** Ends at this scale while fading (pinch in). Use 1.3 for YouTube's
   *  "grows as it fades" look instead. */
  exitScale: 0.85,
  /** Status pill: how long it stays after the last action, and its fade. */
  hudHoldMs: 700,
  hudFadeMs: 180,
  hudHiddenScale: 0.92,
  /** Limit reaction: pushes closer together than this count as "persisting". */
  limitStreakGapMs: 450,
  /** The first push only shows the pill; each extra push adds one level. */
  limitMaxLevel: 6,
  /** Top limit: pill scale added per level, and shake distance per level. */
  limitGrowPerLevel: 0.1,
  limitShakePxPerLevel: 1.5,
  limitShakeMs: 360,
  /** Bottom limit: pill scale removed per level, and the smallest it gets. */
  limitShrinkPerLevel: 0.08,
  limitMinScale: 0.55,
  limitScaleEasing: 'cubic-bezier(0.34, 1.56, 0.64, 1)'
} as const;

export type HudLimit = 'max' | 'min' | null;

/** Inline CSS variables for the pill: its scale and shake distance. */
export function hudLimitStyle(limit: HudLimit, level: number): Record<string, string> {
  const { limitGrowPerLevel, limitShrinkPerLevel, limitMinScale, limitShakePxPerLevel } =
    PLAYBACK_INDICATOR;
  let k = 1;
  if (limit === 'max') k = 1 + level * limitGrowPerLevel;
  else if (limit === 'min') k = Math.max(limitMinScale, 1 - level * limitShrinkPerLevel);
  const shake = limit === 'max' ? level * limitShakePxPerLevel : 0;
  return {
    '--gam-hud-k': String(Math.round(k * 1000) / 1000),
    '--gam-hud-shake': `${shake}px`
  };
}

export function playbackIndicatorCss(): string {
  const {
    className, hudClassName, sizePx, cssEasing, enterScale, exitScale,
    popMs, holdMs, fadeMs, hudFadeMs, hudHiddenScale, limitShakeMs, limitScaleEasing
  } = PLAYBACK_INDICATOR;
  const total = popMs + holdMs + fadeMs;
  const popPct = (popMs / total) * 100;
  const holdEndPct = ((popMs + holdMs) / total) * 100;
  // Two identical shake animations with different names: React flips between
  // them (data-shake="a" / "b") so every new push restarts the shake.
  // The swings are balanced left/right so the pill stays centered.
  const shake = (name: string) => `
    @keyframes ${name} {
      0%, 100% { translate: 0 0; }
      16% { translate: calc(var(--gam-hud-shake, 0px) * -1) 0; }
      33% { translate: var(--gam-hud-shake, 0px) 0; }
      50% { translate: calc(var(--gam-hud-shake, 0px) * -0.7) 0; }
      66% { translate: calc(var(--gam-hud-shake, 0px) * 0.7) 0; }
      83% { translate: calc(var(--gam-hud-shake, 0px) * -0.35) 0; }
    }`;
  return `
    @keyframes gam-indicator-pop {
      0%   { opacity: 0; transform: scale(${enterScale}); }
      ${popPct}% { opacity: 1; transform: scale(1); }
      ${holdEndPct}% { opacity: 1; transform: scale(1); }
      100% { opacity: 0; transform: scale(${exitScale}); }
    }
    @keyframes gam-indicator-fade {
      0%   { opacity: 0; }
      ${popPct}% { opacity: 1; }
      ${holdEndPct}% { opacity: 1; }
      100% { opacity: 0; }
    }
    ${shake('gam-hud-shake-a')}
    ${shake('gam-hud-shake-b')}
    /* Doubled class so it beats the glass class's 20px radius (!important). */
    .${className}.${className} {
      border-radius: 50% !important;
      width: ${sizePx}px;
      height: ${sizePx}px;
      display: flex;
      align-items: center;
      justify-content: center;
      animation: gam-indicator-pop ${total}ms ${cssEasing} both;
      will-change: transform, opacity;
    }
    .${hudClassName} {
      position: absolute;
      top: 14px;
      /* Centered with auto margins, NOT translateX(-50%): the separate "scale"
         property is applied outside "transform", so a -50% shift in transform
         would get scaled too and the pill would drift left when it grows. */
      left: 0;
      right: 0;
      margin: 0 auto;
      width: max-content;
      z-index: 4;
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 14px;
      white-space: nowrap;
      pointer-events: none;
      opacity: 0;
      transform: scale(${hudHiddenScale});
      /* "scale" and "translate" are separate from "transform", so the limit
         reaction (grow / shrink / shake) stacks on top of the fade-in. */
      scale: var(--gam-hud-k, 1);
      transition:
        opacity ${hudFadeMs}ms ${cssEasing},
        transform ${hudFadeMs}ms ${cssEasing},
        scale 200ms ${limitScaleEasing};
    }
    .${hudClassName}[data-visible='true'] {
      opacity: 1;
      transform: scale(1);
    }
    .${hudClassName}[data-shake='a'] { animation: gam-hud-shake-a ${limitShakeMs}ms ease-in-out; }
    .${hudClassName}[data-shake='b'] { animation: gam-hud-shake-b ${limitShakeMs}ms ease-in-out; }
    @media (prefers-reduced-motion: reduce) {
      .${className}.${className} { animation-name: gam-indicator-fade; }
      .${hudClassName} { transition: opacity ${hudFadeMs}ms linear; }
      .${hudClassName}[data-shake] { animation: none; }
    }
  `;
}

// --- 6. Video player: compact bar (mini player with the title bar hidden) ---
// GAM-COMPACT-V2
// Pressing the eye button in the mini player hides the title bar. Everything
// below runs on ONE timeline (durationMs = 1.25 s), together with the header:
//   - play / title / loop / speed / effects / volume rise a few px, then drop
//     down while shaking slightly, blurring and fading out
//   - the glass box behind the bar shrinks away
//   - the video grows to fill the window
//   - what is left is [pin] [seek slider] [eye], floating over the video
//   - after autoHideMs (1 s) without mouse movement the whole bar slides down,
//     blurs and fades; moving the mouse brings it back
// VideoPlayer renders <style>{videoCompactBarCss()}</style> itself.

export const VIDEO_COMPACT_BAR = {
  /** Classes VideoPlayer puts on its elements (the CSS below targets them). */
  boxClassName: 'gam-vp-box', // the whole bar (auto-hide slide / blur / fade)
  barClassName: 'gam-vp-bar', // the glass card (shrinks and fades away)
  collapseClassName: 'gam-vp-collapse', // things that rise, drop and disappear
  revealClassName: 'gam-vp-reveal', // pin / eye slots that appear
  /** The whole hide / show timeline. The header and the video growing use it too. */
  durationMs: 600,
  cssEasing: 'cubic-bezier(0.22, 1, 0.36, 1)',
  /** Leaving buttons first rise this many px... */
  risePx: 3,
  /** ...then drop this many px while fading. */
  slidePx: 18,
  /** Side-to-side shake while dropping, in px. */
  shakePx: 1.5,
  /** Blur reached when fully gone, in px. */
  blurPx: 6,
  /** The space the buttons took closes up after they are mostly gone. */
  collapseMs: 240,
  collapseDelayMs: 360,
  /** The bar hides after this long without mouse movement (not while the
   *  pointer is on the bar, a slider is being dragged or a menu is open). */
  autoHideMs: 1000,
  /** Auto-hide slide / blur / fade. */
  hideSlidePx: 14,
  hideBlurPx: 4,
  hideFadeMs: 260
} as const;

/** CSS transition value on the same 1.25 s timeline (used by PreviewPane's
 *  header for video files, so the title bar hides together with the bar). */
export function videoChromeTransition(...props: string[]): string {
  const { durationMs, cssEasing } = VIDEO_COMPACT_BAR;
  return props.map((p) => `${p} ${durationMs}ms ${cssEasing}`).join(', ');
}

export function videoCompactBarCss(): string {
  const {
    boxClassName, barClassName, collapseClassName, revealClassName,
    durationMs, cssEasing, risePx, slidePx, shakePx, blurPx,
    collapseMs, collapseDelayMs, hideSlidePx, hideBlurPx, hideFadeMs
  } = VIDEO_COMPACT_BAR;
  const n = (x: number) => Math.round(x * 100) / 100;
  const list = (props: string[], ms: number, delay = 0) =>
    props.map((p) => `${p} ${ms}ms ${cssEasing} ${delay}ms`).join(', ');
  const geo = ['max-width', 'max-height', 'margin-left', 'margin-right'];
  const fx = ['opacity', 'transform', 'filter'];
  const glass = [
    'background-color', 'border-color', 'box-shadow',
    'backdrop-filter', '-webkit-backdrop-filter', 'padding', 'border-radius'
  ];
  return `
    /* Things that leave: rise a little, drop while shaking + blurring + fading,
       then their space closes up. Coming back is the same in reverse. */
    .${collapseClassName} {
      overflow: hidden;
      max-width: var(--gam-collapse-max, 600px);
      max-height: 80px;
      margin-left: var(--gam-collapse-ml, 0px);
      margin-right: var(--gam-collapse-mr, 0px);
      opacity: 1;
      transform: none;
      filter: blur(0px);
      transition: ${list(geo, collapseMs, 0)}, ${list(fx, 312, 216)};
    }
    [data-compact='true'] .${collapseClassName} {
      max-width: 0 !important;
      max-height: 0 !important;
      margin-left: 0 !important;
      margin-right: 0 !important;
      opacity: 0;
      transform: translateY(${slidePx}px);
      filter: blur(${blurPx}px);
      pointer-events: none;
      animation: gam-vp-leave ${durationMs}ms ease-in-out both;
      transition: ${list(geo, collapseMs, collapseDelayMs)};
    }
    @keyframes gam-vp-leave {
      0%   { opacity: 1;    transform: translate(0, 0);                                 filter: blur(0px); }
      14%  { opacity: 1;    transform: translate(0, -${risePx}px);                      filter: blur(${n(blurPx * 0.1)}px); }
      28%  { opacity: 0.9;  transform: translate(-${shakePx}px, ${n(slidePx * 0.1)}px); filter: blur(${n(blurPx * 0.25)}px); }
      42%  { opacity: 0.75; transform: translate(${shakePx}px, ${n(slidePx * 0.3)}px);  filter: blur(${n(blurPx * 0.4)}px); }
      56%  { opacity: 0.55; transform: translate(-${n(shakePx * 0.7)}px, ${n(slidePx * 0.5)}px); filter: blur(${n(blurPx * 0.55)}px); }
      70%  { opacity: 0.35; transform: translate(${n(shakePx * 0.5)}px, ${n(slidePx * 0.72)}px); filter: blur(${n(blurPx * 0.75)}px); }
      84%  { opacity: 0.15; transform: translate(-${n(shakePx * 0.25)}px, ${n(slidePx * 0.9)}px); filter: blur(${n(blurPx * 0.9)}px); }
      100% { opacity: 0;    transform: translate(0, ${slidePx}px);                      filter: blur(${blurPx}px); }
    }

    /* Slots for the pin / eye buttons: only exist in compact mode. They
       appear once the other buttons are mostly gone. */
    .${revealClassName} {
      display: none;
      align-items: center;
      flex-shrink: 0;
    }
    [data-compact='true'] .${revealClassName} {
      display: flex;
      animation: gam-vp-reveal-in ${Math.round(durationMs * 0.5)}ms ${cssEasing} ${Math.round(durationMs * 0.5)}ms both;
    }
    @keyframes gam-vp-reveal-in {
      from { opacity: 0; transform: translateY(${slidePx}px) scale(0.85); filter: blur(${blurPx}px); }
      to   { opacity: 1; transform: none; filter: blur(0px); }
    }

    /* The glass box behind the bar shrinks and fades away. */
    .${barClassName} {
      transition: ${list(glass, durationMs, 0)};
    }
    .${barClassName}::before,
    .${barClassName}::after {
      transition: opacity ${durationMs}ms ${cssEasing};
    }
    .${barClassName}[data-compact='true'] {
      background: transparent !important;
      background-color: transparent !important;
      border-color: transparent !important;
      box-shadow: none !important;
      backdrop-filter: none !important;
      -webkit-backdrop-filter: none !important;
      padding-top: 2px !important;
      padding-bottom: 2px !important;
      border-radius: 10px !important;
    }
    .${barClassName}[data-compact='true']::before,
    .${barClassName}[data-compact='true']::after {
      opacity: 0 !important;
    }

    /* Seek slider: soft blurred drop shadow while the bar floats over the video. */
    .gam-vp-seek {
      filter: drop-shadow(0 0 0 rgba(0, 0, 0, 0));
      transition: filter ${durationMs}ms ${cssEasing};
    }
    [data-compact='true'] .gam-vp-seek {
      filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.7)) drop-shadow(0 0 14px rgba(0, 0, 0, 0.5));
    }

    /* Auto-hide: the whole bar slides down, blurs and fades. */
    .${boxClassName} {
      transition: opacity ${hideFadeMs}ms ${cssEasing}, transform ${hideFadeMs}ms ${cssEasing}, filter ${hideFadeMs}ms ${cssEasing};
    }
    .${boxClassName}[data-compact='true'][data-shown='false'] {
      opacity: 0;
      transform: translateY(${hideSlidePx}px);
      filter: blur(${hideBlurPx}px);
      pointer-events: none;
    }

    @media (prefers-reduced-motion: reduce) {
      .${collapseClassName}, .${barClassName}, .${boxClassName} { transition: none; }
      [data-compact='true'] .${collapseClassName} { animation: none; }
      [data-compact='true'] .${revealClassName} { animation: none; }
    }
  `;
}
