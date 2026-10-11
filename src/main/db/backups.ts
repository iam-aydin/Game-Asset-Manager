import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { scopedLogger } from '@main/logger';

const log = scopedLogger('db-backup');

const FILE_PREFIX = 'gam-';
const FILE_SUFFIX = '.db';
const DEFAULT_KEEP = 7;

function timestampForFilename(d: Date): string {
  const pad = (n: number) => n.toString().padStart(2, '0');
  return (
    d.getFullYear().toString() +
    pad(d.getMonth() + 1) +
    pad(d.getDate()) +
    '-' +
    pad(d.getHours()) +
    pad(d.getMinutes()) +
    pad(d.getSeconds())
  );
}

/**
 * Copy the library DB into a timestamped file under `backupsDir`, then prune
 * to the `keep` most recent. Filename: `gam-YYYYMMDD-HHmmss.db`.
 * Never throws: a failed backup must not block opening a library.
 */
export function rotateBackup(dbPath: string, backupsDir: string, keep: number = DEFAULT_KEEP): void {
  try {
    if (!existsSync(dbPath)) {
      log.debug('skip backup: no db yet', { dbPath });
      return;
    }
    const srcStat = statSync(dbPath);
    if (srcStat.size === 0) {
      log.debug('skip backup: db is zero bytes', { dbPath });
      return;
    }
    mkdirSync(backupsDir, { recursive: true });
    const dest = join(backupsDir, FILE_PREFIX + timestampForFilename(new Date()) + FILE_SUFFIX);
    copyFileSync(dbPath, dest);
    log.info('backup created', { dbPath, dest, bytes: srcStat.size });
    pruneOldBackups(backupsDir, keep);
  } catch (err) {
    log.warn('backup failed', { dbPath, err: (err as Error).message });
  }
}

function pruneOldBackups(dir: string, keep: number): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  const ours = entries.filter((n) => n.startsWith(FILE_PREFIX) && n.endsWith(FILE_SUFFIX)).sort();
  if (ours.length <= keep) return;
  for (const name of ours.slice(0, ours.length - keep)) {
    try {
      unlinkSync(join(dir, name));
      log.debug('pruned old backup', { name });
    } catch (err) {
      log.warn('prune failed', { name, err: (err as Error).message });
    }
  }
}

export const __test = { FILE_PREFIX, FILE_SUFFIX, timestampForFilename };