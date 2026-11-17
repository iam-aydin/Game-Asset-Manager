import { useEffect, useState } from 'react';
import { Button, Group, Modal, Stack, TextInput } from '@mantine/core';
import { GLASS_POPOVER_CLASS } from './Glasseffect';

interface Props {
  opened: boolean;
  currentName: string;
  onCancel: () => void;
  onConfirm: (newName: string) => void;
  /** Dialog title. Default "Rename folder". */
  title?: string;
  /** Text of the main button. Default "Rename". */
  confirmLabel?: string;
  /** true = the button works even when the name was not changed (used for "New folder"). */
  allowUnchanged?: boolean;
}

/** Rename / new-folder dialog in the glass style used by the other dialogs. */
export function FolderRenameGlassModal({
  opened,
  currentName,
  onCancel,
  onConfirm,
  title = 'Rename folder',
  confirmLabel = 'Rename',
  allowUnchanged = false
}: Props) {
  const [value, setValue] = useState(currentName);

  useEffect(() => {
    if (opened) setValue(currentName);
  }, [opened, currentName]);

  const trimmed = value.trim();
  const invalid = /[\\/:*?"<>|]/.test(trimmed);
  const canSubmit =
    trimmed.length > 0 && !invalid && (allowUnchanged || trimmed !== currentName);

  return (
    <Modal
      opened={opened}
      onClose={onCancel}
      title={title}
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
          error={invalid ? 'A name cannot contain \\ / : * ? " < > |' : undefined}
          onChange={(e) => setValue(e.currentTarget.value)}
          onFocus={(e) => e.currentTarget.select()}
          data-autofocus
          onKeyDown={(e) => {
            if (e.key === 'Enter' && canSubmit) {
              e.preventDefault();
              onConfirm(trimmed);
            }
          }}
        />
        <Group justify="flex-end" gap="sm">
          <Button variant="default" onClick={onCancel} radius="xl">
            Cancel
          </Button>
          <Button disabled={!canSubmit} onClick={() => onConfirm(trimmed)} radius="xl">
            {confirmLabel}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
