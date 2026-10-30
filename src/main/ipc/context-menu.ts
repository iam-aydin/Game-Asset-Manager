import { app, BrowserWindow, ipcMain, screen } from 'electron';
import { join } from 'node:path';

// The mini player is smaller than its right-click menu, so in mini mode the menu lives in its
// own frameless, transparent window that may extend past the mini window and the screen edge.
// The window is big on purpose (room for the list + a flyout on either side); the menu itself
// is drawn at the cursor inside it and everything else stays transparent.
const MENU_W = 1100;
const MENU_H = 800;

let menuWin: BrowserWindow | null = null;
let owner: Electron.WebContents | null = null;
let pending: { x: number; y: number; state: unknown } | null = null;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

function closeMenu(): void {
  const w = menuWin;
  menuWin = null;
  pending = null;
  if (!w || w.isDestroyed()) return;
  // Closed from the menu itself (pick / Esc): give focus back to the player.
  // Closed because the user clicked elsewhere: the menu is not focused any more, leave focus alone.
  const wasFocused = w.isFocused();
  w.destroy();
  if (wasFocused && owner && !owner.isDestroyed()) {
    const ow = BrowserWindow.fromWebContents(owner);
    if (ow && !ow.isDestroyed()) ow.focus();
  }
}

export function registerContextMenuIpc(): void {
  ipcMain.handle('ctxmenu:open', (e, req: { x: number; y: number; state: unknown }) => {
    closeMenu();
    owner = e.sender;
    const wa = screen.getDisplayNearestPoint({ x: Math.round(req.x), y: Math.round(req.y) }).workArea;
    const w = Math.min(MENU_W, wa.width);
    const h = Math.min(MENU_H, wa.height);
    const bx = clamp(Math.round(req.x - w / 2), wa.x, wa.x + wa.width - w);
    const by = clamp(Math.round(req.y - 120), wa.y, wa.y + wa.height - h);
    pending = { x: req.x - bx, y: req.y - by, state: req.state };

    const win = new BrowserWindow({
      x: bx,
      y: by,
      width: w,
      height: h,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      hasShadow: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      show: false,
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false
      }
    });
    menuWin = win;
    win.setAlwaysOnTop(true, 'screen-saver');
    win.setBounds({ x: bx, y: by, width: w, height: h }); // Windows can apply the first bounds at the wrong DPI scale
    win.on('blur', () => {
      if (menuWin === win) setImmediate(closeMenu);
    });
    win.on('closed', () => {
      if (menuWin === win) menuWin = null;
    });
    // Safety net: show even if the renderer never reports ready.
    setTimeout(() => {
      if (menuWin === win && !win.isDestroyed() && !win.isVisible()) {
        win.show();
        win.focus();
      }
    }, 1500);

    if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
      void win.loadURL(`${process.env.ELECTRON_RENDERER_URL}#ctx-menu`);
    } else {
      void win.loadFile(join(__dirname, '../renderer/index.html'), { hash: 'ctx-menu' });
    }
  });

  ipcMain.handle('ctxmenu:getInit', (e) => {
    if (!menuWin || menuWin.isDestroyed() || e.sender !== menuWin.webContents) return null;
    return pending;
  });

  ipcMain.handle('ctxmenu:ready', (e) => {
    if (!menuWin || menuWin.isDestroyed() || e.sender !== menuWin.webContents) return;
    menuWin.show();
    menuWin.focus();
  });

  ipcMain.on('ctxmenu:action', (e, action: unknown) => {
    if (!menuWin || menuWin.isDestroyed() || e.sender !== menuWin.webContents) return;
    if (owner && !owner.isDestroyed()) owner.send('ctxmenu:action', action);
  });

  ipcMain.on('ctxmenu:close', (e) => {
    if (!menuWin || menuWin.isDestroyed() || e.sender !== menuWin.webContents) return;
    closeMenu();
  });
}