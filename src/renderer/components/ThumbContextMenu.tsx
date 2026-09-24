import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Autocomplete,
  Button,
  Group,
  ScrollArea,
  Menu,
  Modal,
  Stack,
  Text,
  UnstyledButton
} from '@mantine/core';
import {
  IconAppWindow,
  IconCircleMinus,
  IconExternalLink,
  IconFolderOpen,
  IconFolderPlus,
  IconFolders,
  IconHash,
  IconPlus,
  IconEdit,
  IconRefresh,
  IconTag,
  IconTagOff,
  IconCopy,
  IconTrash
} from '@tabler/icons-react';
import type {
  CollectionRecord,
  CollectionWithCount,
  FileRecord,
  TagRecord,
  TagWithCount
} from '@shared/types';
import type { ExternalAppRegistration } from '@shared/preferences';
import { ipc } from '../ipc-client';

interface Props {
  opened: boolean;
  /** Viewport coordinates of the click that opened the menu. */
  x: number;
  y: number;
  onClose: () => void;

  libraryId: string;
  selectedFiles: FileRecord[];
  /** Primary (right-clicked) file for single-file actions like Open with / Reveal. */
  primaryFile: FileRecord | null;
  onOpenPreferences: () => void;

  allTags: TagWithCount[];
  collections: CollectionWithCount[];
  /** Non-null when the user is currently viewing a collection. */
  activeCollectionId: number | null;

  onBulkAddTag: (tagName: string) => Promise<void>;
  onBulkRemoveTag: (tagId: number) => Promise<void>;
  onBulkRerender: () => Promise<void>;
  onBatchRename: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onAddToCollection: (collectionId: number, fileIds: number[]) => Promise<void> | void;
  onRemoveFromCollection: (collectionId: number, fileIds: number[]) => Promise<void> | void;
  onCreateCollection: (name: string) => Promise<CollectionRecord | null>;
}

type SubModal =
  | { kind: 'none' }
  | { kind: 'add-tag' }
  | { kind: 'remove-tag' }
  | { kind: 'new-collection' };

/**
 * Right-click context menu over the thumbnail grid. Acts on the current
 * multi-selection.
 */
export function ThumbContextMenu(props: Props) {
  const {
    opened,
    x,
    y,
    onClose,
    libraryId,
    selectedFiles,
    primaryFile,
    onOpenPreferences,
    allTags,
    collections,
    activeCollectionId,
    onBulkAddTag,
    onBulkRemoveTag,
    onBulkRerender,
    onBatchRename,
    onDuplicate,
    onDelete,
    onAddToCollection,
    onRemoveFromCollection,
    onCreateCollection
  } = props;

  const fileIds = useMemo(() => selectedFiles.map((f) => f.id), [selectedFiles]);
  const [modal, setModal] = useState<SubModal>({ kind: 'none' });
  const activeCollection =
    activeCollectionId != null
      ? collections.find((c) => c.id === activeCollectionId) ?? null
      : null;

  // Aggregate tags applied to the selection so "Remove tag" knows what to offer.
  const [appliedTags, setAppliedTags] = useState<TagRecord[]>([]);
  const refToken = useRef(0);
  
  // External apps registered for the primary file's extension.
  const [externalApps, setExternalApps] = useState<ExternalAppRegistration[]>([]);

  useEffect(() => {
    if (!opened || !primaryFile) {
      setExternalApps([]);
      return;
    }
    void ipc.listExternalApps().then((all) => {
      const ext = primaryFile.ext.toLowerCase();
      setExternalApps(
        all
          .filter((a) => a.extensions.length === 0 || a.extensions.includes(ext))
          .sort((a, b) => Number(b.isDefault) - Number(a.isDefault))
      );
    });
  }, [opened, primaryFile]);

  const openWith = useCallback(
    (appId: string | null, profileId: string | null = null) => {
      if (!primaryFile) return;
      void ipc.openWithExternalApp(libraryId, primaryFile.id, appId, profileId);
      onClose();
    },
    [libraryId, primaryFile, onClose]
  );

  const reveal = useCallback(() => {
    if (!primaryFile) return;
    void ipc.revealFile(libraryId, primaryFile.id);
    onClose();
  }, [libraryId, primaryFile, onClose]);

  const isSingleSelection = selectedFiles.length === 1 && primaryFile != null;

  useEffect(() => {
    if (modal.kind !== 'remove-tag') return;
    const token = ++refToken.current;
    void Promise.all(fileIds.map((id) => ipc.listTagsForFile(libraryId, id))).then((results) => {
      if (token !== refToken.current) return;
      const dedup = new Map<number, TagRecord>();
      for (const row of results) for (const t of row) dedup.set(t.id, t);
      setAppliedTags(
        [...dedup.values()].sort((a, b) =>
          a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
        )
      );
    });
  }, [modal.kind, fileIds, libraryId]);

  const close = () => {
    setModal({ kind: 'none' });
    onClose();
  };

  return (
    <>
      <Menu
        opened={opened}
        onChange={(open) => {
          if (!open) onClose();
        }}
        position="right-start"
        floatingStrategy="fixed"
        offset={0}
        middlewares={{
          flip: false,
          shift: { padding: 8 }
        }}
        withinPortal
        shadow="md"
        width={240}
        closeOnItemClick={false}
      >
        <Menu.Target>
          <div
            style={{
              position: 'fixed',
              top: Math.max(0, y - 250),
              left: x,
              width: 1,
              height: 1,
              pointerEvents: 'none'
            }}
          />
        </Menu.Target>
        <Menu.Dropdown p={0}>
          <ScrollArea.Autosize mah="calc(100vh - 20px)" type="auto" p={4}>
            <Menu.Label>
              {selectedFiles.length} file{selectedFiles.length === 1 ? '' : 's'} selected
            </Menu.Label>

            {isSingleSelection && (
              <>
                <Menu.Item
                  leftSection={<IconExternalLink size={14} />}
                  onClick={() => openWith(null)}
                >
                  Open with default app
                </Menu.Item>
                {externalApps.map((app) => {
                  const profiles = app.profiles ?? [];
                  if (profiles.length === 0) {
                    return (
                      <Menu.Item
                        key={app.id}
                        leftSection={<IconAppWindow size={14} />}
                        onClick={() => openWith(app.id)}
                      >
                        Open in {app.name}
                      </Menu.Item>
                    );
                  }
                  return (
                    <div key={app.id}>
                      <Menu.Label>Open in {app.name}</Menu.Label>
                      <Menu.Item
                        leftSection={<IconAppWindow size={14} />}
                        onClick={() => openWith(app.id, null)}
                      >
                        (no profile)
                      </Menu.Item>
                      {profiles.map((p) => (
                        <Menu.Item
                          key={p.id}
                          leftSection={<IconAppWindow size={14} />}
                          onClick={() => openWith(app.id, p.id)}
                        >
                          {p.name}
                        </Menu.Item>
                      ))}
                    </div>
                  );
                })}
                <Menu.Item
                  leftSection={<IconAppWindow size={14} />}
                  onClick={() => {
                    onClose();
                    onOpenPreferences();
                  }}
                >
                  Configure external apps…
                </Menu.Item>
                <Menu.Item
                  leftSection={<IconFolderOpen size={14} />}
                  onClick={reveal}
                >
                  Show in Folder
                </Menu.Item>
                <Menu.Divider />
              </>
            )}

            <Menu.Item
              leftSection={<IconTag size={14} />}
              onClick={() => setModal({ kind: 'add-tag' })}
            >
              Add tag…
            </Menu.Item>
            <Menu.Item
              leftSection={<IconTagOff size={14} />}
              onClick={() => setModal({ kind: 'remove-tag' })}
            >
              Remove tag…
            </Menu.Item>

            <Menu.Divider />

            <Menu.Item
              leftSection={<IconRefresh size={14} />}
              onClick={() => {
                void onBulkRerender();
                onClose();
              }}
            >
              Re-render thumbnails
            </Menu.Item>
            <Menu.Item
              leftSection={<IconEdit size={14} />}
              onClick={() => {
                onClose();
                onBatchRename();
              }}
            >
              Rename…
            </Menu.Item>
            {isSingleSelection && (
              <Menu.Item
                leftSection={<IconCopy size={14} />}
                onClick={() => {
                  onClose();
                  onDuplicate();
                }}
              >
                Duplicate
              </Menu.Item>
            )}
            <Menu.Divider />
            <Menu.Item
              leftSection={<IconTrash size={14} />}
              color="red"
              onClick={() => {
                onClose();
                onDelete();
              }}
            >
              Move to Trash…
            </Menu.Item>

            <Menu.Divider />
            <Menu.Label>Add to collection</Menu.Label>
            {collections.length === 0 && (
              <Menu.Item disabled>
                <Text size="xs" c="dimmed">
                  No collections yet
                </Text>
              </Menu.Item>
            )}
            {collections.map((c) => (
              <Menu.Item
                key={c.id}
                leftSection={<IconFolders size={14} />}
                onClick={() => {
                  void onAddToCollection(c.id, fileIds);
                  onClose();
                }}
              >
                {c.name}
              </Menu.Item>
            ))}
            <Menu.Item
              leftSection={<IconPlus size={14} />}
              onClick={() => setModal({ kind: 'new-collection' })}
            >
              New collection…
            </Menu.Item>

            {activeCollection && (
              <>
                <Menu.Divider />
                <Menu.Item
                  color="red"
                  leftSection={<IconCircleMinus size={14} />}
                  onClick={() => {
                    void onRemoveFromCollection(activeCollection.id, fileIds);
                    onClose();
                  }}
                >
                  Remove from "{activeCollection.name}"
                </Menu.Item>
              </>
            )}
          </ScrollArea.Autosize>
        </Menu.Dropdown>
      </Menu>

      <AddTagModal
        opened={modal.kind === 'add-tag'}
        allTags={allTags}
        fileCount={selectedFiles.length}
        onCancel={close}
        onConfirm={async (name) => {
          await onBulkAddTag(name);
          close();
        }}
      />

      <RemoveTagModal
        opened={modal.kind === 'remove-tag'}
        appliedTags={appliedTags}
        onCancel={close}
        onConfirm={async (tagId) => {
          await onBulkRemoveTag(tagId);
          close();
        }}
      />

      <NewCollectionModal
        opened={modal.kind === 'new-collection'}
        onCancel={close}
        onConfirm={async (name) => {
          const created = await onCreateCollection(name);
          if (created) await onAddToCollection(created.id, fileIds);
          close();
        }}
      />
    </>
  );
}

function AddTagModal({
  opened,
  allTags,
  fileCount,
  onCancel,
  onConfirm
}: {
  opened: boolean;
  allTags: TagWithCount[];
  fileCount: number;
  onCancel: () => void;
  onConfirm: (name: string) => Promise<void> | void;
}) {
  const [value, setValue] = useState('');

  useEffect(() => {
    if (opened) setValue('');
  }, [opened]);

  const suggestions = useMemo(() => allTags.map((t) => t.name), [allTags]);
  const trimmed = value.trim();
  const canSubmit = trimmed.length > 0;

  return (
    <Modal opened={opened} onClose={onCancel} title="Add tag" centered size="sm">
      <Stack gap="md">
        <Autocomplete
          label={`Tag to add to ${fileCount} file${fileCount === 1 ? '' : 's'}`}
          placeholder="Existing or new tag name"
          value={value}
          onChange={setValue}
          data={suggestions}
          data-autofocus
          onKeyDown={(e) => {
            if (e.key === 'Enter' && canSubmit) void onConfirm(trimmed);
          }}
        />
        <Group justify="flex-end" gap="sm">
          <Button variant="default" onClick={onCancel}>
            Cancel
          </Button>
          <Button disabled={!canSubmit} onClick={() => void onConfirm(trimmed)}>
            Add tag
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

function RemoveTagModal({
  opened,
  appliedTags,
  onCancel,
  onConfirm
}: {
  opened: boolean;
  appliedTags: TagRecord[];
  onCancel: () => void;
  onConfirm: (tagId: number) => Promise<void> | void;
}) {
  return (
    <Modal opened={opened} onClose={onCancel} title="Remove tag" centered size="sm">
      <Stack gap="md">
        {appliedTags.length === 0 ? (
          <Text size="sm" c="dimmed">
            None of the selected files have any tags.
          </Text>
        ) : (
          <Stack gap={2}>
            <Text size="xs" c="dimmed">
              Click a tag to remove it from every selected file.
            </Text>
            {appliedTags.map((t) => (
              <UnstyledButton
                key={t.id}
                onClick={() => void onConfirm(t.id)}
                style={{
                  padding: '6px 10px',
                  borderRadius: 4,
                  background: 'var(--mantine-color-dark-6)',
                  border: '1px solid var(--mantine-color-dark-4)'
                }}
              >
                <Group gap={6} wrap="nowrap">
                  <IconHash size={12} />
                  <Text size="sm">{t.name}</Text>
                </Group>
              </UnstyledButton>
            ))}
          </Stack>
        )}
        <Group justify="flex-end" gap="sm">
          <Button variant="default" onClick={onCancel}>
            Close
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

function NewCollectionModal({
  opened,
  onCancel,
  onConfirm
}: {
  opened: boolean;
  onCancel: () => void;
  onConfirm: (name: string) => Promise<void> | void;
}) {
  const [value, setValue] = useState('');

  useEffect(() => {
    if (opened) setValue('');
  }, [opened]);

  const trimmed = value.trim();
  const canSubmit = trimmed.length > 0;

  return (
    <Modal opened={opened} onClose={onCancel} title="New collection" centered size="sm">
      <Stack gap="md">
        <Autocomplete
          label="Name"
          placeholder="e.g. Tuesday batch"
          value={value}
          onChange={setValue}
          data={[]}
          data-autofocus
          onKeyDown={(e) => {
            if (e.key === 'Enter' && canSubmit) void onConfirm(trimmed);
          }}
        />
        <Group justify="flex-end" gap="sm">
          <Button variant="default" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            leftSection={<IconFolderPlus size={14} />}
            disabled={!canSubmit}
            onClick={() => void onConfirm(trimmed)}
          >
            Create &amp; add
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}