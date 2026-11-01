import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { Group, Stack, Text, UnstyledButton } from '@mantine/core';
import { GLASS_ACTION_CLASS } from './Glasseffect';

export type AspectId =
  | 'off' | 'free' | 'original'
  | '1:1' | '4:3' | '3:4' | '3:2' | '2:3' | '16:9' | '9:16';

export const ASPECT_IDS: AspectId[] = [
  'off', 'free', 'original', '1:1', '4:3', '3:4', '3:2', '2:3', '16:9', '9:16'
];

export function isAspectId(v: unknown): v is AspectId {
  return typeof v === 'string' && (ASPECT_IDS as string[]).includes(v);
}

/** Crop box as fractions (0..1) of the viewport, so it survives resizing. */
export interface CropRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const NAMES: Partial<Record<AspectId, string>> = { off: 'Off', free: 'Free', original: 'Original' };
const nameOf = (id: AspectId): string => NAMES[id] ?? id;

function ratioOf(a: AspectId, cw: number, ch: number): number | null {
  if (a === 'off' || a === 'free') return null;
  if (a === 'original') return cw / ch;
  const [p, q] = a.split(':').map(Number);
  return p / q;
}

function defaultCrop(a: AspectId, cw: number, ch: number): CropRect {
  const r = ratioOf(a, cw, ch);
  if (r === null) return { x: 0.1, y: 0.1, w: 0.8, h: 0.8 };
  let w = cw * 0.9;
  let h = w / r;
  if (h > ch * 0.9) {
    h = ch * 0.9;
    w = h * r;
  }
  return { x: (1 - w / cw) / 2, y: (1 - h / ch) / 2, w: w / cw, h: h / ch };
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

type Mode = 'move' | 'n' | 's' | 'e' | 'w' | 'nw' | 'ne' | 'sw' | 'se';
const MIN_PX = 40;
const EPS = 0.5;

function computeCrop(
  mode: Mode,
  start: CropRect,
  dx: number,
  dy: number,
  ratio: number | null,
  s: { w: number; h: number }
): CropRect | null {
  let x0 = start.x * s.w;
  let y0 = start.y * s.h;
  let x1 = x0 + start.w * s.w;
  let y1 = y0 + start.h * s.h;

  if (mode === 'move') {
    const w = x1 - x0;
    const h = y1 - y0;
    x0 = clamp(x0 + dx, 0, s.w - w);
    y0 = clamp(y0 + dy, 0, s.h - h);
    x1 = x0 + w;
    y1 = y0 + h;
  } else {
    if (mode.includes('w')) x0 = clamp(x0 + dx, 0, x1 - MIN_PX);
    if (mode.includes('e')) x1 = clamp(x1 + dx, x0 + MIN_PX, s.w);
    if (mode.includes('n')) y0 = clamp(y0 + dy, 0, y1 - MIN_PX);
    if (mode.includes('s')) y1 = clamp(y1 + dy, y0 + MIN_PX, s.h);
    if (ratio) {
      let w = x1 - x0;
      let h = y1 - y0;
      const corner = mode.length === 2;
      if (corner || mode === 'e' || mode === 'w') h = w / ratio;
      else w = h * ratio;
      if (corner) {
        if (mode.includes('w')) x0 = x1 - w;
        else x1 = x0 + w;
        if (mode.includes('n')) y0 = y1 - h;
        else y1 = y0 + h;
      } else if (mode === 'e' || mode === 'w') {
        if (mode === 'w') x0 = x1 - w;
        else x1 = x0 + w;
        const cy = (y0 + y1) / 2;
        y0 = cy - h / 2;
        y1 = cy + h / 2;
      } else {
        if (mode === 'n') y0 = y1 - h;
        else y1 = y0 + h;
        const cx = (x0 + x1) / 2;
        x0 = cx - w / 2;
        x1 = cx + w / 2;
      }
      if (
        x0 < -EPS || y0 < -EPS || x1 > s.w + EPS || y1 > s.h + EPS ||
        x1 - x0 < MIN_PX || y1 - y0 < MIN_PX
      ) {
        return null;
      }
    }
  }
  return { x: x0 / s.w, y: y0 / s.h, w: (x1 - x0) / s.w, h: (y1 - y0) / s.h };
}

const HANDLES: { mode: Mode; left: number; top: number; cursor: string }[] = [
  { mode: 'nw', left: 0, top: 0, cursor: 'nwse-resize' },
  { mode: 'n', left: 50, top: 0, cursor: 'ns-resize' },
  { mode: 'ne', left: 100, top: 0, cursor: 'nesw-resize' },
  { mode: 'e', left: 100, top: 50, cursor: 'ew-resize' },
  { mode: 'se', left: 100, top: 100, cursor: 'nwse-resize' },
  { mode: 's', left: 50, top: 100, cursor: 'ns-resize' },
  { mode: 'sw', left: 0, top: 100, cursor: 'nesw-resize' },
  { mode: 'w', left: 0, top: 50, cursor: 'ew-resize' }
];

/**
 * Crop box over the 3D viewport. The inside is click-through (you can still
 * orbit); the label pill moves the box, the white handles resize it.
 */
export function AspectCropOverlay({
  aspect,
  crop,
  onCrop,
  nonce,
  outLabel
}: {
  aspect: AspectId;
  crop: CropRect;
  onCrop: (c: CropRect) => void;
  nonce: number;
  outLabel: string;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const sizeRef = useRef(size);
  sizeRef.current = size;
  const cropRef = useRef(crop);
  cropRef.current = crop;
  const aspectRef = useRef(aspect);
  aspectRef.current = aspect;
  const prevRef = useRef<{ a: AspectId; n: number } | null>(null);

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // New default box when the ratio changes (or Reset); locked ratios re-fit on resize.
  useEffect(() => {
    if (size.w <= 0 || size.h <= 0) return;
    const prev = prevRef.current;
    const changed = !prev || prev.a !== aspect || prev.n !== nonce;
    prevRef.current = { a: aspect, n: nonce };
    if (changed || aspect !== 'free') onCrop(defaultCrop(aspect, size.w, size.h));
  }, [aspect, nonce, size.w, size.h]);

  const startDrag = (mode: Mode) => (e: ReactPointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const s = sizeRef.current;
    const start = cropRef.current;
    const sx = e.clientX;
    const sy = e.clientY;
    const ratio = ratioOf(aspectRef.current, s.w, s.h);
    const move = (ev: PointerEvent) => {
      const c = computeCrop(mode, start, ev.clientX - sx, ev.clientY - sy, ratio, s);
      if (c) onCrop(c);
    };
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  };

  const rootStyle: CSSProperties = {
    position: 'absolute',
    inset: 0,
    pointerEvents: 'none',
    overflow: 'hidden',
    zIndex: 5
  };
  const line = (style: CSSProperties) => (
    <div style={{ position: 'absolute', background: 'rgba(255,255,255,0.35)', ...style }} />
  );

  return (
    <div ref={rootRef} style={rootStyle}>
      {size.w > 0 && (
        <div
          style={{
            position: 'absolute',
            left: crop.x * size.w,
            top: crop.y * size.h,
            width: crop.w * size.w,
            height: crop.h * size.h,
            border: '1px solid rgba(255,255,255,0.9)',
            boxShadow: '0 0 0 9999px rgba(0,0,0,0.45)',
            boxSizing: 'border-box'
          }}
        >
          {line({ left: '33.33%', top: 0, bottom: 0, width: 1 })}
          {line({ left: '66.66%', top: 0, bottom: 0, width: 1 })}
          {line({ top: '33.33%', left: 0, right: 0, height: 1 })}
          {line({ top: '66.66%', left: 0, right: 0, height: 1 })}
          <div
            onPointerDown={startDrag('move')}
            style={{
              position: 'absolute',
              top: 8,
              left: '50%',
              transform: 'translateX(-50%)',
              padding: '2px 10px',
              borderRadius: 999,
              background: 'rgba(0,0,0,0.65)',
              color: '#fff',
              fontSize: 11,
              fontWeight: 700,
              whiteSpace: 'nowrap',
              cursor: 'move',
              pointerEvents: 'auto',
              userSelect: 'none',
              touchAction: 'none'
            }}
          >
            {`Crop ${nameOf(aspect)}${outLabel ? ' \u00B7 ' + outLabel + ' px' : ''}`}
          </div>
          {HANDLES.map((h) => (
            <div
              key={h.mode}
              onPointerDown={startDrag(h.mode)}
              style={{
                position: 'absolute',
                left: `${h.left}%`,
                top: `${h.top}%`,
                width: 12,
                height: 12,
                transform: 'translate(-50%, -50%)',
                background: '#fff',
                border: '1px solid rgba(0,0,0,0.6)',
                borderRadius: 2,
                cursor: h.cursor,
                pointerEvents: 'auto',
                touchAction: 'none'
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/** Contents of the aspect-ratio popover (opened by the ring around the camera). */
export function AspectMenu({
  aspect,
  onAspect,
  outLabel,
  onReset
}: {
  aspect: AspectId;
  onAspect: (a: AspectId) => void;
  outLabel: string;
  onReset: () => void;
}) {
  return (
    <Stack gap="xs">
      <Text size="xs" fw={700} tt="uppercase" c="dimmed">
        Aspect ratio
      </Text>
      <Group gap={6}>
        {ASPECT_IDS.map((id) => {
          const active = id === aspect;
          return (
            <UnstyledButton
              key={id}
              onClick={() => onAspect(id)}
              style={{
                padding: '3px 10px',
                borderRadius: 999,
                fontSize: 12,
                fontWeight: 700,
                color: '#fff',
                background: active ? 'rgba(150, 20, 50, 0.95)' : 'rgba(255,255,255,0.08)'
              }}
            >
              {nameOf(id)}
            </UnstyledButton>
          );
        })}
      </Group>
      <Text size="sm">
        {aspect === 'off' ? 'Whole view: ' : 'Crop: '}
        <b>{outLabel ? outLabel + ' px' : '-'}</b>
      </Text>
      <Text size="xs" c="dimmed">
        Drag the label at the top of the box to move it, and the white handles to resize it. The
        dark area is cut away when you take a screenshot (camera button or P). The button on the
        right sets the resolution (1K to 4K).
      </Text>
      <UnstyledButton className={GLASS_ACTION_CLASS} data-tone="soft" onClick={onReset}>
        Reset
      </UnstyledButton>
    </Stack>
  );
}