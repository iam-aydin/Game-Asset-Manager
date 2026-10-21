import '@main/bootstrap';
import { app, BrowserWindow, ipcMain, Menu, screen, shell, type Rectangle } from 'electron';
import { release } from 'node:os';
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
// All animation timing, easing and mini-window sizing lives in transition.ts.
import { animateBounds, MINI_WINDOW } from '@shared/transition';

const isDev = !app.isPackaged;
const log = scopedLogger('app');

// Frosted-glass window: Windows 11 22H2+ (build 22621) can draw a system
// backdrop material behind the window. 'acrylic' blurs whatever is behind the
// window (other apps, desktop); 'mica' only tints with the wallpaper. Needs
// Electron 30+. On anything else (Windows 10, macOS, Linux) we keep the normal
// opaque window, so the app never ends up see-through without blur.
const GLASS_MATERIAL = 'acrylic' as const;
const SOLID_BACKGROUND = '#1a1b1e';

function supportsBackdropMaterial(): boolean {
  if (process.platform !== 'win32') return false;
  const build = Number(release().split('.')[2]);
  return Number.isFinite(build) && build >= 22621;
}

// Master switch. Leave OFF until the renderer paints translucent surfaces and
// the top bar is themed; with it on and an opaque page, only the native title
// bar picks up the blur and it looks broken.
const ENABLE_GLASS = false;
const glassEnabled = ENABLE_GLASS && supportsBackdropMaterial();

// Custom URL schemes must be registered as privileged BEFORE app is ready so
// the renderer's CSP recognizes wh3d-thumb: / wh3d-file: as image / fetch
// sources.
registerAssetSchemes();

// Lets Chromium publish the Media Session (title, play / pause, seek) to the
// Windows media panel in quick settings and to hardware media keys. Must be set
// before the app is ready.
app.commandLine.appendSwitch(
  'enable-features',
  'HardwareMediaKeyHandling,MediaSessionService'
);

interface SavedWindowState {
  bounds: Rectangle;
  wasMaximized: boolean;
  wasFullScreen: boolean;
  minSize: [number, number];
}

const savedWindowState = new WeakMap<BrowserWindow, SavedWindowState>();

const animating = new WeakSet<BrowserWindow>();

async function enterMiniMode(win: BrowserWindow): Promise<void> {
  if (savedWindowState.has(win) || animating.has(win)) return;
  animating.add(win);
  try {
    const state: SavedWindowState = {
      bounds: win.getNormalBounds(),
      wasMaximized: win.isMaximized(),
      wasFullScreen: win.isFullScreen(),
      minSize: win.getMinimumSize() as [number, number]
    };
    savedWindowState.set(win, state);

    if (state.wasFullScreen) win.setFullScreen(false);
    const startBounds = win.getBounds();
    if (win.isMaximized()) {
      win.unmaximize();
      win.setBounds(startBounds); // start the animation from the maximized size
    }

    win.setResizable(true);
    win.setMaximizable(false);
    win.setMinimumSize(320, 200);

    // Always on top is ON by default in mini mode (Ctrl+T toggles it).
    win.setAlwaysOnTop(true, 'screen-saver');
    if (process.platform === 'darwin') {
      win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    }

    const wa = screen.getDisplayMatching(state.bounds).workArea;
    await animateBounds(win, {
      x: wa.x + wa.width - MINI_WINDOW.width - MINI_WINDOW.margin,
      y: wa.y + wa.height - MINI_WINDOW.height - MINI_WINDOW.margin,
      width: MINI_WINDOW.width,
      height: MINI_WINDOW.height
    });
    if (!win.isDestroyed()) win.focus();
  } finally {
    animating.delete(win);
  }
}

async function exitMiniMode(win: BrowserWindow): Promise<void> {
  const state = savedWindowState.get(win);
  if (!state || animating.has(win)) return;
  animating.add(win);
  try {
    win.setAlwaysOnTop(false);
    if (process.platform === 'darwin') win.setVisibleOnAllWorkspaces(false);

    // Grow back to exactly the pre-mini size, discarding whatever the user
    // dragged the mini player to. Min size is restored AFTER growing, because
    // restoring it first would snap the small window up instantly.
    const target = state.wasMaximized
      ? screen.getDisplayMatching(win.getBounds()).workArea
      : state.bounds;
    await animateBounds(win, target);
    if (win.isDestroyed()) return;

    savedWindowState.delete(win);
    win.setMaximizable(true);
    win.setResizable(true);
    win.setMinimumSize(state.minSize[0], state.minSize[1]);

    if (state.wasMaximized) {
      win.setBounds(state.bounds); // so un-maximizing later returns to the right size
      win.maximize();
    } else {
      win.setBounds(state.bounds);
      // Windows can apply the first setBounds at the wrong DPI scale; repeat once.
      setImmediate(() => {
        if (!win.isDestroyed() && !win.isMaximized()) win.setBounds(state.bounds);
      });
    }
    if (state.wasFullScreen) win.setFullScreen(true);
    win.focus();
  } finally {
    animating.delete(win);
  }
}

function registerWindowIpc(): void {
  // Resolves when the animation has finished, so the renderer can sequence its layout swap.
  ipcMain.handle('window:setMiniMode', async (e, on: boolean) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (!win || win.isDestroyed()) return;
    if (on) await enterMiniMode(win);
    else await exitMiniMode(win);
  });

  ipcMain.handle('window:setMiniAlwaysOnTop', (e, on: boolean) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (!win || win.isDestroyed() || !savedWindowState.has(win)) return;
    win.setAlwaysOnTop(on, 'screen-saver');
  });
}

function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    show: false,
    // Glass: fully transparent window background so the system material shows
    // through wherever the page itself is translucent. Otherwise: solid.
    ...(glassEnabled
      ? { backgroundColor: '#00000000', backgroundMaterial: GLASS_MATERIAL }
      : { backgroundColor: SOLID_BACKGROUND }),
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
  log.info('window backdrop', { glass: glassEnabled, material: glassEnabled ? GLASS_MATERIAL : 'none' });
  win.webContents.on('did-start-navigation', (_e, _url, isInPlace, isMainFrame) => {
    if (isMainFrame && !isInPlace) void exitMiniMode(win);
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
  registerWindowIpc();
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