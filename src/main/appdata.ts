import { app } from 'electron';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

let rootOverride: string | null = null;
/** Tests only: point the data root at a temp dir. */
export function __setDataRootForTests(dir: string | null): void {
  rootOverride = dir;
}

const root = (): string => rootOverride ?? join(app.getPath('userData'), 'libraries');

export const libraryDataPath = (id: string): string => join(root(), id);
export const libraryDbPath = (id: string): string => join(libraryDataPath(id), 'library.db');
export const libraryThumbsDir = (id: string): string => join(libraryDataPath(id), 'thumbs');
export const libraryBackupsDir = (id: string): string => join(libraryDataPath(id), 'backups');

export function ensureLibraryDataDir(id: string): void {
  mkdirSync(libraryDataPath(id), { recursive: true });
}