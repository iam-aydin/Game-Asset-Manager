import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import { ActionIcon, Group, Menu, Text } from '@mantine/core';
import { IconCheck, IconCircleFilled, IconPlus, IconStarFilled } from '@tabler/icons-react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { FileRecord, FolderTreeNode } from '@shared/types';
import { COLOR_LABEL_HEX } from '@shared/ratings';
import { formatBytes, formatDateTime } from '../util/format';
import type { TileClickModifiers } from './ThumbGrid';
import { GlassFolderMini } from './FolderGlyphs';

interface Props {
  /** Active library id, or null in "All Libraries" mode. Tile thumbs use
   *  `file.libraryId` so this prop is informational only. */
  libraryId: string | null;
  files: FileRecord[];
  selectedIds: ReadonlySet<number>;
  primaryId: number | null;
  thumbVersions: ReadonlyMap<number, number>;
  onTileClick: (fileId: number, modifiers: TileClickModifiers) => void;
  onTileContextMenu?: (fileId: number, x: number, y: number) => void;
  /** Subfolders shown first, as rows above the files. */
  folders?: FolderTreeNode[];
  onOpenFolder?: (path: string) => void;
  onFolderContextMenu?: (node: FolderTreeNode, x: number, y: number) => void;
}

const ROW_HEIGHT = 36;
const HEADER_HEIGHT = 28;

// ---- Columns ---------------------------------------------------------------

type ColId =
  | 'name'
  | 'ext'
  | 'size'
  | 'mtime'
  | 'vertices'
  | 'triangles'
  | 'resolution'
  | 'duration'
  | 'fps'
  | 'videoBitrate'
  | 'audioBitrate'
  | 'rating'
  | 'label';

interface ColDef {
  label: string;
  width: string;
  right?: boolean;
}

const COLS: Record<ColId, ColDef> = {
  name: { label: 'Name', width: 'minmax(120px, 1fr)' },
  ext: { label: 'Ext', width: '56px' },
  size: { label: 'Size', width: '80px', right: true },
  mtime: { label: 'Modified', width: '150px' },
  vertices: { label: 'Verts', width: '80px', right: true },
  triangles: { label: 'Tris', width: '80px', right: true },
  resolution: { label: 'Resolution', width: '110px', right: true },
  duration: { label: 'Length', width: '70px', right: true },
  fps: { label: 'FPS', width: '56px', right: true },
  videoBitrate: { label: 'Video bitrate', width: '100px', right: true },
  audioBitrate: { label: 'Audio bitrate', width: '100px', right: true },
  rating: { label: 'Rating', width: '70px' },
  label: { label: 'Label', width: '50px' }
};

const ALL_COLS = Object.keys(COLS) as ColId[];
const DEFAULT_COLS: ColId[] = ['name', 'ext', 'size', 'mtime'];
const STORAGE_KEY = 'gam:listColumns';

function readCols(): ColId[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    if (!Array.isArray(parsed)) return DEFAULT_COLS;
    const seen = new Set<ColId>();
    for (const v of parsed) if (ALL_COLS.includes(v)) seen.add(v as ColId);
    if (seen.size === 0) return DEFAULT_COLS;
    const list = [...seen];
    if (!list.includes('name')) list.unshift('name');
    return list;
  } catch {
    return DEFAULT_COLS;
  }
}

// ---- Cell values -----------------------------------------------------------

type Meta = Record<string, any> | null;

function parseMeta(json: string | null): Meta {
  if (!json) return null;
  try {
    return JSON.parse(json) as Meta;
  } catch {
    return null;
  }
}

function fmtDuration(sec: number | null | undefined): string | null {
  if (sec == null || !Number.isFinite(sec) || sec <= 0) return null;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

function fmtKbps(k: number | null | undefined): string | null {
  if (k == null || !Number.isFinite(k) || k <= 0) return null;
  return k >= 1000 ? `${(k / 1000).toFixed(1)} Mbps` : `${Math.round(k)} kbps`;
}

function textFor(id: ColId, file: FileRecord, m: Meta): string | null {
  switch (id) {
    case 'name':
      return file.filename;
    case 'ext':
      return file.ext;
    case 'size':
      return formatBytes(file.sizeBytes);
    case 'mtime':
      return formatDateTime(file.mtimeMs);
    case 'vertices':
      return m?.vertexCount != null ? Number(m.vertexCount).toLocaleString() : null;
    case 'triangles':
      return m?.triangleCount != null ? Number(m.triangleCount).toLocaleString() : null;
    case 'resolution': {
      const w = m?.image?.width ?? m?.imageWidth ?? m?.video?.width;
      const h = m?.image?.height ?? m?.imageHeight ?? m?.video?.height;
      return w && h ? `${w} Ã— ${h}` : null;
    }
    case 'duration':
      return fmtDuration(
        m?.video?.durationSec ??
          m?.audio?.durationSec ??
          m?.audio?.duration ??
          m?.audio?.durationSeconds ??
          m?.audio?.length
      );
    case 'fps':
      return m?.video?.fps ? `${Math.round(m.video.fps * 100) / 100}` : null;
    case 'videoBitrate':
      return fmtKbps(m?.video?.bitrateKbps);
    case 'audioBitrate': {
      if (m?.video?.audioBitrateKbps) return fmtKbps(m.video.audioBitrateKbps);
      const raw = m?.audio?.bitrate ?? m?.audio?.bitRate;
      if (raw) return fmtKbps(raw > 1000 ? raw / 1000 : raw);
      return null;
    }
    default:
      return null;
  }
}

function Cell({ id, file, meta }: { id: ColId; file: FileRecord; meta: Meta }): ReactNode {
  if (id === 'rating') {
    return (
      <Group gap={1} wrap="nowrap">
        {file.rating > 0 ? (
          Array.from({ length: file.rating }, (_, i) => (
            <IconStarFilled key={i} size={9} color="var(--mantine-color-yellow-5)" />
          ))
        ) : (
          <Text size="xs" c="dimmed">
            â€”
          </Text>
        )}
      </Group>
    );
  }
  if (id === 'label') {
    return file.colorLabel ? (
      <IconCircleFilled size={12} color={COLOR_LABEL_HEX[file.colorLabel]} />
    ) : (
      <Text size="xs" c="dimmed">
        â€”
      </Text>
    );
  }
  const t = textFor(id, file, meta);
  return (
    <Text
      size="xs"
      c={id === 'name' ? undefined : 'dimmed'}
      ta={COLS[id].right ? 'right' : undefined}
      truncate
    >
      {t ?? 'â€”'}
    </Text>
  );
}

/**
 * Dense list view of the same files as ThumbGrid. Columns can be dragged into
 * a new order and added/removed from the "+" menu in the header; the layout is
 * saved in localStorage.
 */
export function FileListView({
  libraryId: _libraryId,
  files,
  selectedIds,
  primaryId,
  thumbVersions,
  onTileClick,
  onTileContextMenu,
  folders,
  onOpenFolder,
  onFolderContextMenu
}: Props) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [cols, setColsState] = useState<ColId[]>(() => readCols());

  const setCols = useCallback((next: ColId[]) => {
    setColsState(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // ignore
    }
  }, []);

  const template = useMemo(
    () => `24px ${cols.map((c) => COLS[c].width).join(' ')} 28px`,
    [cols]
  );

  const folderList = folders ?? [];
  const folderCount = folderList.length;

  const virtualizer = useVirtualizer({
    count: folderCount + files.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12
  });

  if (files.length + folderCount === 0) {
    return (
      <div
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--mantine-color-dimmed)'
        }}
      >
        <Text size="sm">This folder has no indexed files.</Text>
      </div>
    );
  }

  return (
    <div
      ref={scrollRef}
      style={{
        flex: 1,
        minHeight: 0,
        overflow: 'auto',
        background: 'var(--mantine-color-dark-7)'
      }}
    >
      <Header
        cols={cols}
        template={template}
        onMove={(from, to) => {
          const next = cols.filter((c) => c !== from);
          next.splice(cols.indexOf(to), 0, from);
          setCols(next);
        }}
        onToggle={(id) =>
          setCols(cols.includes(id) ? cols.filter((c) => c !== id) : [...cols, id])
        }
        onReset={() => setCols(DEFAULT_COLS)}
      />
      <div
        style={{
          height: virtualizer.getTotalSize(),
          width: '100%',
          position: 'relative'
        }}
      >
        {virtualizer.getVirtualItems().map((vRow) => {
          if (vRow.index < folderCount) {
            const f = folderList[vRow.index];
            return (
              <FolderRow
                key={'folder:' + f.path}
                node={f}
                cols={cols}
                template={template}
                style={{ transform: `translateY(${vRow.start}px)` }}
                onOpen={() => onOpenFolder?.(f.path)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  onFolderContextMenu?.(f, e.clientX, e.clientY);
                }}
              />
            );
          }
          const file = files[vRow.index - folderCount];
          return (
            <Row
              key={file.id}
              file={file}
              cols={cols}
              template={template}
              thumbVersion={thumbVersions.get(file.id) ?? 0}
              selected={selectedIds.has(file.id)}
              isPrimary={primaryId === file.id}
              style={{ transform: `translateY(${vRow.start}px)` }}
              onClick={(e) =>
                onTileClick(file.id, {
                  shift: e.shiftKey,
                  meta: e.metaKey,
                  ctrl: e.ctrlKey
                })
              }
              onContextMenu={(e) => {
                if (!onTileContextMenu) return;
                e.preventDefault();
                onTileContextMenu(file.id, e.clientX, e.clientY);
              }}
            />
          );
        })}
      </div>
    </div>
  );
}

function Header({
  cols,
  template,
  onMove,
  onToggle,
  onReset
}: {
  cols: ColId[];
  template: string;
  onMove: (from: ColId, to: ColId) => void;
  onToggle: (id: ColId) => void;
  onReset: () => void;
}) {
  const [dragId, setDragId] = useState<ColId | null>(null);
  const [overId, setOverId] = useState<ColId | null>(null);

  return (
    <div
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 2,
        height: HEADER_HEIGHT,
        display: 'grid',
        gridTemplateColumns: template,
        gap: 8,
        padding: '0 12px',
        alignItems: 'center',
        background: 'var(--mantine-color-dark-7)',
        borderBottom: '1px solid var(--mantine-color-dark-4)',
        fontSize: 10,
        textTransform: 'uppercase',
        color: 'var(--mantine-color-dimmed)',
        fontWeight: 700,
        letterSpacing: 0.4
      }}
    >
      <div />
      {cols.map((id) => (
        <div
          key={id}
          draggable
          title="Drag to reorder"
          onDragStart={(e) => {
            e.dataTransfer.setData('text/plain', id);
            e.dataTransfer.effectAllowed = 'move';
            setDragId(id);
          }}
          onDragOver={(e) => {
            e.preventDefault();
            if (overId !== id) setOverId(id);
          }}
          onDrop={(e) => {
            e.preventDefault();
            if (dragId && dragId !== id) onMove(dragId, id);
            setDragId(null);
            setOverId(null);
          }}
          onDragEnd={() => {
            setDragId(null);
            setOverId(null);
          }}
          style={{
            cursor: 'grab',
            userSelect: 'none',
            overflow: 'hidden',
            whiteSpace: 'nowrap',
            textOverflow: 'ellipsis',
            textAlign: COLS[id].right ? 'right' : 'left',
            opacity: dragId === id ? 0.4 : 1,
            borderLeft:
              overId === id && dragId && dragId !== id
                ? '2px solid var(--mantine-color-indigo-4)'
                : '2px solid transparent',
            paddingLeft: 2
          }}
        >
          {COLS[id].label}
        </div>
      ))}
      <Menu withinPortal closeOnItemClick={false} position="bottom-end" width={200} shadow="md">
        <Menu.Target>
          <ActionIcon size="xs" variant="subtle" color="gray" aria-label="Choose columns">
            <IconPlus size={12} />
          </ActionIcon>
        </Menu.Target>
        <Menu.Dropdown>
          <Menu.Label>Columns</Menu.Label>
          {ALL_COLS.map((id) => (
            <Menu.Item
              key={id}
              disabled={id === 'name'}
              leftSection={
                cols.includes(id) ? <IconCheck size={14} /> : <span style={{ width: 14 }} />
              }
              onClick={() => onToggle(id)}
            >
              {COLS[id].label}
            </Menu.Item>
          ))}
          <Menu.Divider />
          <Menu.Item onClick={onReset}>Reset to default</Menu.Item>
        </Menu.Dropdown>
      </Menu>
    </div>
  );
}

function Row({
  file,
  cols,
  template,
  thumbVersion,
  selected,
  isPrimary,
  style,
  onClick,
  onContextMenu
}: {
  file: FileRecord;
  cols: ColId[];
  template: string;
  thumbVersion: number;
  selected: boolean;
  isPrimary: boolean;
  style?: React.CSSProperties;
  onClick: (e: React.MouseEvent) => void;
  onContextMenu: (e: React.MouseEvent) => void;
}) {
  const meta = useMemo(() => parseMeta(file.metadataJson), [file.metadataJson]);
  const showThumb = file.hasThumb || thumbVersion > 0;
  const thumbUrl = showThumb ? `wh3d-thumb://${file.libraryId}/${file.id}?v=${thumbVersion}` : null;

  return (
    <button
      type="button"
      onClick={onClick}
      onContextMenu={onContextMenu}
      title={file.relPath}
      style={{
        all: 'unset',
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: ROW_HEIGHT,
        display: 'grid',
        gridTemplateColumns: template,
        gap: 8,
        padding: '0 12px',
        alignItems: 'center',
        boxSizing: 'border-box',
        cursor: 'pointer',
        background: selected ? 'var(--mantine-color-dark-5)' : 'var(--mantine-color-dark-6)',
        borderLeft: isPrimary
          ? '2px solid var(--mantine-color-indigo-4)'
          : '2px solid transparent',
        borderBottom: '1px solid var(--mantine-color-dark-7)',
        ...style
      }}
    >
      <Thumb url={thumbUrl} ext={file.ext} />
      {cols.map((id) => (
        <div key={id} style={{ minWidth: 0 }}>
          <Cell id={id} file={file} meta={meta} />
        </div>
      ))}
      <div />
    </button>
  );
}

function Thumb({ url, ext }: { url: string | null; ext: string }) {
  if (url) {
    return (
      <img
        src={url}
        alt=""
        loading="lazy"
        style={{
          width: 24,
          height: 24,
          borderRadius: 3,
          objectFit: 'cover',
          background: '#000'
        }}
      />
    );
  }
  return (
    <div
      style={{
        width: 24,
        height: 24,
        borderRadius: 3,
        background: 'var(--mantine-color-dark-5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 8,
        color: 'var(--mantine-color-dimmed)'
      }}
    >
      .{ext}
    </div>
  );
}

function FolderRow({
  node,
  cols,
  template,
  style,
  onOpen,
  onContextMenu
}: {
  node: FolderTreeNode;
  cols: ColId[];
  template: string;
  style?: React.CSSProperties;
  onOpen: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
}) {
  const [focus, setFocus] = useState(false);
  const count = node.recursiveFileCount;
  return (
    <button
      type="button"
      title={node.path}
      onDoubleClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          onOpen();
        }
      }}
      onContextMenu={onContextMenu}
      onFocus={() => setFocus(true)}
      onBlur={() => setFocus(false)}
      style={{
        all: 'unset',
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: ROW_HEIGHT,
        display: 'grid',
        gridTemplateColumns: template,
        gap: 8,
        padding: '0 12px',
        alignItems: 'center',
        boxSizing: 'border-box',
        cursor: 'pointer',
        background: focus ? 'var(--mantine-color-dark-5)' : 'var(--mantine-color-dark-6)',
        borderLeft: focus ? '2px solid var(--mantine-color-indigo-4)' : '2px solid transparent',
        borderBottom: '1px solid var(--mantine-color-dark-7)',
        ...style
      }}
    >
      <GlassFolderMini hasFiles={count > 0} />
      {cols.map((id) => (
        <div key={id} style={{ minWidth: 0 }}>
          {id === 'name' ? (
            <Text size="xs" fw={500} truncate>
              {node.name}
            </Text>
          ) : id === 'size' ? (
            <Text size="xs" c="dimmed" ta="right" truncate>
              {count} {count === 1 ? 'file' : 'files'}
            </Text>
          ) : null}
        </div>
      ))}
      <div />
    </button>
  );
}