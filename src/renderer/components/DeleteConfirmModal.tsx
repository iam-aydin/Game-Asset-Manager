import { Button, Group, Modal, Stack, Text } from '@mantine/core';
import { IconTrash } from '@tabler/icons-react';
import type { FileRecord } from '@shared/types';
import { GLASS_POPOVER_CLASS } from './Glasseffect';

interface Props {
  opened: boolean;
  files: FileRecord[];
  onCancel: () => void;
  onConfirm: () => void;
}

const MAX_SHOWN = 6;

export function DeleteConfirmModal({ opened, files, onCancel, onConfirm }: Props) {
  const count = files.length;
  const shown = files.slice(0, MAX_SHOWN);
  const more = count - shown.length;

  return (
    <Modal
      opened={opened}
      onClose={onCancel}
      centered
      radius="lg"
      size={430}
      title="Move to Trash"
      overlayProps={{ backgroundOpacity: 0.45, blur: 6 }}
      classNames={{ content: GLASS_POPOVER_CLASS }}
    >
      <Stack gap="sm">
        <Text size="sm">
          {count === 1
            ? 'This file will be moved to the Trash:'
            : `These ${count} files will be moved to the Trash:`}
        </Text>

        <Stack
          gap={2}
          style={{
            padding: '8px 10px',
            borderRadius: 10,
            background: 'rgba(0, 0, 0, 0.22)',
            border: '1px solid rgba(255, 255, 255, 0.12)'
          }}
        >
          {shown.map((f) => (
            <Text key={f.id} size="xs" truncate title={f.relPath}>
              {f.filename}
            </Text>
          ))}
          {more > 0 && (
            <Text size="xs" c="dimmed">
              and {more} more...
            </Text>
          )}
        </Stack>

        <Text size="xs" c="dimmed">
          Nothing is deleted for good. You can restore files from the Trash.
        </Text>

        <Group justify="flex-end" gap="xs" mt={4}>
          <Button variant="subtle" color="gray" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            color="red"
            leftSection={<IconTrash size={15} />}
            onClick={onConfirm}
            data-autofocus
          >
            Move to Trash
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}