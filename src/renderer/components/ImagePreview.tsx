import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { ColorPicker, Divider, Group, NumberInput, Stack, Switch, Text, UnstyledButton } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import type { FileRecord } from '@shared/types';
import { ipc } from '../ipc-client';
import { formatBytes } from '../util/format';
import { GLASS_ACTION_CLASS } from './Glasseffect';
import { PlayerContextMenu, type CtxSection } from './PlayerContextMenu';
import { PlayerGlassStyles } from './PlayerGlass';
import { FxSlider, GlassSegmented, PresetPills } from './PlayerMenu';
import { ZoomControl } from './ZoomControl';
import { VIEW_ZOOM_STEP, useSmoothView, wheelZoomFactor } from '../util/smooth-zoom';
import {
  DEFAULT_POST,
  PALETTES,
  applyPostFx,
  cornerColor,
  downscaleNearest,
  postActive,
  type Dither,
  type PostFx
} from '../util/pixel-fx';

interface ImgFx {
  brightness: number;
  contrast: number;
  saturation: number;
  hue: number;
  invert: boolean;
  gray: boolean;
  radius: number; // % of the shorter side
  rotate: number; // 0 | 90 | 180 | 270
  flipH: boolean;
  flipV: boolean;
}

const DEFAULT_FX: ImgFx = {
  brightness: 100,
  contrast: 100,
  saturation: 100,
  hue: 0,
  invert: false,
  gray: false,
  radius: 0,
  rotate: 0,
  flipH: false,
  flipV: false
};

const hasEdits = (f: ImgFx): boolean => JSON.stringify(f) !== JSON.stringify(DEFAULT_FX);

const cssFilter = (f: ImgFx): string => {
  const p: string[] = [];
  if (f.brightness !== 100) p.push(`brightness(${f.brightness}%)`);
  if (f.contrast !== 100) p.push(`contrast(${f.contrast}%)`);
  if (f.saturation !== 100) p.push(`saturate(${f.saturation}%)`);
  if (f.hue !== 0) p.push(`hue-rotate(${f.hue}deg)`);
  if (f.gray) p.push('grayscale(100%)');
  if (f.invert) p.push('invert(100%)');
  return p.length ? p.join(' ') : 'none';
};

/** Rounded corners always give a transparent PNG; otherwise keep jpg / webp, anything else becomes png. */
const pickFormat = (ext: string, f: ImgFx): { mime: string; ext: string } => {
  if (f.radius > 0) return { mime: 'image/png', ext: 'png' };
  const e = ext.toLowerCase();
  if (e === 'jpg' || e === 'jpeg') return { mime: 'image/jpeg', ext: e };
  if (e === 'webp') return { mime: 'image/webp', ext: 'webp' };
  return { mime: 'image/png', ext: 'png' };
};

export const toBlob = (c: HTMLCanvasElement, mime: string, q?: number): Promise<Blob> =>
  new Promise((res, rej) =>
    c.toBlob((b) => (b ? res(b) : rej(new Error('Could not encode the image'))), mime, q)
  );

// ---- Crop ---------------------------------------------------------------------
// The crop box is stored in pixels of the image AS IT IS SHOWN (after rotation), so it
// lines up with what the user sees. It is only applied when saving / copying.

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const CROP_RATIOS: { id: string; name: string }[] = [
  { id: 'off', name: 'Off' },
  { id: 'free', name: 'Free' },
  { id: 'orig', name: 'Original' },
  { id: '1:1', name: '1:1' },
  { id: '4:3', name: '4:3' },
  { id: '3:4', name: '3:4' },
  { id: '3:2', name: '3:2' },
  { id: '2:3', name: '2:3' },
  { id: '16:9', name: '16:9' },
  { id: '9:16', name: '9:16' }
];

/** width / height for a ratio id, or null for "free". */
function ratioNum(id: string, W: number, H: number): number | null {
  if (id === 'free') return null;
  if (id === 'orig') return H > 0 ? W / H : 1;
  const [a, b] = id.split(':').map(Number);
  return a > 0 && b > 0 ? a / b : null;
}

/** The biggest box with this ratio, centered in the image (free = 80% of the image). */
function defaultRect(ratio: number | null, W: number, H: number): Rect {
  if (!ratio) {
    const w = W * 0.8;
    const h = H * 0.8;
    return { x: (W - w) / 2, y: (H - h) / 2, w, h };
  }
  let w = W;
  let h = W / ratio;
  if (h > H) {
    h = H;
    w = H * ratio;
  }
  return { x: (W - w) / 2, y: (H - h) / 2, w, h };
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

function moveRect(s: Rect, dx: number, dy: number, W: number, H: number): Rect {
  return { ...s, x: clamp(s.x + dx, 0, W - s.w), y: clamp(s.y + dy, 0, H - s.h) };
}

/** Resize from a handle ('n', 'se', 'w', ...). With a ratio the box keeps it. */
function resizeRect(s: Rect, hnd: string, dx: number, dy: number, W: number, H: number, ratio: number | null): Rect {
  const MIN = 16;
  const e = hnd.includes('e');
  const w_ = hnd.includes('w');
  const n = hnd.includes('n');
  const so = hnd.includes('s');
  const sl = s.x;
  const sr = s.x + s.w;
  const st = s.y;
  const sb = s.y + s.h;

  if (!ratio) {
    let l = sl;
    let r = sr;
    let t = st;
    let b = sb;
    if (w_) l = clamp(sl + dx, 0, sr - MIN);
    if (e) r = clamp(sr + dx, sl + MIN, W);
    if (n) t = clamp(st + dy, 0, sb - MIN);
    if (so) b = clamp(sb + dy, st + MIN, H);
    return { x: l, y: t, w: r - l, h: b - t };
  }

  if ((e || w_) && (n || so)) {
    // Corner: the opposite corner stays put.
    const ax = e ? sl : sr;
    const ay = so ? st : sb;
    const px = (e ? sr : sl) + dx;
    const py = (so ? sb : st) + dy;
    let w = Math.abs(px - ax);
    let h = Math.abs(py - ay);
    if (w / ratio > h) h = w / ratio;
    else w = h * ratio;
    const maxW = e ? W - ax : ax;
    const maxH = so ? H - ay : ay;
    if (w > maxW) {
      w = maxW;
      h = w / ratio;
    }
    if (h > maxH) {
      h = maxH;
      w = h * ratio;
    }
    if (w < MIN) {
      w = MIN;
      h = w / ratio;
    }
    if (h < MIN) {
      h = MIN;
      w = h * ratio;
    }
    return { x: e ? ax : ax - w, y: so ? ay : ay - h, w, h };
  }

  if (e || w_) {
    // Left / right edge: grows around the vertical center.
    const cy = s.y + s.h / 2;
    const want = e ? sr + dx - sl : sr - (sl + dx);
    let w = clamp(want, MIN, e ? W - sl : sr);
    let h = w / ratio;
    const maxH = 2 * Math.min(cy, H - cy);
    if (h > maxH) {
      h = maxH;
      w = h * ratio;
    }
    return { x: e ? sl : sr - w, y: cy - h / 2, w, h };
  }

  // Top / bottom edge: grows around the horizontal center.
  const cx = s.x + s.w / 2;
  const want = so ? sb + dy - st : sb - (st + dy);
  let h = clamp(want, MIN, so ? H - st : sb);
  let w = h * ratio;
  const maxW = 2 * Math.min(cx, W - cx);
  if (w > maxW) {
    w = maxW;
    h = w / ratio;
  }
  return { x: cx - w / 2, y: so ? st : sb - h, w, h };
}

const HANDLES: { id: string; x: number; y: number; cursor: string }[] = [
  { id: 'nw', x: 0, y: 0, cursor: 'nwse-resize' },
  { id: 'n', x: 50, y: 0, cursor: 'ns-resize' },
  { id: 'ne', x: 100, y: 0, cursor: 'nesw-resize' },
  { id: 'e', x: 100, y: 50, cursor: 'ew-resize' },
  { id: 'se', x: 100, y: 100, cursor: 'nwse-resize' },
  { id: 's', x: 50, y: 100, cursor: 'ns-resize' },
  { id: 'sw', x: 0, y: 100, cursor: 'nesw-resize' },
  { id: 'w', x: 0, y: 50, cursor: 'ew-resize' }
];

// ---- Saving as JPG / PNG / BMP ---------------------------------------------------

export type OutFmt = 'jpg' | 'png' | 'bmp' | 'ico';

/** JPG and BMP have no transparency: put the picture on white so clear areas are not black. */
function flatten(src: HTMLCanvasElement): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = src.width;
  c.height = src.height;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('Canvas is not available');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(src, 0, 0);
  return c;
}

/** Plain 24-bit Windows BMP (canvas.toBlob cannot make BMP). */
function encodeBmp(src: HTMLCanvasElement): Blob {
  const flat = flatten(src);
  const w = flat.width;
  const h = flat.height;
  const ctx = flat.getContext('2d');
  if (!ctx) throw new Error('Canvas is not available');
  const px = ctx.getImageData(0, 0, w, h).data;
  const rowSize = Math.ceil((w * 3) / 4) * 4;
  const dataSize = rowSize * h;
  const buf = new ArrayBuffer(54 + dataSize);
  const v = new DataView(buf);
  v.setUint8(0, 0x42); // B
  v.setUint8(1, 0x4d); // M
  v.setUint32(2, 54 + dataSize, true);
  v.setUint32(6, 0, true);
  v.setUint32(10, 54, true);
  v.setUint32(14, 40, true);
  v.setInt32(18, w, true);
  v.setInt32(22, h, true);
  v.setUint16(26, 1, true);
  v.setUint16(28, 24, true);
  v.setUint32(30, 0, true);
  v.setUint32(34, dataSize, true);
  v.setInt32(38, 2835, true);
  v.setInt32(42, 2835, true);
  v.setUint32(46, 0, true);
  v.setUint32(50, 0, true);
  const out = new Uint8Array(buf);
  let o = 54;
  for (let y = h - 1; y >= 0; y--) {
    let i = y * w * 4;
    const rowStart = o;
    for (let x = 0; x < w; x++) {
      out[o++] = px[i + 2];
      out[o++] = px[i + 1];
      out[o++] = px[i];
      i += 4;
    }
    while (o - rowStart < rowSize) out[o++] = 0;
  }
  return new Blob([buf], { type: 'image/bmp' });
}

const ICO_SIZES = [16, 32, 48, 64, 128, 256];

/** Fits the picture inside a transparent size x size square. Halving steps keep small icons sharp. */
function squareIcon(src: HTMLCanvasElement, size: number): HTMLCanvasElement {
  const k = Math.min(size / src.width, size / src.height);
  const tw = Math.max(1, Math.round(src.width * k));
  const th = Math.max(1, Math.round(src.height * k));
  let cur: HTMLCanvasElement = src;
  while (cur.width / 2 >= tw && cur.height / 2 >= th) {
    const half = document.createElement('canvas');
    half.width = Math.max(1, Math.round(cur.width / 2));
    half.height = Math.max(1, Math.round(cur.height / 2));
    const hc = half.getContext('2d');
    if (!hc) throw new Error('Canvas is not available');
    hc.imageSmoothingEnabled = true;
    hc.imageSmoothingQuality = 'high';
    hc.drawImage(cur, 0, 0, half.width, half.height);
    cur = half;
  }
  const out = document.createElement('canvas');
  out.width = size;
  out.height = size;
  const ctx = out.getContext('2d');
  if (!ctx) throw new Error('Canvas is not available');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(cur, Math.round((size - tw) / 2), Math.round((size - th) / 2), tw, th);
  return out;
}

/** Windows icon with 16 to 256 px sizes, each stored as PNG (keeps transparency). */
async function encodeIco(src: HTMLCanvasElement): Promise<Blob> {
  const pngs: Uint8Array[] = [];
  for (const sz of ICO_SIZES) {
    const b = await toBlob(squareIcon(src, sz), 'image/png');
    pngs.push(new Uint8Array(await b.arrayBuffer()));
  }
  const n = pngs.length;
  let offset = 6 + 16 * n;
  const total = offset + pngs.reduce((a, p) => a + p.length, 0);
  const buf = new ArrayBuffer(total);
  const v = new DataView(buf);
  const out = new Uint8Array(buf);
  v.setUint16(0, 0, true); // reserved
  v.setUint16(2, 1, true); // type: icon
  v.setUint16(4, n, true);
  pngs.forEach((png, i) => {
    const sz = ICO_SIZES[i];
    const e = 6 + 16 * i;
    v.setUint8(e, sz >= 256 ? 0 : sz); // 0 means 256
    v.setUint8(e + 1, sz >= 256 ? 0 : sz);
    v.setUint8(e + 2, 0); // palette
    v.setUint8(e + 3, 0);
    v.setUint16(e + 4, 1, true); // planes
    v.setUint16(e + 6, 32, true); // bits per pixel
    v.setUint32(e + 8, png.length, true);
    v.setUint32(e + 12, offset, true);
    out.set(png, offset);
    offset += png.length;
  });
  return new Blob([buf], { type: 'image/x-icon' });
}

export async function encodeAs(canvas: HTMLCanvasElement, fmt: OutFmt): Promise<Blob> {
  if (fmt === 'png') return toBlob(canvas, 'image/png');
  if (fmt === 'ico') return encodeIco(canvas);
  if (fmt === 'jpg') return toBlob(flatten(canvas), 'image/jpeg', 0.95);
  return encodeBmp(canvas);
}

/** Draws the picture with the edits. `crop` is in pixels of the rotated image at scale 1. */
// ---- Glass button (menu action buttons) ----------------------------------------------
// The look (glass, dark blue to dark red) lives in Glasseffect.tsx as GLASS_ACTION_CLASS.
function GlassButton({
  children,
  onClick,
  tone = 'strong'
}: {
  children: React.ReactNode;
  onClick: () => void;
  tone?: 'strong' | 'soft';
}) {
  return (
    <UnstyledButton className={GLASS_ACTION_CLASS} data-tone={tone} onClick={onClick}>
      {children}
    </UnstyledButton>
  );
}

/** Preset color pills plus a "Custom" pill that opens an inline picker (no popup, so the menu stays open). */
function ColorChoice({
  value,
  onChange,
  presets
}: {
  value: string;
  onChange: (hex: string) => void;
  presets: { id: string; name: string }[];
}) {
  const isPreset = presets.some((p) => p.id.toLowerCase() === value.toLowerCase());
  const [open, setOpen] = useState(!isPreset);
  return (
    <Stack gap={8}>
      <PresetPills
        items={[...presets, { id: 'custom', name: 'Custom' }]}
        selected={open || !isPreset ? 'custom' : value}
        onSelect={(id) => {
          if (id === 'custom') {
            setOpen((v) => !v);
          } else {
            setOpen(false);
            onChange(id);
          }
        }}
      />
      {open && (
        <>
          <ColorPicker format="hex" value={value} onChange={onChange} size="sm" fullWidth />
          <Text size="xs" c="dimmed" style={{ fontFamily: 'monospace' }}>
            {value}
          </Text>
        </>
      )}
    </Stack>
  );
}

/** Lets the mouse wheel change a number while the pointer is over its input box. */
function WheelStep({ onStep, children }: { onStep: (dir: 1 | -1) => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const cb = useRef(onStep);
  cb.current = onStep;
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const onWheel = (e: WheelEvent) => {
      if (!(e.target as HTMLElement | null)?.closest?.('input')) return;
      e.preventDefault(); // do not scroll the flyout while changing the value
      cb.current(e.deltaY < 0 ? 1 : -1);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);
  return <div ref={ref}>{children}</div>;
}

function renderToCanvas(bmp: ImageBitmap, f: ImgFx, scale: number, crop?: Rect | null): HTMLCanvasElement {
  const rot = f.rotate % 180 !== 0;
  const w0 = bmp.width;
  const h0 = bmp.height;
  const fullW = Math.max(1, Math.round((rot ? h0 : w0) * scale));
  const fullH = Math.max(1, Math.round((rot ? w0 : h0) * scale));
  const cx = crop ? Math.round(crop.x * scale) : 0;
  const cy = crop ? Math.round(crop.y * scale) : 0;
  const outW = crop ? Math.max(1, Math.min(fullW - cx, Math.round(crop.w * scale))) : fullW;
  const outH = crop ? Math.max(1, Math.min(fullH - cy, Math.round(crop.h * scale))) : fullH;
  const canvas = document.createElement('canvas');
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas is not available');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  if (f.radius > 0) {
    ctx.beginPath();
    ctx.roundRect(0, 0, outW, outH, (f.radius / 100) * Math.min(outW, outH));
    ctx.clip();
  }
  const fl = cssFilter(f);
  if (fl !== 'none') ctx.filter = fl;
  ctx.translate(fullW / 2 - cx, fullH / 2 - cy);
  ctx.scale(f.flipH ? -1 : 1, f.flipV ? -1 : 1);
  ctx.rotate((f.rotate * Math.PI) / 180);
  const dw = w0 * scale;
  const dh = h0 * scale;
  ctx.drawImage(bmp, -dw / 2, -dh / 2, dw, dh);
  return canvas;
}

// Checkerboard so transparent pixels are visible (works on light and dark themes).
const CHECKER_BG: CSSProperties = {
  backgroundColor: 'rgba(255, 255, 255, 0.55)',
  backgroundImage:
    'conic-gradient(rgba(128,128,128,0.45) 25%, transparent 0 50%, rgba(128,128,128,0.45) 0 75%, transparent 0)',
  backgroundSize: '16px 16px'
};

interface ImagePreviewProps {
  libraryId: string;
  file: FileRecord;
  /** Show this URL instead of the file itself (IconPreview: one size of an .ico). */
  srcOverride?: string;
  /** Where the pixels come from when saving / copying (needed with srcOverride). */
  bitmapOverride?: () => Promise<ImageBitmap>;
  /** Crisp pixel scaling + checkerboard, sized up to fit (for small icons). */
  pixelated?: boolean;
  /** Open the right-click menu here as soon as the viewer appears. */
  initialMenu?: { x: number; y: number } | null;
}

export function ImagePreview({
  libraryId,
  file,
  srcOverride,
  bitmapOverride,
  pixelated = false,
  initialMenu = null
}: ImagePreviewProps) {
  const src = srcOverride ?? `wh3d-file://${libraryId}/${file.id}`;
  const boxRef = useRef<HTMLDivElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const bmpRef = useRef<{ id: number; bmp: ImageBitmap } | null>(null);

  const [nat, setNat] = useState<{ w: number; h: number } | null>(null);
  const [rendered, setRendered] = useState({ w: 0, h: 0 });
  const [box, setBox] = useState({ w: 0, h: 0 });
  const { view, setView, zoomBy, animateTo, reset: fitView } = useSmoothView();
  const [fx, setFx] = useState<ImgFx>({ ...DEFAULT_FX });
  const [crop, setCrop] = useState<{ ratio: string; rect: Rect } | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [resizePct, setResizePct] = useState(50);
  const [targetMb, setTargetMb] = useState(1);
  // Game-dev effects (pixelize, normal map, trim, outline, pad). `prev` is the processed picture
  // that replaces the plain image on screen while any of them is on.
  const [post, setPost] = useState<PostFx>({ ...DEFAULT_POST });
  const [prev, setPrev] = useState<{ url: string; w: number; h: number } | null>(null);
  const prevRef = useRef(prev);
  prevRef.current = prev;
  const showPost = prev !== null;

  const base = file.filename.replace(/\.[^.]+$/, '');
  const mayHaveAlpha = ['png', 'webp', 'gif', 'ico', 'svg', 'avif'].includes(file.ext.toLowerCase());

  useEffect(() => () => {
    if (prevRef.current) URL.revokeObjectURL(prevRef.current.url);
  }, []);

  useEffect(() => {
    setPost({ ...DEFAULT_POST });
    setFx({ ...DEFAULT_FX });
    setCrop(null);
    setView({ zoom: 1, x: 0, y: 0 });
    setNat(null);
    setMenu(null);
  }, [file.id]);

  // Opened from IconPreview's right-click: show the menu right away (runs after the reset above).
  useEffect(() => {
    if (initialMenu) setMenu(initialMenu);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(
    () => () => {
      bmpRef.current?.bmp.close();
      bmpRef.current = null;
    },
    []
  );

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return undefined;
    const u = () => setBox({ w: el.clientWidth, h: el.clientHeight });
    u();
    const ro = new ResizeObserver(u);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const el = imgRef.current;
    if (!el || !nat) return undefined;
    const u = () => setRendered({ w: el.clientWidth, h: el.clientHeight });
    u();
    const ro = new ResizeObserver(u);
    ro.observe(el);
    return () => ro.disconnect();
  }, [nat, file.id]);

  // Wheel = gentle, smooth zoom toward the pointer (about 5% per notch).
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return undefined;
    const onWheel = (e: WheelEvent) => {
      // The zoom pill has its own buttons.
      if ((e.target as HTMLElement | null)?.closest?.('[data-zoom-control]')) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const cx = e.clientX - (rect.left + rect.width / 2);
      const cy = e.clientY - (rect.top + rect.height / 2);
      zoomBy(wheelZoomFactor(e), cx, cy);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomBy]);

  const onMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    let lx = e.clientX;
    let ly = e.clientY;
    const move = (ev: MouseEvent) => {
      const dx = ev.clientX - lx;
      const dy = ev.clientY - ly;
      lx = ev.clientX;
      ly = ev.clientY;
      setView((v) => ({ ...v, x: v.x + dx, y: v.y + dy }));
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  const rot90 = fx.rotate % 180 !== 0;
  // Small icons: scale up to fit with whole-number steps so pixels stay sharp.
  const fitS = nat && box.w > 0 && box.h > 0 ? Math.min((box.w * 0.9) / nat.w, (box.h * 0.9) / nat.h) : 1;
  const pxScale = fitS >= 1 ? Math.min(32, Math.floor(fitS)) : fitS;
  const rotFit =
    rot90 && !showPost && rendered.w > 0 && rendered.h > 0
      ? Math.min(box.w / rendered.h, box.h / rendered.w)
      : 1;
  // Corner radius: with a crop box the corners belong to the crop (that is what gets saved),
  // without one they belong to the whole picture.
  const radiusPx = crop ? 0 : (fx.radius / 100) * Math.min(rendered.w, rendered.h);
  const eW = nat ? (rot90 ? nat.h : nat.w) : 0;
  const eH = nat ? (rot90 ? nat.w : nat.h) : 0;

  // Size of the picture as it is drawn on screen (after rotation), before pan / zoom.
  const rotCss = rot90 && !showPost; // with effects on the preview already has the rotation baked in
  const vw = (rotCss ? rendered.h : rendered.w) * rotFit;
  const vh = (rotCss ? rendered.w : rendered.h) * rotFit;

  // The crop box in whole pixels, ready for saving.
  const cropPx: Rect | null = crop
    ? {
        x: Math.round(crop.rect.x),
        y: Math.round(crop.rect.y),
        w: Math.max(1, Math.round(crop.rect.w)),
        h: Math.max(1, Math.round(crop.rect.h))
      }
    : null;
  const edited = hasEdits(fx) || !!cropPx || postActive(post);

  // Rotating changes the image shape: start the box again for the new shape.
  useEffect(() => {
    if (!eW || !eH) return;
    setCrop((c) => (c ? { ratio: c.ratio, rect: defaultRect(ratioNum(c.ratio, eW, eH), eW, eH) } : c));
  }, [eW, eH]);

  const pickRatio = (id: string) => {
    if (id === 'off') {
      setCrop(null);
      return;
    }
    if (!eW || !eH) return;
    setCrop((c) => {
      // Free keeps the box you already have; every other ratio starts a fresh centered box.
      if (id === 'free' && c) return { ratio: 'free', rect: c.rect };
      return { ratio: id, rect: defaultRect(ratioNum(id, eW, eH), eW, eH) };
    });
  };

  const startCrop = (e: React.MouseEvent, handle: string) => {
    if (e.button !== 0 || !crop || !eW || !eH || vw <= 0 || vh <= 0) return;
    e.stopPropagation();
    e.preventDefault();
    const s = crop.rect;
    const sx = e.clientX;
    const sy = e.clientY;
    const ratio = ratioNum(crop.ratio, eW, eH);
    // screen pixels -> image pixels
    const kx = eW / (vw * view.zoom);
    const ky = eH / (vh * view.zoom);
    const move = (ev: MouseEvent) => {
      const dx = (ev.clientX - sx) * kx;
      const dy = (ev.clientY - sy) * ky;
      setCrop((c) =>
        c
          ? {
              ...c,
              rect: handle === 'move' ? moveRect(s, dx, dy, eW, eH) : resizeRect(s, handle, dx, dy, eW, eH, ratio)
            }
          : c
      );
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  const actualView = () => {
    if (!nat || rendered.w === 0) return;
    animateTo({ zoom: nat.w / (rendered.w * rotFit), x: 0, y: 0 });
  };

  const getBitmap = useCallback(async (): Promise<ImageBitmap> => {
    if (bitmapOverride) {
      const b = await bitmapOverride();
      bmpRef.current?.bmp.close();
      bmpRef.current = { id: -1, bmp: b };
      return b;
    }
    if (bmpRef.current && bmpRef.current.id === file.id) return bmpRef.current.bmp;
    const res = await fetch(src);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const bmp = await createImageBitmap(await res.blob());
    bmpRef.current?.bmp.close();
    bmpRef.current = { id: file.id, bmp };
    return bmp;
  }, [file.id, src, bitmapOverride]);

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    try {
      await fn();
    } catch (err) {
      notifications.show({ color: 'red', title: 'Image', message: (err as Error).message });
    } finally {
      setBusy(null);
    }
  };

  const saveBlob = async (blob: Blob | null, name: string): Promise<string | null> => {
    const data = blob ? new Uint8Array(await blob.arrayBuffer()) : null;
    const r = await ipc.saveImageAs({ libraryId, fileId: file.id, defaultName: name, data });
    if (!r.ok) {
      notifications.show({ color: 'red', title: 'Save failed', message: r.error });
      return null;
    }
    if (r.canceled) return null;
    return r.path;
  };

  /** Picture with every edit applied. `lowRes` honors "save at original size" off (true sprite size). */
  const renderOut = (bmp: ImageBitmap, scale: number, lowRes: boolean): HTMLCanvasElement => {
    const c = renderToCanvas(bmp, fx, scale, cropPx);
    if (!postActive(post)) return c;
    const r = applyPostFx(c, post, { scale, autoBg: cornerColor(bmp) });
    return lowRes && !post.pxUpscale && r.k > 1 ? downscaleNearest(r.canvas, r.k) : r.canvas;
  };

  /** Effects that need transparency or exact pixels are always saved as PNG. */
  const fmtOf = () => (postActive(post) ? { mime: 'image/png', ext: 'png' } : pickFormat(file.ext, fx));

  // Live preview of the game-dev effects (capped at 2048 px so sliders stay responsive).
  useEffect(() => {
    if (!postActive(post)) {
      setPrev(null);
      return undefined;
    }
    let dead = false;
    const t = window.setTimeout(async () => {
      try {
        const bmp = await getBitmap();
        if (dead) return;
        const s = Math.min(1, 2048 / Math.max(bmp.width, bmp.height));
        // The crop is not baked into the preview: the crop box stays on screen and is applied on save.
        const cropOn = !!crop;
        const out = applyPostFx(renderToCanvas(bmp, cropOn ? { ...fx, radius: 0 } : fx, s, null), post, {
          scale: s,
          keepSize: cropOn,
          autoBg: cornerColor(bmp)
        }).canvas;
        const blob = await toBlob(out, 'image/png');
        if (dead) return;
        const url = URL.createObjectURL(blob);
        setPrev((p) => {
          if (p) URL.revokeObjectURL(p.url);
          return { url, w: out.width, h: out.height };
        });
      } catch {
        // A stale bitmap or a half-typed value: the next change tries again.
      }
    }, 120);
    return () => {
      dead = true;
      window.clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [post, fx, !!crop, getBitmap]);

  /** Save As > Same as original: the untouched file if there are no edits, else the edited picture. */
  const doSaveAs = () =>
    run('Saving...', async () => {
      if (!edited) {
        const p = await saveBlob(null, file.filename);
        if (p) notifications.show({ color: 'green', title: 'Saved', message: p });
        return;
      }
      const bmp = await getBitmap();
      const fmt = fmtOf();
      const blob = await toBlob(renderOut(bmp, 1, true), fmt.mime, 0.92);
      const p = await saveBlob(blob, `${base} (edited).${fmt.ext}`);
      if (p) notifications.show({ color: 'green', title: 'Saved', message: p });
    });

  /** Save As > JPG / PNG / BMP. */
  const doConvert = (fmt: OutFmt) =>
    run(`Converting to ${fmt.toUpperCase()}...`, async () => {
      const bmp = await getBitmap();
      const canvas = renderOut(bmp, 1, true);
      const blob = await encodeAs(canvas, fmt);
      const p = await saveBlob(blob, `${base}${edited ? ' (edited)' : ''}.${fmt}`);
      if (p) {
        notifications.show({
          color: 'green',
          title: `Saved as ${fmt.toUpperCase()}`,
          message:
            fmt === 'ico'
              ? `Sizes ${ICO_SIZES[0]} to ${ICO_SIZES[ICO_SIZES.length - 1]} px, ${formatBytes(blob.size)}`
              : `${canvas.width} x ${canvas.height} px, ${formatBytes(blob.size)}`
        });
      }
    });

  const doCopy = () =>
    run('Copying...', async () => {
      const bmp = await getBitmap();
      const blob = await toBlob(renderOut(bmp, 1, false), 'image/png');
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      notifications.show({ color: 'green', title: 'Copied', message: 'Image copied to the clipboard.' });
    });

  const doShow = () => {
    void ipc.revealFile(libraryId, file.id);
  };

  const doResize = () =>
    run('Resizing...', async () => {
      const bmp = await getBitmap();
      const fmt = fmtOf();
      const c = renderOut(bmp, resizePct / 100, true);
      const blob = await toBlob(c, fmt.mime, 0.92);
      const p = await saveBlob(blob, `${base} ${c.width}x${c.height}.${fmt.ext}`);
      if (p) {
        notifications.show({
          color: 'green',
          title: 'Resized image saved',
          message: `${c.width} x ${c.height} px, ${formatBytes(blob.size)}`
        });
      }
    });

  const doShrink = () =>
    run('Finding the best size...', async () => {
      const bmp = await getBitmap();
      const fmt = fmtOf();
      const limit = Math.floor(targetMb * 1024 * 1024) - 2048;
      const lossy = fmt.mime !== 'image/png';
      const enc = async (scale: number, q: number) => {
        const c = renderOut(bmp, scale, true);
        return { blob: await toBlob(c, fmt.mime, q), w: c.width, h: c.height };
      };
      const fits = (b: Blob) => b.size <= limit;
      let best: { blob: Blob; w: number; h: number } | null = null;

      // Highest resolution first: quality only.
      let r = await enc(1, lossy ? 0.92 : 1);
      if (fits(r.blob)) best = r;
      else if (lossy) {
        setBusy('Lowering quality...');
        r = await enc(1, 0.5);
        if (fits(r.blob)) {
          let lo = 0.5;
          let hi = 0.92;
          best = r;
          for (let i = 0; i < 7; i++) {
            const mid = (lo + hi) / 2;
            const t = await enc(1, mid);
            if (fits(t.blob)) {
              best = t;
              lo = mid;
            } else hi = mid;
          }
        }
      }
      if (!best) {
        // Then resolution.
        setBusy('Lowering resolution...');
        const q = lossy ? 0.82 : 1;
        let lo = 0.03;
        let hi = 1;
        const first = await enc(lo, q);
        if (!fits(first.blob)) throw new Error(`Cannot get this image under ${targetMb} MB.`);
        best = first;
        for (let i = 0; i < 9; i++) {
          const mid = (lo + hi) / 2;
          const t = await enc(mid, q);
          if (fits(t.blob)) {
            best = t;
            lo = mid;
          } else hi = mid;
        }
      }
      const p = await saveBlob(best.blob, `${base} (under ${targetMb}MB).${fmt.ext}`);
      if (p) {
        notifications.show({
          color: 'green',
          title: 'Saved',
          message: `${best.w} x ${best.h} px, ${formatBytes(best.blob.size)}`
        });
      }
    });

  const setF = (partial: Partial<ImgFx>) => setFx((p) => ({ ...p, ...partial }));
  const setP = (partial: Partial<PostFx>) => setPost((p) => ({ ...p, ...partial }));
  const curW = cropPx ? cropPx.w : eW;
  const curH = cropPx ? cropPx.h : eH;
  const rw = Math.max(1, Math.round(curW * (resizePct / 100)));
  const rh = Math.max(1, Math.round(curH * (resizePct / 100)));

  const resetLink = (onClick: () => void) => (
    <UnstyledButton onClick={onClick}>
      <Text size="xs" c="dimmed">
        Reset
      </Text>
    </UnstyledButton>
  );

  const saveRow = (id: string, label: string, fn: () => void): CtxSection => ({
    id,
    label,
    onSelect: () => {
      setMenu(null);
      fn();
    }
  });

  const sections: CtxSection[] = [
    {
      id: 'save',
      label: 'Save As',
      children: [
        saveRow('save-orig', 'Same as original', () => void doSaveAs()),
        saveRow('save-jpg', 'JPG', () => void doConvert('jpg')),
        saveRow('save-png', 'PNG', () => void doConvert('png')),
        saveRow('save-bmp', 'BMP', () => void doConvert('bmp')),
        saveRow('save-ico', 'ICO', () => void doConvert('ico'))
      ]
    },
    { id: 'copy', label: 'Copy to Clipboard', onSelect: () => { setMenu(null); void doCopy(); } },
    { id: 'show', label: 'Show in Folder', onSelect: () => { setMenu(null); doShow(); } },
    {
      id: 'resize',
      label: 'Resize Image',
      separator: true,
      width: 260,
      content: (
        <Stack gap={10}>
          <Text size="xs" c="dimmed">
            {nat ? `${cropPx ? 'Cropped' : 'Original'}: ${curW} x ${curH} px${cropPx ? '' : `, ${formatBytes(file.sizeBytes)}`}` : ''}
          </Text>
          <GlassSegmented
            value={String(resizePct)}
            onChange={(v) => setResizePct(Number(v))}
            data={[100, 75, 50, 25].map((p) => ({ value: String(p), label: `${p}%` }))}
          />
          <Text size="xs">
            Result: <b>{rw} x {rh} px</b>
          </Text>
          <GlassButton onClick={() => { setMenu(null); void doResize(); }}>Save as file...</GlassButton>
          <Divider />
          <Text size="10px" c="dimmed" tt="uppercase" fw={700}>
            Size aware
          </Text>
          <WheelStep
            onStep={(dir) =>
              setTargetMb((v) => {
                const step = v < 1 ? 0.1 : 0.5;
                return Math.max(0.05, Math.round((v + dir * step) * 100) / 100);
              })
            }
          >
            <NumberInput
              size="xs"
              radius="xl"
              label="Keep under"
              value={targetMb}
              onChange={(v) => setTargetMb(Math.max(0.05, Number(v) || 1))}
              min={0.05}
              step={0.5}
              decimalScale={2}
              suffix=" MB"
            />
          </WheelStep>
          <GlassButton tone="soft" onClick={() => { setMenu(null); void doShrink(); }}>
            Shrink under {targetMb} MB...
          </GlassButton>
          <Text size="10px" c="dimmed">
            Keeps the best resolution and quality that fits. Very large images can take a while.
          </Text>
        </Stack>
      )
    },
    {
      id: 'scale',
      label: 'Scale & Rotate',
      width: 250,
      content: (
        <Stack gap={10}>
          <Group grow gap={6}>
            <GlassButton tone="soft" onClick={fitView}>
              Fit
            </GlassButton>
            <GlassButton tone="soft" onClick={actualView}>
              Actual size
            </GlassButton>
          </Group>
          <div>
            <Text size="xs" c="dimmed" mb={4}>
              Rotate
            </Text>
            <GlassSegmented
              value={String(fx.rotate)}
              onChange={(v) => setF({ rotate: Number(v) })}
              data={[
                { value: '0', label: '0\u00b0' },
                { value: '90', label: '90\u00b0' },
                { value: '180', label: '180\u00b0' },
                { value: '270', label: '270\u00b0' }
              ]}
            />
          </div>
          <Switch size="xs" label="Mirror horizontally" checked={fx.flipH} onChange={(e) => setF({ flipH: e.currentTarget.checked })} />
          <Switch size="xs" label="Mirror vertically" checked={fx.flipV} onChange={(e) => setF({ flipV: e.currentTarget.checked })} />
          {resetLink(() => {
            setF({ rotate: 0, flipH: false, flipV: false });
            fitView();
          })}
        </Stack>
      )
    },
    {
      id: 'crop',
      label: 'Crop',
      width: 270,
      content: (
        <Stack gap={10}>
          <Text size="10px" c="dimmed" tt="uppercase" fw={700}>
            Aspect ratio
          </Text>
          <PresetPills items={CROP_RATIOS} selected={crop ? crop.ratio : 'off'} onSelect={pickRatio} />
          <Text size="xs">
            {cropPx ? (
              <>
                Crop: <b>{cropPx.w} x {cropPx.h} px</b>
              </>
            ) : (
              'Pick a ratio to put a crop box on the image.'
            )}
          </Text>
          <Text size="10px" c="dimmed" style={{ lineHeight: 1.4 }}>
            Close this menu, then drag the box to move it and the handles to resize it. The dark area is
            cut away when you save, copy or resize.
          </Text>
          {resetLink(() => setCrop(null))}
        </Stack>
      )
    },
    {
      id: 'fx',
      label: 'Image Effects',
      children: [
        {
      id: 'fx-color',
      label: 'Color & Shape',
      width: 250,
      content: (
        <Stack gap={8}>
          <FxSlider label="Brightness" display={`${fx.brightness}%`} value={fx.brightness} min={0} max={200} step={1} onChange={(v) => setF({ brightness: v })} marks={[{ value: 100 }]} />
          <FxSlider label="Contrast" display={`${fx.contrast}%`} value={fx.contrast} min={0} max={200} step={1} onChange={(v) => setF({ contrast: v })} marks={[{ value: 100 }]} />
          <FxSlider label="Saturation" display={`${fx.saturation}%`} value={fx.saturation} min={0} max={300} step={1} onChange={(v) => setF({ saturation: v })} marks={[{ value: 100 }]} />
          <FxSlider label="Hue" display={`${fx.hue > 0 ? '+' : ''}${fx.hue}\u00b0`} value={fx.hue} min={-180} max={180} step={1} onChange={(v) => setF({ hue: v })} marks={[{ value: 0 }]} />
          <Switch size="xs" label="Black & white" checked={fx.gray} onChange={(e) => setF({ gray: e.currentTarget.checked })} />
          <Switch size="xs" label="Invert" checked={fx.invert} onChange={(e) => setF({ invert: e.currentTarget.checked })} />
          <Divider />
          <FxSlider label="Corner radius" display={`${fx.radius}%`} value={fx.radius} min={0} max={50} step={1} onChange={(v) => setF({ radius: v })} marks={[{ value: 0 }]} />
          <Text size="10px" c="dimmed">
            Rounded corners are saved as a transparent PNG or ICO. JPG and BMP fill them with white. With a
            crop box on, the corners round the crop box.
          </Text>
          {resetLink(() => setFx((p) => ({ ...DEFAULT_FX, rotate: p.rotate, flipH: p.flipH, flipV: p.flipV })))}
        </Stack>
      )
        },
        {
          id: 'fx-pixel',
          label: 'Pixelize',
          width: 280,
          content: (
            <Stack gap={8}>
              <Switch size="xs" label="Pixelize" checked={post.pixelize} onChange={(e) => setP({ pixelize: e.currentTarget.checked })} />
              <FxSlider label="Target width" display={`${post.pxWidth} px`} value={post.pxWidth} min={8} max={256} step={1} onChange={(v) => setP({ pxWidth: v, pixelize: true })} marks={[{ value: 32 }, { value: 64 }, { value: 128 }]} />
              <PresetPills
                items={[16, 32, 48, 64, 128].map((n) => ({ id: String(n), name: String(n) }))}
                selected={String(post.pxWidth)}
                onSelect={(id) => setP({ pxWidth: Number(id), pixelize: true })}
              />
              {post.pixelize && curW > 0 && (
                <Text size="xs">
                  Sprite size: <b>{Math.min(curW, post.pxWidth)} x {Math.max(1, Math.round((curH * Math.min(curW, post.pxWidth)) / curW))} px</b>
                </Text>
              )}
              <Text size="10px" c="dimmed" tt="uppercase" fw={700}>
                Palette
              </Text>
              <PresetPills
                items={PALETTES.map((d) => ({ id: d.id, name: d.name }))}
                selected={post.palette}
                onSelect={(id) => setP({ palette: id, pixelize: true })}
              />
              <Text size="10px" c="dimmed" tt="uppercase" fw={700}>
                Dither
              </Text>
              <GlassSegmented
                value={post.dither}
                onChange={(v) => setP({ dither: v as Dither })}
                data={[
                  { value: 'none', label: 'None' },
                  { value: 'bayer', label: 'Bayer' },
                  { value: 'fs', label: 'Floyd' }
                ]}
              />
              <Switch size="xs" label="Hard alpha edges" checked={post.hardAlpha} onChange={(e) => setP({ hardAlpha: e.currentTarget.checked })} />
              <Switch size="xs" label="Save at original size" checked={post.pxUpscale} onChange={(e) => setP({ pxUpscale: e.currentTarget.checked })} />
              <Text size="10px" c="dimmed" style={{ lineHeight: 1.4 }}>
                Averages each block, then maps to the palette. Turn "Save at original size" off to save the true
                low-res sprite (for example 64 x 64).
              </Text>
              {resetLink(() => setP({ pixelize: false, pxWidth: 64, palette: 'none', dither: 'none', hardAlpha: true, pxUpscale: true }))}
            </Stack>
          )
        },
        {
          id: 'fx-normal',
          label: 'Normal Map',
          width: 260,
          content: (
            <Stack gap={8}>
              <Switch size="xs" label="Make normal map" checked={post.normal} onChange={(e) => setP({ normal: e.currentTarget.checked })} />
              <FxSlider label="Strength" display={post.normalStrength.toFixed(1)} value={post.normalStrength} min={0.5} max={8} step={0.1} onChange={(v) => setP({ normalStrength: v, normal: true })} marks={[{ value: 2 }]} />
              <Switch size="xs" label="Flip green (DirectX)" checked={post.flipGreen} onChange={(e) => setP({ flipGreen: e.currentTarget.checked })} />
              <Text size="10px" c="dimmed" style={{ lineHeight: 1.4 }}>
                Brightness is used as height. Default is OpenGL (green up). Saved as PNG.
              </Text>
              {resetLink(() => setP({ normal: false, normalStrength: 2, flipGreen: false }))}
            </Stack>
          )
        },
        {
          id: 'fx-sprite',
          label: 'Sprite Tools',
          width: 270,
          content: (
            <Stack gap={8}>
              <Switch size="xs" label="Trim transparent borders" checked={post.trim} onChange={(e) => setP({ trim: e.currentTarget.checked })} />
              <Switch size="xs" label="Outline" checked={post.outline} onChange={(e) => setP({ outline: e.currentTarget.checked })} />
              <FxSlider label="Outline width" display={`${post.outlineW} px`} value={post.outlineW} min={1} max={20} step={1} onChange={(v) => setP({ outlineW: v, outline: true })} marks={[{ value: 1 }]} />
              <ColorChoice
                value={post.outlineColor}
                onChange={(c) => setP({ outlineColor: c, outline: true })}
                presets={[
                  { id: '#000000', name: 'Black' },
                  { id: '#ffffff', name: 'White' },
                  { id: '#e03131', name: 'Red' },
                  { id: '#fcc419', name: 'Yellow' },
                  { id: '#2f9e44', name: 'Green' },
                  { id: '#1c7ed6', name: 'Blue' }
                ]}
              />
              <Divider />
              <Switch size="xs" label="Add padding" checked={post.padOn} onChange={(e) => setP({ padOn: e.currentTarget.checked })} />
              <FxSlider label="Padding" display={`${post.padPx} px`} value={post.padPx} min={1} max={128} step={1} onChange={(v) => setP({ padPx: v, padOn: true })} marks={[{ value: 8 }]} />
              <Switch size="xs" label="Pad to power of two" checked={post.pow2} onChange={(e) => setP({ pow2: e.currentTarget.checked })} />
              <Text size="10px" c="dimmed" style={{ lineHeight: 1.4 }}>
                Padding adds transparent space on every side. Outline and padding are counted in sprite pixels when
                Pixelize is on. Everything is saved as PNG.
              </Text>
              {resetLink(() => setP({ trim: false, outline: false, outlineW: 1, outlineColor: '#000000', padOn: false, padPx: 8, pow2: false }))}
            </Stack>
          )
        },
        {
          id: 'fx-sharpen',
          label: 'Sharpen',
          width: 250,
          content: (
            <Stack gap={8}>
              <FxSlider label="Amount" display={`${post.sharpen}%`} value={post.sharpen} min={0} max={300} step={5} onChange={(v) => setP({ sharpen: v })} marks={[{ value: 100 }]} />
              <Text size="10px" c="dimmed">0 turns it off. Brings out edges and fine detail.</Text>
              {resetLink(() => setP({ sharpen: 0 }))}
            </Stack>
          )
        },
        {
          id: 'fx-blur',
          label: 'Blur',
          width: 250,
          content: (
            <Stack gap={8}>
              <FxSlider label="Radius" display={`${post.blur} px`} value={post.blur} min={0} max={40} step={0.5} onChange={(v) => setP({ blur: v })} marks={[{ value: 0 }]} />
              <Text size="10px" c="dimmed">0 turns it off. Runs before Pixelize, so it smooths what gets averaged.</Text>
              {resetLink(() => setP({ blur: 0 }))}
            </Stack>
          )
        },
        {
          id: 'fx-quant',
          label: 'Color Quantization',
          width: 270,
          content: (
            <Stack gap={8}>
              <Switch size="xs" label="Reduce colors" checked={post.quant} onChange={(e) => setP({ quant: e.currentTarget.checked })} />
              <FxSlider label="Colors" display={`${post.quantN}`} value={post.quantN} min={2} max={256} step={1} onChange={(v) => setP({ quantN: v, quant: true })} marks={[{ value: 16 }]} />
              <PresetPills
                items={[4, 8, 16, 32, 64, 128].map((n) => ({ id: String(n), name: String(n) }))}
                selected={String(post.quantN)}
                onSelect={(id) => setP({ quantN: Number(id), quant: true })}
              />
              <Text size="10px" c="dimmed" tt="uppercase" fw={700}>
                Dither
              </Text>
              <GlassSegmented
                value={post.quantDither}
                onChange={(v) => setP({ quantDither: v as Dither, quant: true })}
                data={[
                  { value: 'none', label: 'None' },
                  { value: 'bayer', label: 'Bayer' },
                  { value: 'fs', label: 'Floyd' }
                ]}
              />
              <Text size="10px" c="dimmed" style={{ lineHeight: 1.4 }}>
                Picks the best N colors for this picture. Works without Pixelize.
              </Text>
              {resetLink(() => setP({ quant: false, quantN: 16, quantDither: 'none' }))}
            </Stack>
          )
        },
        {
          id: 'fx-bg',
          label: 'Remove Background',
          width: 270,
          content: (
            <Stack gap={8}>
              <Switch size="xs" label="Remove background" checked={post.removeBg} onChange={(e) => setP({ removeBg: e.currentTarget.checked })} />
              <Switch size="xs" label="Detect color from the corners" checked={post.bgAuto} onChange={(e) => setP({ bgAuto: e.currentTarget.checked, removeBg: true })} />
              {!post.bgAuto && (
                <ColorChoice
                  value={post.bgColor}
                  onChange={(c) => setP({ bgColor: c, removeBg: true })}
                  presets={[
                    { id: '#ffffff', name: 'White' },
                    { id: '#000000', name: 'Black' },
                    { id: '#2f9e44', name: 'Green' },
                    { id: '#1c7ed6', name: 'Blue' }
                  ]}
                />
              )}
              <FxSlider label="Tolerance" display={`${post.bgTol}%`} value={post.bgTol} min={0} max={100} step={1} onChange={(v) => setP({ bgTol: v, removeBg: true })} marks={[{ value: 12 }]} />
              <FxSlider label="Edge softness" display={`${post.bgFeather}%`} value={post.bgFeather} min={0} max={40} step={1} onChange={(v) => setP({ bgFeather: v, removeBg: true })} marks={[{ value: 6 }]} />
              <Switch size="xs" label="Only background touching the edges" checked={post.bgContig} onChange={(e) => setP({ bgContig: e.currentTarget.checked })} />
              <Text size="10px" c="dimmed" style={{ lineHeight: 1.4 }}>
                Makes a solid-color background transparent. Keep the edge switch on so the same color inside the
                subject stays. Saved as PNG.
              </Text>
              {resetLink(() => setP({ removeBg: false, bgAuto: true, bgColor: '#ffffff', bgTol: 12, bgFeather: 6, bgContig: true }))}
            </Stack>
          )
        }
      ]
    }
  ];

  // Rounded corners on the crop box, in the same units the box is drawn in.
  const cropRadius =
    crop && eW > 0 ? (fx.radius / 100) * Math.min(crop.rect.w, crop.rect.h) * (vw / eW) : 0;
  const handleSize = 10 / view.zoom;
  const lineW = 1.5 / view.zoom;
  const cropLabel = crop ? CROP_RATIOS.find((r) => r.id === crop.ratio)?.name ?? crop.ratio : '';

  return (
    <div
      ref={boxRef}
      onMouseDown={onMouseDown}
      onDoubleClick={fitView}
      onContextMenu={(e) => {
        e.preventDefault();
        setMenu({ x: e.clientX, y: e.clientY });
      }}
      style={{
        position: 'absolute',
        inset: 0,
        overflow: 'hidden',
        cursor: 'grab',
        userSelect: 'none',
        background: 'var(--wh3d-viewport-bg)'
      }}
    >
      <PlayerGlassStyles />
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`,
          transformOrigin: '50% 50%'
        }}
      >
        <img
          key={file.id}
          ref={imgRef}
          src={showPost ? prev.url : src}
          alt={file.filename}
          draggable={false}
          onLoad={(e) => {
            if (!showPost) setNat({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight });
          }}
          style={{
            ...(showPost
              ? pixelated && nat
                ? {
                    width: prev.w * pxScale,
                    height: prev.h * pxScale,
                    maxWidth: 'none',
                    maxHeight: 'none',
                    imageRendering: 'pixelated' as const,
                    ...CHECKER_BG
                  }
                : {
                    maxWidth: '100%',
                    maxHeight: '100%',
                    imageRendering: post.pixelize ? ('pixelated' as const) : ('auto' as const),
                    ...CHECKER_BG
                  }
              : pixelated && nat
              ? {
                  width: nat.w * pxScale,
                  height: nat.h * pxScale,
                  maxWidth: 'none',
                  maxHeight: 'none',
                  imageRendering: 'pixelated' as const,
                  ...CHECKER_BG
                }
              : {
                  maxWidth: '100%',
                  maxHeight: '100%',
                  ...(mayHaveAlpha
                    ? {
                        ...CHECKER_BG,
                        backgroundSize: `${16 / view.zoom}px ${16 / view.zoom}px`
                      }
                    : {})
                }),
            display: 'block',
            // With effects on, `prev` already has the filters, rotation, crop and corners baked in.
            filter: showPost ? 'none' : cssFilter(fx),
            borderRadius: showPost ? 0 : radiusPx,
            transform: showPost
              ? 'none'
              : `scale(${fx.flipH ? -1 : 1}, ${fx.flipV ? -1 : 1}) rotate(${fx.rotate}deg) scale(${rotFit})`
          }}
        />

        {/* Crop box: sits exactly over the picture; everything outside the box is dimmed. */}
        {crop && nat && vw > 0 && vh > 0 && eW > 0 && eH > 0 && (
          <div
            style={{
              position: 'absolute',
              left: '50%',
              top: '50%',
              width: vw,
              height: vh,
              transform: 'translate(-50%, -50%)',
              pointerEvents: 'none'
            }}
          >
            <div
              onMouseDown={(e) => startCrop(e, 'move')}
              onDoubleClick={(e) => e.stopPropagation()}
              style={{
                position: 'absolute',
                left: `${(crop.rect.x / eW) * 100}%`,
                top: `${(crop.rect.y / eH) * 100}%`,
                width: `${(crop.rect.w / eW) * 100}%`,
                height: `${(crop.rect.h / eH) * 100}%`,
                borderRadius: cropRadius,
                boxShadow: `0 0 0 ${lineW}px rgba(255,255,255,0.95), 0 0 0 9999px rgba(12, 12, 16, 0.62)`,
                cursor: 'move',
                pointerEvents: 'auto'
              }}
            >
              {/* rule-of-thirds lines */}
              {[33.333, 66.666].map((p) => (
                <div
                  key={`v${p}`}
                  style={{ position: 'absolute', left: `${p}%`, top: 0, bottom: 0, width: lineW, background: 'rgba(255,255,255,0.35)', pointerEvents: 'none' }}
                />
              ))}
              {[33.333, 66.666].map((p) => (
                <div
                  key={`h${p}`}
                  style={{ position: 'absolute', top: `${p}%`, left: 0, right: 0, height: lineW, background: 'rgba(255,255,255,0.35)', pointerEvents: 'none' }}
                />
              ))}
              {HANDLES.map((h) => (
                <div
                  key={h.id}
                  onMouseDown={(e) => startCrop(e, h.id)}
                  style={{
                    position: 'absolute',
                    left: `${h.x}%`,
                    top: `${h.y}%`,
                    width: handleSize,
                    height: handleSize,
                    transform: 'translate(-50%, -50%)',
                    background: '#fff',
                    border: `${lineW}px solid rgba(0,0,0,0.65)`,
                    borderRadius: 2,
                    cursor: h.cursor
                  }}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {crop && cropPx && (
        <div
          onMouseDown={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
          style={{
            position: 'absolute',
            top: 10,
            left: '50%',
            transform: 'translateX(-50%)',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '3px 5px 3px 12px',
            borderRadius: 999,
            background: 'rgba(0,0,0,0.65)',
            color: '#fff',
            fontSize: 11,
            cursor: 'default'
          }}
        >
          <span>
            Crop {cropLabel} &middot; {cropPx.w} x {cropPx.h} px
          </span>
          <UnstyledButton
            onClick={() => setCrop(null)}
            style={{ color: '#fff', fontSize: 11, padding: '2px 10px', borderRadius: 999, background: 'rgba(255,255,255,0.18)' }}
          >
            Clear
          </UnstyledButton>
        </div>
      )}

      {nat && (
        <div
          style={{
            position: 'absolute',
            left: 10,
            bottom: 8,
            fontSize: 11,
            padding: '2px 8px',
            borderRadius: 999,
            background: 'rgba(0,0,0,0.55)',
            color: '#fff',
            pointerEvents: 'none'
          }}
        >
          {nat.w} x {nat.h} px
        </div>
      )}
      {busy && (
        <div
          style={{
            position: 'absolute',
            left: '50%',
            bottom: 14,
            transform: 'translateX(-50%)',
            padding: '6px 14px',
            borderRadius: 999,
            background: 'rgba(0,0,0,0.75)',
            color: '#fff',
            fontSize: 12,
            pointerEvents: 'none'
          }}
        >
          {busy}
        </div>
      )}
      <ZoomControl
        zoom={view.zoom}
        onZoomIn={() => zoomBy(VIEW_ZOOM_STEP)}
        onZoomOut={() => zoomBy(1 / VIEW_ZOOM_STEP)}
        onReset={fitView}
      />
      {menu && <PlayerContextMenu x={menu.x} y={menu.y} sections={sections} onClose={() => setMenu(null)} />}
    </div>
  );
}