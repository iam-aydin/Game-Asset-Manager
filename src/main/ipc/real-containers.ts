import { app, ipcMain, shell } from 'electron';
import { existsSync, mkdirSync } from 'node:fs';
import { copyFile, cp, mkdir, readdir, rename, rm, rmdir, unlink } from 'node:fs/promises';
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path';
import { broadcastLibraryEvent } from '@main/events';
import { addLibrary, getOpenLibrary, listLibraries, type OpenLibrary } from '@main/libraries/manager';
import { scanner } from '@main/scanner/service';
import { markCountsStale } from '@main/scanner/counter';
import { undoQueue } from '@main/undo/queue';
import { renameEntryFor } from '@main/files/move-service';
import * as containersStore from '@main/containers/store';
import { DEFAULT_GENERIC_NAMES, MODEL_EXTS, planBundle, uniqueDirName } from '@main/containers/bundle';

// Patch 2a: real containers. A container is a real folder in
// %APPDATA%\GAM\containers that is registered as a library.
// Channels: rc:create, rc:list, rc:place (move / copy bundles), rc:moveFolders.

type Op = { kind: 'move' | 'copy'; from: string; to: string };

export const containersRoot = (): string => join(app.getPath('appData'), 'GAM', 'containers');

const normId = (id: number) => (id >= 1000000000 ? id % 1000000000 : id);
const keyOf = (p: string) => (process.platform === 'win32' ? resolve(p).toLowerCase() : resolve(p));
const same = (a: string, b: string) => keyOf(a) === keyOf(b);
const inside = (child: string, parent: string) => {
  const c = keyOf(child);
  const p = keyOf(parent);
  return c === p || c.startsWith(p.endsWith(sep) ? p : p + sep);
};
const mountOf = (lib: OpenLibrary) => lib.resolver.getMountPath();
const relIn = (lib: OpenLibrary, abs: string) => relative(mountOf(lib), abs).split(sep).join('/');
const absOf = (lib: OpenLibrary, rel: string) => (rel === '' ? mountOf(lib) : lib.resolver.toAbsolute(rel));
const cleanSub = (s: unknown): string | null => {
  const t = String(s ?? '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  return t.split('/').some((x) => x === '..') ? null : t;
};
const isModelExt = (ext: string) => MODEL_EXTS.includes(ext.replace(/^\./, '').toLowerCase());
const errMsg = (e: unknown) => String((e as Error)?.message ?? e);

function safeName(name: string): string {
  let n = name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/, '').trim();
  if (/^(con|prn|aux|nul|com\d|lpt\d)$/i.test(n)) n = `_${n}`;
  return n;
}

function uniqueFile(dir: string, name: string): string {
  if (!existsSync(join(dir, name))) return name;
  const ext = extname(name);
  const stem = basename(name, ext);
  for (let i = 1; i < 10000; i++) {
    const c = `${stem}(${i})${ext}`;
    if (!existsSync(join(dir, c))) return c;
  }
  return `${stem}(${Date.now()})${ext}`;
}

/** Moves a file. Across drives (EXDEV) it copies, then deletes the original. */
async function relocateFile(from: string, to: string): Promise<void> {
  await mkdir(dirname(to), { recursive: true });
  try {
    await rename(from, to);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EXDEV') throw e;
    await copyFile(from, to);
    await unlink(from);
  }
}

async function relocateDir(from: string, to: string): Promise<void> {
  await mkdir(dirname(to), { recursive: true });
  try {
    await rename(from, to);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EXDEV') throw e;
    await cp(from, to, { recursive: true });
    await rm(from, { recursive: true, force: true });
  }
}

/** Removes empty folders bottom-up. Returns true when `dir` itself is gone. */
async function pruneEmpty(dir: string): Promise<boolean> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return false;
  }
  let empty = true;
  for (const e of entries) {
    if (e.isDirectory()) {
      if (!(await pruneEmpty(join(dir, e.name)))) empty = false;
    } else empty = false;
  }
  if (!empty) return false;
  try {
    await rmdir(dir);
    return true;
  } catch {
    return false;
  }
}

/** Runs the operations in order. If one fails, everything done so far is undone. */
async function runOps(ops: Op[]): Promise<void> {
  const done: Op[] = [];
  try {
    for (const op of ops) {
      if (!existsSync(op.from)) throw new Error(`File not found: ${op.from}`);
      if (op.kind === 'copy') {
        await mkdir(dirname(op.to), { recursive: true });
        await copyFile(op.from, op.to);
      } else {
        await relocateFile(op.from, op.to);
      }
      done.push(op);
    }
  } catch (e) {
    for (const op of done.reverse()) {
      try {
        if (op.kind === 'copy') await unlink(op.to);
        else await relocateFile(op.to, op.from);
      } catch {
        // best effort
      }
    }
    throw e;
  }
}

/** Keeps the databases and the old virtual containers in step after files moved. */
function syncDb(src: OpenLibrary, dest: OpenLibrary, ops: Op[]): void {
  const sameLib = src.entry.id === dest.entry.id;
  const renames: { id: number; from: string; to: string }[] = [];
  for (const op of ops) {
    if (op.kind !== 'move' || !inside(op.from, mountOf(src))) continue;
    const fromRel = relIn(src, op.from);
    const row = src.files.getByRelPath(fromRel);
    if (!row) continue;
    if (sameLib) {
      renames.push({ id: row.id, from: fromRel, to: relIn(dest, op.to) });
    } else {
      src.files.deleteByRelPath(fromRel);
      containersStore.removePath(src.entry.id, fromRel);
    }
  }
  if (renames.length > 0) {
    src.files.applyRenames(renames.map((r) => renameEntryFor(r.id, r.to)));
    containersStore.renamePaths(src.entry.id, renames.map((r) => ({ from: r.from, to: r.to })));
  }
}

function refresh(libs: OpenLibrary[], index: { lib: OpenLibrary; rel: string }[]): void {
  const ids = [...new Set(libs.map((l) => l.entry.id))];
  for (const id of ids) markCountsStale(id);
  for (const d of index) void scanner.indexAll(d.lib.entry.id, d.rel);
  for (const id of ids) broadcastLibraryEvent({ kind: 'files-changed', libraryId: id });
}

function pushUndo(srcId: string, destId: string, label: string, ops: Op[], destDirs: string[]): void {
  undoQueue.push({
    libraryId: srcId,
    label,
    undo: async () => {
      const src = getOpenLibrary(srcId);
      const dest = getOpenLibrary(destId);
      if (!src || !dest) return { ok: false as const, error: 'Library no longer open' };
      try {
        for (const op of [...ops].reverse()) {
          if (op.kind === 'copy') {
            if (existsSync(op.to)) await unlink(op.to);
            continue;
          }
          if (!existsSync(op.to)) throw new Error(`Not found: ${op.to}`);
          if (existsSync(op.from)) throw new Error(`Original place is occupied: ${op.from}`);
          await relocateFile(op.to, op.from);
        }
      } catch (e) {
        return { ok: false as const, error: errMsg(e) };
      }
      for (const op of ops) {
        if (inside(op.to, mountOf(dest))) dest.files.deleteByRelPath(relIn(dest, op.to));
      }
      for (const d of destDirs) await pruneEmpty(d);
      markCountsStale(srcId);
      markCountsStale(destId);
      void scanner.rescan(srcId);
      if (destId !== srcId) void scanner.rescan(destId);
      broadcastLibraryEvent({ kind: 'files-changed', libraryId: srcId });
      broadcastLibraryEvent({ kind: 'files-changed', libraryId: destId });
      return { ok: true as const };
    }
  });
}

interface PlaceItem {
  libraryId: string;
  fileId: number;
}

export function registerRealContainersIpc(): void {
  ipcMain.removeHandler('rc:create');
  ipcMain.handle('rc:create', async (_e, name: unknown) => {
    try {
      const n = safeName(String(name ?? '').trim());
      if (!n) return { ok: false, error: 'Name cannot be empty' };
      const root = containersRoot();
      mkdirSync(root, { recursive: true });
      const dir = join(root, uniqueDirName(root, n));
      mkdirSync(dir);
      return addLibrary({ mountPath: dir, name: basename(dir) });
    } catch (e) {
      return { ok: false, error: errMsg(e) };
    }
  });

  ipcMain.removeHandler('rc:list');
  ipcMain.handle('rc:list', async () => {
    const root = containersRoot();
    return listLibraries().filter((l) => inside(l.mountPath, root));
  });

  // Move (drag / Ctrl+X) or copy (Ctrl+C / Ctrl+V) models with their textures and .bin files.
  ipcMain.removeHandler('rc:place');
  ipcMain.handle('rc:place', async (_e, raw: any) => {
    const created: string[] = [];
    try {
      const mode: 'move' | 'copy' = raw?.mode === 'copy' ? 'copy' : 'move';
      const dest = getOpenLibrary(String(raw?.destLibraryId ?? ''));
      if (!dest) return { ok: false, error: 'The destination library is not open' };
      const sub = cleanSub(raw?.destSubDir);
      if (sub === null) return { ok: false, error: 'Invalid folder' };
      const destBase = absOf(dest, sub);
      if (!existsSync(destBase)) return { ok: false, error: 'The destination folder does not exist' };
      const generic: string[] = Array.isArray(raw?.genericNames)
        ? raw.genericNames.map(String)
        : DEFAULT_GENERIC_NAMES;

      const entries = ((Array.isArray(raw?.items) ? raw.items : []) as PlaceItem[])
        .map((it) => {
          const src = getOpenLibrary(String(it.libraryId));
          const file = src?.files.getById(normId(Number(it.fileId)));
          return src && file ? { src, file, abs: src.resolver.toAbsolute(file.relPath) } : null;
        })
        .filter((x): x is NonNullable<typeof x> => x !== null)
        // models first, so their textures are handled with them and not on their own
        .sort((a, b) => Number(isModelExt(b.file.ext)) - Number(isModelExt(a.file.ext)));

      // Phase 1: plan everything (bundle folders are created now so names stay unique).
      const jobs: { src: OpenLibrary; ops: Op[]; destDirs: string[]; name: string }[] = [];
      const seen = new Set<string>();
      let skipped = 0;
      for (const { src, file, abs } of entries) {
        if (!existsSync(abs) || seen.has(keyOf(abs))) {
          skipped++;
          continue;
        }
        seen.add(keyOf(abs));
        if (isModelExt(file.ext)) {
          if (mode === 'move' && same(dirname(dirname(abs)), destBase)) {
            skipped++; // already in a bundle folder directly here
            continue;
          }
          const plan = planBundle(abs, destBase, mode, generic);
          mkdirSync(plan.destDir, { recursive: true });
          created.push(plan.destDir);
          for (const f of [...plan.moves, ...plan.copies]) seen.add(keyOf(f.from));
          jobs.push({
            src,
            destDirs: [plan.destDir],
            name: plan.name,
            ops: [
              ...plan.moves.map((m): Op => ({ kind: 'move', from: m.from, to: m.to })),
              ...plan.copies.map((c): Op => ({ kind: 'copy', from: c.from, to: c.to }))
            ]
          });
        } else {
          if (mode === 'move' && same(dirname(abs), destBase)) {
            skipped++;
            continue;
          }
          const to = join(destBase, uniqueFile(destBase, basename(abs)));
          jobs.push({ src, destDirs: [], name: basename(abs), ops: [{ kind: mode, from: abs, to }] });
        }
      }

      // Phase 2: do it.
      const touched: OpenLibrary[] = [dest];
      for (const job of jobs) {
        await runOps(job.ops);
        syncDb(job.src, dest, job.ops);
        touched.push(job.src);
        pushUndo(
          job.src.entry.id,
          dest.entry.id,
          `${mode === 'copy' ? 'Copy' : 'Move'} ${job.name}`,
          job.ops,
          job.destDirs
        );
      }
      const index = jobs.flatMap((j) =>
        j.destDirs.length > 0
          ? j.destDirs.map((d) => ({ lib: dest, rel: relIn(dest, d) }))
          : [{ lib: dest, rel: sub }]
      );
      refresh(touched, index);
      return { ok: true, count: jobs.length, skipped, names: jobs.map((j) => j.name) };
    } catch (e) {
      for (const d of created) await pruneEmpty(d);
      return { ok: false, error: errMsg(e) };
    }
  });

  // Move whole folders (also several at once) into a folder of any open library.
  ipcMain.removeHandler('rc:moveFolders');
  ipcMain.handle('rc:moveFolders', async (_e, raw: any) => {
    try {
      const src = getOpenLibrary(String(raw?.srcLibraryId ?? ''));
      const dest = getOpenLibrary(String(raw?.destLibraryId ?? ''));
      if (!src || !dest) return { ok: false, error: 'Library is not open' };
      const sub = cleanSub(raw?.destSubDir);
      if (sub === null) return { ok: false, error: 'Invalid folder' };
      const destBase = absOf(dest, sub);
      if (!existsSync(destBase)) return { ok: false, error: 'The destination folder does not exist' };
      const sameLib = src.entry.id === dest.entry.id;
      const moved: { absFrom: string; absTo: string; fromRel: string; toRel: string }[] = [];
      let skipped = 0;

      for (const f of (Array.isArray(raw?.folders) ? raw.folders : []) as unknown[]) {
        const folder = cleanSub(f);
        if (!folder) continue; // the library root cannot be moved
        const absFrom = src.resolver.toAbsolute(folder);
        if (!existsSync(absFrom)) continue;
        if (inside(destBase, absFrom)) {
          return { ok: false, error: `Cannot move "${basename(absFrom)}" into itself` };
        }
        if (same(dirname(absFrom), destBase)) {
          skipped++;
          continue;
        }
        const absTo = join(destBase, uniqueDirName(destBase, basename(absFrom)));
        const affected = src.files.query({ parentDir: folder, recursive: true });
        await relocateDir(absFrom, absTo);
        const toRel = relIn(dest, absTo);
        if (sameLib) {
          if (affected.length > 0) {
            const next = affected.map((a) => ({ id: a.id, from: a.relPath, to: toRel + a.relPath.slice(folder.length) }));
            src.files.applyRenames(next.map((n) => renameEntryFor(n.id, n.to)));
            containersStore.renamePaths(src.entry.id, next.map((n) => ({ from: n.from, to: n.to })));
          }
        } else {
          for (const a of affected) {
            src.files.deleteByRelPath(a.relPath);
            containersStore.removePath(src.entry.id, a.relPath);
          }
        }
        moved.push({ absFrom, absTo, fromRel: folder, toRel });
      }

      if (moved.length > 0) {
        undoQueue.push({
          libraryId: src.entry.id,
          label: moved.length === 1 ? `Move folder ${basename(moved[0].absTo)}` : `Move ${moved.length} folders`,
          undo: async () => {
            const s = getOpenLibrary(src.entry.id);
            const d = getOpenLibrary(dest.entry.id);
            if (!s || !d) return { ok: false as const, error: 'Library no longer open' };
            try {
              for (const m of [...moved].reverse()) {
                if (!existsSync(m.absTo)) throw new Error(`Not found: ${m.absTo}`);
                if (existsSync(m.absFrom)) throw new Error(`Original place is occupied: ${m.absFrom}`);
                for (const r of d.files.query({ parentDir: m.toRel, recursive: true })) {
                  d.files.deleteByRelPath(r.relPath);
                }
                await relocateDir(m.absTo, m.absFrom);
              }
            } catch (e) {
              return { ok: false as const, error: errMsg(e) };
            }
            markCountsStale(src.entry.id);
            markCountsStale(dest.entry.id);
            void scanner.rescan(src.entry.id);
            if (dest.entry.id !== src.entry.id) void scanner.rescan(dest.entry.id);
            broadcastLibraryEvent({ kind: 'files-changed', libraryId: src.entry.id });
            broadcastLibraryEvent({ kind: 'files-changed', libraryId: dest.entry.id });
            return { ok: true as const };
          }
        });
      }
      refresh([src, dest], moved.map((m) => ({ lib: dest, rel: m.toRel })));
      return { ok: true, count: moved.length, skipped };
    } catch (e) {
      return { ok: false, error: errMsg(e) };
    }
  });

  ipcMain.removeHandler('rc:reveal');
  ipcMain.handle('rc:reveal', async () => {
    mkdirSync(containersRoot(), { recursive: true });
    await shell.openPath(containersRoot());
  });
}