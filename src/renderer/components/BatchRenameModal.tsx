import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Button,
  Group,
  Modal,
  ScrollArea,
  Stack,
  Table,
  Text,
  TextInput
} from '@mantine/core';
import { IconAlertCircle, IconArrowRight } from '@tabler/icons-react';
import { notifications } from '@mantine/notifications';
import type { BatchRenameItem, FileRecord } from '@shared/types';
import { isInvalidFilename } from '@shared/rename-template';
import { PREVIEW_TRANSITION, pulseResizeBlur } from '@shared/transition';
import { ipc } from '../ipc-client';
import { GLASS_POPOVER_CLASS } from './glasseffect';

// Opens and closes like the fullscreen preview: the dialog grows out of the
// button that opened it (or the screen centre) with the same duration, easing
// and frosted-window blur as transition.ts, and shrinks back the same way.
const CONTENT_CLASS = 'gam-batch-content';

function morphKeyframes(from: DOMRect | null, to: DOMRect): Keyframe[] {
  const fromCx = from ? from.left + from.width / 2 : window.innerWidth / 2;
  const fromCy = from ? from.top + from.height / 2 : window.innerHeight / 2;
  const sx = from ? Math.max(0.05, from.width / to.width) : 0.9;
  const sy = from ? Math.max(0.05, from.height / to.height) : 0.9;
  const dx = fromCx - (to.left + to.width / 2);
  const dy = fromCy - (to.top + to.height / 2);
  return [
    { transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`, opacity: 0.2 },
    { transform: 'translate(0, 0) scale(1, 1)', opacity: 1 }
  ];
}

// Soft glass for the text boxes: pill shape, a light tint and a little blur.
const INPUT_STYLES = {
  input: {
    borderRadius: 999,
    paddingInline: 18,
    background: 'rgba(255, 255, 255, 0.06)',
    WebkitBackdropFilter: 'blur(6px)',
    backdropFilter: 'blur(6px)',
    border: '1px solid var(--wh3d-overlay-border, rgba(255, 255, 255, 0.16))'
  },
  section: { paddingLeft: 6 }
} as const;

interface Props {
  opened: boolean;
  libraryId: string | null;
  files: FileRecord[];
  onClose: () => void;
}

interface PreviewRow {
  file: FileRecord;
  newName: string;
  newRelPath: string;
  warning?: string;
  changed: boolean;
}

const cleanExt = (ext: string): string => ext.trim().replace(/^\.+/, '');

/** File name without its extension. */
function stemOf(file: FileRecord): string {
  const suffix = file.ext ? `.${file.ext}` : '';
  return suffix && file.filename.toLowerCase().endsWith(suffix.toLowerCase())
    ? file.filename.slice(0, file.filename.length - suffix.length)
    : file.filename;
}

/**
 * Batch rename with two plain boxes: Name and Extension.
 *  - Leave Name empty to keep each file's own name; type one to give every file
 *    that name. When several files end up with the same name, the 2nd, 3rd...
 *    get _2, _3... added so nothing collides.
 *  - Leave Extension empty to keep each file's own extension.
 * One selected file starts with its current name and extension filled in.
 */
export function BatchRenameModal({ opened, libraryId, files, onClose }: Props) {
  const [name, setName] = useState('');
  const [ext, setExt] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Where the dialog grows from: the element that had focus (the button that
  // opened it). Captured the moment `opened` turns true.
  const originRef = useRef<DOMRect | null>(null);
  const wasOpenRef = useRef(false);
  if (opened && !wasOpenRef.current) {
    const el = document.activeElement as HTMLElement | null;
    originRef.current = el && el !== document.body ? el.getBoundingClientRect() : null;
  }
  wasOpenRef.current = opened;

  const closingRef = useRef(false);

  useEffect(() => {
    if (!opened) return;
    closingRef.current = false;
    pulseResizeBlur();
    const frame = requestAnimationFrame(() => {
      const el = document.querySelector<HTMLElement>(`.${CONTENT_CLASS}`);
      if (!el) return;
      el.animate(morphKeyframes(originRef.current, el.getBoundingClientRect()), {
        duration: PREVIEW_TRANSITION.durationMs,
        easing: PREVIEW_TRANSITION.cssEasing,
        fill: 'both'
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [opened]);

  const close = useCallback(() => {
    const el = document.querySelector<HTMLElement>(`.${CONTENT_CLASS}`);
    if (!el || closingRef.current) {
      onClose();
      return;
    }
    closingRef.current = true;
    pulseResizeBlur();
    const frames = morphKeyframes(originRef.current, el.getBoundingClientRect()).reverse();
    const anim = el.animate(frames, {
      duration: PREVIEW_TRANSITION.durationMs,
      easing: PREVIEW_TRANSITION.cssEasing,
      fill: 'both'
    });
    const done = () => {
      closingRef.current = false;
      onClose();
    };
    anim.onfinish = done;
    anim.oncancel = done;
  }, [onClose]);

  useEffect(() => {
    if (!opened) return;
    setSubmitting(false);
    if (files.length === 1) {
      setName(stemOf(files[0]));
      setExt(files[0].ext);
    } else {
      setName('');
      setExt('');
    }
    // Only when the dialog opens, so typing is never overwritten.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opened]);

  const rows = useMemo<PreviewRow[]>(() => {
    if (files.length === 0) return [];
    const typedName = name.trim();
    const typedExt = cleanExt(ext);
    const used = new Map<string, number>();

    return files.map((file) => {
      const base = typedName === '' ? stemOf(file) : typedName;
      const extension = typedExt === '' ? file.ext : typedExt;
      const dir = file.parentDir;

      // Same name twice in one folder -> number the later ones.
      const build = (stem: string) => (extension ? `${stem}.${extension}` : stem);
      const keyOf = (n: string) => `${dir}/${n}`.toLowerCase();
      let candidate = build(base);
      const count = (used.get(keyOf(candidate)) ?? 0) + 1;
      used.set(keyOf(candidate), count);
      if (count > 1) {
        let n = count;
        candidate = build(`${base}_${n}`);
        while (used.has(keyOf(candidate))) {
          n += 1;
          candidate = build(`${base}_${n}`);
        }
        used.set(keyOf(candidate), 1);
      }

      return {
        file,
        newName: candidate,
        newRelPath: dir ? `${dir}/${candidate}` : candidate,
        warning: isInvalidFilename(candidate) ? 'Invalid filename' : undefined,
        changed: candidate !== file.filename
      };
    });
  }, [files, name, ext]);

  const anyInvalid = rows.some((r) => r.warning);
  const changedCount = rows.filter((r) => r.changed).length;
  const canSubmit = changedCount > 0 && !anyInvalid && !submitting && opened;

  const submit = async () => {
    if (!libraryId || !canSubmit) return;
    setSubmitting(true);
    try {
      const plan: BatchRenameItem[] = rows
        .filter((r) => r.changed)
        .map((r) => ({
          fileId: r.file.id,
          fromRelPath: r.file.relPath,
          toRelPath: r.newRelPath
        }));
      const result = await ipc.batchRename(libraryId, plan);
      if (result.ok) {
        notifications.show({
          color: 'green',
          title: 'Batch rename',
          message: `Renamed ${result.renamed} file${result.renamed === 1 ? '' : 's'}.`
        });
        close();
      } else if (result.collisions && result.collisions.length > 0) {
        notifications.show({
          color: 'orange',
          title: 'Rename aborted: name already exists',
          message: result.collisions.slice(0, 5).join(', ')
        });
      } else {
        notifications.show({
          color: 'red',
          title: 'Rename failed',
          message: result.error ?? 'Unknown error; changes rolled back.'
        });
      }
    } finally {
      setSubmitting(false);
    }
  };

  const onEnter = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && canSubmit) void submit();
  };

  return (
    <Modal
      opened={opened}
      onClose={close}
      title="Batch rename"
      centered
      size="xl"
      radius={20}
      classNames={{ content: `${GLASS_POPOVER_CLASS} ${CONTENT_CLASS}` }}
      overlayProps={{ backgroundOpacity: 0.35, blur: PREVIEW_TRANSITION.bgBlurPx / 3 }}
      transitionProps={{ duration: 0 }}
    >
      <Stack gap="md">
        <Group gap="sm" align="flex-start" wrap="nowrap">
          <TextInput
            label="Name"
            description={
              files.length > 1 ? 'Empty keeps each name. Duplicates get _2, _3…' : undefined
            }
            placeholder={files.length > 1 ? 'Keep original names' : 'New name'}
            value={name}
            onChange={(e) => setName(e.currentTarget.value)}
            onKeyDown={onEnter}
            data-autofocus
            styles={INPUT_STYLES}
            style={{ flex: 1 }}
          />
          <TextInput
            label="Extension"
            description={files.length > 1 ? 'Empty keeps each one' : undefined}
            placeholder="Keep original"
            leftSection={<Text size="sm" c="dimmed">.</Text>}
            value={ext}
            onChange={(e) => setExt(e.currentTarget.value)}
            onKeyDown={onEnter}
            styles={INPUT_STYLES}
            style={{ width: 170 }}
          />
        </Group>

        {anyInvalid && (
          <Alert color="red" icon={<IconAlertCircle size={14} />}>
            One or more names are invalid (no slashes or \ : * ? " &lt; &gt; |).
          </Alert>
        )}

        <ScrollArea h={300} type="auto">
          <Table withRowBorders={false} verticalSpacing={4} fz="xs">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Original</Table.Th>
                <Table.Th style={{ width: 24 }}></Table.Th>
                <Table.Th>New</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {rows.map((r) => (
                <Table.Tr key={r.file.id}>
                  <Table.Td style={{ wordBreak: 'break-all' }}>
                    <Text size="xs" c="dimmed">
                      {r.file.filename}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <IconArrowRight size={12} color="var(--mantine-color-dimmed)" />
                  </Table.Td>
                  <Table.Td style={{ wordBreak: 'break-all' }}>
                    <Text
                      size="xs"
                      c={r.warning ? 'red' : r.changed ? undefined : 'dimmed'}
                      fw={r.changed ? 500 : 400}
                    >
                      {r.newName}
                      {r.warning && ` - ${r.warning}`}
                    </Text>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </ScrollArea>

        <Group justify="flex-end">
          <Button variant="default" onClick={close}>
            Cancel
          </Button>
          <Button disabled={!canSubmit} loading={submitting} onClick={() => void submit()}>
            Rename {changedCount} file{changedCount === 1 ? '' : 's'}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}