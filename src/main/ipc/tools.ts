import { app, BrowserWindow, dialog, ipcMain, shell, type WebContents } from 'electron';
import { spawn, type ChildProcess } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync
} from 'node:fs';
import { basename, dirname, extname, join, sep } from 'node:path';
import ffmpegStatic from 'ffmpeg-static';
import { scopedLogger } from '@main/logger';
import { getOpenLibrary } from '@main/libraries/manager';

// GAM Tools: extract / remove audio, convert, compress to a target size, save a frame.
// Everything runs through the ffmpeg that ships with the app (ffmpeg-static).

const log = scopedLogger('tools');

type ToolKind = 'audio' | 'silent' | 'convert' | 'compress' | 'frame';
type Container = 'mp4' | 'webm' | 'mkv' | 'gif';
type Cont = 'mp4' | 'webm' | 'mkv';
type CodecChoice = 'same' | 'h264' | 'h265' | 'av1';
type CodecKey = 'h264' | 'h265' | 'av1' | 'vp9';
type EncoderChoice = 'auto' | 'cpu' | 'nvidia';
type AudioFormat = 'original' | 'mp3' | 'wav' | 'flac' | 'm4a' | 'opus';
type EncName =
  | 'libx264'
  | 'libx265'
  | 'libsvtav1'
  | 'libaom-av1'
  | 'libvpx-vp9'
  | 'h264_nvenc'
  | 'hevc_nvenc'
  | 'av1_nvenc';

export interface ToolsOptions {
  tool: ToolKind;
  audioFormat: AudioFormat;
  container: Container;
  codec: CodecChoice;
  encoder: EncoderChoice;
  bestQuality: boolean;
  targetMB: number;
  lockRes: boolean;
  lockFps: boolean;
  gifWidth: number;
  gifFps: number;
  atSec: number;
  saveAs: boolean;
}

interface Probe {
  durationSec: number;
  width: number;
  height: number;
  fps: number;
  vcodec: string | null;
  acodec: string | null;
  vKbps: number | null;
  aKbps: number | null;
  totalKbps: number | null;
  sizeBytes: number;
  ext: string;
}

interface Caps {
  x264: boolean;
  x265: boolean;
  vp9: boolean;
  av1cpu: 'libsvtav1' | 'libaom-av1' | null;
  mp3: boolean;
  opus: boolean;
  aac: boolean;
  flac: boolean;
  nvidia: { h264: boolean; h265: boolean; av1: boolean };
}

interface Plan {
  ok: boolean;
  error?: string;
  summary: string;
  warn: string[];
  fast: boolean;
  copy: boolean;
  ext: string;
  suffix: string;
  durationSec: number;
  cont: Cont;
  vCopy: boolean;
  enc: EncName | null;
  codec: CodecKey;
  width: number;
  height: number;
  fps: number;
  scale: boolean;
  fpsChange: boolean;
  videoKbps: number;
  audioKbps: number;
  aMode: 'none' | 'copy' | 'aac' | 'opus';
  twoPass: boolean;
  crf: number;
  audioFmt: AudioFormat;
}

interface RunResult {
  ok: boolean;
  path?: string;
  sizeBytes?: number;
  targetBytes?: number;
  note?: string;
  error?: string;
  canceled?: boolean;
}

// ---- helpers ----------------------------------------------------------------

const normId = (fileId: number) => (fileId >= 1000000000 ? fileId % 1000000000 : fileId);
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

function ffmpegBinary(): string | null {
  const p = ffmpegStatic as unknown as string | null;
  if (!p) return null;
  // Packaged app: the binary is unpacked next to app.asar (see asarUnpack in package.json).
  return p.replace(`app.asar${sep}`, `app.asar.unpacked${sep}`);
}

function runCapture(
  args: string[],
  timeoutMs = 20000
): Promise<{ code: number | null; out: string; err: string }> {
  const bin = ffmpegBinary();
  if (!bin) return Promise.resolve({ code: -1, out: '', err: 'ffmpeg was not found' });
  return new Promise((resolve) => {
    let out = '';
    let err = '';
    let done = false;
    const finish = (code: number | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ code, out, err });
    };
    const proc = spawn(bin, args, { windowsHide: true });
    const timer = setTimeout(() => {
      try {
        proc.kill();
      } catch {
        // ignore
      }
    }, timeoutMs);
    proc.stdout.on('data', (d) => {
      if (out.length < 400000) out += String(d);
    });
    proc.stderr.on('data', (d) => {
      if (err.length < 400000) err += String(d);
    });
    proc.on('error', (e) => {
      err += String(e);
      finish(-1);
    });
    proc.on('close', (code) => finish(code));
  });
}

// ---- probe (ffmpeg-static has no ffprobe, so ffmpeg -i is parsed) -----------

const probeCache = new Map<string, Probe>();

async function probeFile(path: string): Promise<Probe | null> {
  let st;
  try {
    st = statSync(path);
  } catch {
    return null;
  }
  const key = `${path}|${st.mtimeMs}|${st.size}`;
  const hit = probeCache.get(key);
  if (hit) return hit;

  const r = await runCapture(['-hide_banner', '-i', path]);
  const t = r.err;
  const dm = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(t);
  if (!dm) return null;
  const durationSec = Number(dm[1]) * 3600 + Number(dm[2]) * 60 + Number(dm[3]);
  const totalM = /bitrate:\s*(\d+)\s*kb\/s/.exec(t);

  let vLine: string | null = null;
  let aLine: string | null = null;
  for (const ln of t.split(/\r?\n/)) {
    if (!vLine && /Stream #\d+:\d+.*Video:/.test(ln) && !/attached pic/.test(ln)) vLine = ln;
    else if (!aLine && /Stream #\d+:\d+.*Audio:/.test(ln)) aLine = ln;
  }

  let width = 0;
  let height = 0;
  let fps = 30;
  let vcodec: string | null = null;
  let vKbps: number | null = null;
  if (vLine) {
    vcodec = (/Video:\s*([\w-]+)/.exec(vLine)?.[1] ?? '').toLowerCase() || null;
    const sz = /,\s*(\d{2,5})x(\d{2,5})/.exec(vLine);
    if (sz) {
      width = Number(sz[1]);
      height = Number(sz[2]);
    }
    const f = /(\d+(?:\.\d+)?)\s*fps/.exec(vLine) ?? /(\d+(?:\.\d+)?)\s*tbr/.exec(vLine);
    if (f && Number(f[1]) > 0 && Number(f[1]) <= 240) fps = Number(f[1]);
    const vb = /(\d+)\s*kb\/s/.exec(vLine);
    if (vb) vKbps = Number(vb[1]);
    const rot = /rotation of (-?\d+(?:\.\d+)?) degrees/.exec(t);
    if (rot) {
      const a = Math.abs(Math.round(Number(rot[1]))) % 180;
      if (a === 90) [width, height] = [height, width];
    }
  }

  let acodec: string | null = null;
  let aKbps: number | null = null;
  if (aLine) {
    acodec = (/Audio:\s*([\w-]+)/.exec(aLine)?.[1] ?? '').toLowerCase() || null;
    const ab = /(\d+)\s*kb\/s/.exec(aLine);
    if (ab) aKbps = Number(ab[1]);
  }

  const probe: Probe = {
    durationSec,
    width,
    height,
    fps,
    vcodec,
    acodec,
    vKbps,
    aKbps,
    totalKbps: totalM ? Number(totalM[1]) : null,
    sizeBytes: st.size,
    ext: extname(path).replace(/^\./, '').toLowerCase()
  };
  probeCache.set(key, probe);
  if (probeCache.size > 50) probeCache.delete(probeCache.keys().next().value as string);
  return probe;
}

// ---- encoder detection ------------------------------------------------------
// The list of encoders ffmpeg prints is not trusted for NVIDIA: a tiny test encode must work.

let capsPromise: Promise<Caps> | null = null;

async function testNvenc(enc: string): Promise<boolean> {
  const r = await runCapture(
    [
      '-hide_banner', '-v', 'error',
      '-f', 'lavfi', '-i', 'color=c=black:s=256x256:d=0.5:r=30',
      '-frames:v', '5',
      '-c:v', enc, '-preset', 'p5', '-tune', 'hq',
      '-rc', 'vbr', '-b:v', '1M', '-multipass', 'fullres',
      '-pix_fmt', 'yuv420p',
      '-f', 'null', '-'
    ],
    20000
  );
  if (r.code !== 0) log.info('nvenc test failed', { enc, err: r.err.slice(-300) });
  return r.code === 0;
}

function getCaps(): Promise<Caps> {
  if (!capsPromise) {
    capsPromise = (async () => {
      const r = await runCapture(['-hide_banner', '-encoders']);
      const has = (n: string) => new RegExp(`\\b${n}\\b`).test(r.out);
      const [h264, h265, av1] = await Promise.all([
        has('h264_nvenc') ? testNvenc('h264_nvenc') : Promise.resolve(false),
        has('hevc_nvenc') ? testNvenc('hevc_nvenc') : Promise.resolve(false),
        has('av1_nvenc') ? testNvenc('av1_nvenc') : Promise.resolve(false)
      ]);
      const caps: Caps = {
        x264: has('libx264'),
        x265: has('libx265'),
        vp9: has('libvpx-vp9'),
        av1cpu: has('libsvtav1') ? 'libsvtav1' : has('libaom-av1') ? 'libaom-av1' : null,
        mp3: has('libmp3lame'),
        opus: has('libopus'),
        aac: has('aac'),
        flac: has('flac'),
        nvidia: { h264, h265, av1 }
      };
      log.info('encoder capabilities', caps as unknown as Record<string, unknown>);
      return caps;
    })();
  }
  return capsPromise;
}

// ---- planning ---------------------------------------------------------------

const CODEC_LABEL: Record<CodecKey, string> = { h264: 'H.264', h265: 'H.265', av1: 'AV1', vp9: 'VP9' };
const ALLOWED: Record<Cont, CodecKey[]> = {
  mp4: ['h264', 'h265', 'av1'],
  webm: ['vp9', 'av1'],
  mkv: ['h264', 'h265', 'av1', 'vp9']
};
// How much more quality per bit each codec gives compared with H.264.
const EFFICIENCY: Record<CodecKey, number> = { h264: 1, h265: 1.4, vp9: 1.35, av1: 1.7 };
const CRF: Record<EncName, number> = {
  libx264: 18,
  libx265: 20,
  libsvtav1: 27,
  'libaom-av1': 28,
  'libvpx-vp9': 30,
  h264_nvenc: 19,
  hevc_nvenc: 21,
  av1_nvenc: 26
};
const AUDIO_EXT: Record<string, string> = {
  aac: 'm4a',
  mp3: 'mp3',
  opus: 'opus',
  vorbis: 'ogg',
  flac: 'flac',
  ac3: 'ac3',
  eac3: 'eac3'
};
const AUDIO_NAMES: Record<Exclude<AudioFormat, 'original'>, string> = {
  mp3: 'MP3 (highest VBR quality)',
  wav: 'WAV (uncompressed)',
  flac: 'FLAC (lossless)',
  m4a: 'M4A (AAC 256 kbps)',
  opus: 'Opus (160 kbps)'
};
const BPP_FLOOR = 0.075; // below this (per codec-adjusted pixel) a size target starts to look bad

const baseline = (): Plan => ({
  ok: true,
  summary: '',
  warn: [],
  fast: false,
  copy: false,
  ext: 'mp4',
  suffix: '',
  durationSec: 0,
  cont: 'mp4',
  vCopy: false,
  enc: null,
  codec: 'h264',
  width: 0,
  height: 0,
  fps: 30,
  scale: false,
  fpsChange: false,
  videoKbps: 0,
  audioKbps: 0,
  aMode: 'none',
  twoPass: false,
  crf: 0,
  audioFmt: 'original'
});
const fail = (error: string): Plan => ({ ...baseline(), ok: false, error });

function srcCodecKey(v: string | null): CodecKey | null {
  switch (v) {
    case 'h264':
      return 'h264';
    case 'hevc':
      return 'h265';
    case 'av1':
      return 'av1';
    case 'vp9':
      return 'vp9';
    default:
      return null;
  }
}

function contOf(c: Container): Cont {
  return c === 'webm' || c === 'mkv' ? c : 'mp4';
}

function resolveCodec(
  p: Probe,
  o: ToolsOptions,
  cont: Cont
): { codec: CodecKey; sameAsSource: boolean; warn: string[] } {
  const warn: string[] = [];
  const sk = srcCodecKey(p.vcodec);
  let codec: CodecKey = o.codec === 'same' ? (sk ?? 'h264') : o.codec;
  let same = o.codec === 'same' && sk !== null;
  if (!ALLOWED[cont].includes(codec)) {
    const fb: CodecKey = cont === 'webm' ? 'vp9' : 'h264';
    if (o.codec !== 'same') {
      warn.push(`${CODEC_LABEL[codec]} can't go into ${cont.toUpperCase()}, using ${CODEC_LABEL[fb]} instead.`);
    }
    codec = fb;
    same = false;
  }
  return { codec, sameAsSource: same, warn };
}

function pickEncoder(
  codec: CodecKey,
  caps: Caps,
  choice: EncoderChoice,
  best: boolean
): { enc: EncName | null; gpu: boolean; note?: string } {
  const cpu: EncName | null =
    codec === 'h264'
      ? caps.x264 ? 'libx264' : null
      : codec === 'h265'
        ? caps.x265 ? 'libx265' : null
        : codec === 'vp9'
          ? caps.vp9 ? 'libvpx-vp9' : null
          : caps.av1cpu;
  const gpu: EncName | null =
    codec === 'h264' && caps.nvidia.h264
      ? 'h264_nvenc'
      : codec === 'h265' && caps.nvidia.h265
        ? 'hevc_nvenc'
        : codec === 'av1' && caps.nvidia.av1
          ? 'av1_nvenc'
          : null;
  let useGpu = false;
  let note: string | undefined;
  if (choice === 'nvidia') {
    if (gpu) useGpu = true;
    else note = `No NVIDIA encoder for ${CODEC_LABEL[codec]} was found, using the CPU.`;
  } else if (choice === 'auto') {
    useGpu = !!gpu && !best;
  }
  if (useGpu && gpu) return { enc: gpu, gpu: true, note };
  if (cpu) return { enc: cpu, gpu: false, note };
  if (gpu) return { enc: gpu, gpu: true, note };
  return { enc: null, gpu: false, note };
}

const audioFits = (acodec: string, cont: Cont): boolean =>
  cont === 'mkv'
    ? true
    : cont === 'mp4'
      ? ['aac', 'mp3', 'ac3', 'eac3', 'alac'].includes(acodec)
      : ['opus', 'vorbis'].includes(acodec);

function qualityLabel(effBpp: number): string {
  if (effBpp >= 0.12) return 'excellent';
  if (effBpp >= 0.08) return 'good';
  if (effBpp >= 0.055) return 'fair';
  if (effBpp >= 0.035) return 'low';
  return 'poor';
}

const fmtMB = (bytes: number) => `${(bytes / 1048576).toFixed(bytes < 10485760 ? 2 : 1)} MB`;

function planGif(p: Probe, o: ToolsOptions): Plan {
  const plan = baseline();
  const w = o.gifWidth === 0 ? p.width : Math.min(o.gifWidth || 480, p.width);
  const f = clamp(Math.round(o.gifFps || 15), 5, 30);
  plan.ext = 'gif';
  plan.suffix = '_gif';
  plan.durationSec = p.durationSec;
  plan.width = even(w);
  plan.height = even((p.height * w) / p.width);
  plan.fps = f;
  if (p.durationSec > 15) {
    plan.warn.push(
      `GIFs get huge quickly and this clip is ${Math.round(p.durationSec)} s long. A shorter clip makes a much smaller GIF.`
    );
  }
  plan.summary = `GIF \u00b7 ${plan.width} px wide \u00b7 ${f} fps \u00b7 optimized palette \u00b7 no audio`;
  return plan;
}

function makePlan(p: Probe, o: ToolsOptions, caps: Caps): Plan {
  switch (o.tool) {
    case 'audio': {
      if (!p.acodec) return fail('This file has no audio track.');
      const plan = baseline();
      plan.audioFmt = o.audioFormat;
      plan.durationSec = p.durationSec;
      plan.suffix = '_audio';
      if (o.audioFormat === 'original') {
        plan.copy = true;
        plan.fast = true;
        plan.ext = AUDIO_EXT[p.acodec] ?? (p.acodec.startsWith('pcm') ? 'wav' : 'mka');
        plan.summary = `Audio only \u00b7 original ${p.acodec.toUpperCase()} stream copied untouched \u00b7 .${plan.ext}`;
      } else {
        if (o.audioFormat === 'mp3' && !caps.mp3) return fail("This ffmpeg build can't encode MP3.");
        if (o.audioFormat === 'opus' && !caps.opus) return fail("This ffmpeg build can't encode Opus.");
        plan.ext = o.audioFormat;
        plan.fast = true;
        plan.summary = `Audio only \u00b7 ${AUDIO_NAMES[o.audioFormat]} \u00b7 .${plan.ext}`;
      }
      return plan;
    }

    case 'silent': {
      if (!p.width) return fail('This file has no video track.');
      const plan = baseline();
      plan.durationSec = p.durationSec;
      plan.suffix = '_silent';
      plan.ext = ['mp4', 'mkv', 'webm', 'mov', 'm4v'].includes(p.ext) ? p.ext : 'mkv';
      plan.copy = true;
      plan.fast = true;
      plan.summary = `Video copied as it is, sound removed \u00b7 no re-encode \u00b7 .${plan.ext}`;
      return plan;
    }

    case 'frame': {
      if (!p.width) return fail('This file has no video track.');
      const plan = baseline();
      plan.durationSec = p.durationSec;
      plan.suffix = '_frame';
      plan.ext = 'png';
      plan.fast = true;
      plan.summary = `PNG of the current frame \u00b7 ${p.width}\u00d7${p.height}`;
      return plan;
    }

    case 'convert': {
      if (!p.width) return fail('This file has no video track.');
      if (o.container === 'gif') return planGif(p, o);
      const cont = contOf(o.container);
      const { codec, sameAsSource, warn } = resolveCodec(p, o, cont);
      const plan = baseline();
      plan.warn = warn;
      plan.cont = cont;
      plan.ext = cont;
      plan.suffix = '_converted';
      plan.durationSec = p.durationSec;
      plan.codec = codec;
      plan.width = p.width;
      plan.height = p.height;
      plan.fps = p.fps;
      if (!p.acodec) plan.aMode = 'none';
      else if (audioFits(p.acodec, cont)) plan.aMode = 'copy';
      else {
        plan.aMode = cont === 'webm' ? 'opus' : 'aac';
        plan.audioKbps = cont === 'webm' ? 128 : 192;
      }
      const audioText =
        plan.aMode === 'none'
          ? 'no audio'
          : plan.aMode === 'copy'
            ? 'audio copied'
            : `audio to ${plan.aMode === 'opus' ? 'Opus' : 'AAC'} ${plan.audioKbps} kbps`;

      if (sameAsSource) {
        plan.vCopy = true;
        plan.fast = true;
        plan.copy = plan.aMode === 'copy' || plan.aMode === 'none';
        plan.summary = `${p.ext.toUpperCase()} \u2192 ${cont.toUpperCase()} \u00b7 ${CODEC_LABEL[codec]} video copied, ${audioText} \u00b7 ${
          plan.copy ? 'no quality loss' : 'video is lossless'
        }`;
        if (p.ext === cont && plan.copy) plan.warn.push(`This file is already ${cont.toUpperCase()} with the same streams, nothing would change.`);
        return plan;
      }

      const sel = pickEncoder(codec, caps, o.encoder, o.bestQuality);
      if (!sel.enc) return fail(`This ffmpeg build has no ${CODEC_LABEL[codec]} encoder.`);
      if (sel.note) plan.warn.push(sel.note);
      plan.enc = sel.enc;
      plan.crf = CRF[sel.enc];
      plan.fast = sel.gpu;
      if (codec === 'h265' || codec === 'av1') {
        plan.warn.push(`${CODEC_LABEL[codec]} files may not preview in some chats, browsers and in this player.`);
      }
      plan.summary = `${plan.width}\u00d7${plan.height} \u00b7 ${Math.round(plan.fps * 100) / 100} fps \u00b7 ${CODEC_LABEL[codec]} near-lossless \u00b7 ${audioText} \u00b7 ${
        sel.gpu ? 'NVIDIA (fast)' : 'CPU (slower)'
      }`;
      return plan;
    }

    case 'compress': {
      if (!p.width) return fail('This file has no video track.');
      const cont = contOf(o.container === 'gif' ? 'mp4' : o.container);
      const dur = p.durationSec;
      if (dur < 0.5) return fail('This clip is too short to compress.');
      const targetMB = clamp(o.targetMB || 20, 0.5, 100000);
      const targetBytes = targetMB * 1048576;
      const { codec, warn } = resolveCodec(p, o, cont);
      const plan = baseline();
      plan.warn = warn;
      plan.cont = cont;
      plan.ext = cont;
      plan.suffix = `_${Number(targetMB.toFixed(1))}MB`;
      plan.durationSec = dur;
      plan.codec = codec;

      const sel = pickEncoder(codec, caps, o.encoder, o.bestQuality);
      if (!sel.enc) return fail(`This ffmpeg build has no ${CODEC_LABEL[codec]} encoder.`);
      if (sel.note) plan.warn.push(sel.note);
      plan.enc = sel.enc;
      plan.fast = sel.gpu;
      plan.twoPass = !sel.gpu && (sel.enc === 'libx264' || sel.enc === 'libx265' || sel.enc === 'libvpx-vp9');

      const eff = EFFICIENCY[codec];
      const q = (kbps: number, w: number, h: number, f: number) => ((kbps * 1000) / (w * h * f)) * eff;

      // 1) Math first: what bitrate fits, with ~3% kept back for the container.
      const usableKbps = (targetBytes * 0.97 * 8) / dur / 1000;

      // 2) Squeeze audio before touching the picture.
      const hasAudio = !!p.acodec;
      let audioKbps = 0;
      if (hasAudio) {
        const aud0 = Math.min(128, p.aKbps ?? 128);
        const ladder = [aud0, 96, 64].filter((a) => a <= aud0).filter((a, i, arr) => arr.indexOf(a) === i);
        audioKbps = ladder[ladder.length - 1];
        for (const a of ladder) {
          if (q(usableKbps - a, p.width, p.height, p.fps) >= BPP_FLOOR) {
            audioKbps = a;
            break;
          }
        }
      }
      let videoKbps = usableKbps - audioKbps;
      if (videoKbps < 40) {
        return fail(`${targetMB} MB is too small for a ${Math.round(dur)} s video. Pick a bigger size or a shorter clip.`);
      }

      // Never spend more than the source already uses.
      const srcV = p.vKbps ?? (p.totalKbps ? Math.max(0, p.totalKbps - (p.aKbps ?? 0)) : null);
      if (srcV && videoKbps > srcV) {
        videoKbps = srcV;
        plan.warn.push('The video is already smaller than the target, so it keeps about the same bitrate.');
      }

      // 3) Keep resolution and frame rate whenever the budget allows.
      let width = p.width;
      let height = p.height;
      let fps = p.fps;
      if (!o.lockRes && q(videoKbps, width, height, fps) < BPP_FLOOR) {
        const heights = [2160, 1440, 1080, 720, 540, 480, 360, 240].filter((h) => h < p.height);
        let chosen: { w: number; h: number } | null = null;
        for (const h of heights) {
          const w = even((p.width * h) / p.height);
          if (q(videoKbps, w, h, fps) >= BPP_FLOOR) {
            chosen = { w, h };
            break;
          }
        }
        if (!chosen && heights.length) {
          const h = heights.filter((x) => x >= 360).pop() ?? heights[heights.length - 1];
          chosen = { w: even((p.width * h) / p.height), h };
        }
        if (chosen) {
          width = chosen.w;
          height = chosen.h;
        }
      }
      if (!o.lockFps && fps > 31 && q(videoKbps, width, height, fps) < BPP_FLOOR) fps = 30;

      const quality = qualityLabel(q(videoKbps, width, height, fps));
      if (quality === 'poor' || quality === 'low') {
        plan.warn.push('Very tight for this length, expect blocky areas. A bigger size or a shorter clip looks much better.');
      }
      if (codec === 'h265' || codec === 'av1') {
        plan.warn.push(`${CODEC_LABEL[codec]} files may not preview in some chats, browsers and in this player.`);
      }

      plan.width = width;
      plan.height = height;
      plan.fps = fps;
      plan.scale = width !== p.width || height !== p.height;
      plan.fpsChange = Math.abs(fps - p.fps) > 0.01;
      plan.videoKbps = videoKbps;
      plan.audioKbps = audioKbps;
      plan.aMode = !hasAudio ? 'none' : cont === 'webm' ? 'opus' : 'aac';
      const est = ((videoKbps + audioKbps) * 1000 * dur) / 8 / 0.97;
      plan.summary = `${width}\u00d7${height} \u00b7 ${Math.round(fps * 100) / 100} fps \u00b7 ${CODEC_LABEL[codec]} \u00b7 ${(videoKbps / 1000).toFixed(2)} Mbps video${
        hasAudio ? ` + ${audioKbps} kbps audio` : ', no audio'
      } \u00b7 about ${fmtMB(Math.min(est, targetBytes))} \u00b7 quality: ${quality} \u00b7 ${
        sel.gpu ? 'NVIDIA (fast)' : plan.twoPass ? 'CPU two-pass (slow, accurate)' : 'CPU (slow)'
      }`;
      return plan;
    }
  }
}

// ---- ffmpeg arguments -------------------------------------------------------

function encArgs(
  enc: EncName,
  rate: { crf: number } | { kbps: number },
  best: boolean,
  pass: 0 | 1 | 2,
  tag: string,
  cont: Cont
): string[] {
  const a: string[] = ['-c:v', enc];
  const abr = 'kbps' in rate;
  const kbps = 'kbps' in rate ? Math.max(20, Math.round(rate.kbps)) : 0;
  const crf = 'crf' in rate ? rate.crf : 0;
  switch (enc) {
    case 'libx264':
      a.push('-preset', best ? 'slow' : 'medium');
      if (abr) a.push('-b:v', `${kbps}k`);
      else a.push('-crf', String(crf));
      if (pass) a.push('-pass', String(pass), '-passlogfile', tag);
      break;
    case 'libx265':
      a.push('-preset', best ? 'slow' : 'medium');
      if (abr) a.push('-b:v', `${kbps}k`);
      else a.push('-crf', String(crf));
      a.push('-x265-params', pass ? `pass=${pass}:stats=${tag}.log:log-level=error` : 'log-level=error');
      if (cont === 'mp4') a.push('-tag:v', 'hvc1');
      break;
    case 'libsvtav1':
      a.push('-preset', best ? '4' : '6');
      if (abr) a.push('-b:v', `${kbps}k`);
      else a.push('-crf', String(crf));
      break;
    case 'libaom-av1':
      a.push('-cpu-used', best ? '4' : '6', '-row-mt', '1');
      if (abr) a.push('-b:v', `${kbps}k`);
      else a.push('-crf', String(crf), '-b:v', '0');
      break;
    case 'libvpx-vp9':
      a.push('-row-mt', '1', '-deadline', 'good', '-cpu-used', best ? '1' : '2');
      if (abr) a.push('-b:v', `${kbps}k`);
      else a.push('-crf', String(crf), '-b:v', '0');
      if (pass) a.push('-pass', String(pass), '-passlogfile', tag);
      break;
    default:
      // NVIDIA (h264_nvenc / hevc_nvenc / av1_nvenc)
      a.push('-preset', 'p5', '-tune', 'hq');
      if (abr) {
        a.push(
          '-rc', 'vbr',
          '-b:v', `${kbps}k`,
          '-maxrate', `${Math.round(kbps * 1.25)}k`,
          '-bufsize', `${kbps * 2}k`,
          '-multipass', 'fullres'
        );
      } else {
        a.push('-rc', 'vbr', '-cq', String(crf), '-b:v', '0');
      }
      if (enc === 'hevc_nvenc' && cont === 'mp4') a.push('-tag:v', 'hvc1');
      break;
  }
  return a;
}

const audioCodecArgs = (mode: Plan['aMode'], kbps: number, stereo: boolean): string[] => {
  if (mode === 'none') return ['-an'];
  if (mode === 'copy') return ['-c:a', 'copy'];
  const a = mode === 'opus' ? ['-c:a', 'libopus', '-b:a', `${kbps}k`] : ['-c:a', 'aac', '-b:a', `${kbps}k`];
  if (stereo) a.push('-ac', '2');
  return a;
};

function audioExtractArgs(fmt: AudioFormat): string[] {
  switch (fmt) {
    case 'mp3':
      return ['-c:a', 'libmp3lame', '-q:a', '0', '-ac', '2'];
    case 'wav':
      return ['-c:a', 'pcm_s16le'];
    case 'flac':
      return ['-c:a', 'flac'];
    case 'm4a':
      return ['-c:a', 'aac', '-b:a', '256k'];
    case 'opus':
      return ['-c:a', 'libopus', '-b:a', '160k'];
    default:
      return ['-c:a', 'copy'];
  }
}

// ---- running ----------------------------------------------------------------

interface Job {
  proc: ChildProcess | null;
  canceled: boolean;
}
let active: { id: string; job: Job } | null = null;
const produced = new Set<string>();

function execFfmpeg(
  args: string[],
  cwd: string,
  durationSec: number,
  job: Job,
  report: (frac: number, speed: string | null, outSec: number) => void
): Promise<{ ok: boolean; err: string }> {
  const bin = ffmpegBinary();
  if (!bin) return Promise.resolve({ ok: false, err: 'ffmpeg was not found' });
  if (job.canceled) return Promise.resolve({ ok: false, err: 'canceled' });
  return new Promise((resolve) => {
    const full = ['-hide_banner', '-y', '-nostats', '-progress', 'pipe:1', ...args];
    const proc = spawn(bin, full, { cwd, windowsHide: true });
    job.proc = proc;
    let err = '';
    let buf = '';
    let speed: string | null = null;
    proc.stdout.on('data', (d) => {
      buf += String(d);
      let i = buf.indexOf('\n');
      while (i >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        i = buf.indexOf('\n');
        const eq = line.indexOf('=');
        if (eq < 0) continue;
        const k = line.slice(0, eq);
        const v = line.slice(eq + 1).trim();
        if (k === 'speed') speed = v;
        else if (k === 'out_time') {
          const m = /^(\d+):(\d+):(\d+(?:\.\d+)?)$/.exec(v);
          if (m) {
            const t = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
            report(durationSec > 0 ? t / durationSec : 0, speed, t);
          }
        }
      }
    });
    proc.stderr.on('data', (d) => {
      err = (err + String(d)).slice(-4000);
    });
    proc.on('error', (e) => resolve({ ok: false, err: String(e) }));
    proc.on('close', (code) => {
      job.proc = null;
      resolve({ ok: code === 0 && !job.canceled, err });
    });
  });
}

function uniqueOut(dir: string, stem: string, suffix: string, ext: string): string {
  let p = join(dir, `${stem}${suffix}.${ext}`);
  for (let i = 2; existsSync(p); i++) p = join(dir, `${stem}${suffix} (${i}).${ext}`);
  return p;
}

function moveInto(tmp: string, wanted: string): string {
  let target = wanted;
  if (existsSync(target)) {
    const ext = extname(wanted);
    const stem = basename(wanted, ext);
    for (let i = 2; existsSync(target); i++) target = join(dirname(wanted), `${stem} (${i})${ext}`);
  }
  try {
    renameSync(tmp, target);
  } catch {
    copyFileSync(tmp, target); // different drive
    try {
      unlinkSync(tmp);
    } catch {
      // ignore
    }
  }
  return target;
}

const fmtClock = (s: number) => {
  const t = Math.max(0, Math.floor(s));
  return `${Math.floor(t / 60)}m${String(t % 60).padStart(2, '0')}s`;
};

function cleanOpts(o: unknown): ToolsOptions {
  const r = (o && typeof o === 'object' ? o : {}) as Record<string, unknown>;
  const pick = <T extends string>(v: unknown, list: readonly T[], d: T): T =>
    typeof v === 'string' && (list as readonly string[]).includes(v) ? (v as T) : d;
  const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
  return {
    tool: pick(r.tool, ['audio', 'silent', 'convert', 'compress', 'frame'] as const, 'convert'),
    audioFormat: pick(r.audioFormat, ['original', 'mp3', 'wav', 'flac', 'm4a', 'opus'] as const, 'original'),
    container: pick(r.container, ['mp4', 'webm', 'mkv', 'gif'] as const, 'mp4'),
    codec: pick(r.codec, ['same', 'h264', 'h265', 'av1'] as const, 'same'),
    encoder: pick(r.encoder, ['auto', 'cpu', 'nvidia'] as const, 'auto'),
    bestQuality: r.bestQuality === true,
    targetMB: clamp(num(r.targetMB, 20), 0.5, 100000),
    lockRes: r.lockRes === true,
    lockFps: r.lockFps === true,
    gifWidth: num(r.gifWidth, 480),
    gifFps: num(r.gifFps, 15),
    atSec: Math.max(0, num(r.atSec, 0)),
    saveAs: r.saveAs === true
  };
}

function resolveSource(libraryId: string, fileId: number): string | null {
  const lib = getOpenLibrary(libraryId);
  const file = lib?.files.getById(normId(fileId));
  if (!lib || !file) return null;
  const src = lib.resolver.toAbsolute(file.relPath);
  return existsSync(src) ? src : null;
}

async function runJob(
  sender: WebContents,
  jobId: string,
  job: Job,
  libraryId: string,
  fileId: number,
  o: ToolsOptions
): Promise<RunResult> {
  const src = resolveSource(libraryId, fileId);
  if (!src) return { ok: false, error: 'The file was not found on disk.' };
  const p = await probeFile(src);
  if (!p) return { ok: false, error: 'ffmpeg could not read this file.' };
  const caps = await getCaps();
  const plan = makePlan(p, o, caps);
  if (!plan.ok) return { ok: false, error: plan.error ?? 'Nothing to do.' };

  const safe = jobId.replace(/[^\w-]/g, '').slice(0, 40) || 'job';
  const tmpDir = join(app.getPath('temp'), 'gam-tools');
  mkdirSync(tmpDir, { recursive: true });
  const tmpOut = join(tmpDir, `${safe}.${plan.ext}`);
  const tag = `p_${safe}`;
  const outDir = dirname(src);
  const stem = basename(src, extname(src));

  let lastEmit = 0;
  const emit = (pct: number, stage: string, speed: string | null, etaSec: number | null) => {
    const now = Date.now();
    if (now - lastEmit < 150 && pct < 99) return;
    lastEmit = now;
    if (!sender.isDestroyed()) {
      sender.send('tools:progress', {
        jobId,
        pct: clamp(Math.round(pct), 0, 100),
        stage,
        speed,
        etaSec
      });
    }
  };
  const pass = (args: string[], lo: number, hi: number, stage: string) => {
    emit(lo, stage, null, null);
    return execFfmpeg(args, tmpDir, plan.durationSec, job, (frac, speed, outSec) => {
      const spd = speed ? parseFloat(speed) : NaN;
      const eta = Number.isFinite(spd) && spd > 0 ? Math.max(0, (plan.durationSec - outSec) / spd) : null;
      emit(lo + (hi - lo) * Math.min(1, frac), stage, speed, eta);
    });
  };
  const failed = (err: string): RunResult =>
    job.canceled ? { ok: false, canceled: true } : { ok: false, error: lastLine(err) };
  const done = async (suffix: string, targetBytes?: number, note?: string): Promise<RunResult> => {
    let wanted = uniqueOut(outDir, stem, suffix, plan.ext);
    if (o.saveAs) {
      const win = BrowserWindow.fromWebContents(sender);
      const saveOpts = {
        title: 'Save as',
        defaultPath: wanted,
        filters: [{ name: plan.ext.toUpperCase(), extensions: [plan.ext] }]
      };
      const pick = win
        ? await dialog.showSaveDialog(win, saveOpts)
        : await dialog.showSaveDialog(saveOpts);
      if (pick.canceled || !pick.filePath) return { ok: false, canceled: true };
      wanted = pick.filePath;
      if (existsSync(wanted)) rmSync(wanted, { force: true }); // the dialog already asked about overwriting
    }
    const finalPath = moveInto(tmpOut, wanted);
    produced.add(finalPath);
    emit(100, 'Done', null, 0);
    return { ok: true, path: finalPath, sizeBytes: statSync(finalPath).size, targetBytes, note };
  };

  try {
    switch (o.tool) {
      case 'audio': {
        const args = ['-i', src, '-map', '0:a:0', '-vn', '-sn', '-dn', ...audioExtractArgs(plan.audioFmt), tmpOut];
        const r = await pass(args, 0, 100, 'Extracting audio');
        if (!r.ok) return failed(r.err);
        return await done(plan.suffix);
      }

      case 'silent': {
        const args = ['-i', src, '-map', '0:v:0', '-c:v', 'copy', '-an', '-sn', '-dn'];
        if (plan.ext === 'mp4' || plan.ext === 'mov' || plan.ext === 'm4v') args.push('-movflags', '+faststart');
        args.push(tmpOut);
        const r = await pass(args, 0, 100, 'Removing audio');
        if (!r.ok) return failed(r.err);
        return await done(plan.suffix);
      }

      case 'frame': {
        const t = clamp(o.atSec, 0, Math.max(0, p.durationSec - 0.05));
        const args = ['-ss', t.toFixed(3), '-i', src, '-map', '0:v:0', '-frames:v', '1', tmpOut];
        const r = await pass(args, 0, 100, 'Saving frame');
        if (!r.ok) return failed(r.err);
        return await done(`_frame_${fmtClock(t)}`);
      }

      case 'convert': {
        if (o.container === 'gif') {
          const vf =
            `fps=${plan.fps},scale=${plan.width}:-2:flags=lanczos,split[s0][s1];` +
            `[s0]palettegen=stats_mode=diff[pal];[s1][pal]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle`;
          const args = ['-i', src, '-map', '0:v:0', '-an', '-vf', vf, '-loop', '0', tmpOut];
          const r = await pass(args, 0, 100, 'Making GIF');
          if (!r.ok) return failed(r.err);
          return await done(plan.suffix);
        }
        const args = ['-i', src, '-map', '0:v:0', '-map', '0:a?', '-sn', '-dn'];
        if (plan.vCopy) {
          args.push('-c:v', 'copy');
          if (plan.codec === 'h265' && plan.cont === 'mp4') args.push('-tag:v', 'hvc1');
        } else {
          args.push(...encArgs(plan.enc as EncName, { crf: plan.crf }, o.bestQuality, 0, tag, plan.cont), '-pix_fmt', 'yuv420p');
        }
        args.push(...audioCodecArgs(plan.aMode, plan.audioKbps, false));
        if (plan.cont === 'mp4') args.push('-movflags', '+faststart');
        args.push(tmpOut);
        const r = await pass(args, 0, 100, plan.vCopy ? 'Copying streams' : 'Converting');
        if (!r.ok) return failed(r.err);
        return await done(plan.suffix);
      }

      case 'compress': {
        const enc = plan.enc as EncName;
        const targetBytes = o.targetMB * 1048576;
        let kbps = plan.videoKbps;
        const vf: string[] = [];
        if (plan.scale) vf.push(`scale=${plan.width}:${plan.height}:flags=lanczos`);
        if (plan.fpsChange) vf.push(`fps=${plan.fps}`);
        const build = (n: 0 | 1 | 2): string[] => {
          const a = ['-i', src, '-map', '0:v:0'];
          if (n !== 1 && plan.aMode !== 'none') a.push('-map', '0:a:0?');
          a.push('-sn', '-dn');
          if (vf.length) a.push('-vf', vf.join(','));
          a.push(...encArgs(enc, { kbps }, o.bestQuality, n, tag, plan.cont), '-pix_fmt', 'yuv420p');
          if (n === 1) {
            a.push('-an', '-f', 'null', '-');
          } else {
            a.push(...audioCodecArgs(plan.aMode, plan.audioKbps, true));
            if (plan.cont === 'mp4') a.push('-movflags', '+faststart');
            a.push(tmpOut);
          }
          return a;
        };

        let size = 0;
        for (let attempt = 0; attempt < 2; attempt++) {
          const retry = attempt > 0 ? ' (retry, it came out too big)' : '';
          if (plan.twoPass) {
            const r1 = await pass(build(1), 0, 40, `Analysing, pass 1 of 2${retry}`);
            if (!r1.ok) return failed(r1.err);
            const r2 = await pass(build(2), 40, 100, `Encoding, pass 2 of 2${retry}`);
            if (!r2.ok) return failed(r2.err);
          } else {
            const r = await pass(build(0), 0, 100, `Encoding${retry}`);
            if (!r.ok) return failed(r.err);
          }
          size = statSync(tmpOut).size;
          if (size <= targetBytes || attempt === 1) break;
          const excessBits = (size - targetBytes * 0.985) * 8;
          kbps = Math.max(kbps * 0.5, kbps - excessBits / plan.durationSec / 1000);
        }
        const over = size > targetBytes;
        return await done(
          plan.suffix,
          targetBytes,
          over ? 'The result is still a little over the target.' : undefined
        );
      }
    }
    return { ok: false, error: 'Unknown tool.' };
  } catch (e) {
    log.warn('tools job failed', { error: String(e) });
    return { ok: false, error: String((e as Error)?.message ?? e) };
  } finally {
    try {
      rmSync(tmpOut, { force: true });
      for (const f of readdirSync(tmpDir)) {
        if (f.startsWith(tag)) rmSync(join(tmpDir, f), { force: true });
      }
    } catch {
      // ignore
    }
  }
}

function lastLine(err: string): string {
  const lines = err
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  return lines[lines.length - 1] || 'ffmpeg failed.';
}

export function registerToolsIpc(): void {
  ipcMain.handle('tools:info', async (_e, libraryId: string, fileId: number) => {
    try {
      const src = resolveSource(libraryId, fileId);
      if (!src) return { ok: false, error: 'The file was not found on disk.' };
      const probe = await probeFile(src);
      if (!probe) return { ok: false, error: 'ffmpeg could not read this file.' };
      const caps = await getCaps();
      return { ok: true, probe, caps };
    } catch (e) {
      return { ok: false, error: String((e as Error)?.message ?? e) };
    }
  });

  ipcMain.handle('tools:plan', async (_e, libraryId: string, fileId: number, raw: unknown) => {
    const empty = { ok: false, summary: '', warn: [] as string[], fast: false, copy: false };
    try {
      const src = resolveSource(libraryId, fileId);
      if (!src) return { ...empty, error: 'The file was not found on disk.' };
      const probe = await probeFile(src);
      if (!probe) return { ...empty, error: 'ffmpeg could not read this file.' };
      const plan = makePlan(probe, cleanOpts(raw), await getCaps());
      return { ok: plan.ok, error: plan.error, summary: plan.summary, warn: plan.warn, fast: plan.fast, copy: plan.copy };
    } catch (e) {
      return { ...empty, error: String((e as Error)?.message ?? e) };
    }
  });

  ipcMain.handle(
    'tools:run',
    async (e, jobId: string, libraryId: string, fileId: number, raw: unknown): Promise<RunResult> => {
      if (active) return { ok: false, error: 'Another Tools job is still running.' };
      const id = String(jobId);
      const job: Job = { proc: null, canceled: false };
      active = { id, job };
      try {
        return await runJob(e.sender, id, job, libraryId, fileId, cleanOpts(raw));
      } finally {
        active = null;
      }
    }
  );

  ipcMain.handle('tools:cancel', (_e, jobId: string) => {
    if (!active || active.id !== jobId) return;
    active.job.canceled = true;
    try {
      active.job.proc?.kill();
    } catch {
      // ignore
    }
  });

  ipcMain.handle('tools:reveal', (_e, path: string) => {
    if (typeof path === 'string' && produced.has(path) && existsSync(path)) shell.showItemInFolder(path);
  });
}