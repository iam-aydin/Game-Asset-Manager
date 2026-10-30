// Pixel-art / game-dev image effects. Pure canvas code, no React.
// Pipeline order: pixelize -> normal map -> trim -> outline -> pad to power of two -> upscale.
// Everything before the last step works at the low (sprite) resolution.

export type Dither = 'none' | 'bayer' | 'fs';

export interface PostFx {
  pixelize: boolean;
  pxWidth: number; // target width in px
  pxUpscale: boolean; // save at the original size (true) or at the true low-res size (false)
  palette: string; // PALETTES id
  dither: Dither;
  hardAlpha: boolean;
  normal: boolean;
  normalStrength: number;
  flipGreen: boolean; // DirectX style normal map
  trim: boolean;
  outline: boolean;
  outlineW: number;
  outlineColor: string;
  pow2: boolean;
  padOn: boolean;
  padPx: number;
  sharpen: number; // % , 0 = off
  blur: number; // px, 0 = off
  quant: boolean;
  quantN: number;
  quantDither: Dither;
  removeBg: boolean;
  bgAuto: boolean;
  bgColor: string;
  bgTol: number; // %
  bgFeather: number; // %
  bgContig: boolean; // only background touching the edges
}

export const DEFAULT_POST: PostFx = {
  pixelize: false,
  pxWidth: 64,
  pxUpscale: true,
  palette: 'none',
  dither: 'none',
  hardAlpha: true,
  normal: false,
  normalStrength: 2,
  flipGreen: false,
  trim: false,
  outline: false,
  outlineW: 1,
  outlineColor: '#000000',
  pow2: false,
  padOn: false,
  padPx: 8,
  sharpen: 0,
  blur: 0,
  quant: false,
  quantN: 16,
  quantDither: 'none',
  removeBg: false,
  bgAuto: true,
  bgColor: '#ffffff',
  bgTol: 12,
  bgFeather: 6,
  bgContig: true
};

export const postActive = (p: PostFx): boolean =>
  p.pixelize || p.normal || p.trim || p.outline || p.pow2 || p.padOn || p.sharpen > 0 || p.blur > 0 || p.quant || p.removeBg;

type Src = ImageBitmap | HTMLCanvasElement;

const hex = (s: string): number[] => {
  const n = parseInt(s.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

export interface PaletteDef {
  id: string;
  name: string;
  auto?: number;
  colors?: number[][];
}

export const PALETTES: PaletteDef[] = [
  { id: 'none', name: 'Off' },
  { id: 'auto8', name: '8 colors', auto: 8 },
  { id: 'auto16', name: '16 colors', auto: 16 },
  { id: 'auto32', name: '32 colors', auto: 32 },
  { id: 'bw', name: '1-bit', colors: [[0, 0, 0], [255, 255, 255]] },
  { id: 'gb', name: 'Game Boy', colors: ['0f380f', '306230', '8bac0f', '9bbc0f'].map(hex) },
  {
    id: 'pico8',
    name: 'PICO-8',
    colors: [
      '000000', '1d2b53', '7e2553', '008751', 'ab5236', '5f574f', 'c2c3c7', 'fff1e8',
      'ff004d', 'ffa300', 'ffec27', '00e436', '29adff', '83769c', 'ff77a8', 'ffccaa'
    ].map(hex)
  },
  {
    id: 'edg32',
    name: 'Endesga 32',
    colors: [
      'be4a2f', 'd77643', 'ead4aa', 'e4a672', 'b86f50', '733e39', '3e2731', 'a22633',
      'e43b44', 'f77622', 'feae34', 'fee761', '63c74d', '3e8948', '265c42', '193c3e',
      '124e89', '0099db', '2ce8f5', 'ffffff', 'c0cbdc', '8b9bae', '5a6988', '3a4466',
      '262b44', '181425', 'ff0044', '68386c', 'b55088', 'f6757a', 'e8b796', 'c28569'
    ].map(hex)
  }
];

function mk(w: number, h: number): { c: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Canvas is not available');
  return { c, ctx };
}

function toCanvas(src: Src): HTMLCanvasElement {
  const { c, ctx } = mk(src.width, src.height);
  ctx.drawImage(src, 0, 0);
  return c;
}

const clamp255 = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v);

// ---- Palette -------------------------------------------------------------------

function medianCut(d: Uint8ClampedArray, n: number): number[][] {
  let pts: number[][] = [];
  for (let i = 0; i < d.length; i += 4) if (d[i + 3] >= 128) pts.push([d[i], d[i + 1], d[i + 2]]);
  if (!pts.length) return [[0, 0, 0]];
  if (pts.length > 50000) {
    const step = pts.length / 50000;
    pts = Array.from({ length: 50000 }, (_, i) => pts[Math.floor(i * step)]);
  }
  const boxes: number[][][] = [pts];
  while (boxes.length < n) {
    let bi = -1;
    let best = 0;
    let ch = 0;
    boxes.forEach((b, i) => {
      if (b.length < 2) return;
      for (let c = 0; c < 3; c++) {
        let lo = 255;
        let hi = 0;
        for (const p of b) {
          if (p[c] < lo) lo = p[c];
          if (p[c] > hi) hi = p[c];
        }
        if (hi - lo > best) {
          best = hi - lo;
          bi = i;
          ch = c;
        }
      }
    });
    if (bi < 0) break;
    const b = boxes[bi];
    b.sort((a, c) => a[ch] - c[ch]);
    const m = b.length >> 1;
    boxes.splice(bi, 1, b.slice(0, m), b.slice(m));
  }
  return boxes.map((b) => {
    const s = [0, 0, 0];
    for (const p of b) {
      s[0] += p[0];
      s[1] += p[1];
      s[2] += p[2];
    }
    return s.map((v) => Math.round(v / b.length));
  });
}

const BAYER = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5]
];

function quantize(d: Uint8ClampedArray, w: number, h: number, pal: number[][], dither: Dither): void {
  // Nearest palette color, cached per 5-bit color so big palettes stay fast.
  const cache = new Int16Array(32768).fill(-1);
  const near = (r: number, g: number, b: number): number[] => {
    const key = (((r | 0) >> 3) << 10) | (((g | 0) >> 3) << 5) | ((b | 0) >> 3);
    const hit = cache[key];
    if (hit >= 0) return pal[hit];
    let best = 0;
    let bd = Infinity;
    for (let i = 0; i < pal.length; i++) {
      const c = pal[i];
      const dr = r - c[0];
      const dg = g - c[1];
      const db = b - c[2];
      const dd = dr * dr + dg * dg + db * db;
      if (dd < bd) {
        bd = dd;
        best = i;
      }
    }
    cache[key] = best;
    return pal[best];
  };
  const put = (o: number, c: number[]) => {
    d[o] = c[0];
    d[o + 1] = c[1];
    d[o + 2] = c[2];
  };

  if (dither === 'fs') {
    const buf = new Float32Array(w * h * 3);
    for (let i = 0; i < w * h; i++) {
      buf[i * 3] = d[i * 4];
      buf[i * 3 + 1] = d[i * 4 + 1];
      buf[i * 3 + 2] = d[i * 4 + 2];
    }
    const spread = (x: number, y: number, e: number[], f: number) => {
      if (x < 0 || x >= w || y >= h) return;
      const k = (y * w + x) * 3;
      buf[k] += e[0] * f;
      buf[k + 1] += e[1] * f;
      buf[k + 2] += e[2] * f;
    };
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const o = (y * w + x) * 4;
        if (d[o + 3] === 0) continue;
        const k = (y * w + x) * 3;
        const r = clamp255(buf[k]);
        const g = clamp255(buf[k + 1]);
        const b = clamp255(buf[k + 2]);
        const c = near(r, g, b);
        put(o, c);
        const e = [r - c[0], g - c[1], b - c[2]];
        spread(x + 1, y, e, 7 / 16);
        spread(x - 1, y + 1, e, 3 / 16);
        spread(x, y + 1, e, 5 / 16);
        spread(x + 1, y + 1, e, 1 / 16);
      }
    }
    return;
  }

  const spreadAmt = 255 / Math.cbrt(Math.max(2, pal.length)) * 0.5;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      if (d[o + 3] === 0) continue;
      const t = dither === 'bayer' ? (BAYER[y & 3][x & 3] / 16 - 0.5) * spreadAmt : 0;
      put(o, near(clamp255(d[o] + t), clamp255(d[o + 1] + t), clamp255(d[o + 2] + t)));
    }
  }
}

// ---- Pixelize ------------------------------------------------------------------

/** Box-average down to the target width (alpha-weighted), then palette + hard alpha. */
function pixelize(src: HTMLCanvasElement, p: PostFx): { canvas: HTMLCanvasElement; k: number } {
  const W = src.width;
  const H = src.height;
  const tw = Math.min(W, Math.max(1, Math.round(p.pxWidth)));
  const th = Math.max(1, Math.round((H * tw) / W));
  const ctx0 = src.getContext('2d');
  if (!ctx0) throw new Error('Canvas is not available');
  const s = ctx0.getImageData(0, 0, W, H).data;
  const out = new Uint8ClampedArray(tw * th * 4);

  for (let ty = 0; ty < th; ty++) {
    const y0 = Math.floor((ty * H) / th);
    const y1 = Math.min(H, Math.max(y0 + 1, Math.floor(((ty + 1) * H) / th)));
    for (let tx = 0; tx < tw; tx++) {
      const x0 = Math.floor((tx * W) / tw);
      const x1 = Math.min(W, Math.max(x0 + 1, Math.floor(((tx + 1) * W) / tw)));
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let n = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = (y * W + x) * 4;
          const al = s[i + 3];
          r += s[i] * al;
          g += s[i + 1] * al;
          b += s[i + 2] * al;
          a += al;
          n++;
        }
      }
      const o = (ty * tw + tx) * 4;
      if (a > 0) {
        out[o] = r / a;
        out[o + 1] = g / a;
        out[o + 2] = b / a;
      }
      out[o + 3] = n ? a / n : 0;
    }
  }

  if (p.hardAlpha) {
    for (let i = 3; i < out.length; i += 4) out[i] = out[i] >= 128 ? 255 : 0;
  }
  const def = PALETTES.find((x) => x.id === p.palette);
  if (def && (def.colors || def.auto)) {
    quantize(out, tw, th, def.colors ?? medianCut(out, def.auto ?? 16), p.dither);
  }

  const { c, ctx } = mk(tw, th);
  const img = ctx.createImageData(tw, th);
  img.data.set(out);
  ctx.putImageData(img, 0, 0);
  return { canvas: c, k: Math.max(1, Math.round(W / tw)) };
}

// ---- Other effects ---------------------------------------------------------------

/** Height (luminance) to tangent-space normal map. Default is OpenGL (green up). */
function normalMap(src: HTMLCanvasElement, p: PostFx): HTMLCanvasElement {
  const w = src.width;
  const h = src.height;
  const ctx0 = src.getContext('2d');
  if (!ctx0) throw new Error('Canvas is not available');
  const s = ctx0.getImageData(0, 0, w, h).data;
  const ht = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    ht[i] = (0.2126 * s[i * 4] + 0.7152 * s[i * 4 + 1] + 0.0722 * s[i * 4 + 2]) / 255;
  }
  const H = (x: number, y: number) => ht[Math.max(0, Math.min(h - 1, y)) * w + Math.max(0, Math.min(w - 1, x))];
  const { c, ctx } = mk(w, h);
  const img = ctx.createImageData(w, h);
  const sign = p.flipGreen ? -1 : 1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = H(x + 1, y - 1) + 2 * H(x + 1, y) + H(x + 1, y + 1) - (H(x - 1, y - 1) + 2 * H(x - 1, y) + H(x - 1, y + 1));
      const dy = H(x - 1, y + 1) + 2 * H(x, y + 1) + H(x + 1, y + 1) - (H(x - 1, y - 1) + 2 * H(x, y - 1) + H(x + 1, y - 1));
      let nx = -dx * p.normalStrength;
      let ny = dy * p.normalStrength * sign;
      let nz = 1;
      const len = Math.hypot(nx, ny, nz);
      nx /= len;
      ny /= len;
      nz /= len;
      const o = (y * w + x) * 4;
      img.data[o] = Math.round((nx * 0.5 + 0.5) * 255);
      img.data[o + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      img.data[o + 2] = Math.round((nz * 0.5 + 0.5) * 255);
      img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/** Cut away fully transparent borders. */
function trim(src: HTMLCanvasElement): HTMLCanvasElement {
  const w = src.width;
  const h = src.height;
  const ctx0 = src.getContext('2d');
  if (!ctx0) throw new Error('Canvas is not available');
  const d = ctx0.getImageData(0, 0, w, h).data;
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (d[(y * w + x) * 4 + 3] > 0) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return src; // nothing visible
  const { c, ctx } = mk(x1 - x0 + 1, y1 - y0 + 1);
  ctx.drawImage(src, -x0, -y0);
  return c;
}

/** Outline around the opaque pixels, `outlineW` pixels thick (in sprite pixels). */
function outline(src: HTMLCanvasElement, p: PostFx, wPx: number): HTMLCanvasElement {
  const n = Math.max(1, Math.round(wPx));
  const w = src.width + n * 2;
  const h = src.height + n * 2;
  const { c, ctx } = mk(w, h);
  ctx.drawImage(src, n, n);
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  const col = hex(p.outlineColor);
  for (let pass = 0; pass < n; pass++) {
    const prev = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) prev[i] = d[i * 4 + 3] > 0 ? 1 : 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (prev[i]) continue;
        if (
          (x > 0 && prev[i - 1]) ||
          (x < w - 1 && prev[i + 1]) ||
          (y > 0 && prev[i - w]) ||
          (y < h - 1 && prev[i + w])
        ) {
          d[i * 4] = col[0];
          d[i * 4 + 1] = col[1];
          d[i * 4 + 2] = col[2];
          d[i * 4 + 3] = 255;
        }
      }
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

function padPow2(src: HTMLCanvasElement): HTMLCanvasElement {
  const up = (v: number) => 2 ** Math.ceil(Math.log2(Math.max(1, v)));
  const w = up(src.width);
  const h = up(src.height);
  if (w === src.width && h === src.height) return src;
  const { c, ctx } = mk(w, h);
  ctx.drawImage(src, Math.floor((w - src.width) / 2), Math.floor((h - src.height) / 2));
  return c;
}

function upscale(src: HTMLCanvasElement, k: number): HTMLCanvasElement {
  const { c, ctx } = mk(src.width * k, src.height * k);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(src, 0, 0, c.width, c.height);
  return c;
}

/** Nearest-neighbor shrink by a whole factor (undoes `upscale`). */
export function downscaleNearest(src: HTMLCanvasElement, k: number): HTMLCanvasElement {
  const { c, ctx } = mk(src.width / k, src.height / k);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(src, 0, 0, c.width, c.height);
  return c;
}

function padAll(src: HTMLCanvasElement, n: number): HTMLCanvasElement {
  const { c, ctx } = mk(src.width + n * 2, src.height + n * 2);
  ctx.drawImage(src, n, n);
  return c;
}

function upscaleTo(src: HTMLCanvasElement, w: number, h: number): HTMLCanvasElement {
  const { c, ctx } = mk(w, h);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(src, 0, 0, c.width, c.height);
  return c;
}

function blurCanvas(src: HTMLCanvasElement, r: number): HTMLCanvasElement {
  if (r <= 0) return src;
  const ctx0 = src.getContext('2d');
  if (!ctx0) throw new Error('Canvas is not available');
  const before = ctx0.getImageData(0, 0, src.width, src.height).data;
  let opaque = true;
  for (let i = 3; i < before.length; i += 4) {
    if (before[i] < 255) {
      opaque = false;
      break;
    }
  }
  const { c, ctx } = mk(src.width, src.height);
  ctx.filter = `blur(${r}px)`;
  ctx.drawImage(src, 0, 0);
  if (opaque) {
    // Blurring fades the picture's own border to transparent: put the full alpha back.
    const img = ctx.getImageData(0, 0, c.width, c.height);
    for (let i = 3; i < img.data.length; i += 4) img.data[i] = 255;
    ctx.putImageData(img, 0, 0);
  }
  return c;
}

/** 3x3 sharpen. amount is a percent (100 = normal, 300 = very strong). */
function sharpen(src: HTMLCanvasElement, amount: number): HTMLCanvasElement {
  const w = src.width;
  const h = src.height;
  const ctx0 = src.getContext('2d');
  if (!ctx0) throw new Error('Canvas is not available');
  const s = ctx0.getImageData(0, 0, w, h).data;
  const { c, ctx } = mk(w, h);
  const img = ctx.createImageData(w, h);
  const o = img.data;
  const a = amount / 100;
  for (let y = 0; y < h; y++) {
    const yu = Math.max(0, y - 1);
    const yd = Math.min(h - 1, y + 1);
    for (let x = 0; x < w; x++) {
      const xl = Math.max(0, x - 1);
      const xr = Math.min(w - 1, x + 1);
      const i = (y * w + x) * 4;
      const u = (yu * w + x) * 4;
      const dn = (yd * w + x) * 4;
      const l = (y * w + xl) * 4;
      const r = (y * w + xr) * 4;
      for (let ch = 0; ch < 3; ch++) {
        const v = s[i + ch] * (1 + 4 * a) - a * (s[u + ch] + s[dn + ch] + s[l + ch] + s[r + ch]);
        o[i + ch] = clamp255(v);
      }
      o[i + 3] = s[i + 3];
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/** Reduce to n colors (median cut) with optional dithering. */
function quantizeCanvas(src: HTMLCanvasElement, n: number, dither: Dither): HTMLCanvasElement {
  const w = src.width;
  const h = src.height;
  const ctx0 = src.getContext('2d');
  if (!ctx0) throw new Error('Canvas is not available');
  const img = ctx0.getImageData(0, 0, w, h);
  quantize(img.data, w, h, medianCut(img.data, Math.max(2, Math.round(n))), dither);
  const { c, ctx } = mk(w, h);
  ctx.putImageData(img, 0, 0);
  return c;
}

/** The corner color the other corners agree with most (opaque corners only). */
function cornerAvg(d: Uint8ClampedArray, w: number, h: number): number[] {
  const pts = [
    [0, 0],
    [w - 1, 0],
    [0, h - 1],
    [w - 1, h - 1]
  ]
    .map(([x, y]) => (y * w + x) * 4)
    .filter((i) => d[i + 3] > 0)
    .map((i) => [d[i], d[i + 1], d[i + 2]]);
  if (!pts.length) return [255, 255, 255];
  let best = pts[0];
  let bs = Infinity;
  for (const p of pts) {
    const sum = pts.reduce((a, q) => a + Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]), 0);
    if (sum < bs) {
      bs = sum;
      best = p;
    }
  }
  return best;
}

/** Background color of the whole picture (so a crop does not change what counts as background). */
export function cornerColor(src: Src): number[] {
  const k = Math.min(1, 64 / Math.max(src.width, src.height));
  const { c, ctx } = mk(src.width * k, src.height * k);
  ctx.drawImage(src, 0, 0, c.width, c.height);
  return cornerAvg(ctx.getImageData(0, 0, c.width, c.height).data, c.width, c.height);
}

/** Make a solid-color background transparent. */
function removeBg(src: HTMLCanvasElement, p: PostFx, auto?: number[]): HTMLCanvasElement {
  const w = src.width;
  const h = src.height;
  const ctx0 = src.getContext('2d');
  if (!ctx0) throw new Error('Canvas is not available');
  const img = ctx0.getImageData(0, 0, w, h);
  const d = img.data;
  const bg = p.bgAuto ? auto ?? cornerAvg(d, w, h) : hex(p.bgColor);
  const thr = (p.bgTol / 100) * 220;
  const fe = (p.bgFeather / 100) * 220;
  const lim = thr + fe;
  const dist = (i: number) => Math.hypot(d[i] - bg[0], d[i + 1] - bg[1], d[i + 2] - bg[2]);
  const mark = new Uint8Array(w * h);

  if (p.bgContig) {
    const stack: number[] = [];
    const seed = (x: number, y: number) => {
      const j = y * w + x;
      if (mark[j]) return;
      if (d[j * 4 + 3] === 0 || dist(j * 4) <= lim) {
        mark[j] = 1;
        stack.push(j);
      }
    };
    for (let x = 0; x < w; x++) {
      seed(x, 0);
      seed(x, h - 1);
    }
    for (let y = 0; y < h; y++) {
      seed(0, y);
      seed(w - 1, y);
    }
    while (stack.length) {
      const j = stack.pop() as number;
      const x = j % w;
      const y = (j / w) | 0;
      if (x > 0) seed(x - 1, y);
      if (x < w - 1) seed(x + 1, y);
      if (y > 0) seed(x, y - 1);
      if (y < h - 1) seed(x, y + 1);
    }
  } else {
    for (let j = 0; j < w * h; j++) if (dist(j * 4) <= lim) mark[j] = 1;
  }

  for (let j = 0; j < w * h; j++) {
    if (!mark[j]) continue;
    const dd = dist(j * 4);
    const f = dd <= thr ? 0 : fe > 0 ? Math.min(1, (dd - thr) / fe) : 0;
    d[j * 4 + 3] = Math.round(d[j * 4 + 3] * f);
  }
  const { c, ctx } = mk(w, h);
  ctx.putImageData(img, 0, 0);
  return c;
}

export interface PostOpts {
  /** How much smaller than the real picture `src` is (the preview is capped in size). */
  scale?: number;
  /** Keep the picture the same size: skip trim / outline / padding and scale back to the source size. */
  keepSize?: boolean;
  /** Background color for "auto" remove background (see cornerColor). */
  autoBg?: number[];
}

/**
 * Runs the whole chain: remove background, blur, sharpen, pixelize, color quantization,
 * normal map, trim, outline, padding, power of two, then scaled back up by `k`.
 * With `k > 1` the true low-res picture is `downscaleNearest(canvas, k)`.
 */
export function applyPostFx(src: Src, p: PostFx, opts: PostOpts = {}): { canvas: HTMLCanvasElement; k: number } {
  let cur = toCanvas(src);
  const W0 = cur.width;
  const H0 = cur.height;
  const sc = opts.scale ?? 1;
  if (p.removeBg) cur = removeBg(cur, p, opts.autoBg);
  if (p.blur > 0) cur = blurCanvas(cur, p.blur * sc);
  if (p.sharpen > 0) cur = sharpen(cur, p.sharpen);
  let k = 1;
  if (p.pixelize) {
    const r = pixelize(cur, p);
    cur = r.canvas;
    k = r.k;
  }
  if (p.quant) cur = quantizeCanvas(cur, p.quantN, p.quantDither);
  if (p.normal) cur = normalMap(cur, p);
  if (!opts.keepSize) {
    // After pixelize one pixel is a sprite pixel; otherwise it is a picture pixel (scaled in preview).
    const u = p.pixelize ? 1 : sc;
    if (p.trim) cur = trim(cur);
    if (p.outline) cur = outline(cur, p, p.outlineW * u);
    if (p.padOn && p.padPx > 0) cur = padAll(cur, Math.max(1, Math.round(p.padPx * u)));
    if (p.pow2) cur = padPow2(cur);
    if (k > 1) cur = upscale(cur, k);
  } else if (k > 1) {
    cur = upscaleTo(cur, W0, H0);
  }
  return { canvas: cur, k };
}
