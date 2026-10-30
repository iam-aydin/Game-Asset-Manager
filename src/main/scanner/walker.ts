import type { Dirent } from 'node:fs';
import { open, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { PathResolver } from '@shared/paths';
import { extensionOf, isSupportedExtension } from '@shared/formats';
import type { UpsertInput } from '@main/db/repos/files';

export interface WalkOptions {
  /** Directory names to skip entirely (matched case-sensitively, no slashes). */
  ignoreDirNames?: Set<string>;
  /** How many entries to gather before yielding via the onBatch callback. */
  batchSize?: number;
  /** Called with each batch of supported files as the walk progresses. */
  onBatch?: (batch: UpsertInput[]) => Promise<void> | void;
  /**
   * Cancellation signal. Checked before descending into each directory and
   * before every flush; when aborted the walk throws an `AbortError` so the
   * caller can leave its state untouched.
   */
  signal?: AbortSignal;
}

/** Thrown by walkLibrary when its AbortSignal fires mid-walk. */
export class WalkAbortedError extends Error {
  constructor() {
    super('Scan aborted');
    this.name = 'AbortError';
  }
}

const DEFAULT_IGNORE: ReadonlySet<string> = new Set([
  '.git',
  '.svn',
  '.hg',
  'node_modules',
  '.DS_Store',
  '@eaDir' // Synology NAS thumbnail folder
]);

/**
 * Recursively walk a library root, batching supported 3D files for upsert.
 * Hidden directories (any starting with '.') and a small ignore-list are
 * skipped. Returns the total count of supported files seen and the set of
 * relative paths so callers can compute stale rows for deletion.
 */
export async function walkLibrary(
  resolver: PathResolver,
  options: WalkOptions = {}
): Promise<{ totalSeen: number; seenRelPaths: Set<string> }> {
  const ignore = new Set([...DEFAULT_IGNORE, ...(options.ignoreDirNames ?? [])]);
  const batchSize = options.batchSize ?? 200;
  const root = resolver.getMountPath();

  const signal = options.signal;

  let buffer: UpsertInput[] = [];
  const seenRelPaths = new Set<string>();
  let totalSeen = 0;

  const throwIfAborted = () => {
    if (signal?.aborted) throw new WalkAbortedError();
  };

  const flush = async () => {
    if (buffer.length === 0) return;
    if (options.onBatch) await options.onBatch(buffer);
    buffer = [];
  };

  const visit = async (absDir: string): Promise<void> => {
    throwIfAborted();
    let entries: Dirent[];
    try {
      entries = await readdir(absDir, { withFileTypes: true, encoding: 'utf8' });
    } catch {
      // Permission denied or transient FS error — skip this subtree silently.
      return;
    }

    for (const entry of entries) {
      const absChild = join(absDir, entry.name);

      if (entry.isDirectory()) {
        if (entry.name.startsWith('.') || ignore.has(entry.name)) continue;
        await visit(absChild);
        continue;
      }

      if (!entry.isFile() && !entry.isSymbolicLink()) continue;

      const ext = extensionOf(entry.name);
      if (!isSupportedExtension(ext)) continue;

      // Symlinks need an explicit stat to get size/mtime of the target.
      let sizeBytes: number;
      let mtimeMs: number;
      try {
        const s = entry.isSymbolicLink() ? await stat(absChild) : await stat(absChild);
        sizeBytes = s.size;
        mtimeMs = Math.floor(s.mtimeMs);
      } catch {
        continue;
      }

      const relPath = resolver.toRelative(absChild);
      const slash = relPath.lastIndexOf('/');
      const parentDir = slash < 0 ? '' : relPath.slice(0, slash);

      seenRelPaths.add(relPath);
      totalSeen++;

      buffer.push({
        relPath,
        parentDir,
        filename: entry.name,
        ext,
        sizeBytes,
        mtimeMs
      });

      if (buffer.length >= batchSize) {
        await flush();
        throwIfAborted();
      }
    }
  };

  await visit(root);
  await flush();
  return { totalSeen, seenRelPaths };
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ Lazy (Explorer style) scanning â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const SKIP_DIRS_LOWER: ReadonlySet<string> = new Set([
  'node_modules',
  '@eadir',
  'intermediate',
  'binaries',
  'deriveddatacache',
  'saved',
  '__pycache__',
  '$recycle.bin',
  'system volume information'
]);

/** True for folders that are never listed or scanned (hidden, build output, tooling). */
export function shouldSkipDir(name: string): boolean {
  return name.startsWith('.') || SKIP_DIRS_LOWER.has(name.toLowerCase());
}

/** Compiled C++ objects also use the .obj extension; real OBJ models are text. */
async function looksBinary(abs: string): Promise<boolean> {
  let fh;
  try {
    fh = await open(abs, 'r');
    const buf = Buffer.alloc(512);
    const { bytesRead } = await fh.read(buf, 0, 512, 0);
    for (let i = 0; i < bytesRead; i++) if (buf[i] === 0) return true;
    return false;
  } catch {
    return true;
  } finally {
    await fh?.close().catch(() => undefined);
  }
}

/**
 * Supported files directly inside ONE folder (no recursion).
 * Returns [] when the folder no longer exists, null when it cannot be read
 * right now (so callers leave its database rows alone).
 */
export async function listFolderFiles(
  resolver: PathResolver,
  relDir: string
): Promise<UpsertInput[] | null> {
  const absDir = relDir === '' ? resolver.getMountPath() : resolver.toAbsolute(relDir);
  let entries: Dirent[];
  try {
    entries = await readdir(absDir, { withFileTypes: true, encoding: 'utf8' });
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'ENOENT' ? [] : null;
  }
  const out: UpsertInput[] = [];
  for (const entry of entries) {
    if (!entry.isFile() && !entry.isSymbolicLink()) continue;
    const ext = extensionOf(entry.name);
    if (!isSupportedExtension(ext)) continue;
    const absChild = join(absDir, entry.name);
    try {
      if (ext === 'obj' && (await looksBinary(absChild))) continue;
      const s = await stat(absChild);
      if (!s.isFile()) continue;
      const relPath = resolver.toRelative(absChild);
      const slash = relPath.lastIndexOf('/');
      out.push({
        relPath,
        parentDir: slash < 0 ? '' : relPath.slice(0, slash),
        filename: entry.name,
        ext,
        sizeBytes: s.size,
        mtimeMs: Math.floor(s.mtimeMs)
      });
    } catch {
      continue;
    }
  }
  return out;
}
