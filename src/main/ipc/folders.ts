import { ipcMain } from 'electron';
import { lstat, readdir, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { IPC } from '@shared/ipc-channels';
import type { FolderInfoResult, FolderTreeNode } from '@shared/types';
import { getOpenLibrary } from '@main/libraries/manager';
import { scanner } from '@main/scanner/service';
import { shouldSkipDir } from '@main/scanner/walker';
import { ensureCounting, getFolderCounts, markCountsStale } from '@main/scanner/counter';

/** Windows allocates space in clusters; 4 KB is the NTFS default. */
const CLUSTER_BYTES = 4096;

/** Walks a folder on disk and totals file sizes. Symlinks and junctions are skipped. */
async function measureFolder(
  dir: string
): Promise<{ bytes: number; onDisk: number; files: number; folders: number }> {
  let bytes = 0;
  let onDisk = 0;
  let files = 0;
  let folders = 0;
  const stack: string[] = [dir];
  while (stack.length > 0) {
    const cur = stack.pop() as string;
    try {
      const entries = await readdir(cur, { withFileTypes: true });
      await Promise.all(
        entries.map(async (e) => {
          const full = join(cur, e.name);
          if (e.isSymbolicLink()) return;
          if (e.isDirectory()) {
            folders++;
            stack.push(full);
            return;
          }
          try {
            const st = await lstat(full);
            if (!st.isFile()) return;
            files++;
            bytes += st.size;
            onDisk += Math.ceil(st.size / CLUSTER_BYTES) * CLUSTER_BYTES;
          } catch {
            // file vanished or is unreadable: skip it
          }
        })
      );
    } catch {
      // folder unreadable: skip it
    }
  }
  return { bytes, onDisk, files, folders };
}

export function registerFoldersIpc(): void {
  // A finished rescan means the disk may have changed: recount on the next tree load.
  scanner.on('scan-complete', (libraryId: string) => markCountsStale(libraryId));

  // Registered last on purpose: replaces any older listFolders handler.
  ipcMain.removeHandler(IPC.listFolders);
  ipcMain.handle(
    IPC.listFolders,
    async (_e, req: { libraryId: string }): Promise<FolderTreeNode | null> => {
      const libraryId = req.libraryId;
      const lib = getOpenLibrary(libraryId);
      if (!lib) return null;

      // Count the files in every folder in the background. This only reads folder
      // listings: no database writes, no thumbnails. Opening a folder is still what
      // indexes it and makes its thumbnails.
      ensureCounting(
        libraryId,
        lib.resolver.getMountPath(),
        () => scanner.emit('files-changed', libraryId),
        () => !!getOpenLibrary(libraryId)
      );

      const root: FolderTreeNode = {
        path: '',
        name: lib.entry.label,
        immediateFileCount: 0,
        recursiveFileCount: 0,
        children: []
      };
      const map = new Map<string, FolderTreeNode>([['', root]]);
      const ensure = (path: string): FolderTreeNode => {
        const hit = map.get(path);
        if (hit) return hit;
        const idx = path.lastIndexOf('/');
        const parent = ensure(idx < 0 ? '' : path.slice(0, idx));
        const node: FolderTreeNode = {
          path,
          name: path.slice(idx + 1),
          immediateFileCount: 0,
          recursiveFileCount: 0,
          children: []
        };
        parent.children.push(node);
        map.set(path, node);
        return node;
      };

      // Exact counts for folders that are already indexed (opened before).
      const dbCounts = new Map<string, number>();
      for (const f of lib.files.listFoldersWithCounts()) {
        dbCounts.set(f.parentDir, (dbCounts.get(f.parentDir) ?? 0) + f.fileCount);
        ensure(f.parentDir);
      }

      // Counts for every other folder, from the background count.
      const diskCounts = getFolderCounts(libraryId);
      if (diskCounts) {
        for (const dir of diskCounts.keys()) ensure(dir);
      }

      // Subfolders of the root and of every folder opened this session, read from disk
      // (so the tree has something to show before the background count has reached them).
      const dirs = ['', ...scanner.getOpenedFolders(libraryId).filter((d) => d !== '')];
      await Promise.all(
        dirs.map(async (d) => {
          const abs = d === '' ? lib.resolver.getMountPath() : lib.resolver.toAbsolute(d);
          try {
            const entries = await readdir(abs, { withFileTypes: true });
            for (const e of entries) {
              if (e.isDirectory() && !shouldSkipDir(e.name)) {
                ensure(d ? `${d}/${e.name}` : e.name);
              }
            }
          } catch {
            // folder gone or unreadable: show what we know
          }
        })
      );

      for (const [path, node] of map) {
        node.immediateFileCount = dbCounts.get(path) ?? diskCounts?.get(path) ?? 0;
      }

      const total = (n: FolderTreeNode): number => {
        n.children.sort((a, b) =>
          a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
        );
        n.recursiveFileCount =
          n.immediateFileCount + n.children.reduce((s, c) => s + total(c), 0);
        return n.recursiveFileCount;
      };
      total(root);
      return root;
    }
  );

  // Folder properties (Explorer style): read straight from the disk.
  ipcMain.removeHandler('folders:getInfo');
  ipcMain.handle(
    'folders:getInfo',
    async (_e, libraryId: string, folderPath: string): Promise<FolderInfoResult> => {
      const lib = getOpenLibrary(String(libraryId));
      if (!lib) return { ok: false, error: 'Library is not open' };
      try {
        const rel = String(folderPath ?? '');
        const abs = rel === '' ? lib.resolver.getMountPath() : lib.resolver.toAbsolute(rel);
        const st = await stat(abs);
        if (!st.isDirectory()) return { ok: false, error: 'Not a folder' };
        const m = await measureFolder(abs);
        return {
          ok: true,
          info: {
            absolutePath: abs,
            location: dirname(abs),
            sizeBytes: m.bytes,
            sizeOnDiskBytes: m.onDisk,
            fileCount: m.files,
            folderCount: m.folders,
            createdMs: st.birthtimeMs,
            modifiedMs: st.mtimeMs
          }
        };
      } catch (err) {
        return { ok: false, error: (err as Error).message };
      }
    }
  );

  // "Rescan folder" and the whole-library index. Path ''*'' = index every folder
  // (Show all / filters). Any other path = rescan just that folder.
  ipcMain.removeHandler(IPC.rescanFolder);
  ipcMain.handle(
    IPC.rescanFolder,
    async (_e, a: unknown, b?: unknown): Promise<{ ok: boolean; error?: string }> => {
      const req = (
        typeof a === 'object' && a !== null ? a : { libraryId: a, folderPath: b }
      ) as Record<string, unknown>;
      const libraryId = String(req.libraryId ?? '');
      const folderPath = String(
        req.folderPath ?? req.path ?? req.relDir ?? req.dir ?? req.relPath ?? ''
      );
      if (!getOpenLibrary(libraryId)) return { ok: false, error: 'Library is not open' };
      try {
        if (folderPath === '*' || folderPath.startsWith('*/')) {
          // '*' = whole library, '*/some/folder' = that folder and everything under it
          void scanner.indexAll(libraryId, folderPath === '*' ? '' : folderPath.slice(2));
          return { ok: true };
        }
        await scanner.rescanFolderNow(libraryId, folderPath);
        return { ok: true };
      } catch (err) {
        return { ok: false, error: (err as Error).message };
      }
    }
  );
}