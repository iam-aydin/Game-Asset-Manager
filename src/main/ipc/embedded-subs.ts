import { promises as fs } from 'node:fs';
import type { FileHandle } from 'node:fs/promises';
import { extname } from 'node:path';

// Reads subtitle tracks that are stored INSIDE a video file and returns them as WebVTT.
//   MP4 / M4V / MOV : "tx3g" timed-text tracks (what most WEB-DL releases use)
//   MKV             : text tracks S_TEXT/UTF8 (srt), S_TEXT/ASS, S_TEXT/SSA
// Not supported: picture subtitles (PGS, VobSub) because they are images, not text.

export interface EmbeddedSub {
  label: string;
  vtt: string;
}

interface Cue {
  start: number;
  end: number;
  text: string;
}

const cache = new Map<string, EmbeddedSub[]>();
const WINDOW = 16 * 1024;
const MAX_MOOV = 200 * 1024 * 1024;

/** Small read-ahead cache so thousands of tiny header reads do not each hit the disk. */
class Reader {
  private buf: Buffer = Buffer.alloc(0);
  private start = 0;
  constructor(
    private fh: FileHandle,
    readonly size: number
  ) {}

  async read(pos: number, len: number): Promise<Buffer> {
    if (pos < 0 || pos >= this.size || len <= 0) return Buffer.alloc(0);
    len = Math.min(len, this.size - pos);
    if (pos >= this.start && pos + len <= this.start + this.buf.length) {
      return this.buf.subarray(pos - this.start, pos - this.start + len);
    }
    if (len > WINDOW) {
      const b = Buffer.alloc(len);
      const { bytesRead } = await this.fh.read(b, 0, len, pos);
      return b.subarray(0, bytesRead);
    }
    const want = Math.min(WINDOW, this.size - pos);
    const b = Buffer.alloc(want);
    const { bytesRead } = await this.fh.read(b, 0, want, pos);
    this.buf = b.subarray(0, bytesRead);
    this.start = pos;
    return this.buf.subarray(0, Math.min(len, bytesRead));
  }
}

// ---- shared helpers ---------------------------------------------------------

const p2 = (n: number) => String(n).padStart(2, '0');

function ts(sec: number): string {
  const ms = Math.max(0, Math.round(sec * 1000));
  const h = Math.floor(ms / 3600000);
  const m = Math.floor(ms / 60000) % 60;
  const s = Math.floor(ms / 1000) % 60;
  return `${p2(h)}:${p2(m)}:${p2(s)}.${String(ms % 1000).padStart(3, '0')}`;
}

function cleanLines(t: string): string {
  return t
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .join('\n');
}

function toVtt(cues: Cue[]): string {
  const sorted = cues
    .filter((c) => c.text && c.end > c.start)
    .sort((a, b) => a.start - b.start);
  return (
    'WEBVTT\n\n' +
    sorted.map((c) => `${ts(c.start)} --> ${ts(c.end)}\n${c.text}\n`).join('\n')
  );
}

const B_TO_T: Record<string, string> = {
  ger: 'deu', fre: 'fra', chi: 'zho', dut: 'nld', cze: 'ces', gre: 'ell', rum: 'ron',
  slo: 'slk', per: 'fas', ice: 'isl', mac: 'mkd', may: 'msa', tib: 'bod', wel: 'cym',
  baq: 'eus', geo: 'kat', alb: 'sqi', arm: 'hye', bur: 'mya', mao: 'mri'
};

function langName(code: string): string {
  if (!code || code === 'und') return '';
  const c = B_TO_T[code] ?? code;
  try {
    const n = new (Intl as any).DisplayNames(['en'], { type: 'language' }).of(c);
    if (n && n !== c) return String(n);
  } catch {
    /* unknown code */
  }
  return code;
}

// ---- MP4 / MOV (tx3g) ---------------------------------------------------------

interface Box {
  type: string;
  start: number;
  end: number;
}

function kids(b: Buffer, s: number, e: number, only?: string): Box[] {
  const out: Box[] = [];
  let p = s;
  while (p + 8 <= e) {
    let size = b.readUInt32BE(p);
    const type = b.toString('latin1', p + 4, p + 8);
    let hdr = 8;
    if (size === 1) {
      if (p + 16 > e) break;
      size = Number(b.readBigUInt64BE(p + 8));
      hdr = 16;
    } else if (size === 0) {
      size = e - p;
    }
    if (size < hdr) break;
    if (!only || type === only) out.push({ type, start: p + hdr, end: Math.min(e, p + size) });
    p += size;
  }
  return out;
}

interface Tx3gTrack {
  lang: string;
  timescale: number;
  starts: number[];
  durs: number[];
  sizes: number[];
  offsets: number[];
}

function mdhdLang(code: number): string {
  if (code < 0x400 || code === 0x7fff) return 'und';
  return [(code >> 10) & 31, (code >> 5) & 31, code & 31]
    .map((x) => String.fromCharCode(x + 0x60))
    .join('');
}

function parseTx3g(m: Buffer, trak: Box): Tx3gTrack | null {
  const mdia = kids(m, trak.start, trak.end, 'mdia')[0];
  if (!mdia) return null;
  const hdlr = kids(m, mdia.start, mdia.end, 'hdlr')[0];
  const mdhd = kids(m, mdia.start, mdia.end, 'mdhd')[0];
  const minf = kids(m, mdia.start, mdia.end, 'minf')[0];
  if (!hdlr || !mdhd || !minf || hdlr.end - hdlr.start < 12) return null;
  const handler = m.toString('latin1', hdlr.start + 8, hdlr.start + 12);
  if (!['sbtl', 'text', 'subt'].includes(handler)) return null;

  const stbl = kids(m, minf.start, minf.end, 'stbl')[0];
  if (!stbl) return null;
  const stsd = kids(m, stbl.start, stbl.end, 'stsd')[0];
  if (!stsd || stsd.end - stsd.start < 16) return null;
  if (m.toString('latin1', stsd.start + 12, stsd.start + 16) !== 'tx3g') return null;

  const v1 = m[mdhd.start] === 1;
  if (mdhd.end - mdhd.start < (v1 ? 34 : 22)) return null;
  const timescale = m.readUInt32BE(mdhd.start + (v1 ? 20 : 12)) || 1000;
  const lang = mdhdLang(m.readUInt16BE(mdhd.start + (v1 ? 32 : 20)));

  const stts = kids(m, stbl.start, stbl.end, 'stts')[0];
  const stsz = kids(m, stbl.start, stbl.end, 'stsz')[0];
  const stsc = kids(m, stbl.start, stbl.end, 'stsc')[0];
  const stco = kids(m, stbl.start, stbl.end, 'stco')[0];
  const co64 = kids(m, stbl.start, stbl.end, 'co64')[0];
  if (!stts || !stsz || !stsc || (!stco && !co64)) return null;

  // sample start times / durations
  const starts: number[] = [];
  const durs: number[] = [];
  const nStts = Math.min(m.readUInt32BE(stts.start + 4), Math.floor((stts.end - stts.start - 8) / 8));
  let t = 0;
  for (let i = 0; i < nStts && starts.length < 2_000_000; i++) {
    const cnt = m.readUInt32BE(stts.start + 8 + i * 8);
    const d = m.readUInt32BE(stts.start + 12 + i * 8);
    for (let j = 0; j < cnt && starts.length < 2_000_000; j++) {
      starts.push(t);
      durs.push(d);
      t += d;
    }
  }

  // sample sizes
  const fixed = m.readUInt32BE(stsz.start + 4);
  let count = m.readUInt32BE(stsz.start + 8);
  if (!fixed) count = Math.min(count, Math.floor((stsz.end - stsz.start - 12) / 4));
  count = Math.min(count, starts.length);
  const sizes: number[] = [];
  for (let i = 0; i < count; i++) sizes.push(fixed || m.readUInt32BE(stsz.start + 12 + i * 4));

  // samples per chunk
  const nStsc = Math.min(m.readUInt32BE(stsc.start + 4), Math.floor((stsc.end - stsc.start - 8) / 12));
  const firstChunk: number[] = [];
  const perChunk: number[] = [];
  for (let i = 0; i < nStsc; i++) {
    firstChunk.push(m.readUInt32BE(stsc.start + 8 + i * 12));
    perChunk.push(m.readUInt32BE(stsc.start + 12 + i * 12));
  }

  // chunk offsets
  const chunkOffsets: number[] = [];
  if (stco) {
    const n = Math.min(m.readUInt32BE(stco.start + 4), Math.floor((stco.end - stco.start - 8) / 4));
    for (let i = 0; i < n; i++) chunkOffsets.push(m.readUInt32BE(stco.start + 8 + i * 4));
  } else if (co64) {
    const n = Math.min(m.readUInt32BE(co64.start + 4), Math.floor((co64.end - co64.start - 8) / 8));
    for (let i = 0; i < n; i++) chunkOffsets.push(Number(m.readBigUInt64BE(co64.start + 8 + i * 8)));
  }

  // offset of every sample
  const offsets: number[] = [];
  let sample = 0;
  let k = 0;
  for (let c = 1; c <= chunkOffsets.length && sample < count; c++) {
    while (k + 1 < nStsc && firstChunk[k + 1] <= c) k++;
    const spc = perChunk[k] ?? 1;
    let off = chunkOffsets[c - 1];
    for (let j = 0; j < spc && sample < count; j++) {
      offsets.push(off);
      off += sizes[sample];
      sample++;
    }
  }

  return { lang, timescale, starts, durs, sizes, offsets };
}

function decodeTx3gText(b: Buffer): string {
  if (b.length >= 2 && b[0] === 0xfe && b[1] === 0xff) {
    return Buffer.from(b.subarray(2)).swap16().toString('utf16le');
  }
  return b.toString('utf8');
}

async function extractMp4(path: string): Promise<EmbeddedSub[]> {
  const fh = await fs.open(path, 'r');
  try {
    const st = await fh.stat();
    const r = new Reader(fh, st.size);

    // find the "moov" box (it holds the track tables)
    let pos = 0;
    let moov: Buffer | null = null;
    while (pos + 8 <= st.size) {
      const h = await r.read(pos, 16);
      if (h.length < 8) break;
      let size = h.readUInt32BE(0);
      const type = h.toString('latin1', 4, 8);
      let hdr = 8;
      if (size === 1) {
        if (h.length < 16) break;
        size = Number(h.readBigUInt64BE(8));
        hdr = 16;
      } else if (size === 0) {
        size = st.size - pos;
      }
      if (size < hdr) break;
      if (type === 'moov') {
        if (size - hdr > MAX_MOOV) return [];
        const b = Buffer.alloc(size - hdr);
        await fh.read(b, 0, b.length, pos + hdr);
        moov = b;
        break;
      }
      pos += size;
    }
    if (!moov) return [];

    const out: EmbeddedSub[] = [];
    for (const trak of kids(moov, 0, moov.length, 'trak')) {
      const tr = parseTx3g(moov, trak);
      if (!tr) continue;
      const cues: Cue[] = [];
      for (let i = 0; i < tr.offsets.length; i++) {
        const size = tr.sizes[i];
        if (size < 2) continue;
        const b = await r.read(tr.offsets[i], size);
        if (b.length < 2) continue;
        const len = Math.min(b.readUInt16BE(0), b.length - 2);
        if (len === 0) continue;
        const text = cleanLines(decodeTx3gText(b.subarray(2, 2 + len)));
        if (!text) continue;
        const start = tr.starts[i] / tr.timescale;
        cues.push({ start, end: start + tr.durs[i] / tr.timescale, text });
      }
      if (cues.length === 0) continue;
      out.push({ label: `${langName(tr.lang) || 'Subtitles'} (embedded)`, vtt: toVtt(cues) });
    }
    return out;
  } finally {
    await fh.close();
  }
}

// ---- MKV (Matroska / EBML) ----------------------------------------------------

interface Hdr {
  id: number;
  size: number;
  unknown: boolean;
  len: number;
}

function parseHdr(b: Buffer, o: number): Hdr | null {
  if (o >= b.length) return null;
  const b0 = b[o];
  let il = 1;
  while (il <= 4 && !(b0 & (0x80 >> (il - 1)))) il++;
  if (il > 4 || o + il >= b.length) return null;
  let id = 0;
  for (let i = 0; i < il; i++) id = id * 256 + b[o + i];
  const s0 = b[o + il];
  let sl = 1;
  while (sl <= 8 && !(s0 & (0x80 >> (sl - 1)))) sl++;
  if (sl > 8 || o + il + sl > b.length) return null;
  const mask = 0xff >> sl;
  let size = s0 & mask;
  let ones = (s0 & mask) === mask;
  for (let i = 1; i < sl; i++) {
    const v = b[o + il + i];
    size = size * 256 + v;
    if (v !== 0xff) ones = false;
  }
  return { id, size, unknown: ones, len: il + sl };
}

function walk(
  b: Buffer,
  s: number,
  e: number,
  fn: (h: Hdr, ps: number, pe: number) => void
): void {
  let p = s;
  while (p < e) {
    const h = parseHdr(b, p);
    if (!h) break;
    const ps = p + h.len;
    const pe = h.unknown ? e : Math.min(e, ps + h.size);
    fn(h, ps, pe);
    p = pe;
  }
}

const readUInt = (b: Buffer, s: number, e: number): number => {
  let v = 0;
  for (let i = s; i < e; i++) v = v * 256 + b[i];
  return v;
};
const readStr = (b: Buffer, s: number, e: number): string =>
  b.toString('utf8', s, e).replace(/\0+$/, '');

interface MkTrack {
  num: number;
  codec: string;
  lang: string;
  name: string;
  defDur: number; // nanoseconds
}

function parseTracks(buf: Buffer): Map<number, MkTrack> {
  const tracks = new Map<number, MkTrack>();
  walk(buf, 0, buf.length, (h, ps, pe) => {
    if (h.id !== 0xae) return; // TrackEntry
    const t: MkTrack = { num: 0, codec: '', lang: 'eng', name: '', defDur: 0 };
    let type = 0;
    let bcp = '';
    walk(buf, ps, pe, (c, cs, ce) => {
      switch (c.id) {
        case 0xd7:
          t.num = readUInt(buf, cs, ce);
          break;
        case 0x83:
          type = readUInt(buf, cs, ce);
          break;
        case 0x86:
          t.codec = readStr(buf, cs, ce);
          break;
        case 0x22b59c:
          t.lang = readStr(buf, cs, ce);
          break;
        case 0x22b59d:
          bcp = readStr(buf, cs, ce);
          break;
        case 0x536e:
          t.name = readStr(buf, cs, ce);
          break;
        case 0x23e383:
          t.defDur = readUInt(buf, cs, ce);
          break;
      }
    });
    if (bcp) t.lang = bcp;
    if (type === 17 && t.num > 0 && /^S_TEXT\/(UTF8|ASS|SSA)$/.test(t.codec)) {
      tracks.set(t.num, t);
    }
  });
  return tracks;
}

/** ASS line from a Matroska block: "ReadOrder,Layer,Style,Name,MarginL,MarginR,MarginV,Effect,Text". */
function assBlockText(raw: string): string {
  let idx = -1;
  for (let i = 0; i < 8; i++) {
    idx = raw.indexOf(',', idx + 1);
    if (idx < 0) return '';
  }
  const t = raw.slice(idx + 1);
  if (/\{[^}]*\\p[1-9]/.test(t)) return ''; // drawing commands (typeset signs), not text
  return cleanLines(
    t
      .replace(/\{[^}]*\}/g, '')
      .replace(/\\N/g, '\n')
      .replace(/\\n/g, '\n')
      .replace(/\\h/g, ' ')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
  );
}

interface RawCue {
  start: number;
  end: number;
  text: string;
}

async function extractMkv(path: string): Promise<EmbeddedSub[]> {
  const fh = await fs.open(path, 'r');
  try {
    const st = await fh.stat();
    const r = new Reader(fh, st.size);

    let pos = 0;
    let scale = 1_000_000; // nanoseconds per timecode tick
    let tracks: Map<number, MkTrack> | null = null;
    let clusterTc = 0;
    let last: RawCue | null = null;
    const raw = new Map<number, RawCue[]>();

    while (pos < st.size) {
      const hb = await r.read(pos, 16);
      const h = parseHdr(hb, 0);
      if (!h) break;
      const ps = pos + h.len;

      // Containers we walk INTO (children follow right after the header).
      if (h.id === 0x18538067 || h.id === 0x1f43b675 || h.id === 0xa0) {
        if (h.id !== 0x18538067) {
          if (!tracks) return []; // clusters before the track list: not handled
          last = null;
        }
        pos = ps;
        continue;
      }
      if (h.unknown) break;

      if (h.id === 0x1549a966 && h.size <= 1_000_000) {
        // Info: TimecodeScale
        const b = await r.read(ps, h.size);
        const copy = Buffer.from(b);
        walk(copy, 0, copy.length, (c, cs, ce) => {
          if (c.id === 0x2ad7b1) scale = readUInt(copy, cs, ce) || scale;
        });
      } else if (h.id === 0x1654ae6b && h.size <= 32 * 1024 * 1024) {
        // Tracks
        const b = Buffer.from(await r.read(ps, h.size));
        tracks = parseTracks(b);
        if (tracks.size === 0) return [];
      } else if (h.id === 0xe7 && h.size <= 8) {
        // Cluster Timecode
        const b = await r.read(ps, h.size);
        clusterTc = readUInt(b, 0, b.length);
      } else if ((h.id === 0xa3 || h.id === 0xa1) && tracks) {
        // SimpleBlock / Block
        const bh = await r.read(ps, 12);
        if (bh.length >= 4) {
          let tl = 1;
          while (tl <= 8 && !(bh[0] & (0x80 >> (tl - 1)))) tl++;
          let tn = bh[0] & (0xff >> tl);
          for (let i = 1; i < tl && i < bh.length; i++) tn = tn * 256 + bh[i];
          const track = tracks.get(tn);
          if (track && h.size <= 1_000_000) {
            const full = await r.read(ps, h.size);
            const flags = full[tl + 2];
            if (full.length > tl + 3 && (flags & 0x06) === 0) {
              const rel = full.readInt16BE(tl);
              const text = full.subarray(tl + 3).toString('utf8');
              const start = ((clusterTc + rel) * scale) / 1e9;
              const cue: RawCue = { start, end: -1, text };
              let arr = raw.get(tn);
              if (!arr) raw.set(tn, (arr = []));
              arr.push(cue);
              last = h.id === 0xa1 ? cue : null;
            } else {
              last = null;
            }
          } else {
            last = null;
          }
        }
      } else if (h.id === 0x9b && last && h.size <= 8) {
        // BlockDuration of the subtitle block just read
        const b = await r.read(ps, h.size);
        last.end = last.start + (readUInt(b, 0, b.length) * scale) / 1e9;
      }

      pos = ps + h.size;
    }

    if (!tracks || raw.size === 0) return [];

    const out: EmbeddedSub[] = [];
    for (const [num, list] of raw) {
      const track = tracks.get(num);
      if (!track) continue;
      const isAss = /ASS|SSA/.test(track.codec);
      const fallback = track.defDur > 0 ? track.defDur / 1e9 : 3;
      const cues: Cue[] = [];
      for (const c of list) {
        const text = isAss ? assBlockText(c.text) : cleanLines(c.text);
        if (!text) continue;
        cues.push({ start: c.start, end: c.end > c.start ? c.end : c.start + fallback, text });
      }
      if (cues.length === 0) continue;
      const base = track.name || langName(track.lang) || `Track ${num}`;
      out.push({ label: `${base} (embedded)`, vtt: toVtt(cues) });
    }
    return out;
  } finally {
    await fh.close();
  }
}

// ---- public -------------------------------------------------------------------

export async function extractEmbeddedSubs(path: string): Promise<EmbeddedSub[]> {
  const ext = extname(path).toLowerCase();
  const kind = ['.mp4', '.m4v', '.mov'].includes(ext)
    ? 'mp4'
    : ['.mkv', '.mks'].includes(ext)
      ? 'mkv'
      : null;
  if (!kind) return [];

  const st = await fs.stat(path);
  const key = `${path}|${st.size}|${st.mtimeMs}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const found = kind === 'mp4' ? await extractMp4(path) : await extractMkv(path);

  // Two tracks with the same name get a number so the list stays readable.
  const seen = new Map<string, number>();
  for (const s of found) {
    const n = (seen.get(s.label) ?? 0) + 1;
    seen.set(s.label, n);
    if (n > 1) s.label = s.label.replace(' (embedded)', ` ${n} (embedded)`);
  }

  if (cache.size > 20) cache.clear();
  cache.set(key, found);
  return found;
}