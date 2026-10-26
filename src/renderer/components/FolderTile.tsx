import { useState } from 'react';
import type React from 'react';
import { Menu } from '@mantine/core';
import { IconEdit, IconFolderOpen, IconRefresh, IconStar } from '@tabler/icons-react';
import type { FolderTreeNode } from '@shared/types';
import { GlassFolderBig } from './FolderGlyphs';

const TILE_PADDING = 6;
const TILE_BORDER = 2;
const LABEL_HEIGHT = 34;

/**
 * Folder color follows the theme. It reads --wh3d-folder-accent if a theme
 * defines it, otherwise the theme's indigo accent. Every shade is derived from
 * that one color with color-mix, so switching themes recolors all folders.
 */

export function FolderTile({
  node,
  tileHeight,
  onOpen,
  onContextMenu
}: {
  node: FolderTreeNode;
  tileHeight: number;
  onOpen: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
}) {
  const [hover, setHover] = useState(false);
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
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocus={() => setFocus(true)}
      onBlur={() => setFocus(false)}
      style={{
        all: 'unset',
        cursor: 'pointer',
        display: 'flex',
        flexDirection: 'column',
        height: tileHeight,
        padding: TILE_PADDING,
        borderRadius: 6,
        border: focus
          ? `${TILE_BORDER}px solid var(--mantine-color-indigo-5)`
          : `${TILE_BORDER}px solid transparent`,
        background: focus
          ? 'var(--mantine-color-dark-5)'
          : hover
            ? 'var(--mantine-color-dark-6)'
            : 'transparent',
        boxSizing: 'border-box',
        overflow: 'hidden'
      }}
    >
      <div
        style={{
          position: 'relative',
          width: '100%',
          aspectRatio: '1 / 1',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center'
        }}
      >
        <GlassFolderBig hasFiles={count > 0} />

        {count > 0 && (
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
              color: 'var(--mantine-color-white)',
              background: 'rgba(12, 13, 16, 0.55)',
              WebkitBackdropFilter: 'blur(8px) saturate(140%)',
              backdropFilter: 'blur(8px) saturate(140%)',
              border: '1px solid rgba(255, 255, 255, 0.22)',
              textShadow: '0 1px 3px rgba(0, 0, 0, 0.6)',
              pointerEvents: 'none'
            }}
          >
            {count}
          </div>
        )}
      </div>
      <div style={{ height: LABEL_HEIGHT, marginTop: 4, minWidth: 0, overflow: 'hidden' }}>
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
          {node.name}
        </div>
        <div style={{ fontSize: 11, color: 'var(--mantine-color-dimmed)' }}>
          {count} {count === 1 ? 'file' : 'files'}
        </div>
      </div>
    </button>
  );
}

export interface FolderMenuState {
  opened: boolean;
  x: number;
  y: number;
  path: string;
  name: string;
}

export function FolderContextMenu({
  state,
  onClose,
  isFavorite,
  onToggleFavorite,
  onRename,
  onReveal,
  onRescan
}: {
  state: FolderMenuState;
  onClose: () => void;
  isFavorite: (path: string) => boolean;
  onToggleFavorite: (path: string) => void;
  onRename: (path: string) => void;
  onReveal: (path: string) => void;
  onRescan: (path: string) => void;
}) {
  const run = (fn: (p: string) => void) => () => {
    const p = state.path;
    onClose();
    fn(p);
  };
  return (
    <Menu
      opened={state.opened}
      onChange={(open) => {
        if (!open) onClose();
      }}
      position="bottom-start"
      floatingStrategy="fixed"
      offset={0}
      withinPortal
      shadow="md"
      width={210}
    >
      <Menu.Target>
        <div
          style={{
            position: 'fixed',
            top: state.y,
            left: state.x,
            width: 1,
            height: 1,
            pointerEvents: 'none'
          }}
        />
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Label>{state.name || 'Folder'}</Menu.Label>
        <Menu.Item leftSection={<IconStar size={14} />} onClick={run(onToggleFavorite)}>
          {isFavorite(state.path) ? 'Remove from favorites' : 'Add to favorites'}
        </Menu.Item>
        <Menu.Item leftSection={<IconEdit size={14} />} onClick={run(onRename)}>
          Rename...
        </Menu.Item>
        <Menu.Item leftSection={<IconFolderOpen size={14} />} onClick={run(onReveal)}>
          Show in folder
        </Menu.Item>
        <Menu.Divider />
        <Menu.Item leftSection={<IconRefresh size={14} />} onClick={run(onRescan)}>
          Rescan folder
        </Menu.Item>
      </Menu.Dropdown>
    </Menu>
  );
}