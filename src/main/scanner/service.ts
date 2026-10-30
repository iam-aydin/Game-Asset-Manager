import { EventEmitter } from 'node:events';
import { readdir } from 'node:fs/promises';
import { watch as chokidarWatch, type FSWatcher } from 'chokidar';
import type Database from 'better-sqlite3';
import { PathResolver } from '@shared/paths';
import type { ScanProgress } from '@shared/types';
import {
  createFilesRepo,
  type FilesRepo,
  type RenameEntry,
  type UpsertInput
} from '@main/db/repos/files';
import { listFolderFiles, shouldSkipDir, WalkAbortedError } from './walker';
import { getAll as getPreferences } from '@main/preferences/store';
import { scopedLogger, time } from '@main/logger';
import { hashFileContent } from '@main/files/hash';

const log = scopedLogger('scanner');

interface PerLibrary {
  resolver: PathResolver;
  files: FilesRepo;
  progress: ScanProgress;
  /** One watcher per library; only the root and opened folders are added, one level deep. */
  watcher?: FSWatcher;
  watched: Set<string>;
  /** Folders the user has opened this session (scanned once, then watched). */
  opened: Set<string>;
  opening: Map<string, Promise<void>>;
  /** Folders whose whole subtree has been indexed (filters / Show all). '' = whole library. */
  indexedTrees: Set<string>;
  dirTimers: Map<string, NodeJS.Timeout>;
  /** Set while a scan is running so it can be cancelled. */
  abort?: AbortController;
}

export interface ScannerEvents {
  'scan-progress': (libraryId: string, progress: ScanProgress) => void;
  'scan-complete': (libraryId: string, progress: ScanProgress) => void;
  'scan-cancelled': (libraryId: string, progress: ScanProgress) => void;
  'files-changed': (libraryId: string) => void;
}

function emptyProgress(libraryId: string): ScanProgress {
  return {
    libraryId,
    state: 'idle',
    filesSeen: 0,
    inserted: 0,
    updated: 0,
    renamed: 0,
    removed: 0
  };
}

function parentOfRel(rel: string): string {
  const i = rel.lastIndexOf('/');
  return i < 0 ? '' : rel.slice(0, i);
}

interface SyncStats {
  seen: number;
  inserted: number;
  updated: number;
  renamed: number;
  removed: number;
}

interface IndexJob {
  root: string;
  promise: Promise<void>;
  /** Replaced by a request for another folder: stop quietly, no "cancelled" message. */
  superseded: boolean;
}

export class ScannerService extends EventEmitter {
  private libs = new Map<string, PerLibrary>();
  private indexing = new Map<string, IndexJob>();

  attach(libraryId: string, db: Database.Database, mountPath: string): void {
    if (this.libs.has(libraryId)) return;
    const resolver = new PathResolver(mountPath);
    const files = createFilesRepo(db, libraryId);
    this.libs.set(libraryId, {
      resolver,
      files,
      progress: emptyProgress(libraryId),
      watched: new Set(),
      opened: new Set(),
      opening: new Map(),
      indexedTrees: new Set(),
      dirTimers: new Map()
    });
    void this.runScan(libraryId);
  }

  detach(libraryId: string): void {
    const lib = this.libs.get(libraryId);
    if (!lib) return;
    lib.abort?.abort();
    for (const t of lib.dirTimers.values()) clearTimeout(t);
    lib.dirTimers.clear();
    void lib.watcher?.close();
    this.libs.delete(libraryId);
  }

  detachAll(): void {
    for (const id of [...this.libs.keys()]) this.detach(id);
  }

  /** Re-checks the folders already known (database + opened). Not a deep walk. */
  async rescan(libraryId: string): Promise<{ ok: boolean; error?: string }> {
    const lib = this.libs.get(libraryId);
    if (!lib) return { ok: false, error: `Library ${libraryId} is not attached` };
    if (lib.progress.state === 'scanning') {
      return { ok: false, error: 'Scan already in progress' };
    }
    void this.runScan(libraryId);
    return { ok: true };
  }

  cancelScan(libraryId: string): void {
    const lib = this.libs.get(libraryId);
    if (!lib || lib.progress.state !== 'scanning') return;
    lib.abort?.abort();
  }

  getProgress(libraryId: string): ScanProgress | null {
    return this.libs.get(libraryId)?.progress ?? null;
  }

  /** Folders opened this session (the folder tree lists their subfolders from disk). */
  getOpenedFolders(libraryId: string): string[] {
    const lib = this.libs.get(libraryId);
    return lib ? [...lib.opened] : [];
  }

  /**
   * Called when the user opens a folder. The first time, that one folder is
   * indexed (no recursion) and watched. Later calls return immediately.
   */
  ensureFolder(libraryId: string, relDir: string): Promise<void> {
    const lib = this.libs.get(libraryId);
    if (!lib) return Promise.resolve();
    if (lib.opened.has(relDir)) return Promise.resolve();
    const running = lib.opening.get(relDir);
    if (running) return running;
    const p = (async () => {
      try {
        const stats = await this.syncFolders(libraryId, lib, [relDir], false);
        lib.opened.add(relDir);
        this.watchDir(libraryId, lib, relDir);
        // The tree needs to show this folder's subfolders, and new files need thumbnails.
        this.emit('files-changed', libraryId);
        if (stats.inserted > 0) void this.hashMissing(libraryId);
      } catch (err) {
        if (!(err instanceof WalkAbortedError)) {
          log.warn('open folder failed', { libraryId, relDir, err: (err as Error).message });
        }
      } finally {
        lib.opening.delete(relDir);
      }
    })();
    lib.opening.set(relDir, p);
    return p;
  }

  /** Rescan ONE folder now (not recursive), mark it opened and watch it. */
  async rescanFolderNow(libraryId: string, relDir: string): Promise<void> {
    const lib = this.libs.get(libraryId);
    if (!lib) return;
    const stats = await this.syncFolders(libraryId, lib, [relDir], false);
    lib.opened.add(relDir);
    this.watchDir(libraryId, lib, relDir);
    this.emit('files-changed', libraryId);
    if (stats.inserted > 0) void this.hashMissing(libraryId);
  }

  /** Every folder at or under `root` (library-relative; '' = whole library), read from disk. */
  private async listDirsUnder(
    lib: PerLibrary,
    root: string,
    signal: AbortSignal
  ): Promise<string[]> {
    const out: string[] = [root];
    const stack: string[] = [root];
    while (stack.length > 0) {
      if (signal.aborted) throw new WalkAbortedError();
      const rel = stack.pop() as string;
      let entries;
      try {
        entries = await readdir(
          rel === '' ? lib.resolver.getMountPath() : lib.resolver.toAbsolute(rel),
          { withFileTypes: true, encoding: 'utf8' }
        );
      } catch {
        continue;
      }
      for (const e of entries) {
        if (e.isDirectory() && !shouldSkipDir(e.name)) {
          const child = rel === '' ? e.name : `${rel}/${e.name}`;
          out.push(child);
          stack.push(child);
        }
      }
    }
    return out;
  }

  /**
   * Index a folder and everything under it ('' = whole library). Used by "Show all files"
   * and the filters. Runs in batches without adding file watchers, shows up as a normal scan
   * (progress + cancel button in the top bar) and can be stopped with cancelScan: whatever
   * was already read stays in the database.
   */
  indexAll(libraryId: string, rootDir = ''): Promise<void> {
    const lib = this.libs.get(libraryId);
    if (!lib) return Promise.resolve();
    for (const done of lib.indexedTrees) {
      if (done === '' || rootDir === done || rootDir.startsWith(`${done}/`)) {
        return Promise.resolve();
      }
    }
    const running = this.indexing.get(libraryId);
    if (running) {
      if (running.root === rootDir) return running.promise;
      // The user moved to another folder: stop the old job quietly and start the new one.
      running.superseded = true;
      lib.abort?.abort();
      return running.promise.then(() => this.indexAll(libraryId, rootDir));
    }
    if (lib.progress.state === 'scanning') {
      // A normal scan is running: start after it.
      return new Promise<void>((resolve) => {
        const onDone = (id: string): void => {
          if (id !== libraryId) return;
          this.off('scan-complete', onDone);
          this.off('scan-cancelled', onDone);
          void this.indexAll(libraryId, rootDir).then(resolve);
        };
        this.on('scan-complete', onDone);
        this.on('scan-cancelled', onDone);
      });
    }

    const abort = new AbortController();
    lib.abort = abort;
    const job: IndexJob = { root: rootDir, promise: Promise.resolve(), superseded: false };
    job.promise = (async () => {
      let seen = 0;
      let inserted = 0;
      let updated = 0;
      let renamed = 0;
      let removed = 0;
      try {
        this.updateProgress(libraryId, {
          ...emptyProgress(libraryId),
          state: 'scanning',
          startedAt: Date.now(),
          finishedAt: undefined,
          error: undefined
        });
        const dirs = (await this.listDirsUnder(lib, rootDir, abort.signal)).filter(
          (d) => !lib.opened.has(d)
        );
        const BATCH = 40;
        let lastEmit = 0;
        for (let i = 0; i < dirs.length; i += BATCH) {
          if (!this.libs.has(libraryId)) return;
          const st = await this.syncFolders(libraryId, lib, dirs.slice(i, i + BATCH), false);
          seen += st.seen;
          inserted += st.inserted;
          updated += st.updated;
          renamed += st.renamed;
          removed += st.removed;
          this.updateProgress(libraryId, {
            filesSeen: seen,
            inserted,
            updated,
            renamed,
            removed
          });
          const now = Date.now();
          if (st.inserted > 0 && now - lastEmit >= 1500) {
            lastEmit = now;
            this.emit('files-changed', libraryId);
          }
          await new Promise<void>((r) => setImmediate(r));
        }
        lib.indexedTrees.add(rootDir);
        const finalProgress: ScanProgress = {
          ...lib.progress,
          filesSeen: seen,
          inserted,
          updated,
          renamed,
          removed,
          state: 'watching',
          finishedAt: Date.now()
        };
        lib.progress = finalProgress;
        lib.abort = undefined;
        this.emit('scan-complete', libraryId, finalProgress);
        if (inserted > 0) void this.hashMissing(libraryId);
        log.info('index folder complete', { libraryId, root: rootDir, folders: dirs.length, seen, inserted });
      } catch (err) {
        if (!this.libs.has(libraryId)) return;
        if (err instanceof WalkAbortedError) {
          if (job.superseded) {
            lib.progress = { ...lib.progress, state: 'idle' };
          } else {
            const cancelled: ScanProgress = {
              ...lib.progress,
              state: 'cancelled',
              finishedAt: Date.now(),
              error: undefined
            };
            lib.progress = cancelled;
            lib.abort = undefined;
            this.emit('scan-cancelled', libraryId, cancelled);
            this.emit('files-changed', libraryId);
            log.info('index folder cancelled', { libraryId, root: rootDir, seen });
          }
          return;
        }
        log.warn('index folder failed', { libraryId, root: rootDir, err: (err as Error).message });
        lib.abort = undefined;
        this.updateProgress(libraryId, {
          state: 'error',
          finishedAt: Date.now(),
          error: (err as Error).message
        });
      } finally {
        if (this.indexing.get(libraryId) === job) this.indexing.delete(libraryId);
      }
    })();
    this.indexing.set(libraryId, job);
    return job.promise;
  }
  private updateProgress(libraryId: string, patch: Partial<ScanProgress>): void {
    const lib = this.libs.get(libraryId);
    if (!lib) return;
    lib.progress = { ...lib.progress, ...patch };
    this.emit('scan-progress', libraryId, lib.progress);
  }

  private async runScan(libraryId: string): Promise<void> {
    const lib = this.libs.get(libraryId);
    if (!lib) return;

    const abort = new AbortController();
    lib.abort = abort;

    this.updateProgress(libraryId, {
      ...emptyProgress(libraryId),
      state: 'scanning',
      startedAt: Date.now(),
      finishedAt: undefined,
      error: undefined
    });
    log.info('scan started', { libraryId });

    try {
      await time(log, 'scan', () => this.refreshKnown(libraryId, lib), {
        meta: { libraryId }
      });
      void this.hashMissing(libraryId);
      lib.opened.add('');
      this.watchDir(libraryId, lib, '');
    } catch (err) {
      if (err instanceof WalkAbortedError) {
        const cancelledProgress: ScanProgress = {
          ...lib.progress,
          state: 'cancelled',
          finishedAt: Date.now(),
          error: undefined
        };
        lib.progress = cancelledProgress;
        lib.abort = undefined;
        this.emit('scan-cancelled', libraryId, cancelledProgress);
        log.info('scan cancelled', { libraryId, filesSeen: cancelledProgress.filesSeen });
        return;
      }
      log.error('scan failed', { libraryId, err: (err as Error).message });
      lib.abort = undefined;
      this.updateProgress(libraryId, {
        state: 'error',
        finishedAt: Date.now(),
        error: (err as Error).message
      });
    }
  }

  /** Startup / manual rescan: the root plus every folder already in the database or opened. */
  private async refreshKnown(libraryId: string, lib: PerLibrary): Promise<void> {
    const dirs = new Set<string>(['']);
    for (const f of lib.files.listFoldersWithCounts()) dirs.add(f.parentDir);
    for (const o of lib.opened) dirs.add(o);

    const stats = await this.syncFolders(libraryId, lib, [...dirs], true);

    const finalProgress: ScanProgress = {
      ...lib.progress,
      filesSeen: stats.seen,
      inserted: stats.inserted,
      updated: stats.updated,
      renamed: stats.renamed,
      removed: stats.removed,
      state: 'watching',
      finishedAt: Date.now()
    };
    lib.progress = finalProgress;
    lib.abort = undefined;
    this.emit('scan-complete', libraryId, finalProgress);
    log.info('scan complete', { libraryId, folders: dirs.size, ...stats });
  }

  /**
   * Index the files directly inside each given folder and diff ONLY those
   * folders against the database. Everything else in the database is untouched.
   */
  private async syncFolders(
    libraryId: string,
    lib: PerLibrary,
    dirs: string[],
    reportProgress: boolean
  ): Promise<SyncStats> {
    const seen: UpsertInput[] = [];
    const scanned = new Set<string>();
    for (const dir of dirs) {
      if (lib.abort?.signal.aborted) throw new WalkAbortedError();
      const res = await listFolderFiles(lib.resolver, dir);
      if (res === null) continue; // unreadable right now: keep its rows
      scanned.add(dir);
      seen.push(...res);
      if (reportProgress) this.updateProgress(libraryId, { filesSeen: seen.length });
    }

    const known = lib.files.listAllForDiff().filter((k) => scanned.has(parentOfRel(k.relPath)));
    const knownByPath = new Map(known.map((k) => [k.relPath, k] as const));

    const matched: UpsertInput[] = [];
    const newPaths: UpsertInput[] = [];
    for (const s of seen) {
      const k = knownByPath.get(s.relPath);
      if (k) {
        matched.push(s);
        knownByPath.delete(s.relPath);
      } else {
        newPaths.push(s);
      }
    }
    const stale = [...knownByPath.values()];

    const staleBySig = new Map<string, typeof stale>();
    for (const s of stale) {
      const key = `${s.sizeBytes}:${s.mtimeMs}`;
      const list = staleBySig.get(key);
      if (list) list.push(s);
      else staleBySig.set(key, [s]);
    }

    const renames: RenameEntry[] = [];
    const trueInserts: UpsertInput[] = [];
    for (const np of newPaths) {
      const key = `${np.sizeBytes}:${np.mtimeMs}`;
      const candidates = staleBySig.get(key);
      if (candidates && candidates.length === 1) {
        renames.push({
          id: candidates[0].id,
          toRelPath: np.relPath,
          toParentDir: np.parentDir,
          toFilename: np.filename
        });
        staleBySig.delete(key);
      } else {
        trueInserts.push(np);
      }
    }
    const toDelete = [...staleBySig.values()].flat().map((s) => s.relPath);

    const renamedCount = lib.files.applyRenames(renames);
    const upsertResult = lib.files.upsertMany([...matched, ...trueInserts]);
    const removedCount = lib.files.deleteByRelPaths(toDelete);

    return {
      seen: seen.length,
      inserted: upsertResult.inserted,
      updated: upsertResult.updated,
      renamed: renamedCount,
      removed: removedCount
    };
  }

  /** Watch one folder, one level deep. Never recursive. */
  private watchDir(libraryId: string, lib: PerLibrary, relDir: string): void {
    if (!this.libs.has(libraryId)) return;
    const abs = relDir === '' ? lib.resolver.getMountPath() : lib.resolver.toAbsolute(relDir);
    if (lib.watched.has(abs)) return;
    lib.watched.add(abs);
    if (!lib.watcher) {
      const poll = lib.resolver.getMountPath().startsWith('\\\\');
      const interval = (getPreferences().nasPollIntervalSec ?? 10) * 1000;
      lib.watcher = chokidarWatch(abs, {
        depth: 0,
        ignoreInitial: true,
        persistent: true,
        ignorePermissionErrors: true,
        usePolling: poll,
        interval,
        ignored: /(^|[\\/])\../
      });
      lib.watcher.on('all', (_ev, p) => this.onFsEvent(libraryId, lib, p));
      lib.watcher.on('error', (err) =>
        log.warn('watcher error', { libraryId, err: (err as Error).message })
      );
    } else {
      lib.watcher.add(abs);
    }
  }

  private onFsEvent(libraryId: string, lib: PerLibrary, absPath: string): void {
    let rel: string;
    try {
      rel = lib.resolver.toRelative(absPath);
    } catch {
      return;
    }
    const dir = parentOfRel(rel);
    if (lib.dirTimers.has(dir)) return;
    lib.dirTimers.set(
      dir,
      setTimeout(() => {
        lib.dirTimers.delete(dir);
        if (!this.libs.has(libraryId)) return;
        void (async () => {
          try {
            await this.syncFolders(libraryId, lib, [dir], false);
          } catch (err) {
            log.warn('folder refresh failed', { libraryId, dir, err: (err as Error).message });
          }
          this.emit('files-changed', libraryId);
          void this.hashMissing(libraryId);
        })();
      }, 400)
    );
  }

  /**
   * Stream-hash every file that lacks a content_sha256 (exact-duplicate
   * detection). Bounded concurrency; read failures leave the hash NULL.
   */
  private async hashMissing(libraryId: string): Promise<void> {
    const lib = this.libs.get(libraryId);
    if (!lib) return;
    const pending = lib.files.listMissingContentHash();
    if (pending.length === 0) return;

    const CONCURRENCY = 4;
    const BATCH = 200;
    let buffer: Array<{ id: number; sha256: string }> = [];
    let hashed = 0;

    const flush = () => {
      if (buffer.length === 0) return;
      lib.files.setContentSha256Many(buffer);
      hashed += buffer.length;
      buffer = [];
    };

    let cursor = 0;
    const worker = async () => {
      while (cursor < pending.length) {
        const item = pending[cursor++];
        if (!this.libs.has(libraryId)) return;
        const abs = lib.resolver.toAbsolute(item.relPath);
        const digest = await hashFileContent(abs);
        if (digest) {
          buffer.push({ id: item.id, sha256: digest });
          if (buffer.length >= BATCH) flush();
        }
      }
    };

    try {
      await Promise.all(
        Array.from({ length: Math.min(CONCURRENCY, pending.length) }, () => worker())
      );
      flush();
    } catch (err) {
      flush();
      log.warn('content hashing failed', { libraryId, err: (err as Error).message });
    }

    if (hashed > 0) {
      log.info('content hashing complete', { libraryId, hashed, scanned: pending.length });
      this.emit('files-changed', libraryId);
    }
  }
}

export const scanner = new ScannerService();