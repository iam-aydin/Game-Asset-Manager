import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ActionIcon,
  Badge,
  Group,
  Menu,
  Stack,
  Text,
  TextInput,
  UnstyledButton
} from '@mantine/core';
import {
  IconBox,
  IconChevronDown,
  IconChevronRight,
  IconDownload,
  IconEdit,
  IconFolder,
  IconFolderPlus,
  IconPhoto,
  IconPlus,
  IconTrash
} from '@tabler/icons-react';
import type { CollectionWithCount, ContainerFolder, ContainerItem } from '@shared/types';
import { notifications } from '@mantine/notifications';
import { ipc } from '../ipc-client';

interface Props {
  libraryId: string | null;
  collections: CollectionWithCount[];
  selectedCollectionId: number | null;
  onSelect: (id: number | null) => void;
  onCreate: (name: string) => void;
  onRename: (id: number, name: string) => void;
  onDelete: (id: number) => void;
  onExportZip: (id: number) => void;
  onExportContactSheet: (id: number) => void;
  /** Click on an item: jump to its library, then open the container. */
  onPickItem: (libraryId: string, collectionId: number) => void;
  /** Folder (inside the selected container) that is open, or null for the container's top level. */
  selectedContainerFolderId: number | null;
  onSelectFolder: (containerId: number, folderId: number | null) => void;
  onNewFolder: (containerId: number, parentFolderId: number | null) => void;
  onRenameFolder: (containerId: number, folderId: number, currentName: string) => void;
  onDeleteFolder: (containerId: number, folderId: number) => void;
}

const LINE = 'color-mix(in srgb, var(--mantine-color-indigo-4) 38%, transparent)';
void IconPhoto;
void [ActionIcon, IconChevronDown, IconChevronRight, ContainerFiles];

async function zipToDesktop(id: number): Promise<void> {
  const r = await ipc.zipContainerToDesktop(id);
  if (!r.ok) {
    notifications.show({ color: 'red', title: 'Zip failed', message: r.error });
    return;
  }
  notifications.show({
    color: 'green',
    title: 'Zipped to Desktop',
    message: `${r.fileCount} file${r.fileCount === 1 ? '' : 's'} -> ${r.path}${
      r.skipped > 0 ? ` (${r.skipped} missing, skipped)` : ''
    }`
  });
}

/**
 * Containers: simple named groups of assets (for example "one game" or "one
 * project"), shown as a small tree. Expand a container to see what is in it.
 */
export function ContainersPanel({
  libraryId,
  collections,
  selectedCollectionId,
  onSelect,
  onCreate,
  onRename,
  onDelete,
  onExportZip,
  onExportContactSheet,
  onPickItem,
  selectedContainerFolderId,
  onSelectFolder,
  onNewFolder,
  onRenameFolder,
  onDeleteFolder
}: Props) {
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set());
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const createDone = useRef(false);
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const renameDone = useRef(false);
  const [menu, setMenu] = useState({
    opened: false,
    x: 0,
    y: 0,
    id: -1,
    name: '',
    folderId: null as number | null
  });
  // Virtual folders of every expanded container.
  const [folderMap, setFolderMap] = useState<Record<number, ContainerFolder[]>>({});
  useEffect(() => {
    let alive = true;
    for (const id of expanded) {
      ipc
        .listContainerFolders(id)
        .then((r) => {
          if (alive) setFolderMap((m) => ({ ...m, [id]: r }));
        })
        .catch(() => {});
    }
    return () => {
      alive = false;
    };
  }, [expanded, collections]);

  const toggle = (id: number) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  void expanded;
  void toggle;
  void libraryId;

  const startCreate = () => {
    createDone.current = false;
    setNewName('');
    setCreating(true);
  };
  const finishCreate = (mode: 'enter' | 'blur' | 'esc') => {
    if (createDone.current) return;
    createDone.current = true;
    const typed = newName.trim();
    setCreating(false);
    setNewName('');
    if (mode === 'esc') return;
    const name = typed || (mode === 'enter' ? 'New container' : '');
    if (name) onCreate(name);
  };

  const startRename = (id: number, current: string) => {
    renameDone.current = false;
    setRenameValue(current);
    setRenamingId(id);
  };
  const finishRename = (mode: 'enter' | 'blur' | 'esc') => {
    if (renameDone.current) return;
    renameDone.current = true;
    const id = renamingId;
    const name = renameValue.trim();
    setRenamingId(null);
    if (mode !== 'esc' && id != null && name) onRename(id, name);
  };

  return (
    <Stack gap={4}>
      {creating ? (
        <TextInput
          size="xs"
          autoFocus
          placeholder="Container name (a game, a project...)"
          value={newName}
          onChange={(e) => setNewName(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') finishCreate('enter');
            else if (e.key === 'Escape') finishCreate('esc');
            e.stopPropagation();
          }}
          onBlur={() => finishCreate('blur')}
        />
      ) : (
        <UnstyledButton
          onClick={startCreate}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '4px 6px',
            borderRadius: 6,
            border: '1px dashed color-mix(in srgb, var(--mantine-color-indigo-4) 50%, transparent)',
            color: 'var(--mantine-color-indigo-2)',
            fontSize: 12
          }}
        >
          <IconPlus size={14} />
          New container
        </UnstyledButton>
      )}

      {collections.length === 0 && !creating && (
        <Text size="xs" c="dimmed">
          Group assets by game or project, so you know what you added where. Click + to create one.
        </Text>
      )}

      {collections.map((c) => {
        const isSelected = c.id === selectedCollectionId && selectedContainerFolderId == null;
        return (
          <div key={c.id}>
            <Group
              gap={2}
              wrap="nowrap"
              onContextMenu={(e) => {
                e.preventDefault();
                setMenu({ opened: true, x: e.clientX, y: e.clientY, id: c.id, name: c.name, folderId: null });
              }}
              style={{
                borderRadius: 6,
                background: isSelected
                  ? 'color-mix(in srgb, var(--mantine-color-indigo-4) 22%, transparent)'
                  : undefined,
                borderLeft: isSelected
                  ? '2px solid var(--mantine-color-indigo-4)'
                  : '2px solid transparent'
              }}
            >
              <UnstyledButton
                onClick={() => toggle(c.id)}
                aria-label="Show folders"
                style={{ padding: '0 2px', display: 'flex', alignItems: 'center' }}
              >
                {expanded.has(c.id) ? <IconChevronDown size={12} /> : <IconChevronRight size={12} />}
              </UnstyledButton>
              {renamingId === c.id ? (
                <TextInput
                  size="xs"
                  autoFocus
                  style={{ flex: 1 }}
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.currentTarget.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') finishRename('enter');
                    else if (e.key === 'Escape') finishRename('esc');
                    e.stopPropagation();
                  }}
                  onBlur={() => finishRename('blur')}
                />
              ) : (
                <UnstyledButton
                  onClick={() => onSelect(c.id)}
                  style={{ flex: 1, minWidth: 0, padding: '4px 4px' }}
                >
                  <Group gap={6} wrap="nowrap">
                    <IconBox size={14} color="var(--mantine-color-indigo-3)" />
                    <Text size="sm" truncate style={{ flex: 1 }}>
                      {c.name}
                    </Text>
                    <Badge size="xs" variant="light" color="gray">
                      {c.fileCount}
                    </Badge>
                  </Group>
                </UnstyledButton>
              )}
            </Group>
            {expanded.has(c.id) && (
              <ContainerFolderRows
                containerId={c.id}
                folders={folderMap[c.id] ?? []}
                parentId={null}
                depth={0}
                activeContainerId={selectedCollectionId}
                activeFolderId={selectedContainerFolderId}
                onSelectFolder={onSelectFolder}
                onMenu={(x, y, folder) =>
                  setMenu({ opened: true, x, y, id: c.id, name: folder.name, folderId: folder.id })
                }
              />
            )}
          </div>
        );
      })}

      {createPortal(
      <Menu
        opened={menu.opened}
        onChange={(open) => {
          if (!open) setMenu((m) => ({ ...m, opened: false }));
        }}
        position="bottom-start"
        floatingStrategy="fixed"
        offset={0}
        withinPortal
        shadow="md"
        width={200}
      >
        <Menu.Target>
          <div
            style={{
              position: 'fixed',
              top: menu.y,
              left: menu.x,
              width: 1,
              height: 1,
              pointerEvents: 'none'
            }}
          />
        </Menu.Target>
        <Menu.Dropdown>
          <Menu.Label>{menu.name}</Menu.Label>
          <Menu.Item
            leftSection={<IconFolderPlus size={14} />}
            onClick={() => {
              const cid = menu.id;
              const fid = menu.folderId;
              setMenu((m) => ({ ...m, opened: false }));
              setExpanded((prev) => new Set(prev).add(cid));
              onNewFolder(cid, fid);
            }}
          >
            New folder
          </Menu.Item>
          {menu.folderId != null ? (
            <>
              <Menu.Item
                leftSection={<IconEdit size={14} />}
                onClick={() => {
                  const cid = menu.id;
                  const fid = menu.folderId as number;
                  const name = menu.name;
                  setMenu((m) => ({ ...m, opened: false }));
                  onRenameFolder(cid, fid, name);
                }}
              >
                Rename
              </Menu.Item>
              <Menu.Divider />
              <Menu.Item
                color="red"
                leftSection={<IconTrash size={14} />}
                onClick={() => {
                  const cid = menu.id;
                  const fid = menu.folderId as number;
                  setMenu((m) => ({ ...m, opened: false }));
                  onDeleteFolder(cid, fid);
                }}
              >
                Delete folder
              </Menu.Item>
            </>
          ) : (
            <>
          <Menu.Item
            leftSection={<IconEdit size={14} />}
            onClick={() => {
              const id = menu.id;
              const name = menu.name;
              setMenu((m) => ({ ...m, opened: false }));
              startRename(id, name);
            }}
          >
            Rename
          </Menu.Item>
          <Menu.Item
            leftSection={<IconDownload size={14} />}
            onClick={() => {
              setMenu((m) => ({ ...m, opened: false }));
              onExportZip(menu.id);
            }}
          >
            Export as ZIP
          </Menu.Item>

          <Menu.Item
            leftSection={<IconDownload size={14} />}
            onClick={() => {
              const id = menu.id;
              setMenu((m) => ({ ...m, opened: false }));
              void zipToDesktop(id);
            }}
          >
            Zip to Desktop
          </Menu.Item>
          <Menu.Divider />
          <Menu.Item
            color="red"
            leftSection={<IconTrash size={14} />}
            onClick={() => {
              setMenu((m) => ({ ...m, opened: false }));
              onDelete(menu.id);
            }}
          >
            Delete container
          </Menu.Item>
            </>
          )}
        </Menu.Dropdown>
      </Menu>,
        document.body
      )}
    </Stack>
  );
}

/** The virtual folders of one container, as an indented tree. */
function ContainerFolderRows({
  containerId,
  folders,
  parentId,
  depth,
  activeContainerId,
  activeFolderId,
  onSelectFolder,
  onMenu
}: {
  containerId: number;
  folders: ContainerFolder[];
  parentId: number | null;
  depth: number;
  activeContainerId: number | null;
  activeFolderId: number | null;
  onSelectFolder: (containerId: number, folderId: number | null) => void;
  onMenu: (x: number, y: number, folder: ContainerFolder) => void;
}) {
  const kids = folders
    .filter((f) => (f.parentId ?? null) === parentId)
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
  if (kids.length === 0) {
    return depth === 0 ? (
      <Text size="xs" c="dimmed" pl={22} py={2}>
        No folders yet. Right-click the container to add one.
      </Text>
    ) : null;
  }
  return (
    <>
      {kids.map((f) => {
        const active = activeContainerId === containerId && activeFolderId === f.id;
        return (
          <div key={f.id}>
            <UnstyledButton
              onClick={() => onSelectFolder(containerId, f.id)}
              onContextMenu={(e) => {
                e.preventDefault();
                onMenu(e.clientX, e.clientY, f);
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                width: '100%',
                padding: '3px 6px 3px ' + (14 + depth * 14) + 'px',
                borderRadius: 6,
                background: active
                  ? 'color-mix(in srgb, var(--mantine-color-indigo-4) 22%, transparent)'
                  : undefined
              }}
            >
              <IconFolder size={13} color="var(--mantine-color-indigo-3)" />
              <Text size="xs" truncate style={{ flex: 1, minWidth: 0 }}>
                {f.name}
              </Text>
              <Badge size="xs" variant="light" color="gray">
                {f.totalCount}
              </Badge>
            </UnstyledButton>
            <ContainerFolderRows
              containerId={containerId}
              folders={folders}
              parentId={f.id}
              depth={depth + 1}
              activeContainerId={activeContainerId}
              activeFolderId={activeFolderId}
              onSelectFolder={onSelectFolder}
              onMenu={onMenu}
            />
          </div>
        );
      })}
    </>
  );
}

function ContainerFiles({
  libraryId,
  collectionId,
  version,
  onPick
}: {
  libraryId: string;
  collectionId: number;
  version: number;
  onPick: (libraryId: string) => void;
}) {
  const [files, setFiles] = useState<ContainerItem[] | null>(null);

  useEffect(() => {
    let alive = true;
    ipc
      .listContainerItems(collectionId)
      .then((r) => {
        if (alive) setFiles(r);
      })
      .catch(() => {
        if (alive) setFiles([]);
      });
    return () => {
      alive = false;
    };
  }, [libraryId, collectionId, version]);

  if (files == null) {
    return (
      <Text size="xs" c="dimmed" py={2}>
        Loading...
      </Text>
    );
  }
  if (files.length === 0) {
    return (
      <Text size="xs" c="dimmed" py={2}>
        Empty. Select assets, then use Add to collection in the details panel.
      </Text>
    );
  }
  return (
    <>
      {files.map((f) => (
        <UnstyledButton
          key={`${f.libraryId}:${f.relPath}`}
          onClick={() => onPick(f.libraryId)}
          title={f.relPath}
          style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '2px 4px', width: '100%' }}
        >
          <span style={{ width: 8, height: 1, background: LINE, flexShrink: 0 }} />
          <Text size="xs" truncate style={{ flex: 1, minWidth: 0 }}>
            {f.filename}{' '}
            <Text span size="xs" c="dimmed">
              Â· {f.libraryName}
            </Text>
          </Text>
        </UnstyledButton>
      ))}
    </>
  );
}