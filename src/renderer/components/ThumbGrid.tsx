import { useCallback, useEffect, useRef, useState } from 'react';
import { ActionIcon, Center, Group, Menu, Stack, Text, Tooltip } from '@mantine/core';
import { IconClipboard, IconFolderPlus, IconMinus, IconPlus, IconStarFilled } from '@tabler/icons-react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { ExtractedMetadata, FileRecord } from '@shared/types';
import type { PrintBed } from '@shared/preferences';
import { COLOR_LABEL_HEX } from '@shared/ratings';
import { modelFitsAnyBed } from '@shared/print-bed';

import { formatBytes } from '../util/format';
import { extColor } from '@shared/ext-colors';
import { ipc } from '../ipc-client';
import { FolderTile } from './FolderTile';
import { createPortal } from 'react-dom';
import { GLASS_POPOVER_CLASS } from './Glasseffect';
import type { FolderTreeNode } from '@shared/types';

export interface TileClickModifiers {
  shift: boolean;
  meta: boolean;
  ctrl: boolean;
  isRightClick?: boolean;
}

interface Props {
  libraryId: string | null;
  files: FileRecord[];
  selectedIds: ReadonlySet<number>;
  primaryId: number | null;
  thumbVersions: ReadonlyMap<number, number>;
  onTileClick: (fileId: number, modifiers: TileClickModifiers) => void;
  onTileContextMenu?: (fileId: number, x: number, y: number) => void;
  headerExtras?: React.ReactNode;
  printBeds?: PrintBed[];
  emptyTitle?: string;
  emptyHint?: string;
  /** Subfolders to show first, as big folder tiles (Explorer style). */
  folders?: FolderTreeNode[];
  onOpenFolder?: (path: string) => void;
  onFolderContextMenu?: (node: FolderTreeNode, x: number, y: number) => void;
  /** Opens the rename dialog for a folder (slow second click, F2). */
  onRenameFolder?: (path: string) => void;
  /** Called when a folder gets selected, so no file stays selected next to it. */
  onClearFileSelection?: () => void;
  /** Replaces the whole file selection (used by the drag-a-box selection). */
  onSelectFiles?: (ids: number[]) => void;
  /** Creates a new folder in the folder you are in (right-click on empty space). */
  onNewFolder?: () => void;
  /** Container view: paste the cut files into the folder you are in. */
  onPaste?: () => void;
  /** True while files are waiting to be pasted. */
  canPaste?: boolean;
  /** Navigation (back / forward / up / path) shown in the bar above the files. */
  headerNav?: React.ReactNode;
}

const TILE_GAP = 8;
const PADDING_X = 12;
const TILE_BORDER = 2;
const TILE_PADDING = 6;
const LABEL_HEIGHT = 34;
const TOOLBAR_HEIGHT = 32;

// A second click on an already selected folder renames it, but only after this
// many ms (so a real double click still opens the folder instead).
const DOUBLE_CLICK_MS = 500;

const THUMB_SIZE_MIN = 80;
const THUMB_SIZE_MAX = 256;
const THUMB_SIZE_STEP = 24;
const DEFAULT_THUMB_SIZE = 128;
const THUMB_SIZE_STORAGE_KEY = 'wh3d:thumbSize';

const noop = (): void => {};

interface GridGeometry {
  columns: number;
  tileWidth: number;
  columnGap: number;
  tileHeight: number;
  total: number;
}

/** Index of the tile under a point (content coordinates), or -1 for empty space. */
function gridItemAt(g: GridGeometry, x: number, y: number): number {
  if (y < 0) return -1;
  const rowH = g.tileHeight + TILE_GAP;
  const row = Math.floor(y / rowH);
  if (y - row * rowH > g.tileHeight) return -1;
  for (let col = 0; col < g.columns; col++) {
    const x0 = PADDING_X + col * (g.tileWidth + g.columnGap);
    if (x >= x0 && x <= x0 + g.tileWidth) {
      const idx = row * g.columns + col;
      return idx < g.total ? idx : -1;
    }
  }
  return -1;
}

/** Indexes of every tile a box touches (content coordinates). */
function gridItemsInBox(
  g: GridGeometry,
  xa: number,
  ya: number,
  xb: number,
  yb: number
): number[] {
  const minX = Math.min(xa, xb);
  const maxX = Math.max(xa, xb);
  const minY = Math.min(ya, yb);
  const maxY = Math.max(ya, yb);
  const rowH = g.tileHeight + TILE_GAP;
  const out: number[] = [];
  const rowFrom = Math.max(0, Math.floor(minY / rowH));
  const rowTo = Math.floor(maxY / rowH);
  for (let row = rowFrom; row <= rowTo; row++) {
    const top = row * rowH;
    if (top > maxY || top + g.tileHeight < minY) continue;
    for (let col = 0; col < g.columns; col++) {
      const x0 = PADDING_X + col * (g.tileWidth + g.columnGap);
      if (x0 > maxX || x0 + g.tileWidth < minX) continue;
      const idx = row * g.columns + col;
      if (idx < g.total) out.push(idx);
    }
  }
  return out;
}

function clampThumbSize(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_THUMB_SIZE;
  return Math.min(THUMB_SIZE_MAX, Math.max(THUMB_SIZE_MIN, Math.round(value)));
}

function readStoredThumbSize(): number {
  try {
    const raw = localStorage.getItem(THUMB_SIZE_STORAGE_KEY);
    if (raw == null) return DEFAULT_THUMB_SIZE;
    return clampThumbSize(Number.parseInt(raw, 10));
  } catch {
    return DEFAULT_THUMB_SIZE;
  }
}

export function ThumbGrid({
  libraryId: _libraryId,
  files,
  selectedIds,
  primaryId,
  thumbVersions,
  onTileClick,
  onTileContextMenu,
  headerExtras,
  printBeds = [],
  emptyTitle,
  emptyHint,
  folders,
  onOpenFolder,
  onFolderContextMenu,
  onRenameFolder,
  onClearFileSelection,
  onSelectFiles,
  onNewFolder,
  onPaste,
  canPaste,
  headerNav
}: Props) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [thumbSize, setThumbSizeState] = useState<number>(() => readStoredThumbSize());

  const setThumbSize = useCallback((next: number) => {
    const clamped = clampThumbSize(next);
    setThumbSizeState(clamped);
    try {
      localStorage.setItem(THUMB_SIZE_STORAGE_KEY, String(clamped));
    } catch {
      // ignore
    }
  }, []);

  const setScrollRef = useCallback((el: HTMLDivElement | null) => {
    scrollRef.current = el;
    if (!el) {
      setContainerWidth(0);
      return;
    }
    const recompute = () => setContainerWidth(el.clientWidth);
    recompute();
    const ro = new ResizeObserver(recompute);
    ro.observe(el);
    (el as unknown as { __wh3dRO?: ResizeObserver }).__wh3dRO?.disconnect();
    (el as unknown as { __wh3dRO?: ResizeObserver }).__wh3dRO = ro;
  }, []);

  const innerWidth = Math.max(0, containerWidth - PADDING_X * 2);
  const columns = Math.max(
    1,
    Math.floor((innerWidth + TILE_GAP) / (thumbSize + TILE_GAP))
  );
  const tileWidth = thumbSize;
  const columnGap =
    columns > 1 && innerWidth > columns * tileWidth
      ? (innerWidth - columns * tileWidth) / (columns - 1)
      : TILE_GAP;
  const tileHeight = Math.round(
    tileWidth + LABEL_HEIGHT + TILE_PADDING * 2 + TILE_BORDER * 2
  );

  const folderList = folders ?? [];
  const folderCount = folderList.length;
  const totalItems = folderCount + files.length;
  const rowCount = Math.ceil(totalItems / columns);
  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => tileHeight + TILE_GAP,
    overscan: 4
  });

  useEffect(() => {
    virtualizer.measure();
  }, [tileHeight, columns, virtualizer]);

  // --- Folder tile selection (Explorer style) -------------------------------
  // Click = select, slow second click = rename, F2 = rename, Enter or double
  // click = open. The selection is only valid while that folder is in the list.
  // Selected folder tiles (a set, so a drag-box can select several). A single
  // selected folder is the "active" one: F2 / Enter / slow click act on it.
  const [selFolderSet, setSelFolderSet] = useState<ReadonlySet<string>>(() => new Set<string>());
  const selFolderPath = selFolderSet.size === 1 ? ([...selFolderSet][0] as string) : null;
  const setSelFolderPath = useCallback(
    (p: string | null) => setSelFolderSet(p === null ? new Set<string>() : new Set<string>([p])),
    []
  );
  // Set while a drag-box changes the file selection, so the effect below does
  // not wipe the folders the same box just selected.
  const suppressFolderClearRef = useRef(false);
  const lastFolderClickRef = useRef(0);
  const renameTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeFolderPath =
    selFolderPath !== null && folderList.some((f) => f.path === selFolderPath)
      ? selFolderPath
      : null;

  const cancelRenameTimer = useCallback(() => {
    if (renameTimerRef.current) {
      clearTimeout(renameTimerRef.current);
      renameTimerRef.current = null;
    }
  }, []);

  // A file got selected: the folder highlight goes away.
  useEffect(() => {
    if (suppressFolderClearRef.current) {
      suppressFolderClearRef.current = false;
      return;
    }
    if (selectedIds.size > 0) {
      setSelFolderPath(null);
      cancelRenameTimer();
    }
  }, [selectedIds, cancelRenameTimer]);

  // Another folder / list: drop any pending rename.
  useEffect(() => {
    cancelRenameTimer();
  }, [folders, cancelRenameTimer]);

  useEffect(() => cancelRenameTimer, [cancelRenameTimer]);

  const handleFolderClick = useCallback(
    (path: string) => {
      const now = Date.now();
      const sinceLast = now - lastFolderClickRef.current;
      lastFolderClickRef.current = now;
      cancelRenameTimer();
      if (activeFolderPath === path && sinceLast > DOUBLE_CLICK_MS) {
        // Already selected and this is a slow second click: rename, unless a
        // double click follows (that cancels this timer and opens instead).
        renameTimerRef.current = setTimeout(() => {
          renameTimerRef.current = null;
          onRenameFolder?.(path);
        }, DOUBLE_CLICK_MS);
        return;
      }
      setSelFolderPath(path);
      onClearFileSelection?.();
    },
    [activeFolderPath, cancelRenameTimer, onRenameFolder, onClearFileSelection]
  );

  const handleFolderDoubleClick = useCallback(
    (path: string) => {
      cancelRenameTimer();
      lastFolderClickRef.current = 0;
      onOpenFolder?.(path);
    },
    [cancelRenameTimer, onOpenFolder]
  );

  // F2 = rename the selected folder, Enter = open it.
  useEffect(() => {
    if (!activeFolderPath) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return;
      const target = e.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable) {
          return;
        }
        if (target.closest('[role="dialog"]')) return;
      }
      if (e.key === 'F2') {
        e.preventDefault();
        cancelRenameTimer();
        onRenameFolder?.(activeFolderPath);
      } else if (e.key === 'Enter') {
        const tag = target?.tagName;
        if (tag === 'BUTTON' || tag === 'A') return;
        e.preventDefault();
        cancelRenameTimer();
        onOpenFolder?.(activeFolderPath);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activeFolderPath, cancelRenameTimer, onRenameFolder, onOpenFolder]);
  // --------------------------------------------------------------------------

  // --- Marquee (drag a box) selection ----------------------------------------
  // Hold the left button on empty space and drag: every folder / file tile the
  // box touches gets selected. Ctrl or Shift keeps the current selection and
  // adds to it. Tile positions come from the grid math (the list is virtualized).
  // The box is moved by direct style updates (no React state), so dragging stays smooth.
  const marqueeElRef = useRef<HTMLDivElement | null>(null);
  // While dragging only this local highlight changes. The real selection (preview,
  // metadata panel, ...) is applied once, when the mouse button is released.
  const [dragFileIds, setDragFileIds] = useState<ReadonlySet<number> | null>(null);
  const geomRef = useRef({
    columns,
    tileWidth,
    columnGap,
    tileHeight,
    folderList,
    files,
    selectedIds,
    selFolderSet
  });
  geomRef.current = {
    columns,
    tileWidth,
    columnGap,
    tileHeight,
    folderList,
    files,
    selectedIds,
    selFolderSet
  };
  const onSelectFilesRef = useRef(onSelectFiles);
  onSelectFilesRef.current = onSelectFiles;


  const handleGridMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      const el = scrollRef.current;
      if (!el) return;
      const r0 = el.getBoundingClientRect();
      // Pressing on a scrollbar is not a selection.
      if (e.clientX - r0.left >= el.clientWidth || e.clientY - r0.top >= el.clientHeight) return;
      const geom = (): GridGeometry => {
        const gm = geomRef.current;
        return {
          columns: gm.columns,
          tileWidth: gm.tileWidth,
          columnGap: gm.columnGap,
          tileHeight: gm.tileHeight,
          total: gm.folderList.length + gm.files.length
        };
      };
      const startX = e.clientX - r0.left + el.scrollLeft;
      const startY = e.clientY - r0.top + el.scrollTop;
      // Pressing on a tile keeps its normal behavior (click, drag the file out).
      if (gridItemAt(geom(), startX, startY) >= 0) return;

      e.preventDefault(); // no text selection while dragging
      const active = document.activeElement as HTMLElement | null;
      if (active && active !== document.body) active.blur();

      const additive = e.ctrlKey || e.metaKey || e.shiftKey;
      const baseFiles: number[] = additive ? [...geomRef.current.selectedIds] : [];
      const baseFolders: string[] = additive ? [...geomRef.current.selFolderSet] : [];
      const pressX = e.clientX;
      const pressY = e.clientY;
      let lastX = pressX;
      let lastY = pressY;
      let dragging = false;
      let lastSig = '';
      let dragIds: number[] | null = null;

      const update = () => {
        if (!dragging) {
          if (Math.abs(lastX - pressX) < 4 && Math.abs(lastY - pressY) < 4) return;
          dragging = true;
          cancelRenameTimer();
        }
        const r = el.getBoundingClientRect();
        const x2 = Math.max(0, lastX - r.left + el.scrollLeft);
        const y2 = Math.max(0, lastY - r.top + el.scrollTop);
        const box = marqueeElRef.current;
        if (box) {
          box.style.display = 'block';
          box.style.left = Math.min(startX, x2) + 'px';
          box.style.top = Math.min(startY, y2) + 'px';
          box.style.width = Math.abs(x2 - startX) + 'px';
          box.style.height = Math.abs(y2 - startY) + 'px';
        }
        const gm = geomRef.current;
        const folderCountNow = gm.folderList.length;
        const folders = new Set<string>(baseFolders);
        const fileIds = new Set<number>(baseFiles);
        for (const i of gridItemsInBox(geom(), startX, startY, x2, y2)) {
          if (i < folderCountNow) folders.add(gm.folderList[i].path);
          else fileIds.add(gm.files[i - folderCountNow].id);
        }
        const sig = [...folders].join('|') + '#' + [...fileIds].join(',');
        if (sig === lastSig) return;
        lastSig = sig;
        setSelFolderSet(folders);
        setDragFileIds(fileIds);
        dragIds = [...fileIds];
      };

      const onMove = (ev: MouseEvent) => {
        lastX = ev.clientX;
        lastY = ev.clientY;
        update();
      };
      // Dragging near the top / bottom edge scrolls the list.
      const timer = setInterval(() => {
        if (!dragging) return;
        const r = el.getBoundingClientRect();
        const before = el.scrollTop;
        if (lastY < r.top + 28) el.scrollTop -= 16;
        else if (lastY > r.bottom - 28) el.scrollTop += 16;
        if (el.scrollTop !== before) update();
      }, 30);
      const onUp = () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        clearInterval(timer);
        if (marqueeElRef.current) marqueeElRef.current.style.display = 'none';
        if (dragging && dragIds && onSelectFilesRef.current) {
          // Apply the real selection once, now that the button is released.
          suppressFolderClearRef.current = true;
          onSelectFilesRef.current(dragIds);
        }
        setDragFileIds(null);
        // Plain click on empty space: reset the whole selection (folders and files).
        if (!dragging && !additive) {
          setSelFolderPath(null);
          onSelectFilesRef.current?.([]);
        }
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    },
    [cancelRenameTimer, setSelFolderPath]
  );
  // --------------------------------------------------------------------------

  // --- Right-click on empty space: New folder ---------------------------------
  const [emptyMenu, setEmptyMenu] = useState({ opened: false, x: 0, y: 0 });
  const handleGridContextMenu = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const el = scrollRef.current;
      if (!el || !onNewFolder) return;
      const r = el.getBoundingClientRect();
      const gm = geomRef.current;
      const hit = gridItemAt(
        {
          columns: gm.columns,
          tileWidth: gm.tileWidth,
          columnGap: gm.columnGap,
          tileHeight: gm.tileHeight,
          total: gm.folderList.length + gm.files.length
        },
        e.clientX - r.left + el.scrollLeft,
        e.clientY - r.top + el.scrollTop
      );
      if (hit >= 0) return; // a tile handles its own menu
      e.preventDefault();
      setEmptyMenu({ opened: true, x: e.clientX, y: e.clientY });
    },
    [onNewFolder]
  );
  // --------------------------------------------------------------------------

  const canDecrease = thumbSize > THUMB_SIZE_MIN;
  const canIncrease = thumbSize < THUMB_SIZE_MAX;

  return (
    <Stack gap={0} h="100%">
      <style>{`
        .gam-zoom-btn {
          border: none !important;
          background: transparent !important;
          box-shadow: none !important;
          color: var(--mantine-color-dimmed) !important;
          transition: color 200ms ease;
        }
        .gam-zoom-btn:hover:not(:disabled):not([data-disabled]) {
          color: var(--mantine-color-gray-0) !important;
          background: transparent !important;
        }
        .gam-zoom-btn:disabled,
        .gam-zoom-btn[data-disabled] {
          opacity: 0.35;
        }
        :root[data-gam-glass='off'] .gam-ext-badge {
          -webkit-backdrop-filter: none !important;
          backdrop-filter: none !important;
          background: var(--mantine-color-dark-7) !important;
          border: 1px solid var(--mantine-color-dark-4) !important;
          box-shadow: none !important;
          text-shadow: none !important;
        }
      `}</style>
      <Group
        h={TOOLBAR_HEIGHT}
        px={PADDING_X}
        gap={6}
        justify="space-between"
        style={{
          flexShrink: 0,
          borderBottom: '1px solid var(--mantine-color-dark-4)',
          background: 'var(--mantine-color-dark-7)'
        }}
      >
        <Text size="xs" c="dimmed">
          {folderCount > 0 && `${folderCount} ${folderCount === 1 ? 'folder' : 'folders'}${'\u00b7'.length ? ' \u00b7 ' : ''}`}
          {files.length} {files.length === 1 ? 'item' : 'items'}
          {(dragFileIds ?? selectedIds).size + folderList.filter((f) => selFolderSet.has(f.path)).length > 0 &&
            ` \u00b7 ${(dragFileIds ?? selectedIds).size + folderList.filter((f) => selFolderSet.has(f.path)).length} selected`}
        </Text>
        <div
          style={{
            flex: 1,
            minWidth: 0,
            display: 'flex',
            alignItems: 'center',
            padding: '0 8px',
            overflow: 'hidden'
          }}
        >
          {headerNav}
        </div>
        <Group gap={6} wrap="nowrap">
          {headerExtras}
          <Group gap={4} wrap="nowrap">
            <Tooltip label="Smaller thumbnails">
              <ActionIcon
                size="sm"
                variant="transparent" className="gam-zoom-btn"
                onClick={() => setThumbSize(thumbSize - THUMB_SIZE_STEP)}
                disabled={!canDecrease}
                aria-label="Decrease thumbnail size"
              >
                <IconMinus size={12} />
              </ActionIcon>
            </Tooltip>
            <Text size="xs" c="dimmed" style={{ minWidth: 40, textAlign: 'center' }}>
              {thumbSize}px
            </Text>
            <Tooltip label="Larger thumbnails">
              <ActionIcon
                size="sm"
                variant="transparent" className="gam-zoom-btn"
                onClick={() => setThumbSize(thumbSize + THUMB_SIZE_STEP)}
                disabled={!canIncrease}
                aria-label="Increase thumbnail size"
              >
                <IconPlus size={12} />
              </ActionIcon>
            </Tooltip>
          </Group>
        </Group>
      </Group>

      <div
        ref={setScrollRef}
        onMouseDown={handleGridMouseDown}
        onContextMenu={handleGridContextMenu}
        style={{ flex: 1, minHeight: 0, overflow: 'auto', position: 'relative' }}
      >
        {totalItems === 0 ? (
          <Center h="100%">
            <Stack align="center" gap={4}>
              <Text c="dimmed">{emptyTitle ?? 'This folder has no indexed assets.'}</Text>
              <Text size="xs" c="dimmed">
                {emptyHint ?? 'Try selecting a parent folder or trigger a rescan from the toolbar.'}
              </Text>
            </Stack>
          </Center>
        ) : (
          <div
            style={{
              height: virtualizer.getTotalSize(),
              width: '100%',
              position: 'relative',
              paddingTop: TILE_GAP / 2
            }}
          >
            {virtualizer.getVirtualItems().map((virtualRow) => {
              const start = virtualRow.index * columns;
              const rowFolders = folderList.slice(
                Math.min(start, folderCount),
                Math.min(start + columns, folderCount)
              );
              const rowItems = files.slice(
                Math.max(0, start - folderCount),
                Math.max(0, start + columns - folderCount)
              );
              return (
                <div
                  key={virtualRow.key}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    transform: `translateY(${virtualRow.start}px)`,
                    display: 'grid',
                    gridTemplateColumns: `repeat(${columns}, ${tileWidth}px)`,
                    justifyContent: 'start',
                    rowGap: TILE_GAP,
                    columnGap,
                    padding: `0 ${PADDING_X}px`,
                    boxSizing: 'border-box'
                  }}
                >
                  {rowFolders.map((f) => {
                    const folderSelected = selFolderSet.has(f.path);
                    return (
                      <div
                        key={'folder:' + f.path}
                        style={{ position: 'relative', height: tileHeight }}
                        onClick={() => handleFolderClick(f.path)}
                        onDoubleClick={() => handleFolderDoubleClick(f.path)}
                      >
                        <FolderTile
                          node={f}
                          tileHeight={tileHeight}
                          onOpen={noop}
                          onContextMenu={(e) => {
                            e.preventDefault();
                            cancelRenameTimer();
                            setSelFolderPath(f.path);
                            onClearFileSelection?.();
                            onFolderContextMenu?.(f, e.clientX, e.clientY);
                          }}
                        />
                        {folderSelected && (
                          <div
                            aria-hidden
                            style={{
                              position: 'absolute',
                              inset: 0,
                              borderRadius: 6,
                              boxSizing: 'border-box',
                              border: `${TILE_BORDER}px solid var(--mantine-color-indigo-3)`,
                              background:
                                'color-mix(in srgb, var(--mantine-color-indigo-4) 16%, transparent)',
                              pointerEvents: 'none',
                              zIndex: 1
                            }}
                          />
                        )}
                      </div>
                    );
                  })}
                  {rowItems.map((file) => {
                    const meta = parseFileMeta(file.metadataJson);
                    return (
                      <Tile
                        key={file.id}
                        file={file}
                        thumbVersion={thumbVersions.get(file.id) ?? 0}
                        selected={(dragFileIds ?? selectedIds).has(file.id)}
                        isPrimary={file.id === primaryId}
                        tileHeight={tileHeight}
                        bedFitProblem={
                          printBeds.length > 0 && !modelFitsAnyBed(meta, printBeds)
                        }
                        onClick={(e) => {
                          onTileClick(file.id, {
                            shift: e.shiftKey,
                            meta: e.metaKey,
                            ctrl: e.ctrlKey,
                            isRightClick: false
                          });
                        }}
                        onContextMenu={(e) => {
                          if (!onTileContextMenu) return;
                          e.preventDefault();
                          if (!selectedIds.has(file.id)) {
                            onTileClick(file.id, {
                              shift: false,
                              meta: false,
                              ctrl: false,
                              isRightClick: true
                            });
                          }
                          onTileContextMenu(file.id, e.clientX, e.clientY);
                        }}
                        onDragStart={(e) => {
                          e.preventDefault();
                          ipc.startFileDrag(file.libraryId, file.id % 1000000000);
                        }}
                      />
                    );
                  })}
                </div>
              );
            })}
          </div>
        )}
        <div
          ref={marqueeElRef}
          aria-hidden
          style={{
            display: 'none',
            position: 'absolute',
            border: '1px solid var(--mantine-color-indigo-3)',
            background: 'color-mix(in srgb, var(--mantine-color-indigo-4) 18%, transparent)',
            borderRadius: 2,
            pointerEvents: 'none',
            zIndex: 5
          }}
        />
      </div>
      {createPortal(
        <Menu
          opened={emptyMenu.opened}
          onChange={(open) => {
            if (!open) setEmptyMenu((m) => ({ ...m, opened: false }));
          }}
          position="bottom-start"
          floatingStrategy="fixed"
          offset={0}
          withinPortal
          shadow="md"
          width={230}
        >
          <Menu.Target>
            <div
              style={{
                position: 'fixed',
                top: emptyMenu.y,
                left: emptyMenu.x,
                width: 1,
                height: 1,
                pointerEvents: 'none'
              }}
            />
          </Menu.Target>
          <Menu.Dropdown className={GLASS_POPOVER_CLASS}>
            <Menu.Item
              leftSection={<IconFolderPlus size={14} />}
              rightSection={
                <Text size="xs" c="dimmed">
                  Ctrl+Shift+N
                </Text>
              }
              onClick={() => {
                setEmptyMenu((m) => ({ ...m, opened: false }));
                onNewFolder?.();
              }}
            >
              New folder
            </Menu.Item>
            {canPaste && onPaste && (
              <Menu.Item
                leftSection={<IconClipboard size={14} />}
                rightSection={
                  <Text size="xs" c="dimmed">
                    Ctrl+V
                  </Text>
                }
                onClick={() => {
                  setEmptyMenu((m) => ({ ...m, opened: false }));
                  onPaste();
                }}
              >
                Paste here
              </Menu.Item>
            )}
          </Menu.Dropdown>
        </Menu>,
        document.body
      )}
    </Stack>
  );
}

function parseFileMeta(json: string | null): ExtractedMetadata | null {
  if (!json) return null;
  try {
    return JSON.parse(json) as ExtractedMetadata;
  } catch {
    return null;
  }
}

function Tile({
  file,
  thumbVersion,
  selected,
  isPrimary,
  tileHeight,
  bedFitProblem,
  onClick,
  onContextMenu,
  onDragStart
}: {
  file: FileRecord;
  thumbVersion: number;
  selected: boolean;
  isPrimary: boolean;
  tileHeight: number;
  bedFitProblem: boolean;
  onClick: (e: React.MouseEvent) => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  onDragStart?: (e: React.DragEvent) => void;
}) {
  const color = extColor(file.ext);
  const [hover, setHover] = useState(false);
  const showThumb = file.hasThumb || thumbVersion > 0;
  const thumbUrl = showThumb
    ? `wh3d-thumb://${file.libraryId}/${file.id}?v=${thumbVersion}`
    : null;
  const hasError = !!file.thumbError && !showThumb;

  return (
    <button
      type="button"
      onClick={onClick}
      onContextMenu={onContextMenu}
      draggable
      onDragStart={onDragStart}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        all: 'unset',
        cursor: 'pointer',
        display: 'flex',
        flexDirection: 'column',
        height: tileHeight,
        padding: TILE_PADDING,
        borderRadius: 6,
        border: isPrimary
          ? `${TILE_BORDER}px solid var(--mantine-color-indigo-3)`
          : selected
            ? `${TILE_BORDER}px solid var(--mantine-color-indigo-5)`
            : hover
              ? `${TILE_BORDER}px solid color-mix(in srgb, var(--mantine-color-indigo-4) 40%, transparent)`
              : `${TILE_BORDER}px solid transparent`,
        background: selected
          ? 'color-mix(in srgb, var(--mantine-color-indigo-4) 16%, var(--mantine-color-dark-6))'
          : hover
            ? 'color-mix(in srgb, var(--mantine-color-indigo-4) 10%, var(--mantine-color-dark-6))'
            : 'var(--mantine-color-dark-6)',
        boxSizing: 'border-box',
        overflow: 'hidden'
      }}
      title={hasError ? `Render failed: ${file.thumbError}` : file.relPath}
    >
      <div
        style={{
          position: 'relative',
          width: '100%',
          aspectRatio: '1 / 1',
          background: thumbUrl
            ? '#000'
            : hasError
              ? 'linear-gradient(135deg, #4a1f1f, #2a1414)'
              : `linear-gradient(135deg, ${color}33, ${color}11)`,
          border: thumbUrl
            ? '1px solid #000'
            : hasError
              ? '1px solid var(--mantine-color-red-7)'
              : `1px solid ${color}55`,
          borderRadius: 4,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: 'var(--mantine-font-family-monospace, monospace)',
          fontSize: 22,
          fontWeight: 700,
          color: hasError ? 'var(--mantine-color-red-4)' : color,
          overflow: 'hidden'
        }}
      >
        {thumbUrl ? (
          <img
            src={thumbUrl}
            alt={file.filename}
            loading="lazy"
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        ) : hasError ? (
          <span style={{ fontSize: 28 }}>!</span>
        ) : (
          <span>.{file.ext}</span>
        )}

        {/* File-format badge: top-right on every tile. Glass pill tinted with
            the category's pastel color (same recipe as the Filter dropdown /
            player glass: tint + blur + translucent border + top highlight). */}
        <div
          className="gam-ext-badge"
          style={{
            position: 'absolute',
            top: 4,
            right: 4,
            padding: '1px 6px',
            borderRadius: 6,
            fontSize: 9,
            fontWeight: 700,
            letterSpacing: 0.5,
            lineHeight: 1.5,
            textTransform: 'uppercase',
            color: color,
            background: `linear-gradient(135deg, ${color}38, ${color}14), rgba(12, 13, 16, 0.42)`,
            WebkitBackdropFilter: 'blur(8px) saturate(140%)',
            backdropFilter: 'blur(8px) saturate(140%)',
            border: '1px solid rgba(255, 255, 255, 0.22)',
            boxShadow:
              '0 2px 8px rgba(0, 0, 0, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.25)',
            textShadow: '0 1px 3px rgba(0, 0, 0, 0.6)',
            pointerEvents: 'none'
          }}
        >
          {file.ext}
        </div>

        {/* Warning badges live bottom-right so they never cover the format badge. */}
        {hasError && (
          <div
            style={{
              position: 'absolute',
              bottom: 4,
              right: 4,
              padding: '2px 6px',
              borderRadius: 3,
              fontSize: 10,
              fontWeight: 600,
              background: 'var(--mantine-color-red-9)',
              color: 'var(--mantine-color-white)'
            }}
          >
            FAILED
          </div>
        )}
        {file.colorLabel && (
          <div
            aria-label={`color label: ${file.colorLabel}`}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: 0,
              height: 0,
              borderTop: `14px solid ${COLOR_LABEL_HEX[file.colorLabel]}`,
              borderRight: '14px solid transparent'
            }}
          />
        )}
        {bedFitProblem && (
          <div
            title="Doesn't fit any registered print bed"
            style={{
              position: 'absolute',
              bottom: 4,
              right: 4,
              padding: '1px 5px',
              borderRadius: 3,
              fontSize: 9,
              fontWeight: 700,
              background: 'var(--mantine-color-red-9)',
              color: 'var(--mantine-color-white)',
              letterSpacing: 0.4
            }}
          >
            OVERSIZE
          </div>
        )}
        {file.rating > 0 && (
          <div
            style={{
              position: 'absolute',
              bottom: 4,
              left: 4,
              padding: '2px 4px',
              borderRadius: 3,
              background: 'rgba(0,0,0,0.55)',
              display: 'flex',
              gap: 1,
              alignItems: 'center'
            }}
            aria-label={`rating: ${file.rating} of 5`}
          >
            {Array.from({ length: file.rating }, (_, i) => (
              <IconStarFilled key={i} size={9} color="var(--mantine-color-yellow-5)" />
            ))}
          </div>
        )}
      </div>
      <div
        style={{
          height: LABEL_HEIGHT,
          marginTop: 4,
          minWidth: 0,
          overflow: 'hidden'
        }}
      >
        <div
          style={{
            fontSize: 12,
            lineHeight: 1.3,
            color: 'var(--mantine-color-text)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap'
          }}
        >
          {file.filename}
        </div>
        <div style={{ fontSize: 11, color: 'var(--mantine-color-dimmed)' }}>
          {formatBytes(file.sizeBytes)}
        </div>
      </div>
    </button>
  );
}