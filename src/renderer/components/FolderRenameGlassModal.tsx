import { useEffect, useState } from 'react';
import { Button, Group, Modal, Stack, TextInput } from '@mantine/core';
import { GLASS_POPOVER_CLASS } from './Glasseffect';

interface Props {
  opened: boolean;
  currentName: string;
  onCancel: () => void;
  onConfirm: (newName: string) => void;
}

/** Rename-folder dialog in the glass style used by the other dialogs. */
export function FolderRenameGlassModal({ opened, currentName, onCancel, onConfirm }: Props) {
  const [value, setValue] = useState(currentName);

  useEffect(() => {
    if (opened) setValue(currentName);
  }, [opened, currentName]);

  const trimmed = value.trim();
  const canSubmit = trimmed.length > 0 && trimmed !== currentName;

  return (
    <Modal
      opened={opened}
      onClose={onCancel}
      title="Rename folder"
      centered
      size="sm"
      radius="lg"
      overlayProps={{ backgroundOpacity: 0.45, blur: 6 }}
      classNames={{ content: GLASS_POPOVER_CLASS }}
    >
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
          <Button variant="default" onClick={onCancel} radius="xl">
            Cancel
          </Button>
          <Button disabled={!canSubmit} onClick={() => onConfirm(trimmed)} radius="xl">
            Rename
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}