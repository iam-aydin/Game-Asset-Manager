import { useEffect, useState } from 'react';

/**
 * ICO parsing + decoding (renderer only, no dependencies).
 *
 * Entry kinds:
 *  - 'png': modern entry, a whole PNG file stored inside the ICO
 *  - 'bmp': classic entry, a DIB (no file header) with an XOR bitmap followed by
 *           a 1-bit AND mask. Supports 1, 4, 8, 16 (555), 24 and 32 bits.
 */

export interface IcoEntry {
  index: number;
  width: number;
  height: number;
  bitCount: number;
  bytes: number;
  offset: number;
  kind: 'png' | 'bmp';
}

export const isIcoExtension = (ext: string): boolean =>
  ext.replace(/^\./, '').toLowerCase() === 'ico';

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47];
const PNG_CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

export function parseIco(buf: ArrayBuffer): IcoEntry[] {
  if (buf.byteLength < 6) throw new Error('Not an ICO file (too small).');
  const v = new DataView(buf);
  const reserved = v.getUint16(0, true);
  const type = v.getUint16(2, true);
  const count = v.getUint16(4, true);
  if (reserved !== 0 || type !== 1 || count === 0) {
    throw new Error('Not an ICO file (bad header).');
  }
  const u8 = new Uint8Array(buf);
  const out: IcoEntry[] = [];
  for (let i = 0; i < count; i++) {
    const p = 6 + i * 16;
    if (p + 16 > buf.byteLength) break;
    let width = v.getUint8(p) || 256;
    let height = v.getUint8(p + 1) || 256;
    let bitCount = v.getUint16(p + 6, true);
    const bytes = v.getUint32(p + 8, true);
    const offset = v.getUint32(p + 12, true);
    if (bytes < 8 || offset + bytes > buf.byteLength) continue; // corrupt entry: skip

    const isPng = PNG_SIG.every((b, k) => u8[offset + k] === b);
    if (isPng && bytes >= 26) {
      // IHDR: width / height are big-endian at +16 / +20
      width = v.getUint32(offset + 16, false) || width;
      height = v.getUint32(offset + 20, false) || height;
      const depth = v.getUint8(offset + 24);
      const channels = PNG_CHANNELS[v.getUint8(offset + 25)] ?? 4;
      bitCount = depth * channels;
    } else if (!isPng && bytes >= 16) {
      bitCount = v.getUint16(offset + 14, true) || bitCount;
    }
    out.push({ index: i, width, height, bitCount, bytes, offset, kind: isPng ? 'png' : 'bmp' });
  }
  if (out.length === 0) throw new Error('This ICO file has no readable images.');
  return out;
}

/** "6 sizes: 16 to 256" (by the longer side). */
export function summarizeIcoSizes(entries: IcoEntry[]): string {
  const dims = new Set(entries.map((e) => `${e.width}x${e.height}`));
  const sides = entries.map((e) => Math.max(e.width, e.height));
  const lo = Math.min(...sides);
  const hi = Math.max(...sides);
  const n = dims.size;
  if (n === 1) return `1 size: ${entries[0].width}\u00d7${entries[0].height}`;
  return `${n} sizes: ${lo} to ${hi}`;
}

// ---- Decoding ----------------------------------------------------------------

function decodeBmp(buf: ArrayBuffer, e: IcoEntry): ImageData {
  const d = new Uint8Array(buf, e.offset, e.bytes);
  const v = new DataView(buf, e.offset, e.bytes);
  const headerSize = v.getUint32(0, true);
  if (headerSize < 40) throw new Error('Unsupported bitmap header.');
  const width = Math.abs(v.getInt32(4, true));
  const rawH = v.getInt32(8, true);
  const topDown = rawH < 0;
  const fullH = Math.abs(rawH);
  const bpp = v.getUint16(14, true);
  const comp = v.getUint32(16, true);
  if (comp !== 0 && comp !== 3) throw new Error('Compressed bitmap icons are not supported.');
  if (![1, 4, 8, 16, 24, 32].includes(bpp)) throw new Error(`Unsupported bit depth: ${bpp}.`);

  // Normal case: the stored height is double (XOR bitmap + AND mask).
  let height = fullH;
  let hasMask = false;
  if (fullH === e.height * 2 || (fullH > width && fullH === width * 2)) {
    height = fullH / 2;
    hasMask = true;
  }
  if (width === 0 || height === 0) throw new Error('Empty bitmap.');

  let palette: Uint8Array | null = null;
  let pixOff = headerSize;
  if (bpp <= 8) {
    const used = v.getUint32(32, true);
    const n = used || 1 << bpp;
    if (headerSize + n * 4 > e.bytes) throw new Error('Truncated palette.');
    palette = d.subarray(headerSize, headerSize + n * 4);
    pixOff = headerSize + n * 4;
  } else if (comp === 3 && headerSize === 40) {
    pixOff += 12; // three colour masks follow a plain 40-byte header
  }

  const rowBytes = ((width * bpp + 31) >> 5) << 2;
  const maskRow = ((width + 31) >> 5) << 2;
  const maskOff = pixOff + rowBytes * height;
  if (maskOff > e.bytes) throw new Error('Truncated bitmap.');
  if (hasMask && maskOff + maskRow * height > e.bytes) hasMask = false;

  const rgba = new Uint8ClampedArray(width * height * 4);
  let anyAlpha = false;

  for (let y = 0; y < height; y++) {
    const srcY = topDown ? y : height - 1 - y;
    const row = pixOff + srcY * rowBytes;
    const mrow = maskOff + srcY * maskRow;
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      let r = 0, g = 0, b = 0, a = 255;
      if (bpp === 32) {
        const p = row + x * 4;
        b = d[p]; g = d[p + 1]; r = d[p + 2]; a = d[p + 3];
        if (a !== 0) anyAlpha = true;
      } else if (bpp === 24) {
        const p = row + x * 3;
        b = d[p]; g = d[p + 1]; r = d[p + 2];
      } else if (bpp === 16) {
        const val = d[row + x * 2] | (d[row + x * 2 + 1] << 8);
        r = Math.round((((val >> 10) & 31) * 255) / 31);
        g = Math.round((((val >> 5) & 31) * 255) / 31);
        b = Math.round(((val & 31) * 255) / 31);
      } else {
        let idx: number;
        if (bpp === 8) idx = d[row + x];
        else if (bpp === 4) idx = (d[row + (x >> 1)] >> (x & 1 ? 0 : 4)) & 15;
        else idx = (d[row + (x >> 3)] >> (7 - (x & 7))) & 1;
        const pi = idx * 4;
        if (palette && pi + 2 < palette.length) {
          b = palette[pi]; g = palette[pi + 1]; r = palette[pi + 2];
        }
      }
      if (bpp !== 32 && hasMask) {
        const bit = (d[mrow + (x >> 3)] >> (7 - (x & 7))) & 1;
        a = bit ? 0 : 255;
      }
      rgba[o] = r; rgba[o + 1] = g; rgba[o + 2] = b; rgba[o + 3] = a;
    }
  }

  // 32-bit icons with an all-zero alpha channel are really masked / opaque images.
  if (bpp === 32 && !anyAlpha) {
    for (let y = 0; y < height; y++) {
      const srcY = topDown ? y : height - 1 - y;
      const mrow = maskOff + srcY * maskRow;
      for (let x = 0; x < width; x++) {
        const bit = hasMask ? (d[mrow + (x >> 3)] >> (7 - (x & 7))) & 1 : 0;
        rgba[(y * width + x) * 4 + 3] = bit ? 0 : 255;
      }
    }
  }
  return new ImageData(rgba, width, height);
}

async function decodePng(buf: ArrayBuffer, e: IcoEntry): Promise<ImageData> {
  const blob = new Blob([new Uint8Array(buf, e.offset, e.bytes)], { type: 'image/png' });
  const bmp = await createImageBitmap(blob);
  try {
    const c = document.createElement('canvas');
    c.width = bmp.width;
    c.height = bmp.height;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('Canvas is not available.');
    ctx.drawImage(bmp, 0, 0);
    return ctx.getImageData(0, 0, bmp.width, bmp.height);
  } finally {
    bmp.close();
  }
}

export async function decodeIcoEntry(buf: ArrayBuffer, e: IcoEntry): Promise<ImageData> {
  return e.kind === 'png' ? decodePng(buf, e) : decodeBmp(buf, e);
}

// ---- Loading (small shared cache so the viewer and the metadata panel fetch once) ----

interface IcoFile {
  buf: ArrayBuffer;
  entries: IcoEntry[];
}

const cache = new Map<string, Promise<IcoFile>>();
const CACHE_MAX = 8;

export function loadIco(
  libraryId: string,
  file: { id: number; mtimeMs: number }
): Promise<IcoFile> {
  const key = `${libraryId}:${file.id}:${file.mtimeMs}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const p = (async () => {
    const res = await fetch(
      `wh3d-file://${encodeURIComponent(libraryId)}/${file.id}?t=${file.mtimeMs}`
    );
    if (!res.ok) throw new Error(`Failed to load icon (${res.status})`);
    const buf = await res.arrayBuffer();
    return { buf, entries: parseIco(buf) };
  })();
  cache.set(key, p);
  p.catch(() => cache.delete(key));
  while (cache.size > CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
  return p;
}

/** Entries of an .ico file, or null while loading / when it cannot be read. */
export function useIcoEntries(
  libraryId: string,
  file: { id: number; mtimeMs: number },
  enabled = true
): IcoEntry[] | null {
  const [entries, setEntries] = useState<IcoEntry[] | null>(null);
  useEffect(() => {
    setEntries(null);
    if (!enabled) return undefined;
    let dead = false;
    loadIco(libraryId, file)
      .then((r) => {
        if (!dead) setEntries(r.entries);
      })
      .catch(() => undefined);
    return () => {
      dead = true;
    };
  }, [libraryId, file.id, file.mtimeMs, enabled]);
  return entries;
}