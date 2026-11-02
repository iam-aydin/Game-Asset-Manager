import { BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { IPC } from '@shared/ipc-channels';
import type {
  AddLibraryRequest,
  AddLibraryResult,
  LibrarySummary,
  PickFolderResult,
  RemoveLibraryRequest,
  RemoveLibraryResult,
  RenameLibraryRequest,
  RenameLibraryResult,
  RevealLibraryResult
} from '@shared/types';
import * as manager from '@main/libraries/manager';

export function registerLibraryIpc(): void {
  ipcMain.handle(IPC.pickFolder, async (event): Promise<PickFolderResult> => {
    const senderWindow = BrowserWindow.fromWebContents(event.sender);
    const opts: Electron.OpenDialogOptions = {
      title: 'Select library folder',
      properties: ['openDirectory', 'createDirectory']
    };
    const result = senderWindow
      ? await dialog.showOpenDialog(senderWindow, opts)
      : await dialog.showOpenDialog(opts);
    if (result.canceled || result.filePaths.length === 0) {
      return { canceled: true };
    }
    return { canceled: false, path: result.filePaths[0] };
  });

  ipcMain.handle(IPC.listLibraries, async (): Promise<LibrarySummary[]> => {
    return manager.listLibraries();
  });

  ipcMain.handle(IPC.addLibrary, async (_e, req: AddLibraryRequest): Promise<AddLibraryResult> => {
    return manager.addLibrary(req);
  });

  ipcMain.handle(IPC.removeLibrary, async (_e, req: RemoveLibraryRequest): Promise<RemoveLibraryResult> => {
    return manager.removeLibrary(req);
  });

  ipcMain.handle(IPC.renameLibrary, async (_e, req: RenameLibraryRequest): Promise<RenameLibraryResult> => {
    return manager.renameLibrary(req);
  });

  ipcMain.handle(IPC.reloadLibrary, async (_e, id: string) => manager.reloadLibrary(id));

  // Asks for the new folder, then points the library at it.
  ipcMain.handle(IPC.setLibraryPath, async (event, id: string) => {
    const entry = manager.listLibraries().find((l) => l.id === id);
    if (!entry) return { ok: false as const, error: 'Library not found' };
    const senderWindow = BrowserWindow.fromWebContents(event.sender);
    // Start the picker at the closest folder of the old path that still exists.
    let start = entry.mountPath;
    while (start && !existsSync(start)) {
      const up = dirname(start);
      if (up === start) break;
      start = up;
    }
    const opts: Electron.OpenDialogOptions = {
      title: `Where is "${entry.name}" now?`,
      defaultPath: start,
      buttonLabel: 'Use this folder',
      properties: ['openDirectory']
    };
    const result = senderWindow
      ? await dialog.showOpenDialog(senderWindow, opts)
      : await dialog.showOpenDialog(opts);
    if (result.canceled || result.filePaths.length === 0) {
      return { ok: true as const, canceled: true as const };
    }
    const r = manager.setLibraryPath({ id, mountPath: result.filePaths[0] });
    return r.ok ? { ok: true as const, canceled: false as const, library: r.library } : r;
  });

  ipcMain.handle(IPC.revealLibrary, async (_e, id: string): Promise<RevealLibraryResult> => {
    const entry = manager.listLibraries().find((l) => l.id === id);
    if (!entry) return { ok: false, error: 'Library not found' };
    if (!existsSync(entry.mountPath)) {
      return { ok: false, error: `Mount path not found: ${entry.mountPath}` };
    }
    // openPath opens the folder itself; showItemInFolder would highlight the
    // folder in its parent, which is less useful for a library root.
    const err = await shell.openPath(entry.mountPath);
    if (err) return { ok: false, error: err };
    return { ok: true };
  });
}
