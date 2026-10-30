import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { SUPPORTED_EXTENSIONS } from '@shared/formats';
import { shouldSkipDir } from './walker';

/**
 * Background "how many files are in each folder" counter.
 *
 * It only reads folder listings. It never writes to the database and never
 * queues thumbnails, so it is safe to run over a whole library. Opening a
 * folder is still what indexes it and makes its thumbnails.
 */

const SUPPORTED = new Set<string>(
  (SUPPORTED_EXTENSIONS as readonly string[]).map((e) => e.toLowerCase())
);

const PARALLEL_FOLDERS = 4;
const PROGRESS_EVERY_MS = 1500;

interface CountState {
  /** Supported files directly inside each folder, keyed by POSIX path ('' = library root). */
  counts: Map<string, number>;
  done: boolean;
  running: boolean;
  stale: boolean;
}

const states = new Map<string, CountState>();

/** Counts known so far (complete once the background count has finished), or null if never started. */
export function getFolderCounts(libraryId: string): ReadonlyMap<string, number> | null {
  return states.get(libraryId)?.counts ?? null;
}

/** The disk may have changed (a rescan finished): recount the next time the tree is loaded. */
export function markCountsStale(libraryId: string): void {
  const s = states.get(libraryId);
  if (s && s.done && !s.running) s.stale = true;
}

async function walk(
  rootAbs: string,
  counts: Map<string, number>,
  signal: AbortSignal,
  tick: () => void
): Promise<void> {
  const stack: string[] = [''];
  let active = 0;

  const visit = async (rel: string): Promise<void> => {
    let entries;
    try {
      entries = await readdir(rel === '' ? rootAbs : join(rootAbs, rel), {
        withFileTypes: true,
        encoding: 'utf8'
      });
    } catch {
      counts.set(rel, counts.get(rel) ?? 0);
      return;
    }
    let n = 0;
    for (const e of entries) {
      if (e.isDirectory()) {
        if (!shouldSkipDir(e.name)) stack.push(rel === '' ? e.name : `${rel}/${e.name}`);
      } else if (e.isFile() || e.isSymbolicLink()) {
        const dot = e.name.lastIndexOf('.');
        if (dot > 0 && SUPPORTED.has(e.name.slice(dot + 1).toLowerCase())) n++;
      }
    }
    counts.set(rel, n);
    tick();
  };

  await new Promise<void>((resolve) => {
    const pump = (): void => {
      while (!signal.aborted && active < PARALLEL_FOLDERS && stack.length > 0) {
        const rel = stack.pop() as string;
        active++;
        void visit(rel)
          .catch(() => undefined)
          .finally(() => {
            active--;
            pump();
          });
      }
      if (active === 0 && (stack.length === 0 || signal.aborted)) resolve();
    };
    pump();
  });
}

/**
 * Starts the background count for a library (once). `onProgress` is called now
 * and then while counting and once at the end, so the folder tree can refresh.
 * `isAlive` lets the count stop by itself when the library is removed.
 */
export function ensureCounting(
  libraryId: string,
  rootAbs: string,
  onProgress: () => void,
  isAlive: () => boolean
): void {
  const existing = states.get(libraryId);
  if (existing && (existing.running || (existing.done && !existing.stale))) return;

  const first = !existing;
  const fresh = new Map<string, number>();
  const st: CountState = existing ?? { counts: fresh, done: false, running: false, stale: false };
  if (first) states.set(libraryId, st);
  st.running = true;
  st.stale = false;

  const ctl = new AbortController();
  let last = 0;
  const tick = (): void => {
    if (!isAlive()) {
      ctl.abort();
      return;
    }
    const now = Date.now();
    if (now - last >= PROGRESS_EVERY_MS) {
      last = now;
      onProgress();
    }
  };

  void walk(rootAbs, fresh, ctl.signal, tick)
    .catch(() => undefined)
    .then(() => {
      st.running = false;
      if (ctl.signal.aborted) {
        states.delete(libraryId);
        return;
      }
      st.counts = fresh;
      st.done = true;
      onProgress();
    });
}