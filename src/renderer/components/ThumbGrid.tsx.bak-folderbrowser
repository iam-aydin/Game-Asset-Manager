import { useCallback, useEffect, useRef, useState } from 'react';
import { ActionIcon, Center, Group, Stack, Text, Tooltip } from '@mantine/core';
import { IconMinus, IconPlus, IconStarFilled } from '@tabler/icons-react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { ExtractedMetadata, FileRecord } from '@shared/types';
import type { PrintBed } from '@shared/preferences';
import { COLOR_LABEL_HEX } from '@shared/ratings';
import { modelFitsAnyBed } from '@shared/print-bed';

import { formatBytes } from '../util/format';
import { extColor } from '@shared/ext-colors';
import { ipc } from '../ipc-client';

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
}

const TILE_GAP = 8;
const PADDING_X = 12;
const TILE_BORDER = 2;
const TILE_PADDING = 6;
const LABEL_HEIGHT = 34;
const TOOLBAR_HEIGHT = 32;

const THUMB_SIZE_MIN = 80;
const THUMB_SIZE_MAX = 256;
const THUMB_SIZE_STEP = 24;
const DEFAULT_THUMB_SIZE = 128;
const THUMB_SIZE_STORAGE_KEY = 'wh3d:thumbSize';

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
  printBeds = []
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

  const rowCount = Math.ceil(files.length / columns);
  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => tileHeight + TILE_GAP,
    overscan: 4
  });

  useEffect(() => {
    virtualizer.measure();
  }, [tileHeight, columns, virtualizer]);

  const canDecrease = thumbSize > THUMB_SIZE_MIN;
  const canIncrease = thumbSize < THUMB_SIZE_MAX;

  return (
    <Stack gap={0} h="100%">
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
          {files.length} {files.length === 1 ? 'item' : 'items'}
          {selectedIds.size > 0 && ` · ${selectedIds.size} selected`}
        </Text>
        <Group gap={6} wrap="nowrap">
          {headerExtras}
          <Group gap={4} wrap="nowrap">
            <Tooltip label="Smaller thumbnails">
              <ActionIcon
                size="sm"
                variant="default"
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
                variant="default"
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
        style={{ flex: 1, minHeight: 0, overflow: 'auto', position: 'relative' }}
      >
        {files.length === 0 ? (
          <Center h="100%">
            <Stack align="center" gap={4}>
              <Text c="dimmed">This folder has no indexed assets.</Text>
              <Text size="xs" c="dimmed">
                Try selecting a parent folder or trigger a rescan from the toolbar.
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
              const rowItems = files.slice(start, start + columns);
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
                  {rowItems.map((file) => {
                    const meta = parseFileMeta(file.metadataJson);
                    return (
                      <Tile
                        key={file.id}
                        file={file}
                        thumbVersion={thumbVersions.get(file.id) ?? 0}
                        selected={selectedIds.has(file.id)}
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
                          ipc.startFileDrag(file.libraryId, file.id);
                        }}
                      />
                    );
                  })}
                </div>
              );
            })}
          </div>
        )}
      </div>
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
            : `${TILE_BORDER}px solid transparent`,
        background: selected ? 'var(--mantine-color-dark-5)' : 'var(--mantine-color-dark-6)',
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