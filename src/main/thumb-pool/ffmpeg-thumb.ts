import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import os from 'node:os';
import { THUMB_WORKER_RENDER_SIZE } from '@shared/thumb-worker-protocol';
import type { ExtractedMetadata, VideoMetadata } from '@shared/types';
import { scopedLogger } from '@main/logger';

/**
 * Video thumbnails and metadata via a bundled ffmpeg binary (ffmpeg-static).
 *
 * Runs in the main process as a separate OS process: no hidden BrowserWindow,
 * no GPU contention with the player, and a seek + single-frame decode takes a
 * fraction of what a <video> element needs. Works for codecs Chromium can't
 * play (AVI, HEVC, ProRes, ...) as long as ffmpeg can read them.
 *
 * Two quick invocations per file:
 *   1. `ffmpeg -i file`      -> container/stream info is printed to stderr
 *   2. `ffmpeg -ss T -i file -frames:v 1 ... pipe:1` -> one letterboxed PNG
 */

const log = scopedLogger('ffmpeg-thumb');

/** Where in the video the frame is taken, as a fraction of the duration. */
const SEEK_FRACTION = 0.1;
/** How many ffmpeg processes may run at once (scales with CPU cores). */
const VIDEO_CONCURRENCY = Math.max(4, os.cpus().length - 2);
const PROBE_TIMEOUT_MS = 10_000;
const FRAME_TIMEOUT_MS = 20_000;
const MAX_STDERR_BYTES = 256 * 1024;
const MAX_STDOUT_BYTES = 16 * 1024 * 1024;

// ─── binary location ──────────────────────────────────────────────────────

let cachedFfmpegPath: string | null | undefined;

/**
 * ffmpeg-static exports the absolute path of the binary it downloaded at
 * install time. Inside a packaged app that path points into app.asar, where
 * executables can't run, so it is redirected to the app.asar.unpacked copy
 * (the package must be listed in electron-builder's `asarUnpack`).
 */
function getFfmpegPath(): string | null {
  if (cachedFfmpegPath !== undefined) return cachedFfmpegPath;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const p = require('ffmpeg-static') as string | null;
    const fixed = p ? p.replace(/app\.asar([\\/])/, 'app.asar.unpacked$1') : null;
    cachedFfmpegPath = fixed && existsSync(fixed) ? fixed : null;
    if (!cachedFfmpegPath) log.error('ffmpeg-static returned no binary path for this platform');
  } catch (err) {
    log.error('ffmpeg-static is not installed', { err: (err as Error).message ?? String(err) });
    cachedFfmpegPath = null;
  }
  return cachedFfmpegPath;
}

// ─── concurrency limit ────────────────────────────────────────────────────

let active = 0;
const waiters: Array<() => void> = [];

async function acquire(): Promise<void> {
  if (active < VIDEO_CONCURRENCY) {
    active++;
    return;
  }
  // The slot is handed over directly by release(), so `active` stays as is.
  await new Promise<void>((resolve) => waiters.push(resolve));
}

function release(): void {
  const next = waiters.shift();
  if (next) next();
  else active--;
}

// ─── process runner ───────────────────────────────────────────────────────

interface RunResult {
  code: number | null;
  stdout: Buffer;
  stderr: string;
}

function runFfmpeg(args: string[], timeoutMs: number): Promise<RunResult> {
  const bin = getFfmpegPath();
  if (!bin) return Promise.reject(new Error('ffmpeg binary not available'));

  return new Promise<RunResult>((resolve, reject) => {
    const child = spawn(bin, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });

    // Keep background thumbnailing from competing with the UI and the player.
    if (child.pid) {
      try {
        os.setPriority(child.pid, os.constants.priority.PRIORITY_BELOW_NORMAL);
      } catch {
        // best-effort
      }
    }

    const out: Buffer[] = [];
    let outBytes = 0;
    let errText = '';
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGKILL');
      reject(new Error(`ffmpeg timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout.on('data', (chunk: Buffer) => {
      outBytes += chunk.length;
      if (outBytes <= MAX_STDOUT_BYTES) out.push(chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      if (errText.length < MAX_STDERR_BYTES) errText += chunk.toString('utf8');
    });
    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, stdout: Buffer.concat(out), stderr: errText });
    });
  });
}

// ─── probe parsing ────────────────────────────────────────────────────────

interface ProbeInfo {
  durationSec: number;
  width: number;
  height: number;
  fps?: number;
  videoCodec?: string;
  audioCodec?: string;
  audioSampleRate?: number;
  audioChannels?: number;
  audioBitrateKbps?: number;
  bitrateKbps?: number;
}

const NAMED_CHANNEL_LAYOUTS: Record<string, number> = {
  mono: 1,
  stereo: 2,
  downmix: 2,
  quad: 4
};

/**
 * Channel count from the audio stream description, e.g. "48000 Hz, stereo,
 * fltp, 160 kb/s" -> 2, "48000 Hz, 5.1(side), fltp" -> 6,
 * "48000 Hz, 2 channels, s16" -> 2.
 */
function parseAudioChannels(audioRest: string): number | undefined {
  const m = /,\s*(mono|stereo|downmix|quad|\d+\.\d(?:\([^)]*\))?|\d+\s+channels?)\s*(?:,|$)/i.exec(
    audioRest
  );
  if (!m) return undefined;
  const token = m[1].toLowerCase();
  if (token in NAMED_CHANNEL_LAYOUTS) return NAMED_CHANNEL_LAYOUTS[token];
  const count = /^(\d+)\s+channel/.exec(token);
  if (count) return Number(count[1]);
  const layout = /^(\d+)\.(\d)/.exec(token);
  if (layout) return Number(layout[1]) + Number(layout[2]);
  return undefined;
}

function parseProbe(stderr: string): ProbeInfo | null {
  const videoLine = /Stream #\d+:\d+[^\n]*?: Video: ([^\n]+)/.exec(stderr);
  if (!videoLine) return null;
  const rest = videoLine[1];

  // `|$` so a size at the very end of the line still matches.
  const size = /(?:^|[\s,])(\d{2,5})x(\d{2,5})(?=[\s,[]|$)/.exec(rest);
  if (!size) return null;

  const dur = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(stderr);
  const durationSec = dur ? Number(dur[1]) * 3600 + Number(dur[2]) * 60 + Number(dur[3]) : 0;

  const fps = /([\d.]+)\s*fps/.exec(rest);
  const vCodec = /^([A-Za-z0-9_]+)/.exec(rest);
  const bitrate = /Duration:[^\n]*bitrate:\s*(\d+)\s*kb\/s/.exec(stderr);

  // First audio stream only. Example line:
  //   Stream #0:1[0x2](und): Audio: aac (LC) (mp4a / 0x6134706D), 48000 Hz, stereo, fltp, 160 kb/s (default)
  const audioLine = /Stream #\d+:\d+[^\n]*?: Audio: ([^\n]+)/.exec(stderr);
  const audioRest = audioLine ? audioLine[1] : '';
  const aCodec = audioRest ? /^([A-Za-z0-9_]+)/.exec(audioRest) : null;
  const aRate = audioRest ? /(\d{4,6})\s*Hz/.exec(audioRest) : null;
  const aBitrate = audioRest ? /(\d+)\s*kb\/s/.exec(audioRest) : null;

  return {
    durationSec: Number.isFinite(durationSec) ? durationSec : 0,
    width: Number(size[1]),
    height: Number(size[2]),
    fps: fps ? Number(fps[1]) : undefined,
    videoCodec: vCodec ? vCodec[1] : undefined,
    audioCodec: aCodec ? aCodec[1] : undefined,
    audioSampleRate: aRate ? Number(aRate[1]) : undefined,
    audioChannels: audioRest ? parseAudioChannels(audioRest) : undefined,
    audioBitrateKbps: aBitrate ? Number(aBitrate[1]) : undefined,
    bitrateKbps: bitrate ? Number(bitrate[1]) : undefined
  };
}

// ─── frame extraction ─────────────────────────────────────────────────────

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47];

function looksLikePng(buf: Buffer): boolean {
  return buf.length > 8 && PNG_SIGNATURE.every((b, i) => buf[i] === b);
}

async function extractFrame(absPath: string, seekSec: number): Promise<Buffer | null> {
  const size = THUMB_WORKER_RENDER_SIZE;
  // Same look as the other tiles: fit inside a square, letterboxed on #101113.
  const filter =
    `scale=${size}:${size}:force_original_aspect_ratio=decrease:flags=fast_bilinear,` +
    `pad=${size}:${size}:(ow-iw)/2:(oh-ih)/2:color=0x101113`;

  const args = [
    '-hide_banner',
    '-nostdin',
    '-loglevel',
    'error',
    '-ss',
    seekSec.toFixed(3),
    // Jump to the nearest keyframe instead of decoding up to the exact
    // timestamp. Much faster on big files; the exact frame doesn't matter.
    '-noaccurate_seek',
    '-i',
    absPath,
    '-map',
    '0:v:0',
    '-frames:v',
    '1',
    '-an',
    '-sn',
    '-dn',
    '-vf',
    filter,
    '-f',
    'image2pipe',
    '-c:v',
    'png',
    '-compression_level',
    '1',
    'pipe:1'
  ];

  const res = await runFfmpeg(args, FRAME_TIMEOUT_MS);
  if (!looksLikePng(res.stdout)) {
    log.warn('ffmpeg frame failed', {
      file: absPath.split(/[\\/]/).pop(),
      code: res.code,
      seekSec,
      stderr: res.stderr.slice(-500)
    });
    return null;
  }
  return res.stdout;
}

// ─── public API ───────────────────────────────────────────────────────────

export interface FfmpegThumbResult {
  png: Uint8Array;
  metadata: ExtractedMetadata;
}

/**
 * Thrown when ffmpeg could read the file (probe worked) but could not decode
 * a frame, e.g. AV1 on a build without a software AV1 decoder. Carries the
 * probed metadata so a fallback renderer can still store fps, codecs and
 * audio info. The message stays "ffmpeg produced no frame" on purpose: old
 * persisted failures with that text are cleared on startup (queue-runner).
 */
export class FfmpegFrameError extends Error {
  readonly video: VideoMetadata;

  constructor(message: string, video: VideoMetadata) {
    super(message);
    this.name = 'FfmpegFrameError';
    this.video = video;
  }
}

export function isFfmpegAvailable(): boolean {
  return getFfmpegPath() !== null;
}

/**
 * Render a video's thumbnail and metadata. Throws on any failure (missing
 * binary, no video stream, no decodable frame, timeout).
 */
export async function renderVideoThumbnailFfmpeg(absPath: string): Promise<FfmpegThumbResult> {
  await acquire();
  try {
    const t0 = Date.now();
    const probeRun = await runFfmpeg(['-hide_banner', '-nostdin', '-i', absPath], PROBE_TIMEOUT_MS);
    const probeMs = Date.now() - t0;
    const info = parseProbe(probeRun.stderr);
    if (!info) throw new Error('no video stream found: ' + probeRun.stderr.slice(-200));

    const video: VideoMetadata = {
      durationSec: info.durationSec,
      width: info.width,
      height: info.height,
      fps: info.fps,
      videoCodec: info.videoCodec,
      audioCodec: info.audioCodec,
      audioSampleRate: info.audioSampleRate,
      audioChannels: info.audioChannels,
      audioBitrateKbps: info.audioBitrateKbps,
      bitrateKbps: info.bitrateKbps
    };

    const seekSec = info.durationSec > 0 ? info.durationSec * SEEK_FRACTION : 0;
    const frameStart = Date.now();
    let png = await extractFrame(absPath, seekSec);
    // Some files can't seek (or are shorter than the probe claims): retry at 0.
    if (!png && seekSec > 0) png = await extractFrame(absPath, 0);
    if (!png) throw new FfmpegFrameError('ffmpeg produced no frame', video);
    log.info('ffmpeg thumb', {
      file: absPath.split(/[\\/]/).pop(),
      probeMs,
      frameMs: Date.now() - frameStart
    });

    const metadata: ExtractedMetadata = {
      vertexCount: 0,
      triangleCount: 0,
      meshCount: 0,
      materialCount: 0,
      hasTextures: false,
      boundingBox: { min: [0, 0, 0], max: [0, 0, 0], size: [0, 0, 0] },
      thumbSource: 'video',
      materialNames: [],
      video
    };

    return { png: new Uint8Array(png), metadata };
  } finally {
    release();
  }
}