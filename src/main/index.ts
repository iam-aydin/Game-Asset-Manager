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
import { registerFoldersIpc } from '@main/ipc/folders';
import { registerSubtitlesIpc } from '@main/ipc/subtitles';
import { registerVideoFallbackIpc } from '@main/ipc/video-fallback';
import { registerContextMenuIpc } from '@main/ipc/context-menu';
import { registerToolsIpc } from '@main/ipc/tools';
import { registerDataTransferIpc } from '@main/ipc/data-transfer';
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
// Windows treats a window as "hidden" when another window covers part of it, and
// Chromium then stops drawing its video. The mini player's right-click menu is
// such a window, so turn that check off.
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
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

// The one real app window (hidden thumbnail-worker windows are not this).
let mainWindow: BrowserWindow | null = null;

// --- Smooth fullscreen (Alt+F) ---------------------------------------------
// The window itself grows to the display size, and real fullscreen is switched
// on at the very end (the window already covers the screen, so nothing visibly
// changes). Leaving plays it in reverse.
interface SmoothFsState {
  bounds: Rectangle;
  wasMaximized: boolean;
}
const smoothFullscreenState = new WeakMap<BrowserWindow, SmoothFsState>();
const SMOOTH_FS_MS = 320; // keep equal to WINDOW_MS in useSmoothFullscreen.ts

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Waits (max 2 s) until no other window animation (or the mini player) is active. */
async function waitUntilIdle(win: BrowserWindow, alsoMini: boolean): Promise<void> {
  const t0 = Date.now();
  while (
    !win.isDestroyed() &&
    (animating.has(win) || (alsoMini && savedWindowState.has(win))) &&
    Date.now() - t0 < 2000
  ) {
    await sleep(30);
  }
}

async function enterSmoothFullscreen(win: BrowserWindow): Promise<void> {
  await waitUntilIdle(win, true);
  if (win.isDestroyed() || savedWindowState.has(win) || win.isFullScreen()) return;
  smoothFullscreenState.delete(win); // stale state from a fullscreen left with F11
  animating.add(win);
  try {
    smoothFullscreenState.set(win, {
      bounds: win.getNormalBounds(),
      wasMaximized: win.isMaximized()
    });
    const startBounds = win.getBounds();
    if (win.isMaximized()) {
      win.unmaximize();
      win.setBounds(startBounds); // start the animation from the maximized size
    }
    const target = screen.getDisplayMatching(startBounds).bounds;
    await animateBounds(win, target, SMOOTH_FS_MS);
    if (win.isDestroyed()) return;
    win.setFullScreen(true);
  } finally {
    animating.delete(win);
  }
}

async function exitSmoothFullscreen(win: BrowserWindow): Promise<void> {
  if (!smoothFullscreenState.has(win)) {
    // Fullscreen came from somewhere else (F11): just leave it.
    if (!win.isDestroyed() && win.isFullScreen() && !savedWindowState.has(win)) {
      win.setFullScreen(false);
    }
    return;
  }
  await waitUntilIdle(win, false);
  const state = smoothFullscreenState.get(win);
  if (win.isDestroyed() || !state) return;
  smoothFullscreenState.delete(win);
  if (!win.isFullScreen()) return; // already left (F11 or the mini player)
  animating.add(win);
  try {
    win.setFullScreen(false);
    const target = state.wasMaximized
      ? screen.getDisplayMatching(win.getBounds()).workArea
      : state.bounds;
    await animateBounds(win, target, SMOOTH_FS_MS);
    if (win.isDestroyed()) return;
    win.setBounds(state.bounds);
    if (state.wasMaximized) {
      win.maximize();
    } else {
      // Windows can apply the first setBounds at the wrong DPI scale; repeat once.
      setImmediate(() => {
        if (!win.isDestroyed() && !win.isMaximized()) win.setBounds(state.bounds);
      });
    }
  } finally {
    animating.delete(win);
  }
}

// Ctrl + drag in the mini player: the window follows the cursor. Done in the main
// process (polling the cursor) so it stays smooth, keeps the exact size on
// high-DPI screens and keeps working if the cursor outruns the window.
const miniDragTimers = new WeakMap<BrowserWindow, ReturnType<typeof setInterval>>();

function stopMiniDrag(win: BrowserWindow): void {
  const t = miniDragTimers.get(win);
  if (t) clearInterval(t);
  miniDragTimers.delete(win);
}

function startMiniDrag(win: BrowserWindow): void {
  if (win.isDestroyed() || !savedWindowState.has(win) || animating.has(win)) return;
  stopMiniDrag(win);
  const start = screen.getCursorScreenPoint();
  const b = win.getBounds();
  let lastX = b.x;
  let lastY = b.y;
  miniDragTimers.set(
    win,
    setInterval(() => {
      if (win.isDestroyed()) return stopMiniDrag(win);
      const p = screen.getCursorScreenPoint();
      const x = b.x + p.x - start.x;
      const y = b.y + p.y - start.y;
      if (x === lastX && y === lastY) return;
      lastX = x;
      lastY = y;
      win.setBounds({ x, y, width: b.width, height: b.height });
    }, 8)
  );
}

async function enterMiniMode(win: BrowserWindow): Promise<void> {
  if (savedWindowState.has(win) || animating.has(win)) return;
  animating.add(win);
  try {
    // Coming from Alt+F fullscreen: the mini player returns to the normal window afterwards.
    const sf = smoothFullscreenState.get(win);
    smoothFullscreenState.delete(win);
    const state: SavedWindowState = {
      bounds: sf ? sf.bounds : win.getNormalBounds(),
      wasMaximized: sf ? sf.wasMaximized : win.isMaximized(),
      wasFullScreen: sf ? false : win.isFullScreen(),
      minSize: win.getMinimumSize() as [number, number]
    };
    savedWindowState.set(win, state);

    if (win.isFullScreen()) win.setFullScreen(false);
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
  stopMiniDrag(win);
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
  // Ctrl + drag in the mini player (see startMiniDrag).
  ipcMain.on('window:miniDragStart', (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (win) startMiniDrag(win);
  });
  ipcMain.on('window:miniDragStop', (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (win) stopMiniDrag(win);
  });
  // Alt+F: window grows to / shrinks from real fullscreen. Resolves when done.
  ipcMain.handle('window:setSmoothFullscreen', async (e, on: boolean) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (!win || win.isDestroyed()) return;
    if (on) await enterSmoothFullscreen(win);
    else await exitSmoothFullscreen(win);
  });
  // Resolves when the animation has finished, so the renderer can sequence its layout swap.
  ipcMain.handle('window:setMiniMode', async (e, on: boolean) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (!win || win.isDestroyed()) return;
    if (on) await enterMiniMode(win);
    else await exitMiniMode(win);
  });

  // Window buttons follow the app theme (called from the renderer on theme change).
  ipcMain.handle(
    'window:setTitleBarTheme',
    (e, theme: { color: string; symbolColor: string }) => {
      const win = BrowserWindow.fromWebContents(e.sender);
      if (!win || win.isDestroyed() || process.platform === 'darwin') return;
      try {
        win.setTitleBarOverlay({ color: theme.color, symbolColor: theme.symbolColor, height: 43 });
      } catch {
        // window has no overlay (e.g. mini mode); ignore
      }
    }
  );

  ipcMain.handle('window:setMiniAlwaysOnTop', (e, on: boolean) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (!win || win.isDestroyed() || !savedWindowState.has(win)) return;
    win.setAlwaysOnTop(on, 'screen-saver');
  });
}

/** If the window is completely off every screen (unplugged monitor, bad saved position), center it. */
function ensureOnScreen(win: BrowserWindow): void {
  try {
    const b = win.getBounds();
    const visible = screen.getAllDisplays().some((d) => {
      const a = d.workArea;
      return b.x < a.x + a.width && b.x + b.width > a.x && b.y < a.y + a.height && b.y + b.height > a.y;
    });
    if (!visible) win.center();
  } catch {
    // cosmetic only
  }
}

/** Makes the main window visible and focused, whatever state it is in. */
function revealWindow(win: BrowserWindow, reason: string): void {
  if (win.isDestroyed()) return;
  try {
    ensureOnScreen(win);
    if (win.isMinimized()) win.restore();
    if (!win.isVisible()) win.show();
    win.focus();
    log.info('main window shown', { reason, ms: Math.round(process.uptime() * 1000) });
  } catch (err) {
    log.warn('main window show failed', { reason, error: String(err) });
  }
}

function createMainWindow(): BrowserWindow {
  log.info('creating main window', { ms: Math.round(process.uptime() * 1000) });
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
    // Hidden title bar: Windows draws only its minimize/maximize/close buttons,
    // on top of our own top bar. Colors follow the theme (see window:setTitleBarTheme).
    ...(process.platform !== 'darwin'
      ? {
          titleBarStyle: 'hidden' as const,
          titleBarOverlay: { color: SOLID_BACKGROUND, symbolColor: '#ececee', height: 43 }
        }
      : {}),
    // No native File/Edit/View/Window/Help bar on Windows/Linux. macOS keeps
    // its menu because the system menu bar is part of the OS there.
    autoHideMenuBar: process.platform !== 'darwin',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      sandbox: false
    }
  });
  mainWindow = win;
  log.info('window backdrop', { glass: glassEnabled, material: glassEnabled ? GLASS_MATERIAL : 'none' });
  win.webContents.on('did-start-navigation', (_e, _url, isInPlace, isMainFrame) => {
    if (isMainFrame && !isInPlace) void exitMiniMode(win);
  });

  // Menu stays installed so accelerators (F11, Ctrl +/-, DevTools, undo...)
  // keep working. Only the visible bar is hidden.
  if (process.platform !== 'darwin') win.setMenuBarVisibility(false);

  // The window MUST become visible. 'ready-to-show' is the normal trigger, but
  // it can fail to fire on a cold start, which left a hidden window forever.
  // So three triggers race and the first one wins:
  //   1. ready-to-show      (normal)
  //   2. did-finish-load    (+0.5 s, gives ready-to-show a chance first)
  //   3. a 4 s timer        (last resort, always fires)
  let revealed = false;
  let fallbackTimer: ReturnType<typeof setTimeout> | undefined;
  const revealOnce = (reason: string): void => {
    if (revealed || win.isDestroyed()) return;
    revealed = true;
    if (fallbackTimer) clearTimeout(fallbackTimer);
    revealWindow(win, reason);
  };
  win.once('ready-to-show', () => revealOnce('ready-to-show'));
  win.webContents.once('did-finish-load', () => {
    setTimeout(() => revealOnce('did-finish-load'), 500);
  });
  win.webContents.on('did-fail-load', (_e, code, description, url, isMainFrame) => {
    if (!isMainFrame) return;
    log.warn('main window failed to load', { code, description, url });
    revealOnce('did-fail-load');
  });
  win.webContents.on('render-process-gone', (_e, details) => {
    log.warn('main window renderer gone', { reason: details.reason, exitCode: details.exitCode });
    revealOnce('render-process-gone');
  });
  fallbackTimer = setTimeout(() => revealOnce('fallback-timer'), 4000);

  // Flush any library events that fired before the first window existed
  // (e.g. integrity-check failures during openAllFromRegistry).
  deliverPendingOnReady(win);

  // The hidden thumbnail-worker windows count as windows, so Electron's
  // 'window-all-closed' never fires while the pool is alive and the process
  // lingered in the background after the main window closed. Quit explicitly
  // when the main window goes away (macOS keeps its usual stay-alive behavior).
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null;
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

// Only one copy of the app may run. A second launch brings the open window to
// the front, even if that window is hidden (the old code skipped hidden ones).
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.exit(0);
}
app.on('second-instance', () => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  revealWindow(mainWindow, 'second-instance');
});

/** Runs one startup step; a failure is logged but never stops the window from opening. */
function safeStep(label: string, fn: () => void): void {
  try {
    fn();
  } catch (err) {
    log.warn('startup step failed', { step: label, error: String(err) });
  }
}

void app.whenReady().then(() => {
  if (!gotLock) return;
  // Init the logger with the default level FIRST, then read prefs and adjust.
  // Reading prefs may itself want to log (corrupt file recovery), so the
  // logger must be ready to receive those entries with the right file path.
  initLogger(DEFAULT_LOG_LEVEL);
  safeStep('log level', () => {
    const prefs = prefsStore.getAll();
    setLogLevel(prefs.logLevel ?? DEFAULT_LOG_LEVEL);
  });
  log.info('app ready', { version: app.getVersion(), platform: process.platform, dev: isDev });

  safeStep('menu', () => {
    Menu.setApplicationMenu(buildMenu());
    subscribeMenuToUndoQueue();
  });
  safeStep('asset protocols', registerAssetProtocols);
  safeStep('ipc libraries', registerLibraryIpc);
  safeStep('ipc files', registerFilesIpc);
  safeStep('ipc tags', registerTagsIpc);
  safeStep('ipc collections', registerCollectionsIpc);
  safeStep('ipc preferences', registerPreferencesIpc);
  safeStep('ipc export', registerExportIpc);
  safeStep('ipc data-transfer', registerDataTransferIpc);
  safeStep('ipc window', registerWindowIpc);
  safeStep('ipc folders', registerFoldersIpc);
  safeStep('ipc subtitles', registerSubtitlesIpc);
  safeStep('ipc video-fallback', registerVideoFallbackIpc);
  safeStep('ipc context-menu', registerContextMenuIpc);
  safeStep('ipc tools', registerToolsIpc);
  // Best-effort restore of registered libraries; failures show as offline.
  // After each library opens its scanner kicks off a scan, and on completion
  // the queue runner reconciles thumbnails.
  safeStep('open libraries', () => {
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
  });
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

// --- Shutdown --------------------------------------------------------------

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