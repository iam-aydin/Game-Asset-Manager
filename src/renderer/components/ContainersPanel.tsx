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
  IconPhoto,
  IconPlus,
  IconTrash
} from '@tabler/icons-react';
import type { CollectionWithCount, ContainerItem } from '@shared/types';
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
  onPickItem
}: Props) {
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set());
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const createDone = useRef(false);
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const renameDone = useRef(false);
  const [menu, setMenu] = useState({ opened: false, x: 0, y: 0, id: -1, name: '' });

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
        const isSelected = c.id === selectedCollectionId;
        return (
          <div key={c.id}>
            <Group
              gap={2}
              wrap="nowrap"
              onContextMenu={(e) => {
                e.preventDefault();
                setMenu({ opened: true, x: e.clientX, y: e.clientY, id: c.id, name: c.name });
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
        </Menu.Dropdown>
      </Menu>,
        document.body
      )}
    </Stack>
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