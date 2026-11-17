import type { FileRecord } from '@shared/types';

/** What is being dragged: files (from the grid) and/or folder paths (relative to the current library). */
export interface DragPayload {
  files: FileRecord[];
  folders: string[];
}

/** A drop target: a folder tile / tree row (path) and optionally another library (real container row). */
export interface DropTarget {
  path: string;
  libraryId: string | null;
}

const THRESHOLD_PX = 6;

let nativeArmed = false;

/**
 * After the pointer left the window, Windows runs the native file drag. While it runs,
 * the page gets HTML5 drag events if the pointer comes back, so folder tiles / tree rows
 * can still accept the drop. Disarms itself on drop or when normal mouse events resume.
 */
function armNativeReturn(payload: DragPayload, onDrop?: (t: DropTarget) => void): void {
  if (!onDrop || nativeArmed) return;
  nativeArmed = true;
  const armedAt = Date.now();
  let hover: HTMLElement | null = null;

  const clearHover = () => {
    if (hover) {
      hover.removeAttribute('data-drop-hover');
      hover = null;
    }
  };
  const find = (e: DragEvent): { el: HTMLElement; t: DropTarget } | null => {
    const el = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-drop-path]') as HTMLElement | null;
    if (!el) return null;
    const lib = el.getAttribute('data-drop-library');
    const t: DropTarget = { path: el.getAttribute('data-drop-path') ?? '', libraryId: lib ? lib : null };
    return isValidDrop(t, payload) ? { el, t } : null;
  };
  const disarm = () => {
    window.removeEventListener('dragenter', onOver, true);
    window.removeEventListener('dragover', onOver, true);
    window.removeEventListener('drop', onDropEv, true);
    window.removeEventListener('mousemove', onMouse, true);
    window.removeEventListener('mousedown', disarm, true);
    window.removeEventListener('keydown', disarm, true);
    clearHover();
    nativeArmed = false;
  };
  const onOver = (e: DragEvent) => {
    e.preventDefault();
    const hit = find(e);
    if (e.dataTransfer) e.dataTransfer.dropEffect = hit ? 'move' : 'none';
    if ((hit?.el ?? null) !== hover) {
      clearHover();
      if (hit) {
        hit.el.setAttribute('data-drop-hover', 'true');
        hover = hit.el;
      }
    }
  };
  const onDropEv = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const hit = find(e);
    disarm();
    if (hit) onDrop(hit.t);
  };
  // Mouse events only come back once the OS drag is over.
  const onMouse = (e: MouseEvent) => {
    if (Date.now() - armedAt > 400 && e.buttons === 0) disarm();
  };

  window.addEventListener('dragenter', onOver, true);
  window.addEventListener('dragover', onOver, true);
  window.addEventListener('drop', onDropEv, true);
  window.addEventListener('mousemove', onMouse, true);
  window.addEventListener('mousedown', disarm, true);
  window.addEventListener('keydown', disarm, true);
}

function parentOf(p: string): string {
  const i = p.lastIndexOf('/');
  return i < 0 ? '' : p.slice(0, i);
}

/** UI guard: no folder into itself or its own subfolder, and no drop that would change nothing. */
export function isValidDrop(t: DropTarget, p: DragPayload): boolean {
  if (p.files.length + p.folders.length === 0) return false;
  if (t.libraryId === null) {
    for (const f of p.folders) {
      if (t.path === f || t.path.startsWith(f + '/')) return false;
    }
    if (p.folders.every((f) => parentOf(f) === t.path) && p.files.every((f) => f.parentDir === t.path)) {
      return false;
    }
  }
  return true;
}

/**
 * Internal drag by pointer (no HTML5 drag, so it cannot clash with the native Windows drag).
 * - Moving the pointer a few pixels starts the drag; a small label follows the cursor.
 * - Elements with data-drop-path (and optional data-drop-library) are drop targets.
 * - Releasing over a valid target calls onDrop.
 * - Leaving the window calls onLeaveWindow (use it to start the native drag to Explorer).
 */
export function startPointerDrag(
  start: MouseEvent,
  payload: DragPayload,
  opts: { onDrop?: (t: DropTarget) => void; onLeaveWindow?: () => void }
): void {
  const sx = start.clientX;
  const sy = start.clientY;
  let dragging = false;
  let ghost: HTMLDivElement | null = null;
  let hover: HTMLElement | null = null;
  const prevUserSelect = document.body.style.userSelect;

  const clearHover = () => {
    if (hover) {
      hover.removeAttribute('data-drop-hover');
      hover = null;
    }
  };

  const targetAt = (x: number, y: number): { el: HTMLElement; t: DropTarget } | null => {
    if (!opts.onDrop) return null;
    const el = document.elementFromPoint(x, y)?.closest('[data-drop-path]') as HTMLElement | null;
    if (!el) return null;
    const lib = el.getAttribute('data-drop-library');
    const t: DropTarget = { path: el.getAttribute('data-drop-path') ?? '', libraryId: lib ? lib : null };
    return isValidDrop(t, payload) ? { el, t } : null;
  };

  const cleanup = () => {
    window.removeEventListener('mousemove', onMove, true);
    window.removeEventListener('mouseup', onUp, true);
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('blur', onBlur);
    clearHover();
    if (ghost) {
      ghost.remove();
      ghost = null;
    }
    document.body.style.userSelect = prevUserSelect;
  };

  const onMove = (e: MouseEvent) => {
    if (!dragging) {
      if (Math.hypot(e.clientX - sx, e.clientY - sy) < THRESHOLD_PX) return;
      dragging = true;
      document.body.style.userSelect = 'none';
      const n = payload.files.length + payload.folders.length;
      ghost = document.createElement('div');
      ghost.textContent = n === 1 ? '1 item' : n + ' items';
      Object.assign(ghost.style, {
        position: 'fixed',
        left: '0',
        top: '0',
        zIndex: '100000',
        pointerEvents: 'none',
        padding: '2px 8px',
        borderRadius: '999px',
        fontSize: '12px',
        color: '#fff',
        background: 'rgba(79, 70, 229, 0.85)',
        border: '1px solid rgba(255, 255, 255, 0.35)',
        boxShadow: '0 4px 14px rgba(0, 0, 0, 0.4)'
      });
      document.body.appendChild(ghost);
    }
    if (!(e.buttons & 1)) {
      cleanup();
      return;
    }
    // Pointer left the window: hand over to the native drag.
    if (e.clientX <= 0 || e.clientY <= 0 || e.clientX >= window.innerWidth - 1 || e.clientY >= window.innerHeight - 1) {
      // No native drag for this payload (folders): keep the internal drag alive outside the window.
      if (!opts.onLeaveWindow) return;
      cleanup();
      armNativeReturn(payload, opts.onDrop);
      opts.onLeaveWindow();
      return;
    }
    if (ghost) ghost.style.transform = 'translate(' + (e.clientX + 14) + 'px, ' + (e.clientY + 14) + 'px)';
    const hit = targetAt(e.clientX, e.clientY);
    if ((hit?.el ?? null) !== hover) {
      clearHover();
      if (hit) {
        hit.el.setAttribute('data-drop-hover', 'true');
        hover = hit.el;
      }
    }
  };

  const onUp = (e: MouseEvent) => {
    const was = dragging;
    const hit = was ? targetAt(e.clientX, e.clientY) : null;
    cleanup();
    if (!was) return;
    // The click that follows a drag must not change the selection.
    const stop = (ev: MouseEvent) => {
      ev.stopPropagation();
      ev.preventDefault();
    };
    window.addEventListener('click', stop, true);
    window.setTimeout(() => window.removeEventListener('click', stop, true), 0);
    if (hit) opts.onDrop?.(hit.t);
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') cleanup();
  };
  const onBlur = () => cleanup();

  window.addEventListener('mousemove', onMove, true);
  window.addEventListener('mouseup', onUp, true);
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('blur', onBlur);
}