import { createHash } from 'node:crypto';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';

// Thumbnails used to be 512x512 PNGs (~140 KB each, ~9 GB for a big library).
// New ones are WebP/JPEG (~10-30 KB). The file extension is neutral because the
// bytes can be WebP (canvas), JPEG (ffmpeg) or PNG (embedded 3MF / custom
// snapshot); the protocol handler sniffs the real type when serving.
export const THUMB_EXT = 'thumb';
const LEGACY_THUMB_EXT = 'png';
const RENDER_SIZE = 512;

export const THUMBNAIL_RENDER_SIZE = RENDER_SIZE;

/**
 * Path of a file's thumbnail RELATIVE to the library's thumbs dir in AppData
 * (this is what the DB stores). Two-level SHA1 fanout keeps directories small.
 */
export function thumbRelPath(fileId: number): string {
  const hash = createHash('sha1').update(String(fileId)).digest('hex');
  return `${hash.slice(0, 2)}/${hash.slice(2, 4)}/${fileId}.${THUMB_EXT}`;
}

/** Absolute on-disk path, given the library's thumbs dir (see appdata.ts). */
export function thumbFilePath(thumbsDir: string, fileId: number): string {
  return join(thumbsDir, ...thumbRelPath(fileId).split('/'));
}

/** Where an old-style PNG thumbnail for the same file lived. */
export function legacyThumbFilePath(thumbsDir: string, fileId: number): string {
  return thumbFilePath(thumbsDir, fileId).replace(/\.thumb$/, `.${LEGACY_THUMB_EXT}`);
}

/** Real image type of a stored thumbnail, from its first bytes. */
export function thumbMimeType(buf: Uint8Array): string {
  if (buf.length > 12 && buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46) {
    return 'image/webp';
  }
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  return 'image/png';
}

export async function writeThumbnailFile(absPath: string, png: Uint8Array): Promise<void> {
  await mkdir(dirname(absPath), { recursive: true });
  await writeFile(absPath, png);
  // Drop the old, much bigger PNG of the same file now that the new one is saved.
  await rm(absPath.replace(/\.thumb$/, `.${LEGACY_THUMB_EXT}`), { force: true });
}

export async function deleteThumbnailFile(absPath: string): Promise<void> {
  await rm(absPath, { force: true });
  await rm(absPath.replace(/\.thumb$/, `.${LEGACY_THUMB_EXT}`), { force: true });
}