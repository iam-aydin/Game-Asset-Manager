import { useEffect, useState } from 'react';
import { Button, Group, Modal, Stack, TextInput } from '@mantine/core';

interface Props {
  opened: boolean;
  currentName: string;
  onCancel: () => void;
  onConfirm: (name: string) => void;
}

/**
 * Rename dialog for a folder row in FolderTree. Electron does not implement
 * window.prompt() (it silently returns null with no dialog shown — unlike
 * window.alert/confirm, which do work) so a real Mantine modal is required
 * here instead of the plain prompt() that was previously used.
 */
export function FolderRenameModal({ opened, currentName, onCancel, onConfirm }: Props) {
  const [value, setValue] = useState('');

  useEffect(() => {
    if (opened) setValue(currentName);
  }, [opened, currentName]);

  const trimmed = value.trim();
  const canSubmit = trimmed.length > 0 && trimmed !== currentName;

  return (
    <Modal opened={opened} onClose={onCancel} title="Rename folder" centered size="sm">
      <Stack gap="md">
        <TextInput
          label="Name"
          value={value}
          onChange={(e) => setValue(e.currentTarget.value)}
          data-autofocus
          onKeyDown={(e) => {
            if (e.key === 'Enter' && canSubmit) onConfirm(trimmed);
          }}
        />
        <Group justify="flex-end" gap="sm">
          <Button variant="default" onClick={onCancel}>
            Cancel
          </Button>
          <Button disabled={!canSubmit} onClick={() => onConfirm(trimmed)}>
            Rename
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}