import { BrowserWindow, app, dialog, ipcMain, net, shell } from 'electron';
import {
  closeSync,
  createWriteStream,
  existsSync,
  openSync,
  readdirSync,
  renameSync,
  readFileSync,
  readSync,
  statSync,
  unlinkSync,
  writeFileSync
} from 'node:fs';
import { dirname, join, parse, relative, resolve, sep } from 'node:path';
import archiver from 'archiver';
import { copyFile, writeFile as writeFileAsync } from 'node:fs/promises';
import { scopedLogger } from '@main/logger';

const zlog = scopedLogger('zip');
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
const MODEL_EXTS = new Set(['fbx', 'gltf', 'glb', 'obj', 'stl', 'ply', '3mf']);
const TEXTURE_DIR = /^(tex|texs|textures?|maps|materials|images)$/i;
const SIDE_FILE = /^(licen[sc]e|copying|notice|readme|credits?|attribution)/i;
const EXTRA_EXT = /\.(png|jpe?g|tga|bmp|dds|tiff?|webp|exr|hdr|ktx2?|bin|mtl)$/i;

function insideRoot(rootDir: string, p: string): boolean {
  const win = process.platform === 'win32';
  const r = win ? resolve(p).toLowerCase() : resolve(p);
  const base = win ? rootDir.toLowerCase() : rootDir;
  return r === base || r.startsWith(base + sep);
}

function readHead(p: string, bytes: number): string {
  const fd = openSync(p, 'r');
  try {
    const buf = Buffer.alloc(bytes);
    const n = readSync(fd, buf, 0, bytes, 0);
    return buf.toString('utf8', 0, n);
  } finally {
    closeSync(fd);
  }
}

function walkFiles(dir: string, out: string[], depth = 0): void {
  if (depth > 4 || out.length > 3000) return;
  let entries: import('node:fs').Dirent[] = [];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walkFiles(p, out, depth + 1);
    else if (e.isFile()) out.push(p);
  }
}

/** Files that belong to a 3D model: referenced buffers/textures, texture folders, licenses. */
function collectModelExtras(abs: string, rootDir: string, ext: string): string[] {
  const out = new Set<string>();
  const dir = dirname(abs);
  const self = resolve(abs);
  const add = (p: string): void => {
    try {
      const r = resolve(p);
      if (r !== self && insideRoot(rootDir, r) && existsSync(r) && statSync(r).isFile()) out.add(r);
    } catch {
      // unreadable: skip
    }
  };
  const addRef = (u: unknown): void => {
    if (typeof u !== 'string' || u === '' || /^(data:|https?:)/i.test(u)) return;
    let d = u;
    try {
      d = decodeURIComponent(u);
    } catch {
      // keep raw
    }
    add(join(dir, d));
  };
  try {
    if (ext === 'gltf') {
      const j = JSON.parse(readFileSync(abs, 'utf8').replace(/^\uFEFF/, ''));
      for (const b of j.buffers ?? []) addRef(b?.uri);
      for (const i of j.images ?? []) addRef(i?.uri);
    } else if (ext === 'obj') {
      for (const m of readHead(abs, 65536).matchAll(/^\s*mtllib\s+(.+?)\s*$/gm)) {
        const mtl = join(dir, m[1]);
        add(mtl);
        if (existsSync(mtl)) {
          for (const line of readFileSync(mtl, 'utf8').split(/\r?\n/)) {
            if (/^\s*(map_\w+|bump|disp|decal|refl)\b/i.test(line)) addRef(line.trim().split(/\s+/).pop());
          }
        }
      }
    }
  } catch {
    // unreadable reference data: the folder scan below still runs
  }

  const scanTextureDirs = (base: string): void => {
    let entries: import('node:fs').Dirent[] = [];
    try {
      entries = readdirSync(base, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.isDirectory() && TEXTURE_DIR.test(e.name)) {
        const list: string[] = [];
        walkFiles(join(base, e.name), list);
        list.forEach(add);
      }
    }
  };

  if (resolve(dir) !== rootDir) {
    const stem = parse(abs).name.toLowerCase();
    let entries: import('node:fs').Dirent[] = [];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      entries = [];
    }
    for (const e of entries) {
      if (!e.isFile()) continue;
      const pp = parse(e.name);
      const isModel = MODEL_EXTS.has(pp.ext.slice(1).toLowerCase());
      if (SIDE_FILE.test(e.name) || (pp.name.toLowerCase() === stem && !isModel)) add(join(dir, e.name));
    }
    // Any texture/buffer file anywhere under the model's own folder.
    const underModel: string[] = [];
    walkFiles(dir, underModel);
    for (const p of underModel) if (EXTRA_EXT.test(p)) add(p);
    scanTextureDirs(dir);
    const parent = dirname(dir);
    if (resolve(parent) !== rootDir && insideRoot(rootDir, parent)) scanTextureDirs(parent);
  }
  zlog.info('model extras found', { model: abs, count: out.size });
  return [...out];
}

export async function zipContainerTo(
  id: number,
  destOverride?: string
): Promise<
  { ok: true; path: string; fileCount: number; skipped: number } | { ok: false; error: string }
> {
  void renameSync;
  const c = store.get(id);
  if (!c) return { ok: false, error: 'Container not found' };
  if (c.items.length === 0) return { ok: false, error: 'Container is empty' };
  const libs = manager.listLibraries();
  const dest = destOverride ?? uniquePath(join(app.getPath('desktop'), `${safeName(c.name)}.zip`));

  // Step 1: decide which files go in. Nothing is written yet.
  const entries: Array<{ abs: string; name: string }> = [];
  const used = new Set<string>();
  const usedFolders = new Set<string>();
  let skipped = 0;
  const addEntry = (absPath: string, name: string): void => {
    let final = name;
    let n = 2;
    while (used.has(final.toLowerCase())) {
      const p = parse(name);
      final = `${p.dir ? p.dir + '/' : ''}${p.name} (${n++})${p.ext}`;
    }
    used.add(final.toLowerCase());
    entries.push({ abs: absPath, name: final });
  };
  try {
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
      const libName = safeName(meta.name);
      const ext = parse(it.relPath).ext.slice(1).toLowerCase();
      if (!MODEL_EXTS.has(ext)) {
        addEntry(abs, `${libName}/${it.relPath}`);
        continue;
      }
      // 3D model: its own folder with textures, buffers and licenses beside it.
      const base = safeName(parse(it.relPath).name);
      let folder = `${libName}/${base}`;
      let k = 2;
      while (usedFolders.has(folder.toLowerCase())) folder = `${libName}/${base} (${k++})`;
      usedFolders.add(folder.toLowerCase());
      addEntry(abs, `${folder}/${parse(abs).base}`);
      const rootDir = resolve(lib.entry.mountPath);
      const modelDir = dirname(abs);
      for (const extra of collectModelExtras(abs, rootDir, ext)) {
        let target = relative(modelDir, extra);
        if (target.startsWith('..')) {
          const up = relative(dirname(modelDir), extra);
          target = up.startsWith('..') ? `_external/${parse(extra).base}` : up;
        }
        addEntry(extra, `${folder}/${target.split(sep).join('/')}`);
      }
    }
  } catch (err) {
    zlog.error('zip: collecting files failed', { message: (err as Error).message });
    return { ok: false, error: `Could not collect files: ${(err as Error).message}` };
  }
  if (entries.length === 0) return { ok: false, error: 'None of the container files exist on disk' };

  // Step 2: write the archive straight to its final path.
  try {
    if (existsSync(dest)) unlinkSync(dest);
    await new Promise<void>((resolveP, rejectP) => {
      const output = createWriteStream(dest);
      const archive = archiver('zip', { zlib: { level: 6 } });
      output.on('close', () => resolveP());
      output.on('error', rejectP);
      archive.on('error', rejectP);
      archive.on('warning', (w) => zlog.warn('zip warning', { message: String(w) }));
      archive.pipe(output);
      for (const e of entries) archive.file(e.abs, { name: e.name });
      void archive.finalize();
    });
    const bytes = statSync(dest).size;
    zlog.info('zip written', { dest, files: entries.length, bytes });
    if (bytes < 100) throw new Error(`Archive is only ${bytes} bytes`);
  } catch (err) {
    zlog.error('zip failed', { message: (err as Error).message });
    try {
      unlinkSync(dest);
    } catch {
      // ignore
    }
    return { ok: false, error: (err as Error).message };
  }
  shell.showItemInFolder(dest);
  return { ok: true, path: dest, fileCount: entries.length, skipped };
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

  ipcMain.handle(IPC.zipContainerToDesktop, async (_e, id: number) => zipContainerTo(id));

  ipcMain.handle(IPC.getAppVersion, () => app.getVersion());

  ipcMain.handle(
    IPC.saveImageAs,
    async (
      event,
      req: { libraryId: string; fileId: number; defaultName: string; data: Uint8Array | null }
    ) => {
      const lib = manager.getOpenLibrary(req.libraryId);
      if (!lib) return { ok: false as const, error: 'Library is not open' };
      const win = BrowserWindow.fromWebContents(event.sender);
      const ext = parse(req.defaultName).ext.slice(1).toLowerCase() || 'png';
      const opts = {
        title: 'Save image as',
        defaultPath: join(app.getPath('pictures'), safeName(req.defaultName)),
        filters: [{ name: ext.toUpperCase(), extensions: [ext] }]
      };
      const res = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts);
      if (res.canceled || !res.filePath) return { ok: true as const, canceled: true as const };
      try {
        if (req.data) {
          await writeFileAsync(res.filePath, Buffer.from(req.data));
        } else {
          const f = lib.files.getById(req.fileId);
          if (!f) return { ok: false as const, error: 'File not found' };
          await copyFile(lib.resolver.toAbsolute(f.relPath), res.filePath);
        }
        return { ok: true as const, canceled: false as const, path: res.filePath };
      } catch (err) {
        return { ok: false as const, error: (err as Error).message };
      }
    }
  );

  ipcMain.handle(IPC.checkForUpdates, async () => {
    const current = app.getVersion();
    const repo = 'iam-aydin/Game-Asset-Manager';
    const parseV = (v: string): number[] =>
      v
        .replace(/^v/i, '')
        .split(/[.\-+]/)
        .map((x) => parseInt(x, 10) || 0);
    const newer = (a: string, b: string): boolean => {
      const x = parseV(a);
      const y = parseV(b);
      for (let i = 0; i < Math.max(x.length, y.length); i++) {
        const d = (x[i] ?? 0) - (y[i] ?? 0);
        if (d !== 0) return d > 0;
      }
      return false;
    };
    const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'Game-Asset-Manager' };
    try {
      let tag = '';
      let url = `https://github.com/${repo}/releases`;
      const r = await net.fetch(`https://api.github.com/repos/${repo}/releases/latest`, { headers });
      if (r.ok) {
        const j = (await r.json()) as { tag_name?: string; html_url?: string };
        tag = j.tag_name ?? '';
        if (j.html_url) url = j.html_url;
      } else if (r.status === 404) {
        const t = await net.fetch(`https://api.github.com/repos/${repo}/tags?per_page=1`, { headers });
        if (t.ok) {
          const arr = (await t.json()) as Array<{ name?: string }>;
          tag = arr[0]?.name ?? '';
        }
      } else {
        return { ok: false as const, error: `GitHub answered with status ${r.status}` };
      }
      if (!tag) return { ok: true as const, current, latest: null, upToDate: true, url };
      return {
        ok: true as const,
        current,
        latest: tag.replace(/^v/i, ''),
        upToDate: !newer(tag, current),
        url
      };
    } catch (err) {
      return { ok: false as const, error: (err as Error).message };
    }
  });

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
    const qOpts: Electron.MessageBoxOptions = {
      type: 'question',
      title: 'Import GAM data',
      message: 'Have your library folder locations changed?',
      detail:
        'Yes: you will be asked where each library folder is on this computer.\n' +
        'No: the folder paths saved in the file are used as they are.',
      buttons: ['Yes, they changed', 'No, same locations', 'Cancel'],
      defaultId: 1,
      cancelId: 2,
      noLink: true
    };
    const ask = win ? await dialog.showMessageBox(win, qOpts) : await dialog.showMessageBox(qOpts);
    if (ask.response === 2) return { ok: true as const, canceled: true as const };
    const sameLocations = ask.response === 1;
    for (const lib of data.libraries) {
      const have = manager.listLibraries();
      const same = have.find((l) => l.id === lib.id);
      if (same) {
        idMap.set(lib.id, same.id);
        continue;
      }
      if (sameLocations && existsSync(lib.mountPath)) {
        const added = manager.addLibrary({ mountPath: lib.mountPath, name: lib.name });
        if (added.ok) {
          idMap.set(lib.id, added.library.id);
          continue;
        }
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