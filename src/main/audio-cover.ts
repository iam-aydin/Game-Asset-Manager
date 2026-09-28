import { statSync } from 'node:fs';
import { nativeImage } from 'electron';
import { parseFile, selectCover } from 'music-metadata';

export interface AudioCover {
  data: Uint8Array;
  mime: string;
}

const COVER_EXTS = new Set([
  'mp3',
  'flac',
  'm4a',
  'mp4',
  'aac',
  'ogg',
  'oga',
  'opus',
  'wma',
  'aiff',
  'aif',
  'ape',
  'wv'
]);

export const isCoverCapableExt = (ext: string): boolean =>
  COVER_EXTS.has(ext.replace(/^\./, '').toLowerCase());

// Longest side, in px, of the cover served as a grid thumbnail.
const THUMB_SIZE = 256;

// Two small LRU caches keyed by path + mtime. `null` is a valid value meaning
// "this file has no cover", so tag-less files aren't re-parsed on every request.
// Full-size covers can be several MB each, so that cache stays small; the
// downscaled thumbnails are tiny, so that cache can hold a whole grid.
const FULL_CACHE_MAX = 16;
const THUMB_CACHE_MAX = 600;
const fullCache = new Map<string, AudioCover | null>();
const thumbCache = new Map<string, AudioCover | null>();

function lruGet<T>(map: Map<string, T>, key: string): T | undefined {
  const value = map.get(key);
  if (value !== undefined) {
    map.delete(key); // refresh LRU position
    map.set(key, value);
  }
  return value;
}

function lruSet<T>(map: Map<string, T>, key: string, value: T, max: number): void {
  map.set(key, value);
  if (map.size > max) {
    const oldest = map.keys().next().value;
    if (oldest !== undefined) map.delete(oldest);
  }
}

function fileKey(absPath: string): string | null {
  try {
    return `${absPath}|${statSync(absPath).mtimeMs}`;
  } catch {
    return null;
  }
}

/** Full-size embedded cover, or null when the file has none. */
export async function readAudioCover(absPath: string): Promise<AudioCover | null> {
  const key = fileKey(absPath);
  if (!key) return null;

  const hit = lruGet(fullCache, key);
  if (hit !== undefined) return hit;

  let result: AudioCover | null = null;
  try {
    const meta = await parseFile(absPath, { skipPostHeaders: true });
    const pic = selectCover(meta.common.picture);
    if (pic && pic.data.length > 0) {
      result = { data: pic.data, mime: pic.format || 'image/jpeg' };
    }
  } catch {
    result = null;
  }

  lruSet(fullCache, key, result, FULL_CACHE_MAX);
  return result;
}

// Uses Electron's built-in nativeImage instead of sharp: sharp is only a
// devDependency in package.json, so it may not exist in a packaged build.
function downscale(cover: AudioCover, maxSize: number): AudioCover {
  try {
    const img = nativeImage.createFromBuffer(Buffer.from(cover.data));
    if (img.isEmpty()) return cover;
    const { width, height } = img.getSize();
    const scale = maxSize / Math.max(width, height);
    if (scale >= 1) return cover; // already small enough
    const resized = img.resize({
      width: Math.max(1, Math.round(width * scale)),
      height: Math.max(1, Math.round(height * scale)),
      quality: 'good'
    });
    return cover.mime.includes('png')
      ? { data: resized.toPNG(), mime: 'image/png' }
      : { data: resized.toJPEG(88), mime: 'image/jpeg' };
  } catch {
    return cover;
  }
}

/** Downscaled cover for grid thumbnails, or null when the file has none. */
export async function readAudioCoverThumb(
  absPath: string,
  maxSize: number = THUMB_SIZE
): Promise<AudioCover | null> {
  const key = fileKey(absPath);
  if (!key) return null;

  const hit = lruGet(thumbCache, key);
  if (hit !== undefined) return hit;

  const full = await readAudioCover(absPath);
  const result = full ? downscale(full, maxSize) : null;
  lruSet(thumbCache, key, result, THUMB_CACHE_MAX);
  return result;
}