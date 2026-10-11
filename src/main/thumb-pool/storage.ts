import { createHash } from 'node:crypto';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export const THUMB_EXT = 'png';
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

export async function writeThumbnailFile(absPath: string, png: Uint8Array): Promise<void> {
  await mkdir(dirname(absPath), { recursive: true });
  await writeFile(absPath, png);
}

export async function deleteThumbnailFile(absPath: string): Promise<void> {
  await rm(absPath, { force: true });
}