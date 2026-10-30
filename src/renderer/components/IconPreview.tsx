import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Center, Loader, Stack, Text } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import type { FileRecord } from '@shared/types';
import { ipc } from '../ipc-client';
import { formatBytes } from '../util/format';
import { decodeIcoEntry, loadIco, type IcoEntry } from '../util/ico';
import { VIEW_ZOOM_STEP, useSmoothView, wheelZoomFactor } from '../util/smooth-zoom';
import { ImagePreview, encodeAs, toBlob, type OutFmt } from './ImagePreview';
import { PlayerContextMenu, type CtxSection } from './PlayerContextMenu';
import { PlayerGlassStyles } from './PlayerGlass';
import { ZoomControl } from './ZoomControl';

/**
 * Viewer for .ico files.
 *
 * - The overview shows every image stored in the icon side by side on one
 *   baseline, with the real pixel size under each, crisp pixel scaling and a
 *   checkerboard behind the transparency.
 * - Click a size to enlarge it. The enlarged view IS the normal image viewer
 *   (ImagePreview), so zoom, crop, effects, rotate, resize, copy and the whole
 *   right-click menu work on that size.
 * - Right-click a size in the overview: it opens enlarged with that menu.
 *   Right-click empty space: a short menu (save / copy / show in folder / pick a size).
 */

interface Props {
  libraryId: string;
  file: FileRecord;
}

interface Decoded {
  entry: IcoEntry;
  data: ImageData | null;
  error?: string;
}

const GAP = 22; // px between icons in the row (not zoomed)
const LABEL_H = 38; // room for the labels under the icons
const MAX_BASE = 32; // largest automatic whole-number scale
const CLICK_SLOP = 4;

const CHECKER: React.CSSProperties = {
  backgroundColor: 'rgba(255, 255, 255, 0.55)',
  backgroundImage:
    'conic-gradient(rgba(128,128,128,0.45) 25%, transparent 0 50%, rgba(128,128,128,0.45) 0 75%, transparent 0)',
  backgroundSize: '16px 16px'
};

function canvasFromData(d: ImageData): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = d.width;
  c.height = d.height;
  c.getContext('2d')?.putImageData(d, 0, 0);
  return c;
}

function IcoCanvas({
  decoded,
  index,
  cssW,
  cssH,
  onActivate
}: {
  decoded: Decoded;
  index: number;
  cssW: number;
  cssH: number;
  onActivate: () => void;
}) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const { data } = decoded;

  useEffect(() => {
    const c = ref.current;
    if (!c || !data) return;
    c.width = data.width;
    c.height = data.height;
    c.getContext('2d')?.putImageData(data, 0, 0);
  }, [data]);

  const box: React.CSSProperties = {
    width: cssW,
    height: cssH,
    ...CHECKER,
    outline: '1px solid rgba(128,128,128,0.35)',
    outlineOffset: 2,
    cursor: 'pointer',
    display: 'block',
    flexShrink: 0
  };

  if (!data) {
    return (
      <div
        data-idx={index}
        onClick={onActivate}
        title={decoded.error}
        style={{ ...box, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      >
        <Text size="xs" c="red">
          ?
        </Text>
      </div>
    );
  }
  return (
    <canvas
      ref={ref}
      data-idx={index}
      onClick={onActivate}
      style={{ ...box, imageRendering: 'pixelated' }}
      aria-label={`${data.width} by ${data.height} pixels`}
    />
  );
}

export function IconPreview({ libraryId, file }: Props) {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [items, setItems] = useState<Decoded[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [stage, setStage] = useState({ w: 0, h: 0 });
  const [dragging, setDragging] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [pendingMenu, setPendingMenu] = useState<{ x: number; y: number } | null>(null);
  // The PNG url is stored together with the ImageData it was made from, so a stale url
  // from the previously enlarged size is never shown.
  const [sel, setSel] = useState<{ data: ImageData; url: string } | null>(null);

  const { view, setView, zoomBy, reset } = useSmoothView();
  const viewRef = useRef(view);
  viewRef.current = view;
  const movedRef = useRef(false);

  const base = file.filename.replace(/\.[^.]+$/, '');

  // ---- Load + decode ----
  useEffect(() => {
    let dead = false;
    setItems(null);
    setError(null);
    setSelected(null);
    setMenu(null);
    setView({ zoom: 1, x: 0, y: 0 });
    loadIco(libraryId, file)
      .then(async ({ buf, entries }) => {
        const sorted = [...entries].sort(
          (a, b) => a.width * a.height - b.width * b.height || a.bitCount - b.bitCount
        );
        const out: Decoded[] = [];
        for (const entry of sorted) {
          try {
            out.push({ entry, data: await decodeIcoEntry(buf, entry) });
          } catch (e) {
            out.push({ entry, data: null, error: (e as Error).message });
          }
        }
        if (!dead) setItems(out);
      })
      .catch((e: unknown) => {
        if (!dead) setError((e as Error).message ?? String(e));
      });
    return () => {
      dead = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [libraryId, file.id, file.mtimeMs]);

  // ---- The enlarged size as a PNG url (feeds the normal image viewer) ----
  const selData = selected !== null ? items?.[selected]?.data ?? null : null;
  useEffect(() => {
    setSel(null);
    if (!selData) return undefined;
    let dead = false;
    let url: string | undefined;
    canvasFromData(selData).toBlob((b) => {
      if (dead || !b) return;
      url = URL.createObjectURL(b);
      setSel({ data: selData, url });
    }, 'image/png');
    return () => {
      dead = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [selData]);

  const bitmapOverride = useCallback(
    () => (selData ? createImageBitmap(selData) : Promise.reject(new Error('Nothing to copy'))),
    [selData]
  );

  // The right-click menu opened from the overview is handed over once, then forgotten.
  const selReady = !!sel && sel.data === selData;
  useEffect(() => {
    if (pendingMenu && selReady) setPendingMenu(null);
  }, [pendingMenu, selReady]);

  // ---- Stage size (overview) ----
  const showOverview = selected === null;
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return undefined;
    const update = () => setStage({ w: el.clientWidth, h: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [items, showOverview]);

  // Wheel zoom: gentle (about 5% a notch), smooth, toward the pointer.
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return undefined;
    const onWheel = (e: WheelEvent) => {
      if ((e.target as HTMLElement | null)?.closest?.('[data-zoom-control]')) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      zoomBy(
        wheelZoomFactor(e),
        e.clientX - (rect.left + rect.width / 2),
        e.clientY - (rect.top + rect.height / 2)
      );
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomBy, items, showOverview]);

  // R = reset to fit (overview only; the enlarged viewer is the image viewer).
  useEffect(() => {
    if (!showOverview) return undefined;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key.toLowerCase() === 'r') {
        e.preventDefault();
        reset();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [reset, showOverview]);

  // Drag to pan (window listeners, so a click on a size still reaches it).
  const onStagePointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    movedRef.current = false;
    const sx = e.clientX;
    const sy = e.clientY;
    const p0 = viewRef.current;
    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - sx;
      const dy = ev.clientY - sy;
      if (!movedRef.current && Math.hypot(dx, dy) > CLICK_SLOP) {
        movedRef.current = true;
        setDragging(true);
      }
      if (movedRef.current) setView({ zoom: viewRef.current.zoom, x: p0.x + dx, y: p0.y + dy });
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      setDragging(false);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };

  const enlarge = (i: number, menuAt: { x: number; y: number } | null = null) => {
    if (!items?.[i]?.data) return;
    setPendingMenu(menuAt);
    setSelected(i);
  };

  const backToOverview = () => {
    setSelected(null);
    setView({ zoom: 1, x: 0, y: 0 });
  };

  // ---- Overview layout: a whole-number scale that fits everything at zoom 1 ----
  const layout = useMemo(() => {
    if (!items || stage.w === 0 || stage.h === 0) return null;
    const availW = stage.w * 0.9;
    const availH = Math.max(40, stage.h * 0.9 - LABEL_H);
    const sumW = items.reduce((s, it) => s + it.entry.width, 0);
    const maxH = items.reduce((m, it) => Math.max(m, it.entry.height), 1);
    const rowW = Math.max(40, availW - GAP * (items.length - 1));
    const s = Math.min(rowW / sumW, availH / maxH);
    return { base: Math.max(0.1, s >= 1 ? Math.min(MAX_BASE, Math.floor(s)) : s) };
  }, [items, stage]);

  // ---- Overview right-click menu (empty space) ----
  // Actions use the largest image in the icon.
  const largest = useMemo(() => {
    if (!items) return null;
    let best: Decoded | null = null;
    for (const it of items) {
      if (!it.data) continue;
      if (!best || it.entry.width * it.entry.height >= best.entry.width * best.entry.height) best = it;
    }
    return best;
  }, [items]);

  const saveData = async (data: Uint8Array | null, name: string): Promise<string | null> => {
    const r = await ipc.saveImageAs({ libraryId, fileId: file.id, defaultName: name, data });
    if (!r.ok) {
      notifications.show({ color: 'red', title: 'Save failed', message: r.error });
      return null;
    }
    return r.canceled ? null : r.path;
  };

  const guard = async (fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (err) {
      notifications.show({ color: 'red', title: 'Icon', message: (err as Error).message });
    }
  };

  const doSaveOriginal = () =>
    guard(async () => {
      const p = await saveData(null, file.filename);
      if (p) notifications.show({ color: 'green', title: 'Saved', message: p });
    });

  const doConvert = (fmt: OutFmt) =>
    guard(async () => {
      if (!largest?.data) throw new Error('Nothing to save');
      const canvas = canvasFromData(largest.data);
      const blob = await encodeAs(canvas, fmt);
      const p = await saveData(new Uint8Array(await blob.arrayBuffer()), `${base}.${fmt}`);
      if (p) {
        notifications.show({
          color: 'green',
          title: `Saved as ${fmt.toUpperCase()}`,
          message: `${canvas.width} x ${canvas.height} px, ${formatBytes(blob.size)}`
        });
      }
    });

  const doCopy = () =>
    guard(async () => {
      if (!largest?.data) throw new Error('Nothing to copy');
      const blob = await toBlob(canvasFromData(largest.data), 'image/png');
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      notifications.show({ color: 'green', title: 'Copied', message: 'Largest size copied to the clipboard.' });
    });

  const pick = (fn: () => void) => () => {
    setMenu(null);
    fn();
  };

  const overviewSections: CtxSection[] = [
    {
      id: 'save',
      label: 'Save As',
      children: [
        { id: 'save-orig', label: 'Same as original (.ico)', onSelect: pick(() => void doSaveOriginal()) },
        { id: 'save-png', label: 'PNG (largest size)', onSelect: pick(() => void doConvert('png')) },
        { id: 'save-jpg', label: 'JPG (largest size)', onSelect: pick(() => void doConvert('jpg')) },
        { id: 'save-bmp', label: 'BMP (largest size)', onSelect: pick(() => void doConvert('bmp')) },
        { id: 'save-ico', label: 'ICO (rebuilt from largest)', onSelect: pick(() => void doConvert('ico')) }
      ]
    },
    { id: 'copy', label: 'Copy to Clipboard', onSelect: pick(() => void doCopy()) },
    { id: 'show', label: 'Show in Folder', onSelect: pick(() => void ipc.revealFile(libraryId, file.id)) },
    {
      id: 'edit',
      label: 'Edit a Size',
      separator: true,
      children: (items ?? []).map((it, i) => ({
        id: `edit-${i}`,
        label: `${it.entry.width} x ${it.entry.height}  (${it.entry.bitCount}-bit)`,
        onSelect: pick(() => enlarge(i))
      }))
    }
  ];

  // ---- Render ----
  if (error) {
    return (
      <Center h="100%" p="md">
        <Stack gap={2} align="center">
          <Text size="xs" c="red">
            Preview failed
          </Text>
          <Text size="xs" c="dimmed" ta="center" style={{ wordBreak: 'break-word' }}>
            {error}
          </Text>
        </Stack>
      </Center>
    );
  }
  if (!items) {
    return (
      <Center h="100%">
        <Loader size="sm" />
      </Center>
    );
  }

  // Enlarged: the normal image viewer, fed with this one size.
  if (selected !== null) {
    const it = items[selected];
    return (
      <div style={{ position: 'absolute', inset: 0 }}>
        {sel && selReady && it?.data ? (
          <ImagePreview
            key={`${file.id}:${selected}`}
            libraryId={libraryId}
            file={file}
            srcOverride={sel.url}
            bitmapOverride={bitmapOverride}
            pixelated
            initialMenu={pendingMenu}
          />
        ) : (
          <Center h="100%">
            <Loader size="sm" />
          </Center>
        )}
        <button
          type="button"
          onClick={backToOverview}
          style={{
            all: 'unset',
            cursor: 'pointer',
            position: 'absolute',
            top: 8,
            left: 8,
            zIndex: 7,
            padding: '4px 10px',
            borderRadius: 6,
            fontSize: 12,
            fontWeight: 600,
            background: 'var(--wh3d-overlay-bg, rgba(16, 17, 19, 0.85))',
            border: '1px solid var(--wh3d-overlay-border, #2C2E33)'
          }}
        >
          &larr; All sizes
        </button>
      </div>
    );
  }

  const scale = layout ? layout.base * view.zoom : 1;

  const cell = (it: Decoded, i: number) => (
    <div
      key={i}
      style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, flexShrink: 0 }}
    >
      <IcoCanvas
        decoded={it}
        index={i}
        cssW={it.entry.width * scale}
        cssH={it.entry.height * scale}
        onActivate={() => {
          if (!movedRef.current) enlarge(i);
        }}
      />
      <div style={{ textAlign: 'center', lineHeight: 1.25, pointerEvents: 'none' }}>
        <Text size="xs" fw={600} style={{ fontFamily: 'monospace' }}>
          {it.entry.width}&times;{it.entry.height}
        </Text>
        <Text size="10px" c="dimmed">
          {it.entry.bitCount}-bit{it.entry.kind === 'png' ? ' PNG' : ''}
        </Text>
      </div>
    </div>
  );

  return (
    <div
      ref={stageRef}
      onPointerDown={onStagePointerDown}
      onDoubleClick={reset}
      onContextMenu={(e) => {
        e.preventDefault();
        const idx = (e.target as HTMLElement).closest?.('[data-idx]')?.getAttribute('data-idx');
        if (idx != null && items[Number(idx)]?.data) {
          enlarge(Number(idx), { x: e.clientX, y: e.clientY });
        } else {
          setMenu({ x: e.clientX, y: e.clientY });
        }
      }}
      style={{
        position: 'absolute',
        inset: 0,
        overflow: 'hidden',
        background: 'var(--wh3d-viewport-bg)',
        cursor: dragging ? 'grabbing' : 'grab',
        userSelect: 'none',
        touchAction: 'none'
      }}
    >
      {/* The context menu panels get their glass look from these styles (ImagePreview mounts them too). */}
      <PlayerGlassStyles />
      {layout && (
        <div
          style={{
            position: 'absolute',
            left: '50%',
            top: '50%',
            transform: `translate(-50%, -50%) translate(${view.x}px, ${view.y}px)`,
            display: 'flex',
            // One baseline: every icon sits on the same bottom line.
            alignItems: 'flex-end',
            gap: GAP,
            willChange: 'transform'
          }}
        >
          {items.map((it, i) => cell(it, i))}
        </div>
      )}

      <ZoomControl
        zoom={view.zoom}
        onZoomIn={() => zoomBy(VIEW_ZOOM_STEP)}
        onZoomOut={() => zoomBy(1 / VIEW_ZOOM_STEP)}
        onReset={reset}
      />

      {menu && <PlayerContextMenu x={menu.x} y={menu.y} sections={overviewSections} onClose={() => setMenu(null)} />}
    </div>
  );
}
