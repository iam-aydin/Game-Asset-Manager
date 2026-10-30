import { useEffect, useState } from 'react';
import { Button, Divider, Group, Modal, Stack, Text } from '@mantine/core';
import type { FolderInfo } from '@shared/types';
import { ipc } from '../ipc-client';
import { GLASS_POPOVER_CLASS } from './Glasseffect';

interface Props {
  opened: boolean;
  libraryId: string | null;
  /** Folder path relative to the library root ("" = the library itself). */
  path: string;
  name: string;
  onClose: () => void;
}

type State =
  | { status: 'loading' }
  | { status: 'ready'; info: FolderInfo }
  | { status: 'error'; error: string };

/** Explorer style: "0.98 GB", "452 KB", "12.5 MB" (switches unit at 1000). */
function formatSize(bytes: number): string {
  if (bytes < 1000) return `${bytes} bytes`;
  const units = ['bytes', 'KB', 'MB', 'GB', 'TB'];
  let v = bytes;
  let i = 0;
  while (v >= 1000 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  const out = v < 10 ? Math.floor(v * 100) / 100 : v < 100 ? Math.floor(v * 10) / 10 : Math.floor(v);
  return `${out} ${units[i]}`;
}

function sizeWithBytes(bytes: number): string {
  return `${formatSize(bytes)} (${bytes.toLocaleString()} bytes)`;
}

function formatDate(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '-';
  return new Date(ms).toLocaleString(undefined, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit'
  });
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '110px 1fr', gap: 12, alignItems: 'baseline' }}>
      <Text size="sm" c="dimmed">
        {label}
      </Text>
      <Text size="sm" style={{ wordBreak: 'break-all' }}>
        {value}
      </Text>
    </div>
  );
}

/** Folder properties dialog in the glass style, laid out like Explorer's Properties window. */
export function FolderInfoGlassModal({ opened, libraryId, path, name, onClose }: Props) {
  const [state, setState] = useState<State>({ status: 'loading' });

  useEffect(() => {
    if (!opened || !libraryId) return;
    let cancelled = false;
    setState({ status: 'loading' });
    ipc
      .getFolderInfo(libraryId, path)
      .then((r) => {
        if (cancelled) return;
        setState(r.ok ? { status: 'ready', info: r.info } : { status: 'error', error: r.error });
      })
      .catch((err: unknown) => {
        if (!cancelled) setState({ status: 'error', error: String((err as Error)?.message ?? err) });
      });
    return () => {
      cancelled = true;
    };
  }, [opened, libraryId, path]);

  const ready = state.status === 'ready' ? state.info : null;
  const pending = state.status === 'loading' ? 'Calculating...' : '-';

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title="Folder info"
      centered
      size={480}
      radius="lg"
      overlayProps={{ backgroundOpacity: 0.45, blur: 6 }}
      classNames={{ content: GLASS_POPOVER_CLASS }}
    >
      <Stack gap="sm">
        <Row label="Name" value={name || '-'} />
        <Row label="Location" value={ready ? ready.location : pending} />
        <Divider />
        <Row label="Size" value={ready ? sizeWithBytes(ready.sizeBytes) : pending} />
        <Row label="Size on disk" value={ready ? sizeWithBytes(ready.sizeOnDiskBytes) : pending} />
        <Row
          label="Contains"
          value={
            ready
              ? `${ready.fileCount.toLocaleString()} Files, ${ready.folderCount.toLocaleString()} Folders`
              : pending
          }
        />
        <Divider />
        <Row label="Created" value={ready ? formatDate(ready.createdMs) : pending} />
        <Row label="Modified" value={ready ? formatDate(ready.modifiedMs) : pending} />
        {state.status === 'error' && (
          <Text size="xs" c="red">
            {state.error}
          </Text>
        )}
        <Group justify="flex-end" gap="sm" mt="xs">
          <Button
            variant="default"
            radius="xl"
            disabled={!ready}
            onClick={() => {
              if (!ready) return;
              try {
                void navigator.clipboard.writeText(ready.absolutePath);
              } catch {
                // ignore
              }
            }}
          >
            Copy path
          </Button>
          <Button
            variant="default"
            radius="xl"
            disabled={!libraryId}
            onClick={() => {
              if (libraryId) void ipc.revealFolder(libraryId, path);
            }}
          >
            Show in folder
          </Button>
          <Button radius="xl" onClick={onClose}>
            Close
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}