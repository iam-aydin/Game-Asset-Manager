import { useMemo, useState } from 'react';
import type React from 'react';
import { ActionIcon, Badge, Group, Menu, Stack, Text, UnstyledButton } from '@mantine/core';
import {
  IconChevronDown,
  IconChevronRight,
  IconEdit,
  IconFolder,
  IconFolderOpen,
  IconRefresh
} from '@tabler/icons-react';
import type { FolderTreeNode } from '@shared/types';

interface FolderContextMenuState {
  opened: boolean;
  x: number;
  y: number;
  folderPath: string;
  folderName: string;
}

interface Props {
  root: FolderTreeNode | null;
  selectedPath: string | null;
  onSelect: (path: string) => void;
  /** Called when files are dropped onto a folder row. Optional. */
  onDropFiles?: (toParentDir: string, fileIds: number[]) => void;
  onRenameFolder?: (path: string) => void;
  onRevealFolder?: (path: string) => void;
  onRescanFolder?: (path: string) => void;
}

/**
 * Lightweight recursive folder tree.
 */
export function FolderTree({
  root,
  selectedPath,
  onSelect,
  onDropFiles,
  onRenameFolder,
  onRevealFolder,
  onRescanFolder
}: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(['']));
  const [ctxMenu, setCtxMenu] = useState<FolderContextMenuState>({
    opened: false,
    x: 0,
    y: 0,
    folderPath: '',
    folderName: ''
  });

  const ensureExpanded = useMemo(() => {
    if (!selectedPath) return expanded;
    if (expanded.has(selectedPath)) return expanded;
    const next = new Set(expanded);
    let cur = '';
    for (const seg of selectedPath.split('/').filter(Boolean)) {
      next.add(cur);
      cur = cur ? `${cur}/${seg}` : seg;
    }
    next.add(selectedPath);
    return next;
  }, [selectedPath, expanded]);

  const toggle = (path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const handleContextMenu = (e: React.MouseEvent, path: string, name: string) => {
    e.preventDefault();
    e.stopPropagation();
    setCtxMenu({
      opened: true,
      x: e.clientX,
      y: e.clientY,
      folderPath: path,
      folderName: name
    });
  };

  const closeCtxMenu = () => setCtxMenu((prev) => ({ ...prev, opened: false }));

  // Fallback handlers using window.api / electron IPC when the parent
  // didn't wire up onRenameFolder/onRevealFolder/onRescanFolder. These are
  // now actually called from the menu below (previously they were defined
  // but never invoked, so the menu items silently no-op'd whenever the
  // parent hadn't passed those props).
  const handleRename = (path: string) => {
    if (onRenameFolder) {
      onRenameFolder(path);
    } else {
      const newName = prompt('Rename folder:', ctxMenu.folderName);
      if (newName && newName !== ctxMenu.folderName) {
        if (typeof window !== 'undefined' && 'api' in window) {
          (window as any).api?.renameFolder?.(path, newName);
        }
      }
    }
  };

  const handleReveal = (path: string) => {
    if (onRevealFolder) {
      onRevealFolder(path);
    } else {
      // Direct electron IPC fallback check
      if (typeof window !== 'undefined' && 'api' in window) {
        (window as any).api?.revealInExplorer?.(path);
      }
    }
  };

  const handleRescan = (path: string) => {
    if (onRescanFolder) {
      onRescanFolder(path);
    } else {
      if (typeof window !== 'undefined' && 'api' in window) {
        (window as any).api?.rescanFolder?.(path);
      }
    }
  };

  if (!root) {
    return (
      <Text c="dimmed" size="sm">
        No library selected
      </Text>
    );
  }

  if (root.recursiveFileCount === 0) {
    return (
      <Stack gap={4}>
        <Text size="sm" c="dimmed">
          No 3D files found yet.
        </Text>
        <Text size="xs" c="dimmed">
          Supported: glb, fbx, gltf, obj, stl, ply, 3mf
        </Text>
      </Stack>
    );
  }

  return (
    <>
      <Stack gap={2}>
        <TreeRow
          node={root}
          depth={0}
          expanded={ensureExpanded}
          toggle={toggle}
          selectedPath={selectedPath}
          onSelect={onSelect}
          onDropFiles={onDropFiles}
          onContextMenu={handleContextMenu}
        />
      </Stack>

      <Menu
        opened={ctxMenu.opened}
        onChange={(open) => {
          if (!open) closeCtxMenu();
        }}
        position="bottom-start"
        floatingStrategy="fixed"
        offset={0}
        middlewares={{
          flip: { fallbackPlacements: ['top-start'] },
          shift: { padding: 8 }
        }}
        withinPortal
        shadow="md"
        width={200}
      >
        <Menu.Target>
          <div
            style={{
              position: 'fixed',
              top: ctxMenu.y,
              left: ctxMenu.x,
              width: 1,
              height: 1,
              pointerEvents: 'none'
            }}
          />
        </Menu.Target>

        <Menu.Dropdown>
          <Menu.Label>{ctxMenu.folderName || 'Folder'}</Menu.Label>

          <Menu.Item
            leftSection={<IconEdit size={14} />}
            onClick={() => {
              const path = ctxMenu.folderPath;
              closeCtxMenu();
              handleRename(path);
            }}
          >
            Rename…
          </Menu.Item>

          <Menu.Item
            leftSection={<IconFolderOpen size={14} />}
            onClick={() => {
              const path = ctxMenu.folderPath;
              closeCtxMenu();
              handleReveal(path);
            }}
          >
            Show in folder
          </Menu.Item>

          <Menu.Divider />

          <Menu.Item
            leftSection={<IconRefresh size={14} />}
            onClick={() => {
              const path = ctxMenu.folderPath;
              closeCtxMenu();
              handleRescan(path);
            }}
          >
            Rescan folder
          </Menu.Item>
        </Menu.Dropdown>
      </Menu>
    </>
  );
}

function TreeRow({
  node,
  depth,
  expanded,
  toggle,
  selectedPath,
  onSelect,
  onDropFiles,
  onContextMenu
}: {
  node: FolderTreeNode;
  depth: number;
  expanded: Set<string>;
  toggle: (path: string) => void;
  selectedPath: string | null;
  onSelect: (path: string) => void;
  onDropFiles?: (toParentDir: string, fileIds: number[]) => void;
  onContextMenu: (e: React.MouseEvent, path: string, name: string) => void;
}) {
  const isExpanded = expanded.has(node.path);
  const isSelected = node.path === selectedPath;
  const hasChildren = node.children.length > 0;
  const [dragHover, setDragHover] = useState(false);

  const acceptsDrop = onDropFiles != null;
  const handleDragOver = (e: React.DragEvent) => {
    if (!acceptsDrop) return;
    if (!e.dataTransfer.types.includes('application/x-wh3d-file-ids')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragHover(true);
  };
  const handleDragLeave = () => setDragHover(false);
  const handleDrop = (e: React.DragEvent) => {
    setDragHover(false);
    if (!acceptsDrop) return;
    const raw = e.dataTransfer.getData('application/x-wh3d-file-ids');
    if (!raw) return;
    e.preventDefault();
    try {
      const ids = JSON.parse(raw) as number[];
      if (Array.isArray(ids) && ids.every((n) => typeof n === 'number')) {
        onDropFiles(node.path, ids);
      }
    } catch {
      // ignore
    }
  };

  return (
    <>
      <Group
        gap={2}
        wrap="nowrap"
        onContextMenu={(e) => onContextMenu(e, node.path, node.name)}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        style={{
          paddingLeft: depth * 12,
          borderRadius: 4,
          background: dragHover
            ? 'var(--mantine-color-indigo-9)'
            : isSelected
              ? 'var(--mantine-color-dark-5)'
              : undefined,
          outline: dragHover ? '1px dashed var(--mantine-color-indigo-4)' : undefined
        }}
      >
        <ActionIcon
          variant="transparent"
          size="sm"
          onClick={() => hasChildren && toggle(node.path)}
          aria-label={isExpanded ? 'Collapse' : 'Expand'}
          style={{ visibility: hasChildren ? 'visible' : 'hidden' }}
        >
          {isExpanded ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
        </ActionIcon>
        <UnstyledButton
          onClick={() => onSelect(node.path)}
          style={{ flex: 1, padding: '4px 4px', minWidth: 0 }}
        >
          <Group gap={6} wrap="nowrap">
            {isExpanded && hasChildren ? (
              <IconFolderOpen size={14} />
            ) : (
              <IconFolder size={14} />
            )}
            <Text size="sm" truncate style={{ flex: 1 }}>
              {node.name}
            </Text>
            <Badge size="xs" variant="light" color="gray">
              {node.recursiveFileCount}
            </Badge>
          </Group>
        </UnstyledButton>
      </Group>
      {isExpanded &&
        node.children.map((child) => (
          <TreeRow
            key={child.path}
            node={child}
            depth={depth + 1}
            expanded={expanded}
            toggle={toggle}
            selectedPath={selectedPath}
            onSelect={onSelect}
            onDropFiles={onDropFiles}
            onContextMenu={onContextMenu}
          />
        ))}
    </>
  );
}