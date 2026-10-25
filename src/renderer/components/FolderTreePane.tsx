import { useEffect, useRef, useState } from 'react';
import { Text } from '@mantine/core';
import {
  IconChevronDown,
  IconChevronRight,
  IconDatabase,
  IconStar,
  IconStarFilled
} from '@tabler/icons-react';
import type { FolderTreeNode } from '@shared/types';
import { FolderContextMenu, type FolderMenuState } from './FolderTile';
import { GlassFolderMini } from './FolderGlyphs';


interface Props {
  root: FolderTreeNode | null;
  rootLabel: string;
  /** null when no folder is the current location (collection / all-models view). */
  selectedPath: string | null;
  onSelect: (path: string) => void;
  isFavorite: (path: string) => boolean;
  onToggleFavorite: (path: string) => void;
  onRename: (path: string) => void;
  onReveal: (path: string) => void;
  onRescan: (path: string) => void;
}

/** Windows Explorer style navigation pane: the library's folders as a tree. */
export function FolderTreePane({
  root,
  rootLabel,
  selectedPath,
  onSelect,
  isFavorite,
  onToggleFavorite,
  onRename,
  onReveal,
  onRescan
}: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(['']));
  const [menu, setMenu] = useState<FolderMenuState>({
    opened: false,
    x: 0,
    y: 0,
    path: '',
    name: ''
  });

  // Whenever the location changes, open the path down to it (and the folder itself).
  useEffect(() => {
    if (selectedPath == null) return;
    setExpanded((prev) => {
      const next = new Set(prev);
      next.add('');
      let cur = '';
      for (const seg of selectedPath.split('/').filter(Boolean)) {
        cur = cur ? `${cur}/${seg}` : seg;
        next.add(cur);
      }
      return next;
    });
  }, [selectedPath]);

  const toggle = (path: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  if (!root) {
    return (
      <div style={{ flex: 1, minHeight: 0, padding: 12 }}>
        <Text size="sm" c="dimmed">
          Loading folders...
        </Text>
      </div>
    );
  }
  if (root.recursiveFileCount === 0) {
    return (
      <div style={{ flex: 1, minHeight: 0, padding: 12 }}>
        <Text size="sm" c="dimmed">
          No files indexed yet.
        </Text>
      </div>
    );
  }

  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden', padding: '6px 6px' }}>
      <TreeRow
        node={root}
        label={rootLabel}
        depth={0}
        isRoot
        expanded={expanded}
        toggle={toggle}
        selectedPath={selectedPath}
        onSelect={onSelect}
        isFavorite={isFavorite}
        onToggleFavorite={onToggleFavorite}
        onContext={(x, y, node) =>
          setMenu({ opened: true, x, y, path: node.path, name: node.name })
        }
      />
      <FolderContextMenu
        state={menu}
        onClose={() => setMenu((m) => ({ ...m, opened: false }))}
        isFavorite={isFavorite}
        onToggleFavorite={onToggleFavorite}
        onRename={onRename}
        onReveal={onReveal}
        onRescan={onRescan}
      />
    </div>
  );
}

function MiniFolder({ open }: { open: boolean }) {
  return <GlassFolderMini open={open} />;
}

function TreeRow({
  node,
  label,
  depth,
  isRoot,
  expanded,
  toggle,
  selectedPath,
  onSelect,
  isFavorite,
  onToggleFavorite,
  onContext
}: {
  node: FolderTreeNode;
  label?: string;
  depth: number;
  isRoot?: boolean;
  expanded: Set<string>;
  toggle: (path: string) => void;
  selectedPath: string | null;
  onSelect: (path: string) => void;
  isFavorite: (path: string) => boolean;
  onToggleFavorite: (path: string) => void;
  onContext: (x: number, y: number, node: FolderTreeNode) => void;
}) {
  const [hover, setHover] = useState(false);
  const rowRef = useRef<HTMLDivElement | null>(null);
  const isOpen = expanded.has(node.path);
  const selected = selectedPath != null && node.path === selectedPath;
  const hasChildren = node.children.length > 0;
  const fav = !isRoot && isFavorite(node.path);

  useEffect(() => {
    if (selected) rowRef.current?.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  const children = isOpen
    ? [...node.children].sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
      )
    : [];

  return (
    <div>
      <div
        ref={rowRef}
        role="treeitem"
        aria-selected={selected}
        title={node.path || label}
        onClick={() => onSelect(node.path)}
        onDoubleClick={() => hasChildren && toggle(node.path)}
        onContextMenu={(e) => {
          if (isRoot) return;
          e.preventDefault();
          onContext(e.clientX, e.clientY, node);
        }}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          height: 28,
          paddingLeft: 2 + depth * 14,
          paddingRight: 6,
          borderRadius: 6,
          cursor: 'pointer',
          boxSizing: 'border-box',
          background: selected
            ? 'color-mix(in srgb, var(--mantine-color-indigo-4) 24%, transparent)'
            : hover
              ? 'rgba(255, 255, 255, 0.06)'
              : 'transparent',
          boxShadow: selected ? 'inset 2px 0 0 var(--mantine-color-indigo-4)' : undefined
        }}
      >
        <span
          onClick={(e) => {
            e.stopPropagation();
            if (hasChildren) toggle(node.path);
          }}
          style={{
            width: 18,
            height: 18,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            color: 'var(--mantine-color-dimmed)',
            visibility: hasChildren ? 'visible' : 'hidden'
          }}
        >
          {isOpen ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
        </span>
        {isRoot ? (
          <IconDatabase size={16} color="var(--mantine-color-indigo-3)" style={{ flexShrink: 0 }} />
        ) : (
          <MiniFolder open={isOpen || selected} />
        )}
        <span
          style={{
            flex: 1,
            minWidth: 0,
            fontSize: 13,
            fontWeight: selected || isRoot ? 600 : 400,
            color: 'var(--mantine-color-text)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap'
          }}
        >
          {isRoot ? label : node.name}
        </span>
        {(hover || fav) && !isRoot ? (
          <span
            role="button"
            aria-label={fav ? 'Remove from favorites' : 'Add to favorites'}
            onClick={(e) => {
              e.stopPropagation();
              onToggleFavorite(node.path);
            }}
            style={{
              display: 'flex',
              flexShrink: 0,
              color: fav ? 'var(--mantine-color-yellow-5)' : 'var(--mantine-color-dimmed)'
            }}
          >
            {fav ? <IconStarFilled size={14} /> : <IconStar size={14} />}
          </span>
        ) : (
          <span style={{ fontSize: 11, color: 'var(--mantine-color-dimmed)', flexShrink: 0 }}>
            {node.recursiveFileCount}
          </span>
        )}
      </div>
      {children.map((child) => (
        <TreeRow
          key={child.path}
          node={child}
          depth={depth + 1}
          expanded={expanded}
          toggle={toggle}
          selectedPath={selectedPath}
          onSelect={onSelect}
          isFavorite={isFavorite}
          onToggleFavorite={onToggleFavorite}
          onContext={onContext}
        />
      ))}
    </div>
  );
}