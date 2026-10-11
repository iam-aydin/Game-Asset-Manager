import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rotateBackup, __test } from './backups';
import { DB_FILENAME } from './connection';

const { FILE_PREFIX, FILE_SUFFIX } = __test;

let root: string;
let dbPath: string;
let backupsDir: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'gam-backups-'));
  dbPath = join(root, DB_FILENAME);
  backupsDir = join(root, 'backups');
});

afterEach(() => {
  try {
    rmSync(root, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

function writeDb(bytes: Buffer | string): void {
  writeFileSync(dbPath, bytes);
}

function listBackups(): string[] {
  try {
    return readdirSync(backupsDir).sort();
  } catch {
    return [];
  }
}

function seedExistingBackups(timestamps: string[]): void {
  mkdirSync(backupsDir, { recursive: true });
  for (const ts of timestamps) {
    writeFileSync(join(backupsDir, FILE_PREFIX + ts + FILE_SUFFIX), 'old');
  }
}

describe('rotateBackup', () => {
  it('is a no-op when the source db does not exist', () => {
    rotateBackup(dbPath, backupsDir);
    expect(listBackups()).toHaveLength(0);
  });

  it('is a no-op when the source db is zero bytes', () => {
    writeDb('');
    rotateBackup(dbPath, backupsDir);
    expect(listBackups()).toHaveLength(0);
  });

  it('creates a backup copy with the right name shape', () => {
    writeDb('hello-database');
    rotateBackup(dbPath, backupsDir);
    const backups = listBackups();
    expect(backups).toHaveLength(1);
    expect(backups[0]).toMatch(/^gam-\d{8}-\d{6}\.db$/);
  });

  it('prunes to keep when the existing count is over the limit', () => {
    // 9 pre-existing backups; keep=7. After a rotate, we'll have 10 then prune to 7.
    seedExistingBackups([
      '20260101-000000',
      '20260102-000000',
      '20260103-000000',
      '20260104-000000',
      '20260105-000000',
      '20260106-000000',
      '20260107-000000',
      '20260108-000000',
      '20260109-000000'
    ]);
    writeDb('latest');
    rotateBackup(dbPath, backupsDir, 7);
    const remaining = listBackups();
    expect(remaining).toHaveLength(7);
    // Oldest should have been pruned, newest preserved.
    expect(remaining.includes(FILE_PREFIX + '20260101-000000' + FILE_SUFFIX)).toBe(false);
    expect(remaining.includes(FILE_PREFIX + '20260109-000000' + FILE_SUFFIX)).toBe(true);
  });

  it('respects a custom keep parameter', () => {
    seedExistingBackups(['20260101-000000', '20260102-000000', '20260103-000000']);
    writeDb('latest');
    rotateBackup(dbPath, backupsDir, 2);
    expect(listBackups()).toHaveLength(2);
  });

  it('does not prune unrelated files in the backups directory', () => {
    mkdirSync(backupsDir, { recursive: true });
    writeFileSync(join(backupsDir, 'README.txt'), 'do not touch');
    seedExistingBackups([
      '20260101-000000',
      '20260102-000000',
      '20260103-000000',
      '20260104-000000',
      '20260105-000000',
      '20260106-000000',
      '20260107-000000',
      '20260108-000000'
    ]);
    writeDb('latest');
    rotateBackup(dbPath, backupsDir, 5);
    const remaining = readdirSync(backupsDir);
    expect(remaining.includes('README.txt')).toBe(true);
  });
});