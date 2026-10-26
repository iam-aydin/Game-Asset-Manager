import { ipcMain } from 'electron';
import { IPC } from '@shared/ipc-channels';
import type { CollectionRecord, CollectionWithCount, ContainerItem } from '@shared/types';
import { getOpenLibrary, listLibraries } from '@main/libraries/manager';
import { isSmartQuery } from '@shared/smart-query';
import { broadcastLibraryEvent as broadcast } from '@main/events';
import * as store from '@main/containers/store';

function toRecord(c: store.StoredContainer): CollectionWithCount {
  return {
    id: c.id,
    name: c.name,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    smartQuery: null,
    fileCount: c.items.length
  };
}

/** One-time import of a library's old per-library (manual) collections into the global store. */
function migrateLibrary(libraryId: string): void {
  if (store.isMigrated(libraryId)) return;
  const lib = getOpenLibrary(libraryId);
  if (!lib) return;
  try {
    for (const c of lib.collections.list()) {
      if (c.smartQuery != null) continue;
      const items: { libraryId: string; relPath: string }[] = [];
      for (const fid of lib.collections.listFileIds(c.id)) {
        const f = lib.files.getById(fid);
        if (f) items.push({ libraryId, relPath: f.relPath });
      }
      const target = store.findByName(c.name) ?? store.create(c.name);
      store.addItems(target.id, items);
    }
    store.markMigrated(libraryId);
  } catch {
    // retried on the next list call
  }
}

export function registerCollectionsIpc(): void {
  ipcMain.handle(
    IPC.listCollections,
    async (_e, _libraryId: string): Promise<CollectionWithCount[]> => {
      for (const l of listLibraries()) migrateLibrary(l.id);
      return store.list().map(toRecord);
    }
  );

  ipcMain.handle(
    IPC.createCollection,
    async (_e, libraryId: string, name: string): Promise<CollectionRecord> => {
      const created = store.create(name);
      broadcast({ kind: 'collections-changed', libraryId, collectionId: created.id });
      return toRecord(created);
    }
  );

  ipcMain.handle(
    IPC.renameCollection,
    async (_e, libraryId: string, id: number, name: string): Promise<CollectionRecord | null> => {
      const renamed = store.rename(id, name);
      if (renamed) broadcast({ kind: 'collections-changed', libraryId, collectionId: id });
      return renamed ? toRecord(renamed) : null;
    }
  );

  ipcMain.handle(
    IPC.deleteCollection,
    async (_e, libraryId: string, id: number): Promise<void> => {
      store.remove(id);
      broadcast({ kind: 'collections-changed', libraryId, collectionId: id });
    }
  );

  ipcMain.handle(
    IPC.addFilesToCollection,
    async (_e, libraryId: string, collectionId: number, fileIds: number[]): Promise<void> => {
      const lib = getOpenLibrary(libraryId);
      if (!lib) return;
      const items: { libraryId: string; relPath: string }[] = [];
      for (const fid of fileIds) {
        const f = lib.files.getById(fid);
        if (f) items.push({ libraryId, relPath: f.relPath });
      }
      store.addItems(collectionId, items);
      broadcast({ kind: 'collections-changed', libraryId, collectionId });
    }
  );

  ipcMain.handle(
    IPC.removeFilesFromCollection,
    async (_e, libraryId: string, collectionId: number, fileIds: number[]): Promise<void> => {
      const lib = getOpenLibrary(libraryId);
      if (!lib) return;
      const items: { libraryId: string; relPath: string }[] = [];
      for (const fid of fileIds) {
        const f = lib.files.getById(fid);
        if (f) items.push({ libraryId, relPath: f.relPath });
      }
      store.removeItems(collectionId, items);
      broadcast({ kind: 'collections-changed', libraryId, collectionId });
    }
  );

  ipcMain.handle(
    IPC.listContainerItems,
    async (_e, collectionId: number): Promise<ContainerItem[]> => {
      const c = store.get(collectionId);
      if (!c) return [];
      const libs = listLibraries();
      const out: ContainerItem[] = [];
      for (const it of c.items) {
        const meta = libs.find((l) => l.id === it.libraryId);
        if (!meta) continue;
        let fileId: number | null = null;
        const lib = getOpenLibrary(it.libraryId);
        if (lib) {
          const f = lib.files.getByRelPath(it.relPath);
          if (!f) continue;
          fileId = f.id;
        }
        out.push({
          libraryId: it.libraryId,
          libraryName: meta.name,
          relPath: it.relPath,
          filename: it.relPath.split('/').pop() ?? it.relPath,
          fileId
        });
      }
      return out;
    }
  );

  ipcMain.handle(
    IPC.createSmartCollection,
    async (_e, libraryId: string, name: string, query: unknown): Promise<CollectionRecord> => {
      const lib = getOpenLibrary(libraryId);
      if (!lib) throw new Error(`Library ${libraryId} not open`);
      const validated = isSmartQuery(query) ? query : {};
      const created = lib.collections.createSmart(name, validated);
      broadcast({ kind: 'collections-changed', libraryId, collectionId: created.id });
      return created;
    }
  );

  ipcMain.handle(
    IPC.updateSmartQuery,
    async (_e, libraryId: string, id: number, query: unknown): Promise<CollectionRecord | null> => {
      const lib = getOpenLibrary(libraryId);
      if (!lib) return null;
      const validated = isSmartQuery(query) ? query : {};
      const updated = lib.collections.updateSmartQuery(id, validated);
      if (updated) broadcast({ kind: 'collections-changed', libraryId, collectionId: id });
      return updated;
    }
  );
}