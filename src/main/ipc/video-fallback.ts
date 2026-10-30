import { app, ipcMain } from 'electron';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, renameSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import ffmpegStatic from 'ffmpeg-static';
import { scopedLogger } from '@main/logger';
import { getOpenLibrary } from '@main/libraries/manager';

const log = scopedLogger('video-fallback');

const normId = (fileId: number) => (fileId >= 1000000000 ? fileId % 1000000000 : fileId);

function ffmpegBinary(): string | null {
  const p = ffmpegStatic as unknown as string | null;
  if (!p) return null;
  // Packaged app: the binary is unpacked next to app.asar.
  return p.replace('app.asar' + require('node:path').sep, 'app.asar.unpacked' + require('node:path').sep);
}

function cacheDir(): string {
  const dir = join(app.getPath('userData'), 'playable-cache');
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Where the converted copy of a file lives (it may not exist yet). */
export function playableCachePath(libraryId: string, fileId: number): string {
  return join(cacheDir(), `${libraryId}-${normId(fileId)}.mp4`);
}

const running = new Map<string, Promise<boolean>>();

function convert(src: string, out: string): Promise<boolean> {
  const bin = ffmpegBinary();
  if (!bin) return Promise.resolve(false);
  const tmp = out + '.part.mp4';
  return new Promise((resolve) => {
    const args = [
      '-y', '-i', src,
      '-map', '0:v:0', '-map', '0:a:0?',
      '-sn', '-dn',
      '-c:v', 'copy',
      '-c:a', 'aac', '-ac', '2', '-b:a', '128k',
      '-movflags', '+faststart',
      tmp
    ];
    const proc = spawn(bin, args, { windowsHide: true });
    let err = '';
    proc.stderr.on('data', (d) => {
      err = (err + String(d)).slice(-2000);
    });
    proc.on('error', (e) => {
      log.warn('ffmpeg failed to start', { error: String(e) });
      resolve(false);
    });
    proc.on('close', (code) => {
      if (code === 0 && existsSync(tmp)) {
        try {
          renameSync(tmp, out);
          resolve(true);
          return;
        } catch (e) {
          log.warn('could not move converted file', { error: String(e) });
        }
      }
      log.warn('ffmpeg conversion failed', { code, err });
      try { if (existsSync(tmp)) unlinkSync(tmp); } catch { /* ignore */ }
      resolve(false);
    });
  });
}

export function registerVideoFallbackIpc(): void {
  ipcMain.handle('video:makePlayable', async (_e, libraryId: string, fileId: number) => {
    try {
      const lib = getOpenLibrary(libraryId);
      const file = lib?.files.getById(normId(fileId));
      if (!lib || !file) return null;
      const src = lib.resolver.toAbsolute(file.relPath);
      if (!existsSync(src)) return null;
      const out = playableCachePath(libraryId, fileId);
      const fresh = existsSync(out) && statSync(out).mtimeMs >= statSync(src).mtimeMs;
      if (!fresh) {
        let job = running.get(out);
        if (!job) {
          job = convert(src, out).finally(() => running.delete(out));
          running.set(out, job);
        }
        if (!(await job)) return null;
      }
      return `wh3d-file://${libraryId}/${normId(fileId)}?pb=1`;
    } catch (e) {
      log.warn('makePlayable failed', { error: String(e) });
      return null;
    }
  });
}