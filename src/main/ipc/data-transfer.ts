import { BrowserWindow, app, dialog, ipcMain, shell } from 'electron';
import { createWriteStream, existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, parse } from 'node:path';
import archiver from 'archiver';
import { IPC } from '@shared/ipc-channels';
import { isColorLabel } from '@shared/ratings';
import { broadcastLibraryEvent as broadcast } from '@main/events';
import * as manager from '@main/libraries/manager';
import { scanner } from '@main/scanner/service';
import * as store from '@main/containers/store';

interface LocalLists {
  favorites: string[];
  recent: string[];
}

interface FileDataRec {
  relPath: string;
  rating: number;
  colorLabel: string | null;
  notes: string | null;
  tags: string[];
}

interface TagRec {
  name: string;
  parent: string | null;
}

interface ExportedLibrary {
  id: string;
  name: string;
  mountPath: string;
  tags: TagRec[];
  files: FileDataRec[];
}

interface DataFile {
  format: 'gam-data';
  version: 1;
  exportedAt: number;
  libraries: ExportedLibrary[];
  containers: { name: string; items: { libraryId: string; relPath: string }[] }[];
  local: LocalLists;
}

const safeName = (s: string): string => s.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').trim() || 'Container';

function uniquePath(p: string): string {
  if (!existsSync(p)) return p;
  const { dir, name, ext } = parse(p);
  for (let i = 2; i < 1000; i++) {
    const c = join(dir, `${name} (${i})${ext}`);
    if (!existsSync(c)) return c;
  }
  return p;
}

// â”€â”€ Zip a container to the Desktop â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function zipToDesktop(
  id: number
): Promise<
  { ok: true; path: string; fileCount: number; skipped: number } | { ok: false; error: string }
> {
  const c = store.get(id);
  if (!c) return { ok: false, error: 'Container not found' };
  if (c.items.length === 0) return { ok: false, error: 'Container is empty' };
  const libs = manager.listLibraries();
  const dest = uniquePath(join(app.getPath('desktop'), `${safeName(c.name)}.zip`));
  let added = 0;
  let skipped = 0;
  try {
    await new Promise<void>((resolve, reject) => {
      const output = createWriteStream(dest);
      const archive = archiver('zip', { zlib: { level: 6 } });
      output.on('close', () => resolve());
      output.on('error', reject);
      archive.on('error', reject);
      archive.pipe(output);
      const used = new Set<string>();
      for (const it of c.items) {
        const lib = manager.getOpenLibrary(it.libraryId);
        const meta = libs.find((l) => l.id === it.libraryId);
        if (!lib || !meta) {
          skipped++;
          continue;
        }
        const abs = lib.resolver.toAbsolute(it.relPath);
        if (!existsSync(abs)) {
          skipped++;
          continue;
        }
        let name = `${safeName(meta.name)}/${it.relPath}`;
        let n = 2;
        while (used.has(name.toLowerCase())) {
          const p = parse(it.relPath);
          name = `${safeName(meta.name)}/${p.dir ? p.dir + '/' : ''}${p.name} (${n++})${p.ext}`;
        }
        used.add(name.toLowerCase());
        archive.file(abs, { name });
        added++;
      }
      if (added === 0) {
        archive.abort();
        output.destroy();
        reject(new Error('None of the container files exist on disk'));
        return;
      }
      void archive.finalize();
    });
  } catch (err) {
    try {
      unlinkSync(dest);
    } catch {
      // ignore
    }
    return { ok: false, error: (err as Error).message };
  }
  shell.showItemInFolder(dest);
  return { ok: true, path: dest, fileCount: added, skipped };
}

// â”€â”€ Export â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function collectLibrary(libraryId: string, name: string, mountPath: string): ExportedLibrary {
  const out: ExportedLibrary = { id: libraryId, name, mountPath, tags: [], files: [] };
  const lib = manager.getOpenLibrary(libraryId);
  if (!lib) return out;
  out.tags = lib.db
    .prepare(
      `SELECT t.name AS name, p.name AS parent FROM tags t LEFT JOIN tags p ON p.id = t.parent_id`
    )
    .all() as TagRec[];
  const rows = lib.db
    .prepare(
      `SELECT id, rel_path AS relPath, rating, color_label AS colorLabel, notes FROM files
       WHERE rating > 0 OR color_label IS NOT NULL OR notes IS NOT NULL
          OR id IN (SELECT file_id FROM file_tags)`
    )
    .all() as Array<{
    id: number;
    relPath: string;
    rating: number;
    colorLabel: string | null;
    notes: string | null;
  }>;
  const tagRows = lib.db
    .prepare(
      `SELECT ft.file_id AS fileId, t.name AS name FROM file_tags ft JOIN tags t ON t.id = ft.tag_id`
    )
    .all() as Array<{ fileId: number; name: string }>;
  const tagsByFile = new Map<number, string[]>();
  for (const r of tagRows) {
    const list = tagsByFile.get(r.fileId) ?? [];
    list.push(r.name);
    tagsByFile.set(r.fileId, list);
  }
  out.files = rows.map((r) => ({
    relPath: r.relPath,
    rating: r.rating ?? 0,
    colorLabel: r.colorLabel,
    notes: r.notes,
    tags: tagsByFile.get(r.id) ?? []
  }));
  return out;
}

// â”€â”€ Import â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const pendingFileData = new Map<string, { tags: TagRec[]; files: FileDataRec[]; tagsDone: boolean }>();

function applyPending(libraryId: string): number {
  const p = pendingFileData.get(libraryId);
  const lib = manager.getOpenLibrary(libraryId);
  if (!p || !lib) return p ? p.files.length : 0;
  let tagsTouched = false;
  if (!p.tagsDone) {
    const ids = new Map<string, number>();
    for (const t of p.tags) {
      const rec = lib.tags.ensureByName(t.name);
      ids.set(t.name.toLowerCase(), rec.id);
      tagsTouched = true;
    }
    for (const t of p.tags) {
      if (!t.parent) continue;
      const id = ids.get(t.name.toLowerCase());
      const parentId = ids.get(t.parent.toLowerCase());
      if (id == null || parentId == null) continue;
      const existing = lib.tags.list().find((x) => x.id === id);
      if (existing && existing.parentId == null) {
        try {
          lib.tags.setParent(id, parentId);
        } catch {
          // cycle: ignore
        }
      }
    }
    p.tagsDone = true;
  }
  const remaining: FileDataRec[] = [];
  let changed = false;
  for (const rec of p.files) {
    const f = lib.files.getByRelPath(rec.relPath);
    if (!f) {
      remaining.push(rec);
      continue;
    }
    if (rec.rating > 0) lib.files.setRatings([f.id], rec.rating);
    if (rec.colorLabel && isColorLabel(rec.colorLabel)) lib.files.setColorLabels([f.id], rec.colorLabel);
    if (rec.notes) lib.files.setNotes(f.id, rec.notes);
    for (const tn of rec.tags) {
      const tag = lib.tags.ensureByName(tn);
      lib.tags.addToFile(f.id, tag.id);
      tagsTouched = true;
    }
    changed = true;
  }
  p.files = remaining;
  if (remaining.length === 0) pendingFileData.delete(libraryId);
  if (changed) broadcast({ kind: 'files-changed', libraryId });
  if (tagsTouched) broadcast({ kind: 'tags-changed', libraryId });
  return remaining.length;
}

function remapKey(key: string, idMap: Map<string, string>): string | null {
  const i = key.indexOf('|');
  if (i < 0) return null;
  const to = idMap.get(key.slice(0, i));
  return to ? `${to}|${key.slice(i + 1)}` : null;
}

export function registerDataTransferIpc(): void {
  scanner.on('scan-complete', (libraryId: string) => {
    applyPending(libraryId);
  });

  ipcMain.handle(IPC.zipContainerToDesktop, async (_e, id: number) => zipToDesktop(id));

  ipcMain.handle(IPC.exportData, async (event, local: LocalLists) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const opts = {
      title: 'Export GAM data',
      defaultPath: join(app.getPath('desktop'), 'GAM-data.gamdata'),
      filters: [{ name: 'GAM data', extensions: ['gamdata'] }]
    };
    const res = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts);
    if (res.canceled || !res.filePath) return { ok: true as const, canceled: true as const };
    try {
      const data: DataFile = {
        format: 'gam-data',
        version: 1,
        exportedAt: Date.now(),
        libraries: manager
          .listLibraries()
          .map((l) => collectLibrary(l.id, l.name, l.mountPath)),
        containers: store.list().map((c) => ({
          name: c.name,
          items: c.items.map((i) => ({ libraryId: i.libraryId, relPath: i.relPath }))
        })),
        local: {
          favorites: Array.isArray(local?.favorites) ? local.favorites : [],
          recent: Array.isArray(local?.recent) ? local.recent : []
        }
      };
      writeFileSync(res.filePath, JSON.stringify(data, null, 2), 'utf8');
      return { ok: true as const, canceled: false as const, path: res.filePath };
    } catch (err) {
      return { ok: false as const, error: (err as Error).message };
    }
  });

  ipcMain.handle(IPC.importData, async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const openOpts: Electron.OpenDialogOptions = {
      title: 'Import GAM data',
      properties: ['openFile'],
      filters: [{ name: 'GAM data', extensions: ['gamdata'] }]
    };
    const picked = win ? await dialog.showOpenDialog(win, openOpts) : await dialog.showOpenDialog(openOpts);
    if (picked.canceled || picked.filePaths.length === 0) {
      return { ok: true as const, canceled: true as const };
    }

    let data: DataFile;
    try {
      data = JSON.parse(readFileSync(picked.filePaths[0], 'utf8')) as DataFile;
      if (data.format !== 'gam-data' || !Array.isArray(data.libraries)) throw new Error('Not a GAM data file');
    } catch (err) {
      return { ok: false as const, error: (err as Error).message };
    }

    // 1. Map every exported library onto a library on THIS machine.
    const idMap = new Map<string, string>();
    for (const lib of data.libraries) {
      const have = manager.listLibraries();
      const same = have.find((l) => l.id === lib.id);
      if (same) {
        idMap.set(lib.id, same.id);
        continue;
      }
      const dlgOpts: Electron.OpenDialogOptions = {
        title: `Where is the library "${lib.name}" on this computer?`,
        message: `Originally: ${lib.mountPath}`,
        buttonLabel: 'Use this folder',
        properties: ['openDirectory']
      };
      const r = win ? await dialog.showOpenDialog(win, dlgOpts) : await dialog.showOpenDialog(dlgOpts);
      if (r.canceled || r.filePaths.length === 0) continue;
      const added = manager.addLibrary({ mountPath: r.filePaths[0], name: lib.name });
      if (added.ok) idMap.set(lib.id, added.library.id);
    }

    // 2. Containers (merged by name).
    let containers = 0;
    for (const c of data.containers ?? []) {
      const target = store.findByName(c.name) ?? store.create(c.name);
      const items = c.items
        .map((i) => ({ libraryId: idMap.get(i.libraryId) ?? '', relPath: i.relPath }))
        .filter((i) => i.libraryId !== '');
      store.addItems(target.id, items);
      containers++;
    }

    // 3. Ratings, labels, notes, tags: applied now where files exist, rest after the scan.
    let pending = 0;
    for (const lib of data.libraries) {
      const newId = idMap.get(lib.id);
      if (!newId) continue;
      pendingFileData.set(newId, { tags: lib.tags ?? [], files: lib.files ?? [], tagsDone: false });
      pending += applyPending(newId);
      broadcast({ kind: 'collections-changed', libraryId: newId });
    }

    // 4. Favorites / recent, remapped to the new library ids.
    const remap = (list: string[]): string[] =>
      (Array.isArray(list) ? list : [])
        .map((k) => remapKey(k, idMap))
        .filter((k): k is string => k !== null);

    return {
      ok: true as const,
      canceled: false as const,
      libraries: idMap.size,
      containers,
      pending,
      local: { favorites: remap(data.local?.favorites ?? []), recent: remap(data.local?.recent ?? []) }
    };
  });
}