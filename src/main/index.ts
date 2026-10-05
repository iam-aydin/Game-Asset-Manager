import { app, BrowserWindow, Menu, shell } from 'electron';
import { join } from 'node:path';
import { registerLibraryIpc } from '@main/ipc/libraries';
import { registerFilesIpc } from '@main/ipc/files';
import { registerTagsIpc } from '@main/ipc/tags';
import { registerCollectionsIpc } from '@main/ipc/collections';
import { registerPreferencesIpc } from '@main/ipc/preferences';
import { registerExportIpc } from '@main/ipc/export';
import * as manager from '@main/libraries/manager';
import {
  registerAssetProtocols,
  registerAssetSchemes
} from '@main/protocol/asset-protocols';
import { thumbPool } from '@main/thumb-pool/pool';
import { queueRunner } from '@main/thumb-pool/queue-runner';
import { DEFAULT_LOG_LEVEL, initLogger, scopedLogger, setLogLevel } from '@main/logger';
import { buildMenu, subscribeMenuToUndoQueue } from '@main/menu';
import * as prefsStore from '@main/preferences/store';
import { deliverPendingOnReady } from '@main/events';

const isDev = !app.isPackaged;
const log = scopedLogger('app');

// Custom URL schemes must be registered as privileged BEFORE app is ready so
// the renderer's CSP recognizes wh3d-thumb: / wh3d-file: as image / fetch
// sources.
registerAssetSchemes();

function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    show: false,
    backgroundColor: '#1a1b1e',
    title: 'Game Asset Manager',
    // No native File/Edit/View/Window/Help bar on Windows/Linux. macOS keeps
    // its menu because the system menu bar is part of the OS there.
    autoHideMenuBar: process.platform !== 'darwin',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  // Menu stays installed so accelerators (F11, Ctrl +/-, DevTools, undo...)
  // keep working. Only the visible bar is hidden.
  if (process.platform !== 'darwin') win.setMenuBarVisibility(false);

  win.once('ready-to-show', () => win.show());
  // Flush any library events that fired before the first window existed
  // (e.g. integrity-check failures during openAllFromRegistry).
  deliverPendingOnReady(win);

  // The hidden thumbnail-worker windows count as windows, so Electron's
  // 'window-all-closed' never fires while the pool is alive and the process
  // lingered in the background after the main window closed. Quit explicitly
  // when the main window goes away (macOS keeps its usual stay-alive behavior).
  win.on('closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  if (isDev && process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'));
  }

  return win;
}

void app.whenReady().then(() => {
  // Init the logger with the default level FIRST, then read prefs and adjust.
  // Reading prefs may itself want to log (corrupt file recovery), so the
  // logger must be ready to receive those entries with the right file path.
  initLogger(DEFAULT_LOG_LEVEL);
  const prefs = prefsStore.getAll();
  setLogLevel(prefs.logLevel ?? DEFAULT_LOG_LEVEL);
  log.info('app ready', { version: app.getVersion(), platform: process.platform, dev: isDev });

  Menu.setApplicationMenu(buildMenu());
  subscribeMenuToUndoQueue();
  registerAssetProtocols();
  registerLibraryIpc();
  registerFilesIpc();
  registerTagsIpc();
  registerCollectionsIpc();
  registerPreferencesIpc();
  registerExportIpc();
  // Best-effort restore of registered libraries; failures show as offline.
  // After each library opens its scanner kicks off a scan, and on completion
  // the queue runner reconciles thumbnails.
  const summaries = manager.openAllFromRegistry();
  log.info('opened libraries from registry', {
    total: summaries.length,
    online: summaries.filter((s) => s.online).length
  });
  // Also reconcile right away in case a library has no new scan to wait for
  // (already-indexed files just need their thumbnails re-checked).
  for (const s of summaries) {
    if (!s.online) continue;
    const lib = manager.getOpenLibrary(s.id);
    if (lib) queueRunner.reconcile(lib);
  }
  const win = createMainWindow();

  // Startup time: from process launch to the first window being ready to show.
  // process.uptime() is wall-clock seconds since this process started, which
  // captures module load + app.whenReady + library open all in one number.
  win.once('ready-to-show', () => {
    log.info('startup complete', { ms: Math.round(process.uptime() * 1000) });
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

// Safety net: also quit if every window (hidden ones included) is gone.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ─── Shutdown ──────────────────────────────────────────────────────────────

let shutdownStarted = false;

/** Runs one shutdown step; never throws and never waits longer than `ms`. */
function shutdownStep(label: string, ms: number, fn: () => unknown): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      log.warn('shutdown step timed out', { step: label, ms });
      resolve();
    }, ms);
    Promise.resolve()
      .then(fn)
      .then(
        () => {
          clearTimeout(timer);
          resolve();
        },
        (err) => {
          clearTimeout(timer);
          log.warn('shutdown step failed', { step: label, error: String(err) });
          resolve();
        }
      );
  });
}

async function gracefulShutdown(): Promise<void> {
  log.info('app shutting down');
  await shutdownStep('queueRunner', 2000, () => queueRunner.shutdown());
  await shutdownStep('thumbPool', 2000, () => thumbPool.shutdown());
  await shutdownStep('libraries', 2000, () => manager.shutdown());
  // Destroy anything still alive (leftover hidden windows included).
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.destroy();
  }
}

// Electron does not await async 'before-quit' handlers, so hold the quit,
// finish shutdown (bounded by timeouts), then hard-exit the process.
app.on('before-quit', (event) => {
  if (shutdownStarted) return;
  shutdownStarted = true;
  event.preventDefault();
  void gracefulShutdown().finally(() => app.exit(0));
});