import { useEffect, useState } from 'react';
import { ActionIcon, Button, Divider, Group, Paper, ScrollArea, Stack, Text, Textarea, Tooltip } from '@mantine/core';
import type { ReactNode } from 'react';
import { notifications } from '@mantine/notifications';
import { IconCheck, IconClipboardText, IconCopy, IconFilePlus, IconPencil } from '@tabler/icons-react';
import type { FileRecord } from '@shared/types';
import { ipc } from '../ipc-client';
import { NEW_LICENSE_FILENAME, useSidecarLicense } from '../util/use-sidecar-license';

// Same theme variables the text viewer uses, so the card follows every theme.
const C = {
  bg: 'var(--mantine-color-body)',
  headerBg: 'var(--mantine-color-default-hover)',
  border: 'var(--mantine-color-default-border)'
};

/** A section with its own divider on top, so nothing is drawn when it is hidden. */
function Block({ children }: { children: ReactNode }) {
  return (
    <>
      <Divider />
      <Stack gap={6}>{children}</Stack>
    </>
  );
}

/**
 * The License block in the metadata panel.
 *  - A license.txt next to the file: shown in a text-viewer style card, with
 *    Edit and Copy buttons.
 *  - None, and the file is a 3D model, image, audio or video file: two buttons,
 *    "Paste license" (opens the editor with the clipboard text) and
 *    "Create license" (opens it empty). Saving writes license.txt into the
 *    file's folder.
 */
export function LicenseSection({
  libraryId,
  file,
  canCreate
}: {
  libraryId: string;
  file: FileRecord;
  canCreate: boolean;
}) {
  const { text, name, loading, update } = useSidecarLicense(libraryId, file.parentDir);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);

  // Switching to another folder closes the editor.
  useEffect(() => {
    setEditing(false);
  }, [libraryId, file.parentDir]);

  if (loading) return null;
  if (text === null && !canCreate && !editing) return null;

  const startEdit = (initial: string) => {
    setDraft(initial);
    setEditing(true);
  };

  const pasteLicense = async () => {
    try {
      const clip = await navigator.clipboard.readText();
      startEdit(clip);
      if (!clip.trim()) {
        notifications.show({ color: 'yellow', message: 'The clipboard is empty.' });
      }
    } catch {
      startEdit('');
      notifications.show({
        color: 'yellow',
        message: 'Could not read the clipboard. Paste the text into the box (Ctrl+V).'
      });
    }
  };

  const save = async () => {
    if (!draft.trim()) return;
    setSaving(true);
    try {
      const target = name ?? NEW_LICENSE_FILENAME;
      const result = await ipc.writeSidecarLicense(libraryId, file.parentDir, target, draft);
      if (result.ok) {
        update(draft, target);
        setEditing(false);
      } else {
        notifications.show({ color: 'red', title: 'Could not save license', message: result.error });
      }
    } finally {
      setSaving(false);
    }
  };

  const copy = () => {
    if (!text) return;
    void navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const title = (
    <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
      License
    </Text>
  );

  // Editor (paste / create / edit)
  if (editing) {
    return (
      <Block>
        {title}
        <Paper withBorder bg={C.bg} style={{ borderColor: C.border, borderRadius: 8, overflow: 'hidden' }}>
          <Group
            justify="space-between"
            px="sm"
            py={6}
            style={{ borderBottom: `1px solid ${C.border}`, background: C.headerBg }}
          >
            <Text size="xs" fw={600} c="dimmed" style={{ fontFamily: 'monospace' }}>
              {name ?? NEW_LICENSE_FILENAME}
            </Text>
          </Group>
          <Textarea
            autosize
            minRows={8}
            maxRows={16}
            value={draft}
            onChange={(e) => setDraft(e.currentTarget.value)}
            placeholder="License text…"
            data-autofocus
            variant="unstyled"
            px="sm"
            py={8}
            styles={{ input: { fontFamily: 'monospace', fontSize: 11, lineHeight: 1.6 } }}
          />
        </Paper>
        <Group gap={6} justify="flex-end">
          <Button size="compact-xs" variant="default" onClick={() => setEditing(false)} disabled={saving}>
            Cancel
          </Button>
          <Button size="compact-xs" onClick={() => void save()} loading={saving} disabled={!draft.trim()}>
            Save license
          </Button>
        </Group>
        <Text size="xs" c="dimmed">
          Saved as {name ?? NEW_LICENSE_FILENAME} in this file's folder.
        </Text>
      </Block>
    );
  }

  // No license yet (3D models, images, audio and video only)
  if (text === null) {
    return (
      <Block>
        {title}
        <Text size="xs" c="dimmed">
          No license file found in this folder.
        </Text>
        <Group gap={6}>
          <Button
            size="xs"
            variant="light"
            leftSection={<IconClipboardText size={14} />}
            onClick={() => void pasteLicense()}
          >
            Paste license
          </Button>
          <Button size="xs" variant="light" leftSection={<IconFilePlus size={14} />} onClick={() => startEdit('')}>
            Create license
          </Button>
        </Group>
      </Block>
    );
  }

  // Existing license, text-viewer style
  return (
    <Block>
      {title}
      <Paper withBorder bg={C.bg} style={{ borderColor: C.border, borderRadius: 8, overflow: 'hidden' }}>
        <Group
          justify="space-between"
          px="sm"
          py={6}
          style={{ borderBottom: `1px solid ${C.border}`, background: C.headerBg }}
        >
          <Text size="xs" fw={600} c="dimmed" style={{ fontFamily: 'monospace' }}>
            {name}
          </Text>
          <Group gap={4}>
            <Tooltip label="Edit license" withinPortal>
              <ActionIcon variant="subtle" color="gray" size="sm" onClick={() => startEdit(text)} aria-label="Edit license">
                <IconPencil size={14} />
              </ActionIcon>
            </Tooltip>
            <Tooltip label={copied ? 'Copied' : 'Copy'} withinPortal>
              <ActionIcon variant="subtle" color={copied ? 'teal' : 'gray'} size="sm" onClick={copy} aria-label="Copy license">
                {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
              </ActionIcon>
            </Tooltip>
          </Group>
        </Group>
        <ScrollArea.Autosize mah={240} type="auto">
          <Text
            component="pre"
            size="xs"
            m={0}
            px="sm"
            py={8}
            style={{ fontFamily: 'monospace', fontSize: 11, lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
          >
            {text}
          </Text>
        </ScrollArea.Autosize>
      </Paper>
    </Block>
  );
}