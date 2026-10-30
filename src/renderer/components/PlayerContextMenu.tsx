import { Fragment, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type SyntheticEvent } from 'react';
import { createPortal } from 'react-dom';
import { Text } from '@mantine/core';
import { IconCheck, IconChevronRight } from '@tabler/icons-react';
import { PLAYER_GLASS_POPOVER_CLASS } from './PlayerGlass';

export interface CtxSection {
  id: string;
  label: string;
  /** Flyout width in px (default 240 for content, 200 for a list of children). */
  width?: number;
  content?: ReactNode;
  /** Sub-menu: this row opens a flyout that lists these rows (any depth). */
  children?: CtxSection[];
  /** Plain action row: runs on click, opens no flyout. */
  onSelect?: () => void;
  /** Thin line above this row. */
  separator?: boolean;
}

const MENU_W = 220;
const FLY_GAP = 6;

const hasFly = (s: CtxSection) => s.content != null || (s.children?.length ?? 0) > 0;

/** Width of the widest chain of flyouts this menu can ever open (gaps included). */
function maxChainWidth(list: CtxSection[]): number {
  let best = 0;
  for (const s of list) {
    if (!hasFly(s)) continue;
    const w = s.width ?? (s.children ? 200 : 240);
    best = Math.max(best, FLY_GAP + w + (s.children ? maxChainWidth(s.children) : 0));
  }
  return best;
}

const css = `
.gam-ctx-row { display:flex; align-items:center; justify-content:space-between; gap:8px;
  padding:12px 14px; border-radius:10px; cursor:default; user-select:none;
  font-weight:500; position:relative;
  transition: background 120ms ease; }
.gam-ctx-row + .gam-ctx-row { margin-top:2px; }
.gam-ctx-sub .gam-ctx-row { padding:9px 12px; }
.gam-ctx-row:hover, .gam-ctx-row[data-active='true'] { background: rgba(128,128,128,0.2); }
.gam-ctx-row[data-active='true']::before {
  content:''; position:absolute; left:3px; top:9px; bottom:9px; width:3px; border-radius:2px;
  background: var(--wh3d-waveform-played, #4c6ef5); }
.gam-ctx-row svg { opacity:0.7; transition: transform 140ms ease, opacity 140ms ease; }
.gam-ctx-row[data-active='true'] svg { opacity:1; transform: translateX(2px); }
.gam-ctx-opt { display:flex; align-items:center; gap:8px; padding:10px 12px; border-radius:10px;
  cursor:default; user-select:none; transition: background 120ms ease; }
.gam-ctx-opt:hover { background: rgba(128,128,128,0.22); }
.gam-ctx-opt[data-checked='true'] { background: color-mix(in srgb, var(--wh3d-waveform-played, #4c6ef5) 26%, transparent); }

/* Opening: starts blurred and small, sharpens fast, with a tiny sideways wobble */
@keyframes gam-ctx-in {
  0%   { opacity:0; filter:blur(12px); transform:scale(0.95) translateX(-2px); }
  35%  { opacity:1; filter:blur(4px);  transform:scale(1.008) translateX(2px); }
  65%  { filter:blur(1px);             transform:scale(1) translateX(-1px); }
  100% { opacity:1; filter:blur(0);    transform:scale(1) translateX(0); }
}
@keyframes gam-ctx-fly {
  0%   { opacity:0; filter:blur(8px); transform:translateX(-6px) scale(0.98); }
  100% { opacity:1; filter:blur(0);   transform:translateX(0) scale(1); }
}
.gam-ctx-panel { animation: gam-ctx-in 220ms cubic-bezier(0.2, 0.8, 0.2, 1) both; transform-origin: top left; }
.gam-ctx-fly { animation: gam-ctx-fly 170ms cubic-bezier(0.2, 0.8, 0.2, 1) both; }
@media (prefers-reduced-motion: reduce) {
  .gam-ctx-panel, .gam-ctx-fly { animation: none; }
}
`;

// ---- Click outside: close the menu and swallow that click ----------------------
// The click that closes the menu must NOT reach the video (no play / pause, no
// fullscreen). This lives outside React on purpose: the menu unmounts as soon as it
// closes, but the swallowing has to outlive it until the click has finished.
let swallowing = false;

function swallowNextClick(): void {
  if (swallowing) return;
  swallowing = true;
  const types = ['pointerup', 'mouseup', 'click', 'dblclick'] as const;
  let timer = 0;
  const done = () => {
    swallowing = false;
    window.clearTimeout(timer);
    types.forEach((t) => window.removeEventListener(t, stop, true));
  };
  function stop(e: Event) {
    e.stopPropagation();
    if (e.type === 'click' || e.type === 'dblclick') done();
  }
  types.forEach((t) => window.addEventListener(t, stop, true));
  timer = window.setTimeout(done, 1500); // safety net if the click never completes
}

/** PotPlayer-style right-click menu: a list of entries, each opens a flyout on hover.
 *  Entries can have `children`, which open further flyouts to the side (any depth). */
export function PlayerContextMenu({
  x,
  y,
  sections,
  onClose
}: {
  x: number;
  y: number;
  sections: CtxSection[];
  onClose: () => void;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const flyRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [pos, setPos] = useState({ left: x, top: y });
  // path[k] = the row that opened flyout k, and where that row sits (px from the menu's top).
  const [path, setPath] = useState<{ id: string; top: number }[]>([]);
  const [shifts, setShifts] = useState<number[]>([]);
  // True while the mouse button is held down inside the menu (dragging a slider).
  // The menu then ignores everything that would close it or switch flyouts.
  const dragRef = useRef(false);

  // Keep the main list inside the window.
  useLayoutEffect(() => {
    const el = panelRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({
      left: Math.max(4, Math.min(x, window.innerWidth - r.width - 4)),
      top: Math.max(4, Math.min(y, window.innerHeight - r.height - 4))
    });
  }, [x, y]);

  // The chain of sections that are open right now: chain[k] is shown in flyout k.
  const chain: CtxSection[] = [];
  {
    let list = sections;
    for (const p of path) {
      const f = list.find((s) => s.id === p.id);
      if (!f) break;
      chain.push(f);
      list = f.children ?? [];
    }
  }
  const widths = chain.map((s) => s.width ?? (s.children ? 200 : 240));

  // Horizontal layout. Opens to the right; if that does not fit, the whole chain opens to the left.
  // The side is decided once from the widest possible chain, so opening a deeper flyout
  // never moves the ones that are already open.
  const need = maxChainWidth(sections);
  const roomR = window.innerWidth - 4 - (pos.left + MENU_W);
  const roomL = pos.left - 4;
  const flip = need <= roomR ? false : need <= roomL ? true : roomL > roomR;
  const lefts: number[] = [];
  {
    let edge = flip ? 0 : MENU_W;
    widths.forEach((w, k) => {
      let l = flip ? edge - FLY_GAP - w : edge + FLY_GAP;
      const abs = Math.max(4, Math.min(pos.left + l, window.innerWidth - w - 4));
      l = abs - pos.left;
      lefts[k] = l;
      edge = flip ? l : l + w;
    });
  }

  // Keep every flyout inside the window vertically.
  useLayoutEffect(() => {
    const rootTop = rootRef.current?.getBoundingClientRect().top ?? 0;
    const next = chain.map((_, k) => {
      const el = flyRefs.current[k];
      if (!el || !path[k]) return 0;
      const naturalTop = rootTop + path[k].top;
      const over = naturalTop + el.offsetHeight - (window.innerHeight - 8);
      return over > 0 ? Math.min(over, Math.max(0, naturalTop - 8)) : 0;
    });
    if (next.length !== shifts.length || next.some((v, i) => v !== shifts[i])) setShifts(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, pos.top]);

  useEffect(() => {
    const inRoot = (t: EventTarget | null) => !!rootRef.current && rootRef.current.contains(t as Node);

    const down = (e: Event) => {
      const me = e as PointerEvent;
      if (inRoot(e.target)) {
        // Pressing inside the menu: lock everything until the button is released.
        if (e.type === 'pointerdown' && me.button === 0) {
          dragRef.current = true;
        }
        return;
      }
      if (dragRef.current) return;
      // Left click anywhere else (usually on the video): only close the menu.
      if (me.button === 0 || me.button === undefined) {
        e.stopPropagation();
        swallowNextClick();
      }
      onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    const blur = () => {
      if (dragRef.current) return;
      onClose();
    };
    const release = () => {
      // A tick later, so the click that ends a drag still counts as "inside".
      window.setTimeout(() => {
        dragRef.current = false;
      }, 30);
    };
    const move = (e: PointerEvent) => {
      if (dragRef.current && e.buttons === 0) dragRef.current = false;
    };

    // While the menu is open nothing behind it may read the mouse: moves, releases, clicks
    // and wheel that land outside the menu are stopped before they reach the player.
    // (A slider being dragged keeps the pointer captured, so its events target the slider
    // itself and pass through here untouched.)
    const BLOCK = ['pointermove', 'mousemove', 'pointerup', 'mouseup', 'click', 'dblclick', 'wheel', 'contextmenu'] as const;
    const block = (e: Event) => {
      if (inRoot(e.target)) return;
      // A press that started inside the menu (a slider drag) is still held: let the moves and
      // the release through wherever the mouse is, or the slider would freeze.
      if (dragRef.current && e.type !== 'click' && e.type !== 'dblclick' && e.type !== 'contextmenu') return;
      if (e.type === 'contextmenu') e.preventDefault();
      e.stopPropagation();
    };
    BLOCK.forEach((t) => window.addEventListener(t, block, true));

    window.addEventListener('pointerdown', down, true);
    window.addEventListener('mousedown', down, true);
    window.addEventListener('keydown', key, true);
    window.addEventListener('blur', blur);
    window.addEventListener('pointerup', release, true);
    window.addEventListener('pointercancel', release, true);
    window.addEventListener('lostpointercapture', release, true);
    window.addEventListener('pointermove', move, true);
    return () => {
      BLOCK.forEach((t) => window.removeEventListener(t, block, true));
      window.removeEventListener('pointerdown', down, true);
      window.removeEventListener('mousedown', down, true);
      window.removeEventListener('keydown', key, true);
      window.removeEventListener('blur', blur);
      window.removeEventListener('pointerup', release, true);
      window.removeEventListener('pointercancel', release, true);
      window.removeEventListener('lostpointercapture', release, true);
      window.removeEventListener('pointermove', move, true);
    };
  }, [onClose]);

  /** Open `id` as flyout number `level` (0 = opened from the main list). */
  const open = (level: number, id: string, el: HTMLElement) => {
    if (dragRef.current) return; // a slider is being dragged: stay where we are
    const rr = rootRef.current?.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    const top = r.top - (rr?.top ?? 0) - 4;
    setPath((p) => (p[level]?.id === id ? p : [...p.slice(0, level), { id, top }]));
  };
  /** Close flyout number `level` and everything deeper. */
  const closeFrom = (level: number) => {
    if (dragRef.current) return;
    setPath((p) => (p.length > level ? p.slice(0, level) : p));
  };

  const row = (s: CtxSection, level: number) => (
    <Fragment key={s.id}>
      {s.separator && <div style={{ height: 1, margin: '6px 8px', background: 'rgba(128,128,128,0.3)' }} />}
      <div
        className="gam-ctx-row"
        data-active={path[level]?.id === s.id ? 'true' : 'false'}
        onMouseEnter={(e) => (hasFly(s) ? open(level, s.id, e.currentTarget) : closeFrom(level))}
        onClick={(e) => (s.onSelect ? s.onSelect() : hasFly(s) ? open(level, s.id, e.currentTarget) : undefined)}
      >
        <Text size="sm">{s.label}</Text>
        {hasFly(s) && <IconChevronRight size={12} />}
      </div>
    </Fragment>
  );

  // Portals bubble React events up to the player that rendered the menu (its onClick,
  // onMouseDown, ... would fire). Stop that here so the player never sees menu input.
  // NOTE: this must only stop React's own bubbling. A real e.stopPropagation() also stops the
  // native event before it reaches `document`, and the sliders listen for mousemove / mouseup
  // there, so they would freeze.
  const stop = (e: SyntheticEvent) => {
    (e as unknown as { isPropagationStopped: () => boolean }).isPropagationStopped = () => true;
  };
  const isolate = {
    onClick: stop,
    onDoubleClick: stop,
    onMouseDown: stop,
    onMouseUp: stop,
    onMouseMove: stop,
    onPointerDown: stop,
    onPointerUp: stop,
    onPointerMove: stop,
    onWheel: stop,
    onTouchStart: stop,
    onTouchMove: stop,
    onTouchEnd: stop,
    onKeyDown: stop
  };

  return createPortal(
    <>
    {/* Invisible shield over the whole window: the video behind the menu gets no hover, press or drag. */}
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 999 }}
      {...isolate}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
    />
    <div
      ref={rootRef}
      style={{ position: 'fixed', left: pos.left, top: pos.top, zIndex: 1000 }}
      {...isolate}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      <style>{css}</style>
      <div
        ref={panelRef}
        className={`${PLAYER_GLASS_POPOVER_CLASS} gam-ctx-panel`}
        style={{ position: 'relative', width: MENU_W, padding: 8, borderRadius: 14 }}
      >
        {sections.map((s) => row(s, 0))}
      </div>
      {chain.map((sec, k) => {
        const kids = sec.children;
        return (
          <div
            key={`${k}:${sec.id}`}
            ref={(el) => {
              flyRefs.current[k] = el;
            }}
            className={`${PLAYER_GLASS_POPOVER_CLASS} gam-ctx-fly${kids ? ' gam-ctx-sub' : ''}`}
            style={{
              position: 'absolute',
              top: path[k].top - (shifts[k] ?? 0),
              left: lefts[k],
              width: widths[k],
              padding: kids ? 8 : 18,
              borderRadius: 12,
              maxHeight: window.innerHeight - 16,
              overflowY: 'auto'
            }}
          >
            {kids ? kids.map((c) => row(c, k + 1)) : sec.content}
          </div>
        );
      })}
    </div>
    </>,
    document.body
  );
}

/** Radio-style list used inside the flyouts. */
export function OptionList({
  items,
  onPick
}: {
  items: { label: string; checked: boolean }[];
  onPick: (index: number) => void;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {items.map((it, i) => (
        <div key={i} className="gam-ctx-opt" data-checked={it.checked ? 'true' : 'false'} onClick={() => onPick(i)}>
          <span style={{ width: 14, display: 'flex', flexShrink: 0 }}>
            {it.checked ? <IconCheck size={12} /> : null}
          </span>
          <Text size="sm" truncate>
            {it.label}
          </Text>
        </div>
      ))}
    </div>
  );
}