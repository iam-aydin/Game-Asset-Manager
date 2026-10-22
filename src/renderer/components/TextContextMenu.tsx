import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CONTEXT_MENU_TRANSITION, contextMenuCss } from '@shared/transition';
import { GLASS_POPOVER_CLASS } from './Glasseffect';

interface TextContextMenuProps {
  /** Pointer position (clientX / clientY) of the right click. */
  x: number;
  y: number;
  /** True when some text is selected, so the Copy item can say so. */
  hasSelection: boolean;
  onCopy: () => void;
  onSelectAll: () => void;
  /** Called after the closing animation has finished. */
  onClose: () => void;
}

const EDGE = 8; // minimum gap to the window edge, px

/**
 * Right-click menu for the text preview: Copy (Ctrl + C) and Select all
 * (Ctrl + A). Glass look comes from glass-effect.tsx, the open / close
 * animation from transition.ts.
 */
export function TextContextMenu({
  x,
  y,
  hasSelection,
  onCopy,
  onSelectAll,
  onClose
}: TextContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y, originX: 'left', originY: 'top' });
  const [closing, setClosing] = useState(false);
  const closingRef = useRef(false);

  const requestClose = () => {
    if (closingRef.current) return;
    closingRef.current = true;
    setClosing(true);
    window.setTimeout(onClose, CONTEXT_MENU_TRANSITION.durationMs);
  };

  // Keep the menu inside the window: flip to the other side of the cursor
  // when there is no room, and grow from the corner nearest the cursor.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const flipX = x + width + EDGE > window.innerWidth;
    const flipY = y + height + EDGE > window.innerHeight;
    setPos({
      left: Math.max(EDGE, flipX ? x - width : x),
      top: Math.max(EDGE, flipY ? y - height : y),
      originX: flipX ? 'right' : 'left',
      originY: flipY ? 'bottom' : 'top'
    });
  }, [x, y]);

  // Close on outside click, Escape, scrolling, resizing or losing focus.
  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) requestClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') requestClose();
    };
    const close = () => requestClose();
    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('blur', close);
    window.addEventListener('resize', close);
    window.addEventListener('wheel', close, { passive: true });
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('blur', close);
      window.removeEventListener('resize', close);
      window.removeEventListener('wheel', close);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const run = (fn: () => void) => () => {
    fn();
    requestClose();
  };

  return createPortal(
    <>
      <style>{contextMenuCss()}</style>
      <div
        ref={ref}
        role="menu"
        className={`${GLASS_POPOVER_CLASS} gam-ctx-menu`}
        data-state={closing ? 'closing' : 'open'}
        // Keep the text selection alive while the menu is clicked.
        onMouseDown={(e) => e.preventDefault()}
        onContextMenu={(e) => e.preventDefault()}
        style={{
          position: 'fixed',
          left: pos.left,
          top: pos.top,
          zIndex: 100001,
          transformOrigin: `${pos.originY} ${pos.originX}`
        }}
      >
        <div role="menuitem" tabIndex={0} className="gam-ctx-item" onClick={run(onCopy)}>
          <span className="gam-ctx-label">{hasSelection ? 'Copy' : 'Copy all'}</span>
          <span className="gam-ctx-hint">Ctrl + C</span>
        </div>
        <div role="menuitem" tabIndex={0} className="gam-ctx-item" onClick={run(onSelectAll)}>
          <span className="gam-ctx-label">Select all</span>
          <span className="gam-ctx-hint">Ctrl + A</span>
        </div>
      </div>
    </>,
    document.body
  );
}
